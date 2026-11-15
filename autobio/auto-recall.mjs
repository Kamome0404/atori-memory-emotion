// Automatic autobio recall selector: only a unique, high-signal approved candidate.
// No new DB, no permission; the caller decides whether the owner enabled autoRecall.
const STOP = new Set(['我们', '你们', '他们', '这个', '那个', '什么', '怎么', '就是', '不是', '还是', '可以', '现在', '今天', '昨天', '明天', '但是', '因为', '所以', '如果', '然后', '真的', '有点', '一下', '一起', '知道', '记得', '还记', '觉得', '喜欢', '时候', '已经', '一个', '没有', '自己', '他们'])

function tokens(text) {
  const t = String(text || '').replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, ' ').trim()
  const out = new Set()
  for (const part of t.split(/\s+/)) {
    if (/^[A-Za-z0-9]+$/.test(part)) { if (part.length >= 3) out.add(part.toLowerCase()); continue }
    const FUNC = /[我你他她它的了是在有和就也都吗呢吧啊很太更最又还这那你您我们]/
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= part.length; i++) {
        const s = part.slice(i, i + n)
        if (STOP.has(s) || FUNC.test(s)) continue
        out.add(s)
      }
    }
  }
  return out
}

export function selectAutoRecall({ text, approved = [] } = {}) {
  const incoming = String(text || '').trim()
  if (incoming.length < 2) return null
  const list = (Array.isArray(approved) ? approved : []).filter(x => x && x.text && x.status === 'approved' && Number(x.uncertain) !== 1)
  if (!list.length) return null
  const inTokens = tokens(incoming)
  const hits = []
  for (const c of list) {
    const ct = tokens(c.text)
    let best = ''
    for (const s of ct) if (inTokens.has(s) && s.length > best.length) best = s
    // Require a meaningful 2+ char overlap and avoid single generic tokens.
    if (best.length >= 2) hits.push({ candidate: c, matched: best })
  }
  if (hits.length !== 1) return null
  return { ...hits[0].candidate, matched: hits[0].matched, auto: true }
}
