// Owner-only, disabled-by-default shadow: classify and record minimal emotion
// state. It never injects prompt text and never changes the reply.
import { createEmotionState } from './emotion-state.mjs'

export function createEmotionStateShadow({
  enabled = false,
  ownerUid = '',
  stateFilePath,
  classifier,
  log = () => {},
  maxPerHour = 60,
} = {}) {
  if (!enabled) {
    return Object.freeze({ enabled: false, observe: async () => ({ applied: false, reason: 'disabled' }), snapshot: () => null })
  }
  if (typeof ownerUid !== 'string' || !/^[1-9][0-9]{4,19}$/.test(ownerUid)) throw new Error('invalid ownerUid')
  if (typeof stateFilePath !== 'string' || !stateFilePath) throw new Error('stateFilePath required')
  if (!classifier || typeof classifier.classify !== 'function') throw new Error('classifier required')
  const state = createEmotionState({ filePath: stateFilePath, ownerUid })
  const stamps = []
  let pendingAttention = false

  // Relevance gate, not a fixed cadence: only a salient event (or a real
  // stance change with medium salience) leaves one attention note pending.
  function nextAttentionBlock() {
    if (!pendingAttention) return ''
    pendingAttention = false
    const s = state.snapshot()
    return [
      '## 情绪参考（不是命令）',
      `这一轮先注意：${s.attention}`,
      '可以自然选择，也可以不表现；不要播报心情，不要用离开或冷处理惩罚对方。',
    ].join('\n')
  }

  function preferredStanceFor(a) {
    if (!a) return ''
    if (a.impact === 'boundary') return 'guarded'
    if (a.impact === 'worry') return a.focus === 'other' ? 'quiet' : 'guarded'
    if (a.impact === 'soothe') return 'open'
    if (a.impact === 'hurt') return 'hurt'
    if (a.impact === 'play') return 'playful'
    if (a.impact === 'repair') return 'repair'
    return ''
  }
  let closed = false

  async function observe({ eventId, confirmed = false, userText = '', replyText = '' } = {}) {
    if (closed) return Object.freeze({ applied: false, reason: 'closed' })
    if (confirmed !== true) return Object.freeze({ applied: false, reason: 'not_confirmed' })
    if (typeof eventId !== 'string' || !eventId || eventId.length > 200) return Object.freeze({ applied: false, reason: 'invalid_event_id' })
    if (typeof userText !== 'string' || !userText.trim() || typeof replyText !== 'string' || !replyText.trim()) {
      return Object.freeze({ applied: false, reason: 'empty_text' })
    }
    const now = Date.now()
    const recent = stamps.filter(t => now - t < 3600000)
    stamps.length = 0
    stamps.push(...recent)
    if (stamps.length >= maxPerHour) return Object.freeze({ applied: false, reason: 'rate_limited' })
    stamps.push(now)
    let appraisal
    try {
      appraisal = await classifier.classify({ userText, replyText })
    } catch (e) {
      log(`[情绪影子] 分类失败：${String(e?.message || e).slice(0, 80)}`)
      return Object.freeze({ applied: false, reason: 'classify_failed' })
    }
    const result = state.observe({
      eventId,
      confirmed: true,
      impact: appraisal.impact,
      intensity: appraisal.intensity,
      uncertain: appraisal.uncertain,
      mood: appraisal.mood,
      labels: appraisal.labels,
      preferredStance: preferredStanceFor(appraisal),
    })
    if (!result.applied) {
      log(`[情绪影子] 未记录：${result.reason}`)
      return Object.freeze({ applied: false, reason: result.reason })
    }
    const salience = appraisal.salience || 'low'
    pendingAttention = salience === 'high' || (salience === 'medium' && result.changed)
    return Object.freeze({
      applied: true,
      classification: { impact: appraisal.impact, focus: appraisal.focus, salience: appraisal.salience, intensity: appraisal.intensity, uncertain: appraisal.uncertain },
      state: { stance: result.state.stance, mood: result.state.mood, labels: result.state.labels, residue: result.state.residue },
    })
  }

  return Object.freeze({
    enabled: true,
    ownerUid,
    observe,
    snapshot: () => state.snapshot(),
    promptBlock: () => state.promptBlock(),
    attentionBlock: () => {
      const s = state.snapshot()
      return [
        '## 情绪参考（不是命令）',
        `这一轮先注意：${s.attention}`,
        '可以自然选择，也可以不表现；不要播报心情，不要用离开或冷处理惩罚对方。',
      ].join('\n')
    },
    nextAttentionBlock,
    close: () => { closed = true },
  })
}
