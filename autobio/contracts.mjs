import { createHash } from 'node:crypto'

export const BASIS = ['user_said', 'delivered_reply', 'character_reflection', 'verified_tool_action']
export const CONTENT_CLASS = ['real_record', 'role_idea', 'fiction']
export const STATUS = ['pending', 'approved', 'rejected', 'invalidated']
export const MAX_TEXT = 240

export function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

export function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

export function validateContext(ctx) {
  const errors = []
  if (!ctx || typeof ctx !== 'object') return ['context']
  if (!/^[A-Za-z0-9:_-]{1,80}$/.test(String(ctx.account || ''))) errors.push('account')
  if (!/^\d{5,20}$/.test(String(ctx.self || ''))) errors.push('self')
  if (!/^\d{5,20}$/.test(String(ctx.uid || ''))) errors.push('uid')
  if (String(ctx.scope || '') !== `private:${String(ctx.uid || '')}`) errors.push('scope')
  if (!Number.isSafeInteger(Number(ctx.generation)) || Number(ctx.generation) < 1) errors.push('generation')
  return errors
}

export function makeCandidate({
  id, context, generation, basis, contentClass, text, uncertain = false,
  sourceRefs = [], proposalOrigin = 'trusted', status = 'pending', now = Date.now(),
}) {
  const clean = normalizeText(text)
  const sourceSetDigest = digest(sourceRefs.map(x => `${x.kind}:${x.eventId}:${x.replyId || ''}:${x.ordinal ?? -1}`).sort().join('|'))
  return {
    id: String(id),
    account_id: String(context.account),
    self_id: String(context.self),
    uid: String(context.uid),
    scope: String(context.scope),
    generation: Number(generation),
    basis: String(basis),
    content_class: String(contentClass),
    text: clean,
    uncertain: uncertain ? 1 : 0,
    status: String(status),
    source_set_digest: sourceSetDigest,
    content_digest: digest(clean),
    dedupe_key: digest(`${context.scope}|${generation}|${basis}|${sourceSetDigest}|${clean}`),
    proposal_origin: String(proposalOrigin),
    created_at: Number(now),
  }
}

export function validateCandidate(c) {
  const errors = []
  if (!c || typeof c !== 'object') return ['candidate']
  for (const k of ['id', 'account_id', 'self_id', 'uid', 'scope', 'basis', 'content_class', 'text', 'source_set_digest', 'content_digest', 'dedupe_key']) {
    if (typeof c[k] !== 'string' || !c[k]) errors.push(k)
  }
  if (!BASIS.includes(c.basis)) errors.push('basis')
  if (!CONTENT_CLASS.includes(c.content_class)) errors.push('content_class')
  if (!Number.isSafeInteger(Number(c.generation)) || Number(c.generation) < 1) errors.push('generation')
  if (![0, 1].includes(Number(c.uncertain))) errors.push('uncertain')
  if (normalizeText(c.text).length > MAX_TEXT) errors.push('text_len')
  if (c.basis === 'character_reflection' && (Number(c.uncertain) !== 1 || !['role_idea', 'fiction'].includes(c.content_class))) errors.push('reflection_shape')
  if (c.basis !== 'character_reflection' && c.content_class !== 'real_record') errors.push('real_shape')
  if (String(c.scope || '') !== `private:${String(c.uid || '')}`) errors.push('scope_uid')
  return errors
}
