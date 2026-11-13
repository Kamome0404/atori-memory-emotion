// Stage V runtime shell: parsing, commands, timer and thin notice/incoming adapters.
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
  let nb = null, m = s.match(/([0-9一二两三四五六七八九十]+)\s*(分钟|小时)后/)
  if (m) {
    const n = cnNumber(m[1])
    if (n !== null) nb = now + n * (m[2] === '小时' ? 3600000 : 60000)
  } else {
    m = s.match(/明天\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/)
    if (m) {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(Number(m[1]), Number(m[2] || 0), 0, 0)
      nb = d.getTime()
    }
  }
  if (nb === null) return null
  const rest = s.replace(m[0], '').replace(/^\s*提醒我\s*/, '').replace(/^(提醒我|记得)\s*/, '').replace(/[，,。.]$/, '').trim()
  if (!rest || rest.length > 60) return null
  return { notBefore: nb, text: rest }
}

export function createProactiveV5Runtime({
  store,
  sendPrivate,
  isOwner,
  getConfig = () => ({}),
  isSleeping = () => false,
  isNight = () => false,
  isMuted = () => false,
  log = () => {},
  clock = Date.now,
  offsetMinutes = () => -new Date().getTimezoneOffset(),
  setIntervalFn = setInterval,
} = {}) {
  if (!store || typeof sendPrivate !== 'function' || typeof isOwner !== 'function') throw new TypeError('invalid proactive runtime')
  let started = false
  let timer = null

  async function handleCommand(data, uid) {
    if (!isOwner(uid) || data.message_type !== 'private') return false
    const text = String(data.raw_message || data.message?.map?.(x => x?.data?.text || '').join('') || '').trim()
    if (!text) return false
    if (/^(开启|同意)主动联系$/.test(text)) {
      store.grant(uid, data.message_id)
      await sendPrivate(uid, '好，我只在明确约定的事情上主动找你；随时发“关闭主动联系”可以停。')
      return true
    }
    if (/^关闭主动联系$/.test(text)) {
      store.revoke(uid)
      await sendPrivate(uid, '好，主动联系已经关了，现有待发也取消。')
      return true
    }
    if (/^主动联系状态$/.test(text)) {
      const st = store.status(uid)
      await sendPrivate(uid, st.consent?.allowed ? '主动联系：开' : '主动联系：关')
      return true
    }
    const rem = parseReminder(text)
    if (rem) {
      const r = store.schedule({ uid, text: rem.text, kind: 'agreed_once', notBefore: rem.notBefore, expiresAt: rem.notBefore + 86400000, sourceEventId: data.message_id })
      try { log(`[主动v5] 排期 ${r.ok ? r.notBefore : r.reason} ${rem.text}`) } catch {}
      await sendPrivate(uid, r.ok ? '记下了，到点我提醒你。' : '这次没排上；先发“开启主动联系”，或者取消现有待办。')
      return true
    }
    return false
  }

  async function tick() {
    try {
      if (getConfig()?.proactiveV5?.enabled === false) return
      const job = store.due(clock(), offsetMinutes())
      if (!job || !isOwner(job.uid)) return
      const st = store.status(job.uid)
      if (!st.consent?.allowed || st.consent.version !== job.consentVersion
        || isSleeping() || isNight() || isMuted(job.uid)) {
        store.finish(job.token, 'failed', null)
        return
      }
      let outcome = 'unknown'
      try {
        const r = await sendPrivate(job.uid, job.text)
        outcome = (r?.status === 'ok' && r?.retcode === 0) ? 'confirmed' : 'failed'
      } catch { outcome = 'unknown' }
      store.finish(job.token, outcome, outcome === 'confirmed' ? 'sent' : null)
      try { log(`[主动v5] ${outcome} ${job.uid}`) } catch {}
    } catch (e) {
      try { log('[主动v5] tick异常：' + String(e.message).slice(0, 80)) } catch {}
    }
  }

  return Object.freeze({
    parseReminder,
    handleCommand,
    tick,
    notice(data, selfId) {
      if (data?.post_type !== 'notice' || data.notice_type !== 'friend_recall') return false
      const uid = String(data.user_id) === String(selfId) ? String(data.target_id || '') : String(data.user_id || '')
      return store.revokeSource(uid, String(data.message_id || ''))
    },
    markIncoming(uid) { return store.markIncoming(uid) },
    start() {
      if (started) return false
      started = true
      timer = setIntervalFn(tick, 30000)
      log('主动联系 v5 已启动：默认关，只接受明确开启和约定提醒')
      return true
    },
    stop() {
      if (timer) { try { clearInterval(timer) } catch {}; timer = null }
      started = false
    },
  })
}
