// Deterministic Shanghai-day cue parsing. No model, no guessing of people or
// scenes: only explicit date words the owner actually typed.
const DAY = 86400000
const ZONE = 'Asia/Shanghai'

function ymd(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Number(ms)))
  const o = {}
  for (const p of parts) if (p.type !== 'literal') o[p.type] = p.value
  return `${o.year}-${o.month}-${o.day}`
}

function dayStart(ms) {
  return Date.parse(`${ymd(ms)}T00:00:00+08:00`)
}

/** @returns {{label:string,start:number,end:number}|null} */
export function parseExplicitTimeCue(text, now = Date.now()) {
  const s = String(text || '')
  const base = dayStart(now)
  let label = ''
  let offset = null
  if (/前天|前日/.test(s)) { label = '前天'; offset = -2 }
  else if (/昨天|昨日/.test(s)) { label = '昨天'; offset = -1 }
  else if (/今天|今日/.test(s)) { label = '今天'; offset = 0 }
  if (offset !== null) return { label, start: base + offset * DAY, end: base + (offset + 1) * DAY }
  const full = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/)
  if (full) {
    const start = Date.parse(`${full[1]}-${String(full[2]).padStart(2, '0')}-${String(full[3]).padStart(2, '0')}T00:00:00+08:00`)
    if (Number.isFinite(start)) return { label: `${full[1]}-${full[2]}-${full[3]}`, start, end: start + DAY }
  }
  const md = s.match(/(\d{1,2})月(\d{1,2})日/)
  if (md) {
    const start = Date.parse(`${ymd(now).slice(0, 4)}-${String(md[1]).padStart(2, '0')}-${String(md[2]).padStart(2, '0')}T00:00:00+08:00`)
    if (Number.isFinite(start)) return { label: `${md[1]}月${md[2]}日`, start, end: start + DAY }
  }
  return null
}

export { DAY, ZONE }
