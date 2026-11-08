// Local, pure BM25 retrieval over caller-supplied, scope-filtered events.
// The caller owns scope filtering; this module never infers or combines scopes.

export const RETRIEVAL_LIMITS = Object.freeze({
  maxEvents: 1256,
  maxTextChars: 2000,
  maxQueryChars: 256,
  maxTokensPerDocument: 4096,
  maxTokensPerQuery: 256,
  minQueryChars: 2
})

const HAN = /\p{Script=Han}/u
const HAN_RUN = /\p{Script=Han}+/gu
const ENGLISH = /[a-z0-9]+/g

function assertBoundedString(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(`${name} must be a non-empty string of <= ${max} characters`)
  }
  return value
}

function normalize(value) {
  return value.normalize('NFKC').toLowerCase()
}

/** Tokenize Latin/digit words and Han characters/bigrams without crossing punctuation. */
export function tokenize(text, { maxTokens = RETRIEVAL_LIMITS.maxTokensPerDocument } = {}) {
  assertBoundedString(text, 'text', RETRIEVAL_LIMITS.maxTextChars)
  const normalized = normalize(text)
  const tokens = []
  for (const run of normalized.matchAll(HAN_RUN)) {
    const chars = [...run[0]]
    for (const char of chars) tokens.push(char)
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(`${chars[i]}${chars[i + 1]}`)
  }
  for (const word of normalized.match(ENGLISH) ?? []) tokens.push(word)
  if (tokens.length > maxTokens) throw new RangeError(`token count exceeds ${maxTokens}`)
  return tokens
}

export const tokenizeQuery = (query) => tokenize(query, { maxTokens: RETRIEVAL_LIMITS.maxTokensPerQuery })

function validateEvents(events) {
  if (!Array.isArray(events) || events.length > RETRIEVAL_LIMITS.maxEvents) {
    throw new TypeError(`events must be an array of <= ${RETRIEVAL_LIMITS.maxEvents} items`)
  }
  return events.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError(`event ${index} must be an object`)
    const text = assertBoundedString(event.text, `event ${index}.text`, RETRIEVAL_LIMITS.maxTextChars)
    return { event, tokens: tokenize(text) }
  })
}

function termCounts(tokens) {
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  return counts
}

/** Build an immutable BM25-ready index from already scope-filtered events. */
export function buildIndex(events, { k1 = 1.2, b = 0.75 } = {}) {
  if (!Number.isFinite(k1) || k1 <= 0 || !Number.isFinite(b) || b < 0 || b > 1) throw new RangeError('k1 must be > 0 and b must be in 0..1')
  const rows = validateEvents(events)
  const documents = rows.map(({ event, tokens }) => ({ event, tokens, counts: termCounts(tokens) }))
  const df = new Map()
  const invertedIndex = new Map()
  for (let docId = 0; docId < documents.length; docId += 1) {
    for (const token of documents[docId].counts.keys()) {
      df.set(token, (df.get(token) ?? 0) + 1)
      const postings = invertedIndex.get(token) ?? []
      postings.push(docId)
      invertedIndex.set(token, postings)
    }
  }
  const avgDocumentLength = documents.length ? documents.reduce((sum, d) => sum + d.tokens.length, 0) / documents.length : 0
  return Object.freeze({ documents, df, invertedIndex, avgDocumentLength, k1, b })
}

/**
 * Search an index. A query shorter than minQueryChars is explicitly rejected as
 * short (rather than silently becoming a noisy single-character match).
 */
export function retrieve(index, query, { limit = 10, topK = limit, minQueryChars = RETRIEVAL_LIMITS.minQueryChars } = {}) {
  if (!index || !Array.isArray(index.documents) || !(index.df instanceof Map) || !(index.invertedIndex instanceof Map)) throw new TypeError('index must be created by buildIndex')
  assertBoundedString(query, 'query', RETRIEVAL_LIMITS.maxQueryChars)
  if (!Number.isInteger(minQueryChars) || minQueryChars < 1 || minQueryChars > RETRIEVAL_LIMITS.maxQueryChars) throw new RangeError('minQueryChars is out of bounds')
  if (!Number.isInteger(limit) || limit < 1 || limit > RETRIEVAL_LIMITS.maxEvents) throw new RangeError('limit is out of bounds')
  if (!Number.isInteger(topK) || topK < 1 || topK > RETRIEVAL_LIMITS.maxEvents) throw new RangeError('topK is out of bounds')
  const normalizedQuery = normalize(query).trim()
  if ([...normalizedQuery].length < minQueryChars) return []
  const queryTokens = tokenizeQuery(normalizedQuery)
  if (!queryTokens.length) return []
  const queryCounts = termCounts(queryTokens)
  const n = index.documents.length
  const avg = index.avgDocumentLength || 1
  const candidateIds = new Set()
  for (const term of queryCounts.keys()) for (const docId of index.invertedIndex.get(term) ?? []) candidateIds.add(docId)
  const scored = [...candidateIds].map(docId => index.documents[docId]).map(({ event, tokens, counts }) => {
    let score = 0
    const matchedTokens = []
    for (const [term, queryFrequency] of queryCounts) {
      const tf = counts.get(term) ?? 0
      const df = index.df.get(term) ?? 0
      if (!tf || !df) continue
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      const saturation = (tf * (index.k1 + 1)) / (tf + index.k1 * (1 - index.b + index.b * tokens.length / avg))
      score += idf * saturation * Math.min(queryFrequency, 2)
      matchedTokens.push(term)
    }
    return { event, score, matchedTokens }
  }).filter(result => result.score > 0)
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.min(limit, topK))
}

export function retrieveEvents(events, query, options = {}) {
  return retrieve(buildIndex(events, options), query, options)
}
