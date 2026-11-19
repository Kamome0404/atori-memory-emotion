// Pure Asia/Shanghai wall-clock label for one hippocampus event.
// No IO, no deletion, no thread/clock mutation. The caller keeps the record current.
const ZONE = 'Asia/Shanghai'
const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']
const DAY_MS = 86400000

function parts(ms, zone = ZONE) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const out = {}
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = p.value
  return { y: +out.year, m: +out.month, d: +out.day, hh: out.hour, mm: out.minute }
}

function dayNumber(p) {
  return Date.UTC(p.y, p.m - 1, p.d) / DAY_MS
}

function unavailable(evidence = null) {
  return { available: false, label: '', absolute: '', elapsedDays: null, evidence, block: '' }
}

function clip(text, max) {
  if (!Number.isFinite(Number(max)) || Number(max) <= 0) return ''
  const a = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  return a.length > max ? a.slice(0, Math.max(0, max - 1)).join('') + '…' : a.join('')
}

/**
 * @param {object} input
 * @param {{eventId?:string,at?:number,text?:string}} input.event
 * @param {number} [input.now]
 * @param {string} [input.zone]
 * @param {number|null} [input.gap]  optional gap evidence; negative/non-finite makes the label unavailable
 * @param {boolean} [input.sourceCurrent]
 */
export function projectMemoryTime({ event, now = Date.now(), zone = ZONE, gap = null, sourceCurrent = true } = {}) {
  if (!event || sourceCurrent === false) return unavailable(event ? { scope: event.scope, uid: event.uid, eventId: event.eventId, at: event.at } : null)
  // This projection is deliberately Shanghai-only; a different zone would make
  // the absolute string (hard-coded +08:00) lie about the clock.
  if (zone !== ZONE) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at: event.at })
  if (event.at == null || event.at === '') return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at: event.at })
  const at = Number(event.at)
  const t = Number(now)
  if (!Number.isFinite(at) || !Number.isFinite(t) || at > t) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at: event.at })
  if (gap != null && (!Number.isFinite(Number(gap)) || Number(gap) < 0)) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at })
  try {
    const e = parts(at, zone)
    const n = parts(t, zone)
    const elapsedDays = dayNumber(n) - dayNumber(e)
    if (elapsedDays < 0) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at })
    const absolute = `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')} ${e.hh}:${e.mm} +08:00`
    const eventDow = new Date(Date.UTC(e.y, e.m - 1, e.d)).getUTCDay()
    const nowDow = new Date(Date.UTC(n.y, n.m - 1, n.d)).getUTCDay()
    const nowDay = dayNumber(n)
    const monday = nowDay - ((nowDow + 6) % 7) // Monday 00:00 in Shanghai
    let label
    if (elapsedDays === 0) label = '今天'
    else if (elapsedDays === 1) label = '昨天'
    else if (elapsedDays === 2) label = '前天'
    else if (dayNumber(e) >= monday - 7 && dayNumber(e) <= monday - 1) label = '上周' + WEEKDAY[eventDow]
    else if (elapsedDays < 7) label = `${elapsedDays}天前`
    else label = `${e.m}月${e.d}日`
    const rawId = String(event.eventId || 'memory')
    const suffix = `] ${absolute} · ${label}`
    // Keep the evidence head (time + label) even when the eventId is long.
    // The full ID stays in structured evidence; the block may show a clipped ID.
    let id = Array.from(rawId).join('')
    let head = `[${id}${suffix}`
    if (Array.from(head).length > 220) {
      const room = 220 - Array.from(suffix).length - 1
      if (room < 2) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at })
      id = Array.from(rawId).slice(0, Math.max(1, room - 1)).join('') + '…'
      head = `[${id}${suffix}`
      if (Array.from(head).length > 220) return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at })
    }
    const remaining = 220 - Array.from(head).length - 1
    const text = clip(event.text, Math.max(0, Math.min(100, remaining)))
    const block = head + (text ? `\n${text}` : '')
    return {
      available: true,
      label,
      absolute,
      elapsedDays,
      evidence: { scope: event.scope, uid: event.uid, eventId: event.eventId, at },
      block,
    }
  } catch {
    return unavailable({ scope: event.scope, uid: event.uid, eventId: event.eventId, at })
  }
}
