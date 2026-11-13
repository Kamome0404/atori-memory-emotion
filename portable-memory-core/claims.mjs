// Only audited literal compositions; unknown or ambiguous subjects fail closed.
// The object table lives in preference-registry.mjs so claim write and B1 read
// cannot drift apart.
import { isBaseObject, isSafeObject } from './preference-registry.mjs'
const PATTERN = /^我(不喜欢|喜欢)(喝|吃|听|看)([\u4e00-\u9fff]{1,8})([。！!]?)$/u;

/**
 * Extract at most one literal first-person preference from a private message.
 * Returns null on any doubt. Input must be { text, eventId, channel: 'private' }.
 * Pure: no I/O, state mutations, normalization, or inference.
 */
export function extractPreference(input, { version = 2 } = {}) {
  if (version !== 1 && version !== 2) throw new TypeError('unsupported extractor version');
  if (!input || typeof input !== 'object' || input.channel !== 'private' ||
      typeof input.text !== 'string' || typeof input.eventId !== 'string') return null;
  const { text, eventId } = input;
  // Length counts UTF-16 code units; disallow whitespace/control, quotes and
  // extra clauses by matching the entire unmodified text against the grammar.
  if (text.length < 5 || text.length > 32 || eventId.length < 1 || eventId.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(eventId)) return null;
  const match = PATTERN.exec(text);
  if (!match || match[0] !== text || !(version === 1 ? isBaseObject(match[2], match[3]) : isSafeObject(match[2], match[3]))) return null;
  return Object.freeze({
    kind: 'self_reported_preference',
    polarity: match[1] === '喜欢' ? 'positive' : 'negative',
    activity: match[2],
    object: match[3],
    original: text,
    eventId,
  });
}
