import { PREFERENCE_TERMS } from '../portable-memory-core/preference-registry.mjs'

// Stage I prompt guard for a preference question.
// It removes old positive preference lines from every prompt channel it is
// applied to. No inference: the mention comes from findPreferenceMention().
const HEADER = /^##\s+/
const PREFERENCE = /(?:喜欢|爱|偏好|常喝|总喝)/
const SPLIT = /([，,；;。！!？?\n]|但|但是|不过)/u
const NEG_BEFORE = /(?:不|没|并不|不太|不怎么|不再|没有)(?:怎么|太|再)?$/
const FOLLOW = /^(?:$|[还或吗呢吧啊呀的了吗嘛但也而且我，,。.？?！!、；;：:\s])/u
const PREFIX_OK = /^(?:$|[喝吃听看想买点来要杯碗份个些去在和跟还于是有无法欢爱我、，,；;：:\s（(【[「"'])$/u
const BARE_TAIL = /^[了的那啊呀吧呢哦嘛着过，,。.？?！!、；;：:\s]*$/u
const OTHER_OBJECTS = PREFERENCE_TERMS.map(t => t.object).filter(Boolean)

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isNegatedBefore(segment, at) {
  return NEG_BEFORE.test(segment.slice(0, at))
}

function hasStalePositive(segment, object) {
  let from = 0
  while (from <= segment.length) {
    const at = segment.indexOf(object, from)
    if (at < 0) break
    from = at + 1
    const beforeObject = segment[at - 1] || ''
    const afterObject = segment[at + object.length] || ''
    if (!PREFIX_OK.test(beforeObject) || !FOLLOW.test(afterObject)) continue

    // Nearest preference before the object.
    const before = segment.slice(Math.max(0, at - 16), at)
    const beforeMatches = [...before.matchAll(/(?:喜欢|爱|偏好|常喝|总喝)/gu)]
    if (beforeMatches.length) {
      const m = beforeMatches[beforeMatches.length - 1]
      const prefAt = Math.max(0, at - 16) + m.index
      const gap = at - (prefAt + m[0].length)
      if (gap <= 12 && !isNegatedBefore(segment, prefAt)) return true
    }

    // Preference immediately after the object; check negation between.
    const tail = segment.slice(at + object.length, at + object.length + 16)
    const afterMatch = /(?:喜欢|爱|偏好|常喝|总喝)/u.exec(tail)
    if (afterMatch) {
      const between = tail.slice(0, afterMatch.index)
      const afterPref = tail.slice(afterMatch.index + afterMatch[0].length)
      // The predicate must close on the object; "喜欢跑步/音乐" is another object.
      if (!BARE_TAIL.test(afterPref)) continue
      if (!/(?:不|没|不是|不再|没有|并不|不太|不怎么)/.test(between)) return true
    }
  }
  return false
}


function hasStaleNegative(segment, object) {
  const neg = /(?:不喜欢|不爱|不偏好|不常喝|不总喝|不再喜欢|不再喝)/
  let from = 0
  while (from <= segment.length) {
    const at = segment.indexOf(object, from)
    if (at < 0) break
    from = at + 1
    const beforeObject = segment[at - 1] || ''
    const afterObject = segment[at + object.length] || ''
    if (!PREFIX_OK.test(beforeObject) || !FOLLOW.test(afterObject)) continue
    const before = segment.slice(Math.max(0, at - 16), at)
    if (neg.test(before.slice(-12))) return true
    const tail = segment.slice(at + object.length, at + object.length + 16)
    if (neg.test(tail)) return true
  }
  return false
}


function hasBroadObjectMention(text, object) {
  let from = 0
  while (from <= text.length) {
    const at = text.indexOf(object, from)
    if (at < 0) return false
    from = at + 1
    const before = text[at - 1] || ''
    const after = text[at + object.length] || ''
    if (PREFIX_OK.test(before) && FOLLOW.test(after)) return true
  }
  return false
}

export function createPreferenceTurn({ mention, mentions, claim, broad = false, historical = null } = {}) {
  const list = (Array.isArray(mentions) ? mentions : (mention ? [mention] : []))
    .filter(m => m && typeof m.object === 'string' && m.object)
  if (!list.length) return null
  const objects = list.map(m => escapeRe(m.object))
  const isBroad = broad === true
  const polarityByObject = new Map()
  for (const m of list) {
    if (m.claim && m.claim.polarity) polarityByObject.set(m.object, m.claim.polarity)
  }
  const primaryObject = list[0]?.object
  if (claim && claim.polarity && primaryObject && !polarityByObject.has(primaryObject)) {
    polarityByObject.set(primaryObject, claim.polarity)
  }

  const sanitizeText = (text) => {
    const raw = String(text || '')
    if (!raw.trim()) return ''
    const parts = raw.split(SPLIT)
    const kept = parts.filter(part => {
      if (isBroad && PREFERENCE_TERMS.some(t => hasBroadObjectMention(part, t.object))) return false
      for (let i = 0; i < objects.length; i++) {
        const rawObject = list[i].object
        const polarity = polarityByObject.get(rawObject) || null
        const object = objects[i]
        if (polarity !== 'positive' && hasStalePositive(part, object)) return false
        if (polarity !== 'negative' && hasStaleNegative(part, object)) return false
      }
      return true
    })
    return kept.join('')
      .split('\n')
      .map(line => line.replace(/^[，,；;。！!？?\s]+/, '').replace(/\s+$/, ''))
      .filter(line => line.trim())
      .join('\n')
  }

  const sanitizeBlock = (text) => {
    const cleaned = sanitizeText(text)
    if (!cleaned.trim()) return ''
    const withoutHeaders = cleaned.replace(/^##[^\n]*$/gm, '').trim()
    return withoutHeaders ? cleaned : ''
  }

  const filterMessages = (messages) => {
    if (!Array.isArray(messages)) return messages
    const out = []
    for (const m of messages) {
      const cleaned = sanitizeText(m?.content)
      if (cleaned.trim()) out.push({ ...m, content: cleaned })
    }
    return out
  }

  return Object.freeze({
    mention: Object.freeze({ ...list[0] }),
    mentions: Object.freeze(list.map(m => Object.freeze({ ...m }))),
    claim: claim ? Object.freeze({ ...claim }) : null,
    historical: historical ? Object.freeze({ ...historical }) : null,
    broad: broad === true,
    active: true,
    sanitizeText,
    sanitizeBlock,
    filterMessages,
  })
}


export function formatHistoricalPreference(pref) {
  if (!pref || !pref.polarity) return ''
  const what = `${pref.activity || ''}${pref.object || ''}`
  if (!what) return ''
  return `他以前说过${pref.polarity === 'negative' ? '不喜欢' : '喜欢'}${what}；现在不确定，可以自然问一句“现在还喜欢吗”，别当成现在的事实。`
}
