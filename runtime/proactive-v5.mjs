import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const HOUR = 3600_000
const DAY = 24 * HOUR
const kinds = new Set(['agreed_once', 'requested_result'])

function finite(v, name) {
  if (!Number.isFinite(v) || v < 0) throw new TypeError('invalid ' + name)
  return v
}
function uidOf(v) {
  const s = String(v ?? '')
  if (!/^\d{5,20}$/.test(s)) throw new TypeError('invalid uid')
  return s
}
function textOf(v) {
  const s = String(v ?? '').trim()
  if (!s || s.length > 60 || /[\u0000-\u001f\u007f]/.test(s)) throw new TypeError('invalid proactive text')
  return s
}

export function createProactiveV5({
  dbPath,
  clock = Date.now,
  quietStart = 22,
  quietEnd = 9,
  maxPer24h = 1,
  cooldownMs = DAY,
  afterIncomingMs = 3 * HOUR,
  leaseMs = 120_000,
} = {}) {
  if (typeof dbPath !== 'string' || !dbPath || typeof clock !== 'function') throw new TypeError('invalid store')
  if (!Number.isInteger(quietStart) || quietStart < 0 || quietStart > 23 || !Number.isInteger(quietEnd) || quietEnd < 0 || quietEnd > 23) throw new TypeError('invalid quiet hours')
  finite(maxPer24h, 'maxPer24h'); finite(cooldownMs, 'cooldownMs'); finite(afterIncomingMs, 'afterIncomingMs'); finite(leaseMs, 'leaseMs')
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS consent(uid TEXT PRIMARY KEY, version INTEGER NOT NULL, allowed INTEGER NOT NULL, source_event_id TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agenda(id TEXT PRIMARY KEY, uid TEXT NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL, not_before INTEGER NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL, token TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, consent_version INTEGER NOT NULL DEFAULT 0, source_event_id TEXT);
    CREATE TABLE IF NOT EXISTS ledger(token TEXT PRIMARY KEY, agenda_id TEXT NOT NULL, uid TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, receipt TEXT);
    CREATE TABLE IF NOT EXISTS policy(uid TEXT PRIMARY KEY, last_sent_at INTEGER, unanswered INTEGER NOT NULL DEFAULT 0, backoff_until INTEGER, last_incoming_at INTEGER, updated_at INTEGER NOT NULL);
  `)
  try{db.prepare('ALTER TABLE agenda ADD COLUMN consent_version INTEGER NOT NULL DEFAULT 0').run()}catch{}
  try{db.prepare('ALTER TABLE agenda ADD COLUMN source_event_id TEXT').run()}catch{}
  const now = () => finite(clock(), 'clock')
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { try { db.exec('ROLLBACK') } catch {}; throw e } }
  const consent = (uid) => db.prepare('SELECT * FROM consent WHERE uid=?').get(uid) || null
  const policy = (uid) => db.prepare('SELECT * FROM policy WHERE uid=?').get(uid) || { uid, last_sent_at: null, unanswered: 0, backoff_until: null, last_incoming_at: null, updated_at: 0 }
  const withinQuiet = (t, zoneOffsetMinutes = 0) => {
    const local = new Date(t + zoneOffsetMinutes * 60_000)
    const h = local.getUTCHours()
    return quietStart > quietEnd ? (h >= quietStart || h < quietEnd) : (h >= quietStart && h < quietEnd)
  }
  return Object.freeze({
    close() { try { db.close() } catch {} },
    status(uid) {
      const u = uidOf(uid); const c = consent(u); const p = policy(u)
      const a = db.prepare('SELECT id,text,kind,not_before,expires_at,state FROM agenda WHERE uid=? ORDER BY created_at DESC LIMIT 1').get(u) || null
      return Object.freeze({ uid: u, consent: c ? { allowed: c.allowed === 1, version: c.version, updatedAt: c.updated_at } : null, policy: Object.freeze({ ...p }), agenda: a ? Object.freeze({ ...a }) : null })
    },
    grant(uid, sourceEventId = null) {
      const u = uidOf(uid); const t = now()
      return tx(() => {
        const c = consent(u); const version = (c?.version || 0) + 1
        db.prepare('INSERT INTO consent VALUES(?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET version=excluded.version,allowed=1,source_event_id=excluded.source_event_id,updated_at=excluded.updated_at').run(u, version, 1, sourceEventId ? String(sourceEventId) : null, t)
        db.prepare('INSERT INTO policy(uid,unanswered,updated_at) VALUES(?,0,?) ON CONFLICT(uid) DO NOTHING').run(u, t)
        return Object.freeze({ ok: true, version })
      })
    },
    revoke(uid) {
      const u = uidOf(uid); const t = now()
      return tx(() => {
        const c = consent(u); if (!c) return Object.freeze({ ok: false })
        db.prepare('UPDATE consent SET version=?,allowed=0,updated_at=? WHERE uid=?').run(c.version + 1, t, u)
        db.prepare("UPDATE agenda SET state='cancelled',updated_at=? WHERE uid=? AND state IN ('scheduled','sending')").run(t, u)
        return Object.freeze({ ok: true, version: c.version + 1 })
      })
    },
    schedule({ uid, text, kind = 'agreed_once', notBefore, expiresAt, sourceEventId = null } = {}) {
      const u = uidOf(uid); const t = now(); const body = textOf(text)
      if (!kinds.has(kind)) throw new TypeError('invalid kind')
      const nb = finite(notBefore ?? t, 'notBefore')
      const exp = finite(expiresAt ?? (nb + DAY), 'expiresAt')
      if (exp <= nb || exp <= t) throw new TypeError('invalid expiry')
      return tx(() => {
        const c = consent(u); if (!c || c.allowed !== 1) return Object.freeze({ ok: false, reason: 'no consent' })
        const active = db.prepare("SELECT id FROM agenda WHERE uid=? AND state IN ('scheduled','sending')").get(u)
        if (active) return Object.freeze({ ok: false, reason: 'already active' })
        const id = randomUUID()
        db.prepare('INSERT INTO agenda VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id, u, body, kind, nb, exp, 'scheduled', null, t, t, c.version, sourceEventId ? String(sourceEventId) : null)
        return Object.freeze({ ok: true, id, notBefore: nb, expiresAt: exp })
      })
    },
    markIncoming(uid) {
      const u = uidOf(uid); const t = now()
      return tx(() => {
        const p = policy(u)
        db.prepare('INSERT INTO policy VALUES(?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET unanswered=0,last_incoming_at=excluded.last_incoming_at,updated_at=excluded.updated_at').run(u, p.last_sent_at ?? null, p.unanswered, p.backoff_until ?? null, t, t)
        return true
      })
    },
    due(nowArg = now(), zoneOffsetMinutes = 0) {
      const t = finite(nowArg, 'now')
      if (withinQuiet(t, zoneOffsetMinutes)) return null
      return tx(() => {
        const row = db.prepare("SELECT * FROM agenda WHERE state='scheduled' AND not_before<=? AND expires_at>? ORDER BY not_before ASC LIMIT 1").get(t, t)
        if (!row) return null
        const c = consent(row.uid); if (!c || c.allowed !== 1 || c.version !== row.consent_version) { db.prepare("UPDATE agenda SET state='cancelled',updated_at=? WHERE id=? AND state='scheduled'").run(t,row.id); return null }
        const p = policy(row.uid)
        if (row.kind !== 'agreed_once' && (p.unanswered >= 1 || (p.backoff_until && t < p.backoff_until))) return null
        if (row.kind !== 'agreed_once' && p.last_incoming_at && t - p.last_incoming_at < afterIncomingMs) return null
        if (row.kind !== 'agreed_once' && p.last_sent_at && t - p.last_sent_at < cooldownMs) return null
        const recent = db.prepare("SELECT count(*) AS n FROM ledger WHERE uid=? AND state IN ('confirmed','unknown') AND at>?").get(row.uid, t - DAY).n
        if (row.kind !== 'agreed_once' && Number(recent) >= maxPer24h) return null
        const token = randomUUID()
        db.prepare("UPDATE agenda SET state='sending',token=?,updated_at=? WHERE id=? AND state='scheduled'").run(token, t, row.id)
        db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?)').run(token, row.id, row.uid, 'pending', t, null)
        return Object.freeze({ token, id: row.id, uid: row.uid, text: row.text, kind: row.kind, consentVersion: row.consent_version, sourceEventId: row.source_event_id })
      })
    },
    finish(token, outcome, receipt = null) {
      if (!['confirmed', 'failed', 'unknown'].includes(outcome)) throw new TypeError('invalid outcome')
      const t = now()
      return tx(() => {
        const l = db.prepare('SELECT * FROM ledger WHERE token=? AND state=?').get(String(token), 'pending'); if (!l) return false
        const ag = db.prepare('SELECT state FROM agenda WHERE id=?').get(l.agenda_id); if (ag?.state === 'cancelled') { db.prepare("UPDATE ledger SET state='blocked',at=?,receipt='cancelled' WHERE token=?").run(t, String(token)); return false }
        const agendaState = outcome === 'confirmed' ? 'confirmed' : outcome === 'failed' ? 'failed' : 'unknown'
        db.prepare('UPDATE ledger SET state=?,at=?,receipt=? WHERE token=?').run(outcome, t, receipt ? String(receipt).slice(0, 200) : null, String(token))
        db.prepare('UPDATE agenda SET state=?,updated_at=? WHERE id=?').run(agendaState, t, l.agenda_id)
        const p = policy(l.uid)
        db.prepare('INSERT INTO policy VALUES(?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET last_sent_at=?,unanswered=?,updated_at=?').run(l.uid, t, p.unanswered, p.backoff_until ?? null, p.last_incoming_at ?? null, t, t, outcome === 'failed' ? p.unanswered : 1, t)
        return true
      })
    },
    revokeSource(uid, sourceEventId) {
      const u = uidOf(uid); const src = String(sourceEventId || ''); const t = now()
      if (!src) return false
      return tx(() => {
        const c = consent(u)
        const r = db.prepare("UPDATE agenda SET state='cancelled',updated_at=? WHERE uid=? AND source_event_id=?").run(t, u, src)
        if (c?.source_event_id === src) db.prepare('UPDATE consent SET version=?,allowed=0,updated_at=? WHERE uid=?').run(c.version + 1, t, u)
        return Number(r.changes) > 0
      })
    },
    cancel(uid) {
      const u = uidOf(uid); const t = now()
      return tx(() => { const r = db.prepare("UPDATE agenda SET state='cancelled',updated_at=? WHERE uid=? AND state IN ('scheduled','sending')").run(t, u); return Number(r.changes) })
    },
  })
}
