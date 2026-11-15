// Deterministic request gate + conservative time parser.
// The LLM may propose an intent later, but cannot grant execution here.
export function preGate(text) {
  const s = String(text || '').trim()
  if (!s) return { allowed: false, kind: 'empty', reason: 'empty' }
  const positiveDoNotForget = /别忘了.{0,6}(提醒|叫我)/.test(s)
  const quoted = /(他说|她说|我说|刚才说|如果|假如|要是|例句|举例|例子|引用|不是说|你觉得)/.test(s)
    || /[“”"「『].{0,50}(提醒|叫|喊)/.test(s)
  if (quoted) return { allowed: false, kind: 'unclear', reason: 'quoted_or_hypothetical' }
  const negative = /(不用|不要|不必|无需|没必要|别再|别乱|别给我|别在).{0,24}(提醒|叫|喊)|取消.{0,8}(提醒|叫)|没让你|不是让你|别叫我|别喊我|别提醒我/.test(s)
  if (negative) return { allowed: false, kind: 'negative', reason: 'negative' }
  if (/(提醒我|叫我|喊我|帮我记着|记得.{0,6}(提醒|叫)|晚点.{0,6}(接着聊|找我)|到时.{0,6}(叫我|提醒))/.test(s)) {
    return { allowed: true, kind: 'reminder', reason: 'explicit' }
  }
  if (/(帮我|给我|替我).{1,40}/.test(s)) {
    return { allowed: true, kind: 'task_request', reason: 'task_proposal_only' }
  }
  return { allowed: false, kind: 'statement', reason: 'no_request' }
}

export function cnNumber(raw) {
  const s = String(raw || '')
  if (/^\d+$/.test(s)) return Number(s)
  const d = { 零:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 }
  if (s === '十') return 10
  const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0)
  return null
}

export function parseTimeSpan(text, { now = Date.now() } = {}) {
  const s = String(text || '').trim()
  let m = s.match(/([0-9一二两三四五六七八九十]+)\s*(分钟|小时)后/)
  if (m) {
    const n = cnNumber(m[1])
    if (n === null || n <= 0 || n > 48 * 60) return null
    return { notBefore: now + n * (m[2] === '小时' ? 3600000 : 60000), unit: m[2], value: n }
  }
  m = s.match(/明天\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/)
  if (m) {
    const h = Number(m[1]), min = Number(m[2] || 0)
    if (h < 1 || h > 23 || min < 0 || min > 59) return null
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(h, min, 0, 0)
    return { notBefore: d.getTime(), unit: 'date', value: `${h}:${min}` }
  }
  return null
}
