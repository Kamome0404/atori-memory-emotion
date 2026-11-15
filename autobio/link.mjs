// autobio 接线：从 feature registry 取 runtime/integration，提供 approved/match/format/observe。
// 候选/审核/撤回规则仍在 lib/autobio。
export function createAutobioLink({ getFeature = () => null, log = () => {} } = {}) {
  function feature() { return getFeature() || null }

  function available() { return !!feature()?.runtime }

  function approved({ uid, generation } = {}) {
    const f = feature()
    if (!f?.runtime) return []
    try { return f.runtime.listApproved({ scope: `private:${String(uid)}`, generation, limit: 100000 }) || [] } catch { return [] }
  }

  function match({ text, list } = {}) {
    const f = feature()
    if (!f?.matchApprovedReference) return null
    try { return f.matchApprovedReference({ text, approved: list || [] }) } catch { return null }
  }

  function format(ref) {
    const f = feature()
    if (!f?.formatApprovedReference || !ref) return ''
    try { return f.formatApprovedReference(ref) || '' } catch { return '' }
  }

  function observeCommitted(args) {
    const f = feature()
    if (!f?.runtime) return false
    try { return f.runtime.observeCommitted(args) } catch (e) { try { log(`[接线] autobio.observe 失败：${String(e?.message || e).slice(0, 120)}`) } catch {}; return false }
  }

  return { feature, available, approved, match, format, observeCommitted }
}
