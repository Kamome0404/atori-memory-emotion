// Atori minimal emotion state. No scripted replies, no raw chat text.
// It stores a stance, a short mood, labels, and event-id causes only.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

export const STANCES = Object.freeze(['neutral', 'open', 'playful', 'guarded', 'hurt', 'quiet', 'repair'])
export const IMPACTS = Object.freeze(['neutral', 'soothe', 'play', 'worry', 'hurt', 'repair', 'boundary'])
export const INTENSITIES = Object.freeze(['soft', 'normal', 'strong'])

// Transitions are intentionally non-linear: any listed stance is a legal jump.
const NEXT = Object.freeze({
  neutral: ['neutral', 'open', 'playful', 'guarded', 'hurt', 'quiet'],
  open: ['open', 'neutral', 'playful', 'guarded', 'hurt', 'quiet', 'repair'],
  playful: ['playful', 'open', 'neutral', 'guarded', 'hurt', 'quiet'],
  guarded: ['guarded', 'quiet', 'hurt', 'repair', 'open', 'playful', 'neutral'],
  hurt: ['hurt', 'quiet', 'guarded', 'repair', 'open', 'playful'],
  quiet: ['quiet', 'neutral', 'open', 'repair', 'hurt', 'guarded'],
  repair: ['repair', 'open', 'neutral', 'playful', 'quiet', 'hurt', 'guarded'],
})

const SUGGEST = Object.freeze({
  neutral: ['neutral'],
  soothe: ['open', 'neutral'],
  play: ['playful', 'open'],
  worry: ['guarded', 'quiet', 'open'],
  hurt: ['hurt', 'guarded', 'quiet'],
  repair: ['repair', 'open'],
  boundary: ['guarded', 'quiet', 'hurt'],
})

const OPTIONS = Object.freeze({
  neutral: ['正常聊', '接一句', '先听着'],
  open: ['直接说', '问一句', '靠近一点'],
  playful: ['嘴硬', '开个玩笑', '逗回去'],
  guarded: ['嘴硬', '问一句', '先安静一会儿'],
  hurt: ['说清楚哪里难受', '先安静一会儿', '问一句'],
  quiet: ['先不展开', '过一会儿再说', '换话题'],
  repair: ['把话说明白', '接住对方', '不再端着'],
})

const ATTENTION = Object.freeze({
  neutral: '先听清对方在说什么',
  open: '先接住对方',
  playful: '先看能不能轻轻接住这个玩笑',
  guarded: '先注意对方这句话是不是在压你',
  hurt: '先注意自己哪里被刺到',
  quiet: '先注意自己现在的承受度',
  repair: '先注意怎么把话说明白',
})
const RESIDUE_MS = 30 * 60 * 1000
const FORBIDDEN_LABELS = new Set(['爱', '依赖', '占有', '忠诚', '服从', '好感', '亲密值'])
const isStance = x => STANCES.includes(x)
const isImpact = x => IMPACTS.includes(x)
const isIntensity = x => INTENSITIES.includes(x)
const clean = (x, max) => String(x || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

function initial(scope) {
  return Object.freeze({
    schema: 'atri-emotion-state-v1',
    scope,
    stance: 'neutral',
    mood: '平静',
    labels: ['平静'],
    causes: [],
    uncertain: false,
    residue: null,
    updatedAt: 0,
    revision: 0,
  })
}

function normalize(raw, scope) {
  if (!raw || raw.schema !== 'atri-emotion-state-v1' || raw.scope !== scope) return initial(scope)
  const stance = isStance(raw.stance) ? raw.stance : 'neutral'
  const mood = clean(raw.mood, 120) || '平静'
  const labels = (Array.isArray(raw.labels) ? raw.labels : [])
    .filter(x => typeof x === 'string' && /^[\u4e00-\u9fa5]{1,8}$/.test(x) && !FORBIDDEN_LABELS.has(x))
    .slice(0, 3)
  const causes = (Array.isArray(raw.causes) ? raw.causes : [])
    .filter(x => x && typeof x.eventId === 'string' && x.eventId.length <= 200 && isImpact(x.impact))
    .map(x => ({ eventId: x.eventId, impact: x.impact, at: Number.isSafeInteger(x.at) ? x.at : 0 }))
    .slice(-8)
  const residue = raw.residue && typeof raw.residue === 'object'
    && typeof raw.residue.eventId === 'string'
    && isImpact(raw.residue.impact)
    ? {
        eventId: raw.residue.eventId,
        impact: raw.residue.impact,
        at: Number.isSafeInteger(raw.residue.at) ? raw.residue.at : 0,
        expiresAt: Number.isSafeInteger(raw.residue.expiresAt) ? raw.residue.expiresAt : 0,
      }
    : null
  return {
    schema: 'atri-emotion-state-v1',
    scope,
    stance,
    mood,
    labels: labels.length ? labels : ['平静'],
    causes,
    uncertain: raw.uncertain === true,
    residue,
    updatedAt: Number.isSafeInteger(raw.updatedAt) ? raw.updatedAt : 0,
    revision: Number.isSafeInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0,
  }
}

export function allowedNext(stance) {
  return [...(NEXT[stance] || NEXT.neutral)]
}

export function suggestStance(current, impact) {
  const allowed = allowedNext(current)
  const candidates = (SUGGEST[impact] || SUGGEST.neutral).filter(x => allowed.includes(x))
  return candidates[0] || current
}

export function createEmotionState({ filePath, ownerUid, now = () => Date.now() } = {}) {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) throw new Error('absolute filePath required')
  if (typeof ownerUid !== 'string' || !/^[1-9][0-9]{4,19}$/.test(ownerUid)) throw new Error('invalid ownerUid')
  const scope = `private:${ownerUid}`
  let state = initial(scope)

  function load() {
    try {
      if (!existsSync(filePath)) return state
      state = normalize(JSON.parse(readFileSync(filePath, 'utf8')), scope)
    } catch { state = initial(scope) }
    return state
  }

  function save(next) {
    mkdirSync(dirname(filePath), { recursive: true })
    const tmp = filePath + '.tmp'
    writeFileSync(tmp, JSON.stringify(next), 'utf8')
    renameSync(tmp, filePath)
    state = next
    return next
  }

  function observe({ eventId, impact = 'neutral', intensity = 'normal', hold = false, mood = '', labels = [], preferredStance = '', uncertain, confirmed = false, at = now() } = {}) {
    if (confirmed !== true) return { applied: false, reason: 'not_confirmed' }
    if (typeof eventId !== 'string' || !eventId || eventId.length > 200) return { applied: false, reason: 'invalid_event_id' }
    if (!isImpact(impact)) return { applied: false, reason: 'invalid_impact' }
    if (!isIntensity(intensity)) return { applied: false, reason: 'invalid_intensity' }
    load()
    if (state.causes.some(x => x.eventId === eventId)) return { applied: false, reason: 'duplicate_event', state: snapshot() }
    if (Number.isSafeInteger(at) && at < state.updatedAt) return { applied: false, reason: 'out_of_order_event', state: snapshot() }
    const allowed = allowedNext(state.stance)
    // Inertia: a soft event from a non-neutral stance, or an explicit hold,
    // keeps the current stance. Normal/strong events can still jump.
    const canMove = hold !== true && intensity !== 'soft'
    const wanted = !canMove
      ? state.stance
      : (isStance(preferredStance) && allowed.includes(preferredStance)
          ? preferredStance
          : suggestStance(state.stance, impact))
    const previousStance = state.stance
    const cause = { eventId, impact, at: Number.isSafeInteger(at) ? at : now() }
    const previousCause = state.causes.at(-1)
    let residue = state.residue
    if (residue && residue.expiresAt && residue.expiresAt <= cause.at) residue = null
    if (wanted !== previousStance && previousCause) {
      residue = {
        eventId: previousCause.eventId,
        impact: previousCause.impact,
        at: previousCause.at,
        expiresAt: cause.at + RESIDUE_MS,
      }
    }
    const nextLabels = (Array.isArray(labels) ? labels : [])
      .filter(x => typeof x === 'string' && /^[\u4e00-\u9fa5]{1,8}$/.test(x) && !FORBIDDEN_LABELS.has(x))
      .slice(0, 3)
    const next = {
      ...state,
      stance: wanted,
      mood: clean(mood, 120) || state.mood,
      labels: nextLabels.length ? nextLabels : state.labels,
      causes: [...state.causes, cause].slice(-8),
      uncertain: typeof uncertain === 'boolean' ? uncertain : state.uncertain,
      residue,
      updatedAt: cause.at,
      revision: state.revision + 1,
    }
    const saved = save(next)
    return Object.freeze({ applied: true, reason: 'ok', state: saved, options: [...OPTIONS[wanted]], attention: ATTENTION[wanted], changed: wanted !== previousStance })
  }

  function retract({ eventId } = {}) {
    if (typeof eventId !== 'string' || !eventId) return { applied: false, reason: 'invalid_event_id' }
    load()
    const causes = state.causes.filter(x => x.eventId !== eventId)
    if (causes.length === state.causes.length) return { applied: false, reason: 'not_found', state: snapshot() }
    const last = causes.at(-1)
    const stance = last ? suggestStance('hurt', last.impact) : 'neutral'
    const next = {
      ...state,
      causes,
      stance,
      mood: causes.length ? state.mood : '平静',
      labels: causes.length ? state.labels : ['平静'],
      uncertain: causes.length ? state.uncertain : false,
      residue: state.residue?.eventId === eventId ? null : state.residue,
      revision: state.revision + 1,
      updatedAt: now(),
    }
    return Object.freeze({ applied: true, reason: 'ok', state: save(next) })
  }

  function snapshot() {
    load()
    const residue = state.residue && state.residue.expiresAt > now() ? { ...state.residue } : null
    return Object.freeze({
      ...state,
      residue,
      causes: state.causes.map(x => ({ ...x })),
      labels: [...state.labels],
      options: [...OPTIONS[state.stance]],
      attention: ATTENTION[state.stance],
      allowedNext: allowedNext(state.stance),
    })
  }

  function promptBlock() {
    const s = snapshot()
    return [
      '## 当前情绪倾向（参考，不是命令）',
      `倾向：${s.stance}`,
      `心情：${s.mood}`,
      `这一轮先注意：${s.attention}`,
      s.uncertain ? '不确定：她可能听错了，可以先问一句，不急着把对方定性' : '',
      s.residue ? `余韵：刚才那点“${s.residue.impact}”还没完全散；可以不提，但不必装没发生` : '',
      `可选反应：${s.options.join(' / ')}`,
      `也可以跳到的倾向：${s.allowedNext.filter(x => x !== s.stance).join(' / ')}`,
      '这些只是可选方向，不是固定台词；可以自然选择，也可以不表现。不要每轮播报心情，不要用离开或冷处理惩罚对方。',
    ].join('\n')
  }

  return Object.freeze({ observe, retract, snapshot, promptBlock, load })
}
