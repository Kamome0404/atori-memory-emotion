import { BASIS, CONTENT_CLASS, validateCandidate } from './contracts.mjs'

export function validateSourceRefs(refs, { max = 4 } = {}) {
  if (!Array.isArray(refs) || !refs.length || refs.length > max) return ['source_refs']
  const errors = []
  for (const r of refs) {
    if (!r || !['event', 'reply', 'tool_receipt'].includes(String(r.kind))) errors.push('source_kind')
    if (!String(r.eventId || '')) errors.push('event_id')
    if (String(r.kind) === 'reply' && (!String(r.replyId || '') || !Number.isInteger(Number(r.ordinal)) || Number(r.ordinal) < 0)) errors.push('reply_ref')
  }
  return errors
}

export function classifyCandidate(candidate) {
  const errors = validateCandidate(candidate)
  if (errors.length) return { ok: false, errors, label: null }
  const label = candidate.basis === 'character_reflection'
    ? (candidate.content_class === 'fiction' ? '她构思的虚构片段' : '她当时的想法')
    : (candidate.basis === 'delivered_reply' ? '她说过的话' : (candidate.basis === 'verified_tool_action' ? '她在数字空间做过的事' : '对方说过的话'))
  return { ok: true, errors: [], label }
}

export function canReview(reviewer) {
  return !!(reviewer && reviewer.trusted === true)
}

export function isEligibleReceipt(receipt) {
  const id = String(receipt?.messageId ?? receipt?.message_id ?? '')
  if (!id) return false
  if (/^(media|self|synthetic):/i.test(id)) return false
  if (!/^-?\d{1,20}$/.test(id)) return false
  return receipt?.status === 'confirmed' || receipt?.ok === true || (receipt?.status === 'ok' && Number(receipt?.retcode) === 0)
}

export function autonomyClaimAllowed({ kind, hasVerifiedAction = false, hasFictionLabel = false }) {
  if (kind === 'verified_tool_action') return hasVerifiedAction === true
  if (kind === 'fiction') return hasFictionLabel === true
  if (kind === 'role_idea') return true
  return false
}

export function sourceClassLabel(basis) {
  if (!BASIS.includes(basis)) return '无效来源'
  if (basis === 'user_said') return '对方说过的话'
  if (basis === 'delivered_reply') return '她说过的话'
  if (basis === 'verified_tool_action') return '有回执的数字行动'
  return '她当时的想法'
}

export { CONTENT_CLASS }
