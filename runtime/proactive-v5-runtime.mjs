// Stage V runtime shell: parsing, commands, timer and thin notice/incoming adapters.
import { preGate } from './natural-intent.mjs'
// The SQLite store remains in proactive-v5.mjs; this file has no import side effects.
export function cnNumber(raw) {
  const s = String(raw || '')
  if (/^\d+$/.test(s)) return Number(s)
  const d = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (s === '十') return 10
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0)
  return null
}

export function parseReminder(text) {
  let s = String(text || '').trim().replace(/^(亚托莉|托莉|小托|atri)[，,。.\s]*/i, '')
  const now = Date.now()
  if (/(^|[^0-9])[-−]\s*\d|\d+[.．]\d/.test(s)) return null
  const timeHits = [...s.matchAll(/(?:[0-9一二两三四五六七八九十]+\s*(?:分钟|小时)后)|(?:明天\s*\d{1,2}\s*[:：点])|(?:\d{1,2}\s*[:：点]\s*\d{0,2})/g)]
  if (timeHits.length > 1) return null
  let nb = null, m = s.match(/([0-9一二两三四五六七八九十]+)\s*(分钟|小时)后/)
  if (m) {
    const n = cnNumber(m[1])
    if (n !== null && n >= 1 && n <= (m[2] === '小时' ? 48 : 48 * 60)) nb = now + n * (m[2] === '小时' ? 3600000 : 60000)
  } else {
    const dates = [...s.matchAll(/明天\s*(\d{1,2})\s*[:：点]\s*(\d{1,2}|半)?/g)]
    m = dates[0] || null
    if (dates.length > 1) return null
    if (m) {
      const h = Number(m[1]), min = m[2] === '半' ? 30 : Number(m[2] || 0)
      if (h < 1 || h > 23 || min < 0 || min > 59) return null
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(h, min, 0, 0)
      nb = d.getTime()
    }
  }
  if (nb === null) return null
  const rest = s.replace(m[0], '').replace(/^\s*提醒我\s*/, '').replace(/^(提醒我|记得)\s*/, '').replace(/[，,。.]$/, '').trim()
  if (!rest || rest.length > 60) return null
  return { notBefore: nb, text: rest }
}

export function classifyProactiveTone({ topic = '' } = {}) {
  const t = String(topic || '')
  if (/面试|考试|答辩|报名|准考证|吃药|药量|医院|复诊|过敏|身体不适|截止|提交|交付|开会|合同|付款|安全|地址|门牌|接送地点|火|炉|燃气|电|插座|关阀|驾驶|药|剂量/.test(t)) return Object.freeze({ tone: 'serious', reason: 'high_risk' })
  if (/认真点|别开玩笑|正经一点/.test(t)) return Object.freeze({ tone: 'serious', reason: 'explicit' })
  if (/^(喝水|吃饭|休息|睡觉|睡一会|喂猫|看猫|打一局游戏|玩游戏)$/.test(t)) return Object.freeze({ tone: 'light', reason: 'low_risk_whitelist' })
  return Object.freeze({ tone: 'neutral', reason: 'default' })
}

export function createProactiveV5Runtime({
  store,
  sendPrivate,
  onReceipt = null,
  isOwner,
  getConfig = () => ({}),
  isSleeping = () => false,
  isNight = () => false,
  isMuted = () => false,
  isPaused = () => false,
  log = () => {},
  clock = Date.now,
  offsetMinutes = () => -new Date().getTimezoneOffset(),
  setIntervalFn = setInterval,
  renderText = null,
} = {}) {
  if (!store || typeof sendPrivate !== 'function' || typeof isOwner !== 'function') throw new TypeError('invalid proactive runtime')
  let started = false
  let timer = null

  async function natural(facts, fallback) {
    try {
      if (typeof renderText !== 'function') return fallback
      const tone = classifyProactiveTone({ topic: facts?.topic }).tone
      const t = await renderText({ phase: facts?.phase, facts: { ...(facts || {}), tone } })
      if (typeof t !== 'string' || !t.trim() || t.length > 60 || /[\r\n]|https?:\/\//i.test(t)) return fallback
      return t.trim()
    } catch { return fallback }
  }
  function whenText(nb) {
    const mins = Math.max(1, Math.round((nb - clock()) / 60000))
    return mins < 60 ? `${mins}分钟后` : `${Math.floor(mins / 60)}小时后`
  }

  async function handleCommand(data, uid) {
    if (!isOwner(uid) || data.message_type !== 'private') return false
    const text = String(data.raw_message || data.message?.map?.(x => x?.data?.text || '').join('') || '').trim()
    if (!text) return false
    if (/^(开启|同意)主动联系$/.test(text)) {
      store.grant(uid, data.message_id)
      await sendPrivate(uid, await natural({ phase: 'optin' }, '好，我会记着；不想被提醒的时候，跟我说关掉就好。'))
      return true
    }
    if (/^关闭主动联系$/.test(text)) {
      store.revoke(uid)
      await sendPrivate(uid, await natural({ phase: 'optout' }, '好，我停下来了。想再开的时候再跟我说。'))
      return true
    }
    if (/^主动联系状态$/.test(text)) {
      const st = store.status(uid)
      await sendPrivate(uid, await natural({ phase: 'status', allowed: !!st.consent?.allowed }, st.consent?.allowed ? '主动提醒现在开着。' : '主动提醒现在是关着的。'))
      return true
    }
    const callback = text.match(/^(?:亚托莉[，,。.\s]*)?晚点找我接着聊[：:]\s*(.+)$/)
    if (callback) {
      const topic = String(callback[1] || '').trim().replace(/[\r\n]+/g, ' ')
      if (topic.length < 2 || topic.length > 40 || /[\u0000-\u001f\u007f]|https?:\/\/|www\./i.test(topic)) return false
      const st = store.status(uid)
      if (!st.consent) store.ensureDefaultConsent(uid, data.message_id)
      else if (!st.consent.allowed) { await sendPrivate(uid, await natural({ phase: 'blocked', reason: 'optout' }, '主动提醒现在是关着的。要重新开，发“开启主动联系”。')); return true }
      const now = clock()
      const r = store.schedule({ uid, text: topic, kind: 'callback_once', notBefore: now + 3 * 3600000, expiresAt: now + 24 * 3600000, sourceEventId: data.message_id })
      try { log(`[主动v5] callback ${r.ok ? r.notBefore : r.reason}`) } catch {}
      const fallback = r.ok ? `好，${whenText(r.notBefore)}我接着你提的「${topic}」找你。` : '这次没排上；等手上那件提醒过去再说。'
      await sendPrivate(uid, await natural({ phase: r.ok ? 'scheduled' : 'blocked', whenText: r.ok ? whenText(r.notBefore) : null, topic, reason: r.ok ? null : r.reason }, fallback))
      return true
    }
    const gate = preGate(text)
    if (!gate.allowed) {
      if (gate.kind === 'negative' && /(提醒|叫|喊)/.test(text)) {
        try { store.cancel(uid) } catch {}
        await sendPrivate(uid, await natural({ phase: 'optout', reason: 'cancel_reminder' }, '好，不提醒了。'))
        return true
      }
      return false
    }
    // Task execution/confirmation is a separate capability gate. Do not swallow
    // ordinary drawing/tool requests here; let the normal chat pipeline handle them.
    if (gate.kind === 'task_request') return false
    const rem = parseReminder(text)
    if (rem) {
      const st = store.status(uid)
      if (!st.consent) store.ensureDefaultConsent(uid, data.message_id)
      else if (!st.consent.allowed) { await sendPrivate(uid, await natural({ phase: 'blocked', reason: 'optout' }, '主动提醒现在是关着的。要重新开，发“开启主动联系”。')); return true }
      const r = store.schedule({ uid, text: rem.text, kind: 'agreed_once', notBefore: rem.notBefore, expiresAt: rem.notBefore + 86400000, sourceEventId: data.message_id })
      try { log(`[主动v5] 排期 ${r.ok ? r.notBefore : r.reason} ${rem.text}`) } catch {}
      const fallback = r.ok ? `好，${whenText(r.notBefore)}提醒你「${rem.text}」。` : '这次没排上；等手上那件提醒过去再说。'
      await sendPrivate(uid, await natural({ phase: r.ok ? 'scheduled' : 'blocked', whenText: r.ok ? whenText(r.notBefore) : null, topic: rem.text, reason: r.ok ? null : r.reason }, fallback))
      return true
    }
    if (/(提醒我|叫我)/.test(text) && /(过一会|一会|晚点|待会|等会|晚些)/.test(text)) {
      const st = store.status(uid)
      if (!st.consent) store.ensureDefaultConsent(uid, data.message_id)
      await sendPrivate(uid, await natural({ phase: 'clarify', reason: 'needs_time' }, '你想隔多久让我叫你？'))
      return true
    }
    return false
  }

  async function tick() {
    try {
      if (getConfig()?.proactiveV5?.enabled === false) return
      if (isPaused()) return
      const job = store.due(clock(), offsetMinutes())
      if (!job || !isOwner(job.uid)) return
      const st = store.status(job.uid)
      if (!st.consent?.allowed || st.consent.version !== job.consentVersion
        || isSleeping() || isNight() || isMuted(job.uid)) {
        store.finish(job.token, 'failed', null)
        return
      }
      const fallback = job.kind === 'callback_once' ? `接着你提的「${job.text}」` : `提醒你：「${job.text}」`
      const outgoing = await natural({ phase: 'due', kind: job.kind, topic: job.text }, fallback)
      if (isPaused()) return
      if (!outgoing || outgoing.length > 60) { store.finish(job.token, 'failed', null); return }
      if (!store.validateSending(job.token, job.consentVersion, job.sourceEventId ? [job.sourceEventId] : [])) { store.finish(job.token, 'failed', null); return }
      let outcome = 'unknown'
      let raw = null
      try {
        raw = await sendPrivate(job.uid, outgoing)
        outcome = (raw?.status === 'ok' && raw?.retcode === 0) ? 'confirmed' : 'failed'
      } catch { outcome = 'unknown' }
      const sourceIds = job.sourceEventId ? [job.sourceEventId] : []
      const preFinishValid = !!store.validateSending(job.token, job.consentVersion, sourceIds)
      const finishAccepted = store.finish(job.token, outcome, outcome === 'confirmed' ? 'sent' : null) === true
      if (typeof onReceipt === 'function') {
        try {
          onReceipt({
            uid: String(job.uid), token: String(job.token), consentVersion: job.consentVersion,
            sourceIds, receipt: raw ? { status: raw.status, retcode: raw.retcode, messageId: raw?.data?.message_id ?? null } : null,
            outcome, preFinishValid, finishAccepted, text: String(outgoing), kind: job.kind || '', sourceEventId: String(job.sourceEventId || ''),
          })
        } catch {}
      }
      try { log(`[主动v5] ${outcome} ${job.uid}`) } catch {}
    } catch (e) {
      try { log('[主动v5] tick异常：' + String(e.message).slice(0, 80)) } catch {}
    }
  }

  function cancelJob(uid, id) {
    if (!store.cancelJob) return { ok: false, error: 'unsupported' }
    return store.cancelJob({ uid, id })
  }

  return Object.freeze({
    parseReminder,
    handleCommand,
    tick,
    cancelJob,
    notice(data, selfId) {
      if (data?.post_type !== 'notice' || data.notice_type !== 'friend_recall') return false
      const uid = String(data.user_id) === String(selfId) ? String(data.target_id || '') : String(data.user_id || '')
      return store.revokeSource(uid, String(data.message_id || ''))
    },
    markIncoming(uid) { return store.markIncoming(uid) },
    start() {
      if (started) return false
      started = true
      try { store.invalidateCallbacks?.() } catch {}
      timer = setIntervalFn(tick, 30000)
      log('主动联系 v5 已启动：owner 私聊自动授权；可随时关闭；只做明确提醒/约定回调')
      return true
    },
    stop() {
      if (timer) { try { clearInterval(timer) } catch {}; timer = null }
      started = false
    },
  })
}
