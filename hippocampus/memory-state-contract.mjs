// Pure memory-state overlay. Source rows stay untouched. The state decides
// retrieval priority, not whether the memory is true.
const DAY_MS = 86400000
const ZONE = 'Asia/Shanghai'
const STATES = ['active', 'weakened', 'archived']

export function memoryKey({ source, scope, uid, sourceRecordId } = {}) {
  return JSON.stringify([String(source || ''), String(scope || ''), String(uid || ''), String(sourceRecordId || '')])
}

function shanghaiDay(ms) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Number(ms)))
  const o = {}
  for (const x of p) if (x.type !== 'literal') o[x.type] = x.value
  return Date.UTC(+o.year, +o.month - 1, +o.day) / DAY_MS
}

/**
 * @param {object} input
 * @param {number} input.at source event time
 * @param {number} [input.now]
 * @param {boolean} [input.pinned]
 * @param {boolean} [input.ownerConfirmed]
 * @param {'current'|'unknown'|'invalidated'} [input.sourceValidity]
 * @param {number} [input.weakenedAfterDays=30]
 * @param {number} [input.archivedAfterDays=180]
 */
export function deriveMemoryState({ at, now = Date.now(), pinned = false, ownerConfirmed = false, sourceValidity = 'current', weakenedAfterDays = 30, archivedAfterDays = 180 } = {}) {
  const t = Number(now), e = Number(at)
  const base = {
    schema: 1, state: 'active', sourceValidity,
    confidence: { level: ownerConfirmed ? 'owner_confirmed' : 'unassessed', retrievalWeight: 1 },
    pinned: !!pinned, reasonCodes: [],
  }
  if (at == null || at === '' || !Number.isFinite(e) || !Number.isFinite(t) || e > t) {
    return { ...base, state: 'archived', sourceValidity: 'invalidated', confidence: { level: 'unassessed', retrievalWeight: 0 }, reasonCodes: ['invalid_time'] }
  }
  if (sourceValidity === 'invalidated') {
    return { ...base, state: 'archived', confidence: { level: 'unassessed', retrievalWeight: 0 }, reasonCodes: ['source_invalidated'] }
  }
  if (pinned || ownerConfirmed) {
    return { ...base, state: 'active', confidence: { level: ownerConfirmed ? 'owner_confirmed' : 'unassessed', retrievalWeight: 1 }, reasonCodes: [pinned ? 'pinned' : 'owner_confirmed'] }
  }
  const age = shanghaiDay(t) - shanghaiDay(e)
  if (age >= Number(archivedAfterDays)) {
    return { ...base, state: 'archived', confidence: { level: 'unassessed', retrievalWeight: 0 }, reasonCodes: ['aged_180'] }
  }
  if (age >= Number(weakenedAfterDays)) {
    return { ...base, state: 'weakened', confidence: { level: 'unassessed', retrievalWeight: 0.5 }, reasonCodes: ['aged_30'] }
  }
  return base
}

export function mergeMemoryState(persisted, derived) {
  if (!persisted) return derived
  if (persisted.confidence?.level === 'owner_confirmed' || persisted.pinned) return persisted
  const order = { active: 0, weakened: 1, archived: 2 }
  const p = String(persisted.state || 'active'), d = String(derived?.state || 'active')
  const state = (order[d] || 0) > (order[p] || 0) ? d : p
  const pw = Number(persisted.confidence?.retrievalWeight)
  const dw = Number(derived?.confidence?.retrievalWeight)
  const weight = Math.min(Number.isFinite(pw) ? pw : 1, Number.isFinite(dw) ? dw : 1)
  return { ...persisted, state, confidence: { ...(persisted.confidence || {}), retrievalWeight: weight }, reasonCodes: [...new Set([...(persisted.reasonCodes || []), ...(derived?.reasonCodes || [])])].slice(0, 12) }
}

export function validateMemoryState(state) {
  const e = []
  if (!state || typeof state !== 'object') return ['shape']
  if (!STATES.includes(String(state.state || ''))) e.push('state')
  if (!['current', 'unknown', 'invalidated'].includes(String(state.sourceValidity || ''))) e.push('sourceValidity')
  const w = Number(state.confidence?.retrievalWeight)
  if (!Number.isFinite(w) || w < 0 || w > 1) e.push('retrievalWeight')
  return e
}

export function isArchived(state) { return String(state?.state || '') === 'archived' }
export function stateWeight(state) { return Number.isFinite(Number(state?.confidence?.retrievalWeight)) ? Number(state.confidence.retrievalWeight) : 1 }
export { STATES, ZONE }
