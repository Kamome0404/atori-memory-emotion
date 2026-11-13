// Pure send-time validation for an injected memory reference.
// The caller supplies the turn object; a changed/missing reference fails closed.

const sameClaim = (a, b) => (!a && !b) || (!!a && !!b &&
  a.eventId === b.eventId && a.version === b.version && a.created === b.created &&
  a.polarity === b.polarity && a.activity === b.activity && a.object === b.object)

export function preferenceProvenanceEqual(a, b) {
  if (!a || !b || a.schema !== 1 || b.schema !== 1 || a.kind !== 'preference' || b.kind !== 'preference') return false
  if (typeof a.tenant !== 'string' || typeof b.tenant !== 'string' ||
      typeof a.scope !== 'string' || typeof b.scope !== 'string' ||
      !Number.isSafeInteger(a.generation) || !Number.isSafeInteger(b.generation)) return false
  if (a.tenant !== b.tenant || a.scope !== b.scope || a.generation !== b.generation) return false
  if (!Array.isArray(a.mentions) || !Array.isArray(b.mentions) || a.mentions.length !== b.mentions.length || a.mentions.length < 1 || a.mentions.length > 8) return false
  const validClaim = c => c == null || (typeof c.eventId === 'string' && typeof c.version === 'number' &&
    Number.isSafeInteger(c.created) && typeof c.polarity === 'string' &&
    typeof c.activity === 'string' && typeof c.object === 'string')
  return a.mentions.every((m, i) => {
    const other = b.mentions[i]
    return m && other && typeof m.activity === 'string' && typeof m.object === 'string' &&
      validClaim(m.claim) && validClaim(other.claim) &&
      m.activity === other.activity && m.object === other.object && sameClaim(m.claim, other.claim)
  })
}

export function referenceStillCurrent({ used, answer, turn, reference, provenance, currentProvenance, historyRev, currentRev } = {}) {
  if (!used && !answer) return true
  if (!turn) return false
  if (historyRev != null && historyRev !== currentRev) return false
  if (provenance != null &&
      (!currentProvenance || !preferenceProvenanceEqual(provenance, currentProvenance))) return false
  try {
    const r = turn.take()
    if (!r) return false
    if (r.preference === true && provenance == null) return false
    if (r.provenance?.kind === 'preference' && provenance == null) return false
    return !!reference && r.text === reference
  } catch {
    return false
  }
}
