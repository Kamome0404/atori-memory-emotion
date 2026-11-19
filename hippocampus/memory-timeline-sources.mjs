// Read-only, bounded source adapters for the timeline. Each adapter reports its
// own coverage; none writes, calls a model, or fills a missing time.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MAX_ITEMS = 50

function atOf(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function base(source, status, items = [], extra = {}) {
  const times = items.map(x => x.at).filter(Number.isFinite)
  return {
    source, status, items, complete: status === 'complete',
    truncated: extra.truncated === true,
    from: times.length ? Math.min(...times) : null,
    to: times.length ? Math.max(...times) : null,
    ...extra,
  }
}

function unavailable(source, status = 'unavailable') {
  return base(source, status, [], { complete: false })
}

function readJsonStrict(path) {
  try { return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) } }
  catch { return { ok: false, value: null } }
}

function item(source, sourceRecordId, at, text, timeKind, extra = {}) {
  return {
    eventId: null,
    sourceRecordId: String(sourceRecordId),
    at: Number(at),
    text: String(text || ''),
    timeKind,
    dateOnly: extra.dateOnly === true,
    timePrecision: extra.timePrecision || 'minute',
    status: extra.status || 'current',
    sourceCurrent: extra.sourceCurrent !== false,
    evidenceField: extra.evidenceField || 'at',
  }
}

function validShanghaiDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null
  const ms = Date.parse(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(ms)) return null
  const local = new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
  return local === date ? ms : null
}

export function readPrivateClockSource({ filePath, ownerUid, now = Date.now() } = {}) {
  const owner = String(ownerUid || '')
  if (!filePath || !owner) return unavailable('private-clock', 'unsupported')
  if (!existsSync(filePath)) return base('private-clock', 'complete', [])
  try {
    const parsed = readJsonStrict(filePath)
    if (!parsed.ok) return unavailable('private-clock')
    const all = parsed.value
    const c = all && all[owner]
    if (!c || typeof c !== 'object') return base('private-clock', 'complete', [])
    const rows = [
      ['lastUserAt', '最近互动记录：他跟你说话'],
      ['lastBotAt', '最近互动记录：你回复他'],
      ['lastProactiveAt', '最近互动记录：你主动找他'],
    ]
    const items = []
    for (const [field, label] of rows) {
      const at = atOf(c[field])
      if (at == null || at > now) continue
      items.push(item('private-clock', `private-clock:${owner}:${field}`, at, label, 'interaction', { evidenceField: field }))
    }
    return base('private-clock', 'complete', items)
  } catch { return unavailable('private-clock') }
}

export function readInnerLifeThreadSource({ filePath, now = Date.now() } = {}) {
  if (!filePath) return unavailable('innerlife-thread', 'unsupported')
  if (!existsSync(filePath)) return base('innerlife-thread', 'complete', [])
  try {
    const parsed = readJsonStrict(filePath)
    if (!parsed.ok) return unavailable('innerlife-thread')
    const t = parsed.value
    if (!t || typeof t !== 'object') return unavailable('innerlife-thread')
    const all = []
    const entries = Array.isArray(t.entries) ? t.entries : []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] || {}
      const at = atOf(e.t)
      if (at == null || at > now || !String(e.thought || '').trim()) continue
      all.push(item('innerlife-thread', `thread:${t.startedAt || 0}:entry:${i}`, at, e.thought, 'thought', { evidenceField: `entries[${i}].t`, status: t.closed ? 'closed' : 'current' }))
    }
    const startAt = atOf(t.startedAt)
    if (!all.length && startAt != null && startAt <= now && String(t.topic || '').trim()) {
      all.push(item('innerlife-thread', `thread:${startAt}:start`, startAt, t.topic, 'thought', { evidenceField: 'startedAt', status: t.closed ? 'closed' : 'current' }))
    }
    all.sort((a, b) => b.at - a.at)
    const truncated = all.length > MAX_ITEMS
    return base('innerlife-thread', truncated ? 'partial' : 'complete', all.slice(0, MAX_ITEMS), { truncated })
  } catch { return unavailable('innerlife-thread') }
}

export function readPlansSource({ filePath, now = Date.now() } = {}) {
  if (!filePath) return unavailable('plans', 'unsupported')
  if (!existsSync(filePath)) return base('plans', 'complete', [])
  try {
    const latest = new Map()
    let bad = 0
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const p = JSON.parse(line)
        if (!p || !p.id) { bad++; continue }
        latest.set(String(p.id), { ...(latest.get(String(p.id)) || {}), ...p })
      } catch { bad++ }
    }
    const all = []
    for (const p of [...latest.values()].sort((a, b) => Number(b.created) - Number(a.created))) {
      const at = atOf(p.created)
      if (at == null || at > now) continue
      const due = /^\d{4}-\d{2}-\d{2}$/.test(String(p.due || '')) ? `（到期 ${p.due}，状态 ${p.status || 'unknown'}）` : ''
      all.push(item('plans', `plan:${p.id}`, at, `计划：${String(p.what || '').slice(0, 100)}${due}`, 'plan', { evidenceField: 'created', status: p.status || 'unknown' }))
    }
    const truncated = all.length > MAX_ITEMS
    const status = all.length ? (truncated || bad ? 'partial' : 'complete') : (bad ? 'unavailable' : 'complete')
    return base('plans', status, all.slice(0, MAX_ITEMS), { truncated, badLines: bad })
  } catch { return unavailable('plans') }
}

export function readSpaceDiarySource({ dir, now = Date.now() } = {}) {
  if (!dir) return unavailable('space-diary', 'unsupported')
  if (!existsSync(dir)) return base('space-diary', 'complete', [])
  try {
    const allFiles = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().reverse()
    const files = allFiles.slice(0, 7)
    const filesTruncated = allFiles.length > 7
    const all = []
    let bad = 0
    for (const file of files) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n')
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        if (!line.trim()) continue
        let e
        try { e = JSON.parse(line) } catch { bad++; continue }
        const at = atOf(e?.t)
        if (at == null || at > now || !String(e?.text || '').trim()) { bad++; continue }
        const thought = e.kind === 'self' || e.source === 'her_imagination'
      all.push(item('space-diary', `diary:${file}:${li}`, at, e.text, thought ? 'thought' : 'event', { evidenceField: 'jsonl.t', status: e.kind || 'unknown' }))
      }
    }
    all.sort((a, b) => b.at - a.at)
    const truncated = filesTruncated || all.length > MAX_ITEMS
    const status = all.length ? (truncated || bad ? 'partial' : 'complete') : (bad ? 'unavailable' : 'complete')
    return base('space-diary', status, all.slice(0, MAX_ITEMS), { truncated, badLines: bad })
  } catch { return unavailable('space-diary') }
}

export function readSpaceYearSource({ filePath, now = Date.now() } = {}) {
  if (!filePath) return unavailable('space-year', 'unsupported')
  if (!existsSync(filePath)) return base('space-year', 'complete', [])
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n')
    const all = []
    let bad = 0
    for (let i = 0; i < lines.length; i++) {
      const m = /^##\s+(\d{4}-\d{2}-\d{2})\b/.exec(lines[i])
      if (!m) continue
      const at = validShanghaiDate(m[1])
      if (at == null) { bad++; continue }
      if (at > now) continue
      const body = []
      for (let j = i + 1; j < lines.length && !/^##\s+/.test(lines[j]); j++) {
        if (lines[j].trim()) body.push(lines[j].trim())
      }
      all.push(item('space-year', `year:${m[1]}:${i}`, at, `年表 ${m[1]}：${body.join(' ').slice(0, 100)}`, 'thought', { dateOnly: true, timePrecision: 'date', evidenceField: `heading[${i}]` }))
    }
    all.sort((a, b) => b.at - a.at)
    const truncated = all.length > MAX_ITEMS
    const status = all.length ? (truncated || bad ? 'partial' : 'complete') : (bad ? 'unavailable' : 'complete')
    return base('space-year', status, all.slice(0, MAX_ITEMS), { truncated, badLines: bad })
  } catch { return unavailable('space-year') }
}

export function readAutobioTimelineSource({ dbPath, hippocampusDb, ownerUid, now = Date.now(), limit = 50 } = {}) {
  const owner = String(ownerUid || '')
  const scope = `private:${owner}`
  if (!dbPath || !owner) return { source: 'autobio', status: 'unavailable', items: [], complete: false }
  let db, hdb
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare("SELECT id,text,created_at,generation,basis FROM candidates WHERE scope=? AND status='approved' ORDER BY created_at DESC LIMIT ?").all(scope, Math.max(1, Math.min(100, Number(limit) || 50)))
    const sourceRows = db.prepare("SELECT candidate_id,event_id FROM sources WHERE event_id != ''").all()
    const sources = new Map()
    for (const s of sourceRows) { if (!sources.has(String(s.candidate_id))) sources.set(String(s.candidate_id), []); sources.get(String(s.candidate_id)).push(String(s.event_id)) }
    let valid = new Set()
    if (hippocampusDb && existsSync(hippocampusDb)) {
      hdb = new DatabaseSync(hippocampusDb, { readOnly: true })
      for (const r of rows) {
        for (const eid of (sources.get(String(r.id)) || [])) {
          const e = hdb.prepare('SELECT 1 AS p FROM events WHERE event_id=? AND scope=? AND uid=?').get(eid, scope, owner)
          const tomb = hdb.prepare('SELECT 1 AS p FROM tombstones WHERE event_id=? AND scope=? AND uid=?').get(eid, scope, owner)
          if (e && !tomb) { valid.add(String(r.id)); break }
        }
      }
    }
    return {
      source: 'autobio', status: 'complete', complete: true,
      items: rows.filter(r => valid.has(String(r.id))).map(r => ({ sourceRecordId: String(r.id), at: Number(r.created_at), text: String(r.text || ''), timeKind: String(r.basis||'') === 'user_said' ? 'event' : 'thought', status: 'approved', sourceCurrent: true, evidenceField: 'autobio.candidates.created_at' })),
    }
  } catch (e) {
    return { source: 'autobio', status: 'unavailable', items: [], complete: false, error: String(e?.message || e).slice(0,80) }
  } finally { try { db?.close() } catch {}; try { hdb?.close() } catch {} }
}
