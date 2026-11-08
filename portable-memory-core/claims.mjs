// Only audited literal compositions; unknown or ambiguous subjects fail closed.
// Modifiers and nouns are deliberately paired by activity; no open noun wildcard.
const OBJECTS = Object.freeze({
  喝: new Set(['热可可', '可可', '牛奶', '咖啡', '茶', '果汁', '水']),
  吃: new Set(['香菜', '苹果', '香蕉', '米饭', '面条', '巧克力', '蛋糕']),
  听: new Set(['音乐', '古典音乐', '流行音乐']),
  看: new Set(['电影', '动画', '书']),
});
const COMPOSITIONS = Object.freeze({
  喝: { modifiers: ['热','冰','温','无糖'], nouns: ['咖啡','牛奶','茶','果汁','可可'] },
  吃: { modifiers: ['热','冰','甜','原味'], nouns: ['面条','蛋糕','巧克力','米饭'] },
  听: { modifiers: ['古典','流行','轻','纯'], nouns: ['音乐'] },
  看: { modifiers: ['科幻','喜剧','动画'], nouns: ['电影'] },
});
function safeObject(activity, object) {
  if (OBJECTS[activity].has(object)) return true;
  const {modifiers,nouns} = COMPOSITIONS[activity];
  return modifiers.some(prefix => nouns.some(noun => object === prefix + noun));
}
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
  if (!match || match[0] !== text || !(version === 1 ? OBJECTS[match[2]].has(match[3]) : safeObject(match[2], match[3]))) return null;
  return Object.freeze({
    kind: 'self_reported_preference',
    polarity: match[1] === '喜欢' ? 'positive' : 'negative',
    activity: match[2],
    object: match[3],
    original: text,
    eventId,
  });
}
