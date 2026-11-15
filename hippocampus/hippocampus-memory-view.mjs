// Owner-only read model for the hippocampus shadow. No recall injection, no writes.
import { DatabaseSync } from 'node:sqlite'

export function readHippocampusMemory({ dbPath, ownerUid, limit = 20, query = '' } = {}) {
  const owner = String(ownerUid || '')
  if (!dbPath || !owner) return { ok: false, error: 'dbPath/owner required' }
  const n = Math.max(1, Math.min(50, Number(limit) || 20))
  const q = String(query || '').trim().slice(0, 80)
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    // One read transaction keeps events/replies/refs on the same snapshot.
    db.exec('BEGIN')
    const scope = `private:${owner}`
    const events = q
      ? db.prepare(`SELECT event_id AS eventId,text,at FROM events WHERE scope=? AND uid=? AND text LIKE ? ORDER BY at DESC LIMIT ?`).all(scope, owner, `%${q}%`, n)
      : db.prepare(`SELECT event_id AS eventId,text,at FROM events WHERE scope=? AND uid=? ORDER BY at DESC LIMIT ?`).all(scope, owner, n)
    const ids = events.map(e => e.eventId)
    let replies = []
    let refs = []
    if (ids.length) {
      const marks = ids.map(() => '?').join(',')
      replies = db.prepare(`SELECT event_id AS eventId,seq,text FROM confirmed_replies WHERE scope=? AND uid=? AND event_id IN (${marks}) ORDER BY event_id,seq`).all(scope, owner, ...ids)
      refs = db.prepare(`SELECT event_id AS eventId,direction,reply_id AS replyId,part_seq AS partSeq FROM refs WHERE scope=? AND uid=? AND event_id IN (${marks}) ORDER BY event_id,direction,part_seq`).all(scope, owner, ...ids)
    }
    db.exec('COMMIT')
    return {
      ok: true, scope, query: q, limit: n,
      items: events.map(e => ({
        eventId: String(e.eventId), text: String(e.text || ''), at: Number(e.at) || 0,
        replies: replies.filter(r => r.eventId === e.eventId).map(r => String(r.text || '')),
        refs: refs.filter(r => r.eventId === e.eventId).map(r => ({ direction: String(r.direction), replyId: String(r.replyId || ''), partSeq: Number(r.partSeq) || 0 })),
      })),
    }
  } catch (e) {
    try { db?.exec('ROLLBACK') } catch {}
    return { ok: false, error: String(e.message || e).slice(0, 120) }
  } finally { try { db?.close() } catch {} }
}
