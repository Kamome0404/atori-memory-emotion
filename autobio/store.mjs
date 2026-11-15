import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function openDatabase(dbPath) {
  const isNew = !existsSync(dbPath) || statSync(dbPath).size === 0
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys=ON')
  if (isNew) {
    const sql = readFileSync(join(here, 'migrations', '001.sql'), 'utf8')
    db.exec(sql)
  } else {
    const rows = db.prepare("SELECT key,value FROM meta WHERE key IN ('marker','schema')").all()
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
    if (map.marker !== 'atori-autobio-candidates-v1' || String(map.schema) !== '1') {
      db.close()
      throw new Error('autobio: unknown marker/schema')
    }
  }
  return db
}

export function openStore(dbPath) {
  if (!dbPath || typeof dbPath !== 'string') throw new Error('autobio: dbPath required')
  const db = openDatabase(dbPath)
  const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { try { db.exec('ROLLBACK') } catch {} throw e } }

  function insertCandidate(c, sources = []) {
    return tx(() => {
      const ins = db.prepare(`INSERT OR IGNORE INTO candidates
        (id,account_id,self_id,uid,scope,generation,basis,content_class,text,uncertain,status,
         source_set_digest,content_digest,dedupe_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        c.id, c.account_id, c.self_id, c.uid, c.scope, c.generation, c.basis, c.content_class,
        c.text, c.uncertain, c.status, c.source_set_digest, c.content_digest, c.dedupe_key, c.created_at,
      )
      if (!ins || Number(ins.changes) === 0) return null
      const got = db.prepare('SELECT * FROM candidates WHERE id=?').get(c.id)
      if (!got) return null
      for (const s of sources) {
        db.prepare(`INSERT OR REPLACE INTO sources
          (candidate_id,source_kind,event_id,reply_id,ordinal,generation,event_digest,source_text_digest)
          VALUES (?,?,?,?,?,?,?,?)`).run(c.id, s.kind, s.eventId, s.replyId || '', Number(s.ordinal ?? -1), Number(s.generation), String(s.eventDigest || ''), String(s.sourceTextDigest || ''))
      }
      return got
    })
  }

  function getCandidate(id) { return db.prepare('SELECT * FROM candidates WHERE id=?').get(String(id)) || null }

  function listPending({ scope, limit = 20 } = {}) {
    return db.prepare('SELECT * FROM candidates WHERE scope=? AND status=\'pending\' ORDER BY created_at ASC LIMIT ?').all(String(scope), Math.min(100, Math.max(1, Number(limit) || 20)))
  }

  function review({ id, scope, decision, reviewerId, expectedDigest, reason = '' } = {}) {
    return tx(() => {
      const c = getCandidate(id)
      if (!c || c.status !== 'pending') return null
      if (scope && c.scope !== String(scope)) return null
      if (!expectedDigest || c.content_digest !== expectedDigest) return null
      const status = decision === 'approve' ? 'approved' : (decision === 'reject' ? 'rejected' : 'invalidated')
      db.prepare('UPDATE candidates SET status=?,reviewer_id=?,reviewed_at=?,invalid_reason=? WHERE id=?').run(status, String(reviewerId || ''), Date.now(), reason, String(id))
      return getCandidate(id)
    })
  }

  function invalidateEvent({ eventId, reason = '' } = {}) {
    return tx(() => {
      const ids = db.prepare('SELECT DISTINCT candidate_id FROM sources WHERE event_id=?').all(String(eventId)).map(r => r.candidate_id)
      for (const id of ids) {
        db.prepare("UPDATE candidates SET status='invalidated',text='',invalid_reason=?,reviewed_at=? WHERE id=?").run(String(reason), Date.now(), id)
      }
      return ids.length
    })
  }

  function invalidateScope({ scope, reason = 'source_revoked' } = {}) {
    return tx(() => {
      const r = db.prepare("UPDATE candidates SET status='invalidated',text='',invalid_reason=?,reviewed_at=? WHERE scope=? AND status IN ('pending','approved')").run(String(reason), Date.now(), String(scope))
      return Number(r.changes || 0)
    })
  }

  function listApproved({ scope, generation, limit = 10 } = {}) {
    return db.prepare("SELECT * FROM candidates WHERE scope=? AND status='approved' AND generation=? ORDER BY created_at DESC LIMIT ?").all(String(scope), Number(generation), Math.max(1, Number(limit) || 10))
  }

  function selectApproved({ scope, id } = {}) {
    const c = db.prepare("SELECT * FROM candidates WHERE scope=? AND id=? AND status='approved'").get(String(scope), String(id))
    return c || null
  }

  function observeDelivery({ attemptKey, accountId, selfId, uid, scope, contentDigest, contentClass, sourceRefs, status, realReceiptId, eligible }) {
    db.prepare(`INSERT OR REPLACE INTO delivery_observations
      (attempt_key,account_id,self_id,uid,scope,content_digest,content_class,source_refs_json,status,real_receipt_id,created_at,eligible)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(String(attemptKey), String(accountId || ''), String(selfId || ''), String(uid || ''), String(scope || ''),
      String(contentDigest || ''), String(contentClass || ''), JSON.stringify(sourceRefs || []), String(status), String(realReceiptId || ''), Date.now(), eligible ? 1 : 0)
  }

  function close() { try { db.close() } catch {} }

  return { db, insertCandidate, getCandidate, listPending, review, invalidateEvent, invalidateScope, listApproved, selectApproved, observeDelivery, close }
}
