// Single audited object registry shared by claim extraction and B1 gating.
// No arbitrary nouns, synonyms, or inference are accepted.
export const REGISTRY_VERSION = 2

const DEFS = {
  喝: {
    base: ['热可可', '可可', '牛奶', '咖啡', '茶', '果汁', '水'],
    nouns: ['咖啡', '牛奶', '茶', '果汁', '可可'],
    modifiers: ['热', '冰', '温', '无糖'],
  },
  吃: {
    base: ['香菜', '苹果', '香蕉', '米饭', '面条', '巧克力', '蛋糕'],
    nouns: ['面条', '蛋糕', '巧克力', '米饭'],
    modifiers: ['热', '冰', '甜', '原味'],
  },
  听: {
    base: ['音乐', '古典音乐', '流行音乐'],
    nouns: ['音乐'],
    modifiers: ['古典', '流行', '轻', '纯'],
  },
  看: {
    base: ['电影', '动画', '书'],
    nouns: ['电影'],
    modifiers: ['科幻', '喜剧', '动画'],
  },
}

const terms = []
for (const activity of Object.keys(DEFS)) {
  const seen = new Set(DEFS[activity].base)
  for (const object of DEFS[activity].base) terms.push({ activity, object })
  for (const modifier of DEFS[activity].modifiers) {
    for (const noun of DEFS[activity].nouns) {
      const object = modifier + noun
      if (seen.has(object)) continue
      seen.add(object)
      terms.push({ activity, object })
    }
  }
}
terms.sort((a, b) => b.object.length - a.object.length || a.object.localeCompare(b.object, 'zh'))

export const PREFERENCE_DEFS = Object.freeze(Object.fromEntries(
  Object.entries(DEFS).map(([activity, def]) => [activity, Object.freeze({
    base: Object.freeze([...def.base]),
    nouns: Object.freeze([...def.nouns]),
    modifiers: Object.freeze([...def.modifiers]),
  })]),
))

export const PREFERENCE_TERMS = Object.freeze(terms.map(t => Object.freeze(t)))

export function isBaseObject(activity, object) {
  return Array.isArray(DEFS[activity]?.base) && DEFS[activity].base.includes(object)
}

export function isSafeObject(activity, object) {
  const def = DEFS[activity]
  if (!def) return false
  if (def.base.includes(object)) return true
  return def.modifiers.some(prefix => def.nouns.some(noun => object === prefix + noun))
}
