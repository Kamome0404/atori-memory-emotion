// Pure send-time validation for an injected memory reference.
// The caller supplies the turn object; a changed/missing reference fails closed.
export function referenceStillCurrent({ used, answer, turn, reference, historyRev, currentRev } = {}) {
  if (!used && !answer) return true
  if (!turn) return false
  if (historyRev != null && historyRev !== currentRev) return false
  try {
    const r = turn.take()
    return !!reference && r?.text === reference
  } catch {
    return false
  }
}
