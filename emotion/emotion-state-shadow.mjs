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
  const attentionEpisodes = new Map()
  const INTENSITY_RANK = { soft: 1, normal: 2, strong: 3 }
  const episodeKey = a => {
    const label = String(a.episode || '').trim()
    return label ? `ep:${label}` : `${a.impact}:${a.focus || 'unknown'}`
  }

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
    const activeEpisodes = [...attentionEpisodes.entries()]
      .filter(([key]) => key.startsWith('ep:'))
      .map(([key, value]) => ({ label: key.slice(3), closed: value?.closed === true }))
      .slice(-12)
    let appraisal
    try {
      appraisal = await classifier.classify({ userText, replyText, activeEpisodes })
    } catch (e) {
      log(`[情绪影子] 分类失败：${String(e?.message || e).slice(0, 80)}`)
      return Object.freeze({ applied: false, reason: 'classify_failed' })
    }
    try { log(`[情绪影子] 分类 impact=${appraisal.impact} focus=${appraisal.focus} intensity=${appraisal.intensity} salience=${appraisal.salience} episode=${appraisal.episode || '-'} state=${appraisal.episodeState || '-'} uncertain=${appraisal.uncertain} active=${activeEpisodes.map(x => x.label + (x.closed ? '(closed)' : '')).join('|') || '-'}`) } catch {}
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
    try { log(`[情绪影子] 状态 stance=${result.state.stance} changed=${result.changed}`) } catch {}
    const salience = appraisal.salience || 'low'
    // Soft play/soothe/neutral are usually just conversational texture. Do not
    // turn them into an attention reminder just because the stance changed.
    const softTexture = appraisal.intensity === 'soft'
      && ['play', 'soothe', 'neutral'].includes(appraisal.impact)
    const attentionWanted = salience === 'high'
      || (salience === 'medium' && result.changed && !softTexture)
    try { log(`[情绪影子] 门 wanted=${attentionWanted} softTexture=${softTexture} salience=${salience} changed=${result.changed}`) } catch {}
    // An episode is a thing that happened, not a mood label. Its state is
    // resolved by the classifier, not by Atori's soothing/repair tone.
    const key = episodeKey(appraisal)
    const episodeState = appraisal.episodeState || (appraisal.impact === 'repair' ? 'resolved' : 'open')
    if (episodeState === 'resolved') {
      const previous = attentionEpisodes.get(key)
      if (previous) {
        attentionEpisodes.set(key, { ...previous, closed: true })
        try { log(`[情绪影子] resolved 关闭 episode=${key}`) } catch {}
      } else {
        try { log(`[情绪影子] resolved 未匹配 episode=${key}`) } catch {}
      }
    }
    const previous = attentionEpisodes.get(key)
    const rank = INTENSITY_RANK[appraisal.intensity] || 0
    const escalated = !!previous && (
      rank > previous.rank
      || (['hurt', 'boundary'].includes(appraisal.impact)
          && !['hurt', 'boundary'].includes(previous.impact))
    )
    const reopened = previous?.closed === true || episodeState === 'reopened'
    const canPublish = episodeState !== 'resolved' && episodeState !== 'uncertain'
    if (attentionWanted && canPublish && (!previous || reopened || escalated)) {
      pendingAttention = true
      attentionEpisodes.set(key, { rank, impact: appraisal.impact, closed: false })
      const why = !previous ? '新事件' : reopened ? '已修复重开' : '升级'
      try { log(`[情绪影子] 发布注意力 episode=${key} reason=${why} rank=${rank}`) } catch {}
      if (attentionEpisodes.size > 32) attentionEpisodes.delete(attentionEpisodes.keys().next().value)
    } else {
      try { log(`[情绪影子] 不发布 episode=${key} wanted=${attentionWanted} state=${episodeState} impact=${appraisal.impact} previous=${!!previous} closed=${previous?.closed === true} escalated=${escalated}`) } catch {}
    }
    return Object.freeze({
      applied: true,
      classification: { impact: appraisal.impact, focus: appraisal.focus, salience: appraisal.salience, intensity: appraisal.intensity, uncertain: appraisal.uncertain, episode: appraisal.episode || '' },
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
