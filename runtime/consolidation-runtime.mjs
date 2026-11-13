// Stage IV runtime shell: load/prompt/current-check/throttled scheduling.
// Core owns quotas/digests; this file only wires them into main, with no import side effects.
export function createConsolidationRuntime({
  getService,
  memoryScope,
  log = () => {},
  clock = Date.now,
  setTimeoutFn = setTimeout,
  throttleMs = 300000,
} = {}) {
  if (typeof getService !== 'function' || typeof memoryScope !== 'function') throw new TypeError('invalid consolidation runtime')

  const lastAt = new Map()

  function load(target) {
    try {
      if (target._evalMode || memoryScope(target) !== `private:${String(target.uid || '')}`) return []
      const pm = getService()
      const generation = target._pilotTurn?.generation ?? pm.status?.(target.uid)?.generation
      if (!pm || !Number.isSafeInteger(generation)) return []
      target._consolidatedGeneration = generation
      const rows = pm.loadConsolidated?.({ uid: target.uid, generation, limit: 4 }) || []
      target._consolidatedSnapshots = rows.map(r => ({ id: r.id, contentDigest: r.provenance.contentDigest, sourceSetDigest: r.provenance.sourceSetDigest }))
      target._consolidatedInjected = rows.length > 0
      return rows
    } catch { return [] }
  }

  function promptBlock(rows, target, preferenceTurn) {
    if (!rows?.length || target._suppressPreferenceMemory || preferenceTurn?.broad) return ''
    return '## 过去的片段（只是历史参考，不是当前事实）\n' + rows.map(r => '- ' + r.content).join('\n')
  }

  function stillCurrent(target) {
    const snaps = target?._consolidatedSnapshots
    if (!Array.isArray(snaps) || !snaps.length) return true
    const generation = target?._consolidatedGeneration ?? target?._pilotTurn?.generation
    if (!Number.isSafeInteger(generation)) return false
    try {
      const rows = getService()?.loadConsolidated?.({ uid: target.uid, generation, limit: 16 }) || []
      return snaps.every(s => rows.some(r => r.id === s.id
        && r.provenance.contentDigest === s.contentDigest
        && r.provenance.sourceSetDigest === s.sourceSetDigest))
    } catch { return false }
  }

  function schedule(uid) {
    try {
      const key = String(uid)
      const now = clock()
      if (now - (lastAt.get(key) || 0) < throttleMs) return false
      lastAt.set(key, now)
      setTimeoutFn(() => {
        try {
          const pm = getService()
          const st = pm?.status?.(key)
          if (!pm || !st?.allowed) return
          const made = pm.consolidateRecent?.({ uid: key, generation: st.generation, limit: 5 }) || []
          if (made.length) log(`[记忆] consolidation 生成 ${made.length} 条`)
        } catch (e) {
          try { log('[记忆] consolidation 失败：' + String(e.message).slice(0, 60)) } catch {}
        }
      }, 0)
      return true
    } catch { return false }
  }

  return Object.freeze({ load, promptBlock, stillCurrent, schedule })
}
