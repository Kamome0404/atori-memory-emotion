// Read-only timeline projection. This module never writes to a source and never
// calls a model. Source adapters supply bounded snapshots; projectMemoryTimeline
// only normalizes, de-duplicates, orders and labels them.
import { DatabaseSync } from 'node:sqlite'
import { projectMemoryTime } from './memory-time-label.mjs'

const DAY_MS = 86400000
const ZONE = 'Asia/Shanghai'

function clip(text, max = 100) {
  const a = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  return a.length > max ? a.slice(0, Math.max(0, max - 1)).join('') + '…' : a.join('')
}

function itemFromEvent(raw, source, scope, uid, now) {
  const eventId = String(raw.eventId || '').trim()
  const sourceRecordId = String(raw.sourceRecordId || eventId).trim()
  if (!eventId && !sourceRecordId) return null
  if (raw.scope != null && String(raw.scope) !== scope) return null
  if (raw.uid != null && String(raw.uid) !== uid) return null
  if (raw.at == null || raw.at === '') return null
  const at = Number(raw.at)
  if (!Number.isFinite(at)) return null
  const item = {
    key: `${source}:${scope}:${uid}:${eventId || sourceRecordId}`,
    source,
    timeKind: ['event', 'interaction', 'thought', 'plan', 'current'].includes(raw.timeKind) ? raw.timeKind : 'event',
    scope,
    uid,
    eventId: eventId || null,
    sourceRecordId,
    at,
    dateOnly: raw.dateOnly === true,
    timePrecision: ['date', 'minute', 'second', 'millisecond', 'unknown'].includes(raw.timePrecision) ? raw.timePrecision : 'minute',
    text: clip(raw.text, 300),
    rawText: String(raw.text || '').slice(0, 4000),
    status: String(raw.status || 'current'),
    sourceCurrent: raw.sourceCurrent !== false,
    evidence: [{ source, scope, uid, eventId: eventId || null, sourceRecordId, at, field: String(raw.evidenceField || (eventId ? 'events.at' : 'source.record')) }],
    replyCount: Number(raw.replyCount || 0),
  }
  item.time = projectMemoryTime({ event: item, now, zone: ZONE, sourceCurrent: item.sourceCurrent })
  return item
}

function coverageOf(sourceName, src) {
  const status = String(src?.status || (src?.complete === false ? 'partial' : 'complete'))
  return {
    source: sourceName,
    status,
    from: Number.isFinite(Number(src?.from)) ? Number(src.from) : null,
    to: Number.isFinite(Number(src?.to)) ? Number(src.to) : null,
    complete: status === 'complete' && src?.complete !== false && src?.truncated !== true,
  }
}

/**
 * Pure projection over already-read, bounded source snapshots.
 * @param {object} input
 * @param {string} input.scope
 * @param {string} input.uid
 * @param {number} [input.now]
 * @param {object} [input.sources]
 * @param {number} [input.limit]
 * @param {'asc'|'desc'} [input.order]
 */
export function projectMemoryTimeline({ scope, uid, now = Date.now(), sources = {}, limit = 20, order = 'desc', offset = 0 } = {}) {
  const s = String(scope || '')
  const u = String(uid || '')
  const t = Number(now)
  const n = Math.max(1, Math.min(50, Number(limit) || 20))
  const off = Math.max(0, Math.min(10000, Number(offset) || 0))
  const coverage = []
  const missing = []
  const byKey = new Map()
  let sourceTruncated = false

  if (!s || !u || !Number.isFinite(t)) {
    return {
      schema: 'memory-timeline/v1', now: Number.isFinite(t) ? t : null, zone: ZONE,
      items: [], missing: ['scope/uid/now'], excluded: [], partial: true, truncated: false,
      coverage: [], consistency: 'snapshot-per-source',
    }
  }

  for (const [sourceName, src] of Object.entries(sources || {})) {
    if (!src) { missing.push(sourceName); continue }
    const cov = coverageOf(sourceName, src)
    coverage.push(cov)
    if (src.truncated) sourceTruncated = true
    // A gap/unavailable source may only explain its hole, never leak its items.
    const suppressItems = ['gap', 'unavailable', 'unsupported'].includes(cov.status)
    for (const raw of (suppressItems ? [] : (Array.isArray(src.items) ? src.items : []))) {
      const item = itemFromEvent(raw, sourceName, s, u, t)
      if (!item) continue
      if (item.scope !== s || item.uid !== u) continue
      if (!item.sourceCurrent) continue
      if (item.at > t) continue
      const prior = byKey.get(item.key)
      if (!prior || item.at > prior.at) byKey.set(item.key, item)
    }
  }

  const items = [...byKey.values()].sort((a, b) => {
    const d = order === 'asc' ? a.at - b.at : b.at - a.at
    return d || String(a.source + a.sourceRecordId).localeCompare(String(b.source + b.sourceRecordId))
  })
  const truncated = items.length > off + n || sourceTruncated
  const selected = items.slice(off, off + n)
  const coverageComplete = Object.keys(sources || {}).length > 0
    && missing.length === 0
    && !truncated
    && coverage.every(x => x.status === 'complete' && x.complete === true)
  const claimReasons = []
  if (!Object.keys(sources || {}).length) claimReasons.push('no_sources')
  if (missing.length) claimReasons.push('missing_source')
  if (truncated) claimReasons.push('truncated')
  if (coverage.some(x => x.status !== 'complete' || x.complete !== true)) claimReasons.push('partial_coverage')
  return {
    schema: 'memory-timeline/v1',
    now: t,
    zone: ZONE,
    items: selected, offset: off, nextOffset: off + selected.length,
    missing: [...new Set(missing)],
    excluded: [],
    partial: !coverageComplete,
    truncated,
    coverage,
    consistency: 'snapshot-per-source',
    claims: {
      canSayLast: coverageComplete,
      canSayNever: coverageComplete,
      canSayAlways: coverageComplete,
      reasons: claimReasons,
    },
  }
}

/**
 * Read-only hippocampus snapshot. It opens a read transaction and excludes
 * tombstones in the same snapshot. No writes, no model calls.
 */
export function readHippocampusTimelineSource({ dbPath, ownerUid, now = Date.now(), limit = 100 } = {}) {
  const owner = String(ownerUid || '')
  const n = Math.max(1, Math.min(100, Number(limit) || 100))
  const scope = `private:${owner}`
  if (!dbPath || !owner) return { source: 'hippocampus', status: 'unsupported', items: [], complete: false, truncated: false }
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    db.exec('BEGIN')
    const rows = db.prepare(`
      SELECT e.event_id AS eventId, e.at AS at, e.text AS text,
             (SELECT COUNT(*) FROM confirmed_replies r
               WHERE r.scope=e.scope AND r.uid=e.uid AND r.event_id=e.event_id) AS replyCount
        FROM events e
       WHERE e.scope=? AND e.uid=? AND e.at<=?
         AND NOT EXISTS (SELECT 1 FROM tombstones t
                          WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
       ORDER BY e.at DESC, e.event_id DESC
       LIMIT ?
    `).all(scope, owner, Number(now), n + 1)
    db.exec('COMMIT')
    const truncated = rows.length > n
    const items = rows.slice(0, n).map(r => ({
      eventId: String(r.eventId), at: Number(r.at), text: String(r.text || ''),
      replyCount: Number(r.replyCount || 0), sourceCurrent: true,
    }))
    const times = items.map(x => x.at).filter(Number.isFinite)
    return {
      source: 'hippocampus',
      status: truncated ? 'partial' : 'complete',
      items,
      truncated,
      complete: !truncated,
      from: times.length ? Math.min(...times) : null,
      to: times.length ? Math.max(...times) : null,
    }
  } catch {
    try { db?.exec('ROLLBACK') } catch {}
    return { source: 'hippocampus', status: 'unavailable', items: [], complete: false, truncated: false }
  } finally {
    try { db?.close() } catch {}
  }
}
