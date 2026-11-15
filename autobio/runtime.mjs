import { makeCandidate, normalizeText, validateCandidate, validateContext } from './contracts.mjs'
import { canReview, classifyCandidate, isEligibleReceipt, validateSourceRefs } from './policy.mjs'
import { openStore } from './store.mjs'

export function createAutobio({ dbPath, mode = 'off', ownerScope = '', memoryPort, receiptPort = null, clock = { now: () => Date.now() } } = {}) {
  if (!['off', 'shadow', 'one_ref', 'limited'].includes(mode)) throw new Error('autobio: invalid mode')
  const store = openStore(dbPath)
  let currentMode = mode
  let stopped = false

  function active() { return !stopped && currentMode !== 'off' }
  function now() { return Number(clock.now ? clock.now() : Date.now()) }

  function observeCommitted({ context, generation, eventId } = {}) {
    if (!active() || currentMode !== 'shadow') return { stored: 0, reason: 'inactive' }
    const ctxErr = validateContext({ ...context, generation })
    if (ctxErr.length || String(context.scope) !== String(ownerScope)) return { stored: 0, reason: 'context' }
    if (!memoryPort || typeof memoryPort.projectConfirmedExchange !== 'function') return { stored: 0, reason: 'port' }
    const snap = memoryPort.projectConfirmedExchange({ uid: context.uid, generation, eventId })
    if (!snap || String(snap.tenant || '') !== String(context.uid) || String(snap.scope || '') !== String(context.scope) || Number(snap.generation) !== Number(generation) || String(snap.eventId) !== String(eventId)) return { stored: 0, reason: 'source' }
    if (!snap.userText) return { stored: 0, reason: 'empty' }
    const id = `cand:${context.account}:${context.self}:${eventId}:user`
    const c = makeCandidate({ id, context, generation, basis: 'user_said', contentClass: 'real_record', text: snap.userText, sourceRefs: [{ kind: 'event', eventId, generation }], now: now() })
    if (validateCandidate(c).length) return { stored: 0, reason: 'candidate' }
    const got = store.insertCandidate(c, [{ kind: 'event', eventId, generation, eventDigest: snap.eventDigest || '', sourceTextDigest: snap.snapshotDigest || '' }])
    return { stored: got ? 1 : 0, reason: got ? 'stored' : 'duplicate' }
  }

  function submitReflection({ context, generation, sourceRefs, text, proposalOrigin = 'model' } = {}) {
    if (!active() || currentMode !== 'shadow') return null
    if (validateContext({ ...context, generation }).length || String(context.scope) !== String(ownerScope)) return null
    if (validateSourceRefs(sourceRefs).length) return null
    const id = `cand:${context.account}:${context.self}:${now()}:reflection`
    const c = makeCandidate({ id, context, generation, basis: 'character_reflection', contentClass: 'role_idea', text, uncertain: true, sourceRefs, proposalOrigin, now: now() })
    if (validateCandidate(c).length) return null
    const got = store.insertCandidate(c, sourceRefs.map(r => ({ kind: r.kind, eventId: r.eventId, replyId: r.replyId || '', ordinal: r.ordinal ?? -1, generation, eventDigest: r.eventDigest || '', sourceTextDigest: r.sourceTextDigest || '' })))
    return got ? got.id : null
  }

  function observeDelivery({ context, attemptKey, sourceRefs, receipt, status, contentDigest, contentClass, preFinishValid, finishAccepted } = {}) {
    if (!active() || !attemptKey) return
    const ok = isEligibleReceipt(receipt) && preFinishValid === true && finishAccepted === true
    const realId = String(receipt?.messageId ?? receipt?.message_id ?? '')
    const st = ok ? 'confirmed' : (status === 'unknown' ? 'unknown' : (status === 'failed' ? 'failed' : 'confirmed_not_eligible'))
    store.observeDelivery({
      attemptKey, accountId: context?.account, selfId: context?.self, uid: context?.uid, scope: context?.scope,
      contentDigest, contentClass, sourceRefs, status: st, realReceiptId: realId, eligible: ok,
    })
  }

  function invalidate({ eventId, reason = 'source_revoked' } = {}) {
    if (!active() || !eventId) return 0
    return store.invalidateEvent({ eventId, reason })
  }

  function invalidateScope({ scope, reason = 'source_revoked' } = {}) {
    if (!active() || !scope) return 0
    return store.invalidateScope({ scope, reason })
  }

  function listPending({ reviewer, context, limit = 20 } = {}) {
    if (!active() || currentMode !== 'shadow' || !canReview(reviewer)) return []
    return store.listPending({ scope: context.scope, limit })
  }

  function review({ reviewer, context, id, decision, expectedDigest } = {}) {
    if (!active() || currentMode !== 'shadow' || !canReview(reviewer)) return null
    if (!context?.scope || !expectedDigest) return null
    if (!['approve', 'reject', 'invalidate'].includes(decision)) return null
    return store.review({ id, scope: context.scope, decision, reviewerId: reviewer.id || 'local', expectedDigest })
  }

  function listApproved({ scope, generation, limit = 100000 } = {}) {
    if (!active()) return []
    return store.listApproved({ scope, generation, limit })
  }

  function selectOne({ context, generation, query, currentEventId } = {}) {
    if (!active() || currentMode !== 'one_ref' || !query || query.type !== 'explicit_id' || !query.id) return null
    const c = store.selectApproved({ scope: context.scope, id: query.id })
    if (!c || Number(c.generation) !== Number(generation) || c.status !== 'approved') return null
    return { candidateId: c.id, uid: c.uid, scope: c.scope, generation: c.generation, text: c.text, label: c.basis === 'character_reflection' ? '她当时的想法' : '对方说过的话', currentEventId }
  }

  function recheck(reference) {
    if (!reference) return false
    if (!memoryPort || typeof memoryPort.status !== 'function') return false
    const s = memoryPort.status(reference.uid || '')
    return !!(s && s.allowed === true && !s.gap)
  }

  function setMode(next) {
    if (!['off', 'shadow'].includes(next)) throw new Error('autobio: A mode only off/shadow')
    currentMode = next
  }
  function stop() { stopped = true; store.close() }

  return { observeCommitted, submitReflection, observeDelivery, invalidate, invalidateScope, listPending, review, selectOne, listApproved, recheck, setMode, stop, _store: store, _mode: () => currentMode }
}
