// Conservative B1 context gate.
// Only exact, current-topic object mentions are eligible. No inference, no
// vector search, no third-party/quoted statements.
import { PREFERENCE_TERMS } from './preference-registry.mjs'
const TERMS = PREFERENCE_TERMS
const QUOTED = /["“”‘’]|(?:朋友|同学|同事|他|她|别人|有人说|据说)(?:说|觉得|喜欢|爱)/
const CURRENT_SELF = /^我(?:不喜欢|喜欢)(?:喝|吃|听|看)/
const FOLLOW = /^(?:$|[还或吗呢吧啊呀的了吗嘛但也而且，,。.？?！!、；;：:\s])/u
const PREFIX_OK = /^(?:$|[喝吃听看想买点来要杯碗份个些去在和跟还于是有无法欢爱我、，,；;：:\s（(【[「"'])$/u

export function findPreferenceMentions(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 300) return []
  if (QUOTED.test(text)) return []
  const trimmed = text.trim()
  // Self-referential only: no "咖啡因是什么" or "你想..." lookups.
  if (!/^我/.test(trimmed)) return []
  const isQuestion = /[？?]|吗|呢|什么|哪个|还是|要不要/.test(trimmed)
  if (!isQuestion) return []
  const matches = []
  for (const term of TERMS) {
    let from = 0
    while (from <= text.length - term.object.length) {
      const at = text.indexOf(term.object, from)
      if (at < 0) break
      const before = text[at - 1] || ''
      const after = text[at + term.object.length] || ''
      if (PREFIX_OK.test(before) && FOLLOW.test(after)) matches.push({ activity: term.activity, object: term.object, at })
      from = at + 1
    }
  }
  matches.sort((a, b) => b.object.length - a.object.length || a.at - b.at)
  const selected = []
  for (const m of matches) {
    const overlaps = selected.some(x => m.at < x.at + x.object.length && x.at < m.at + m.object.length)
    if (overlaps) continue
    if (selected.some(x => x.activity === m.activity && x.object === m.object)) continue
    selected.push(m)
  }
  return selected.sort((a, b) => a.at - b.at || a.object.localeCompare(b.object, 'zh'))
}

export function findPreferenceMention(text) {
  const [m] = findPreferenceMentions(text)
  return m ? { activity: m.activity, object: m.object } : null
}


export function isPreferenceQuery(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 300) return false
  const t = text.trim()
  // Recall questions may omit 吗/？ entirely.
  if (/(?:记得|还记得)/.test(t) && PREFERENCE_TERMS.some(x => t.includes(x.object))) return true
  if (!/[？?]|吗|呢|什么|哪个|还是|要不要/.test(t)) return false
  if (/(?:喜欢|爱|偏好|常喝|总喝)/.test(t)) return true
  if (/(?:喝什么|吃什么|听什么|看什么)/.test(t)) return true
  return false
}

export function formatPreferenceBlock(pref) {
  if (!pref || !['positive', 'negative'].includes(pref.polarity)) return ''
  const what = `${pref.activity || ''}${pref.object || ''}`
  if (!what || what.length > 20) return ''
  return pref.polarity === 'positive'
    ? `他以前说过喜欢${what}；这是旧话，别当成刚说的。`
    : `他以前喜欢${what}，后来说不喜欢了；以现在为准。`
}

export function formatPreferenceReference(pref, mention) {
  const what = `${mention?.activity || ''}${mention?.object || ''}`
  if (!pref) return `[偏好参考] ${what}偏好现在无法确认；别把旧事当现在。`
  if (pref.polarity === 'negative') return `[偏好参考] 他明确说不喜欢${what}；以现在为准。`
  return `[偏好参考] 他明确说过喜欢${what}；这是旧话，别当刚说。`
}
