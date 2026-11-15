import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export class HippocampusSqliteError extends Error {}
export class ScopeError extends HippocampusSqliteError {}
export class ConflictError extends HippocampusSqliteError {}
export class InputError extends HippocampusSqliteError {}
export class SchemaError extends HippocampusSqliteError {}
// Stores that implement the confirmed-capture contract must advertise this symbol.
export const CONFIRMED_CAPTURE_CONTRACT = Symbol.for('dsh.hippocampus.confirmed-capture.v1')

const MAX_TEXT = 4000
const MAX_QUERY = 512
const MAX_ID = 256
const MAX_REPLIES = 8
const DAY = 86400000
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const SCHEMA_VERSION = '4'

function text(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new InputError(`${name} must be non-empty and <= ${max} characters`)
  return value
}
function id(value, name) {
  const raw = text(String(value ?? ''), name, MAX_ID)
  if (!raw.trim() || raw !== raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) throw new InputError(`${name} must be a safe identifier`)
  return raw
}
function scopeParts(scope, uid) {
  const rawScope = text(scope, 'scope', 128), s = rawScope.trim()
  if (rawScope !== s) throw new ScopeError('scope must not contain surrounding whitespace')
  if (typeof uid !== 'string' && typeof uid !== 'number') throw new ScopeError('uid must be a non-empty identifier')
  const rawUid = String(uid), u = rawUid.trim()
  if (rawUid !== u) throw new ScopeError('uid must not contain surrounding whitespace')
  if (!u || u.length > MAX_ID) throw new ScopeError('uid must be a non-empty identifier')
  const match = /^(private|group):([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/.exec(s)
  if (!match || /[\u0000-\u001f\u007f]/.test(u) || u.includes(':')) throw new ScopeError('scope must be private:<id> or group:<id>')
  if (match[1] === 'private' && match[2] !== u) throw new ScopeError('private scope id must equal uid')
  return { scope: s, uid: u }
}
function finite(value, fallback, name) {
  const n = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(n)) throw new InputError(`${name} must be finite`)
  return n
}
function timestamp(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InputError(`${name} must be a non-negative safe integer`)
  return value
}
function replyList(value) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPLIES) throw new InputError(`confirmedReplies must contain 1..${MAX_REPLIES} items`)
  return value.map((item, index) => {
    const t = text(item, `confirmedReplies[${index}]`, 2000)
    if (CONTROL.test(t)) throw new InputError(`confirmedReplies[${index}] contains control characters`)
    return t
  })
}
function sameReplies(left, right) {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}
function tokenize(value) {
  const normalized = value.normalize('NFKC').toLowerCase()
  const out = []
  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = [...run]
    out.push(...chars)
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1])
  }
  out.push(...normalized.match(/[a-z0-9]+/g) ?? [])
  return out
}
function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { try { db.exec('ROLLBACK') } catch {} ; throw error }
}
// Deferred read transaction: every read inside belongs to one snapshot. A concurrent
// commit is not blocked, and cannot change the result of this call halfway through.
function withReadTransaction(db, fn) {
  db.exec('BEGIN')
  try { const result = fn(); db.exec('COMMIT'); return result } catch (error) { try { db.exec('ROLLBACK') } catch {} ; throw error }
}

export const KNOWN_SCHEMA_SQL = Object.freeze({
  events: `CREATE TABLE events (
  scope TEXT NOT NULL, uid TEXT NOT NULL, event_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('short','long')),
  episode_id TEXT, at INTEGER NOT NULL, text TEXT NOT NULL, importance REAL NOT NULL CHECK(importance >= 0 AND importance <= 1),
  PRIMARY KEY(scope, uid, event_id)
)`,
  reviews: `CREATE TABLE reviews (
  scope TEXT NOT NULL, uid TEXT NOT NULL, memory_id TEXT NOT NULL, review_id TEXT NOT NULL,
  at INTEGER NOT NULL, quality REAL NOT NULL CHECK(quality >= 0 AND quality <= 1),
  PRIMARY KEY(scope, uid, memory_id, review_id),
  FOREIGN KEY(scope, uid, memory_id) REFERENCES events(scope, uid, event_id) ON DELETE CASCADE
)`,
  confirmed_replies: `CREATE TABLE confirmed_replies (
  scope TEXT NOT NULL, uid TEXT NOT NULL, event_id TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq >= 0),
  text TEXT NOT NULL,
  PRIMARY KEY(scope, uid, event_id, seq),
  FOREIGN KEY(scope, uid, event_id) REFERENCES events(scope, uid, event_id) ON DELETE CASCADE
)`,
  tombstones: `CREATE TABLE tombstones (
  scope TEXT NOT NULL, uid TEXT NOT NULL, event_id TEXT NOT NULL, deleted_at INTEGER NOT NULL,
  PRIMARY KEY(scope, uid, event_id)
)`,
  refs: `CREATE TABLE refs (
  scope TEXT NOT NULL, uid TEXT NOT NULL, event_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in','out')),
  reply_id TEXT NOT NULL, part_seq INTEGER NOT NULL CHECK(part_seq >= 0 AND part_seq < 8),
  created_at INTEGER NOT NULL,
  UNIQUE(scope, uid, event_id, direction, part_seq)
)`,
  meta: `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  candidates: `CREATE TABLE candidates (
  scope TEXT NOT NULL, uid TEXT NOT NULL, candidate_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('candidate_fact','inference')),
  text TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(scope, uid, candidate_id)
)`,
  candidate_evidence: `CREATE TABLE candidate_evidence (
  scope TEXT NOT NULL, uid TEXT NOT NULL, candidate_id TEXT NOT NULL, seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(scope, uid, candidate_id, seq),
  FOREIGN KEY(scope, uid, candidate_id) REFERENCES candidates(scope, uid, candidate_id) ON DELETE CASCADE
)`,
  dispositions: `CREATE TABLE dispositions (
  scope TEXT NOT NULL, uid TEXT NOT NULL, candidate_id TEXT NOT NULL, action_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('confirm','correct','withdraw')), at INTEGER NOT NULL,
  replacement_candidate_id TEXT,
  PRIMARY KEY(scope, uid, action_id),
  FOREIGN KEY(scope, uid, candidate_id) REFERENCES candidates(scope, uid, candidate_id) ON DELETE CASCADE
)`,
  disposition_evidence: `CREATE TABLE disposition_evidence (
  scope TEXT NOT NULL, uid TEXT NOT NULL, action_id TEXT NOT NULL, seq INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY(scope, uid, action_id, seq),
  FOREIGN KEY(scope, uid, action_id) REFERENCES dispositions(scope, uid, action_id) ON DELETE CASCADE
)`,
})
const CREATE = (sql) => sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')
const CORE_DDL = [
  CREATE(KNOWN_SCHEMA_SQL.events),
  'CREATE INDEX IF NOT EXISTS events_scope_time ON events(scope, uid, at DESC)',
  CREATE(KNOWN_SCHEMA_SQL.reviews),
  'CREATE INDEX IF NOT EXISTS reviews_due ON reviews(scope, uid, memory_id, at DESC)',
  CREATE(KNOWN_SCHEMA_SQL.confirmed_replies),
  CREATE(KNOWN_SCHEMA_SQL.tombstones),
  CREATE(KNOWN_SCHEMA_SQL.refs),
  CREATE(KNOWN_SCHEMA_SQL.meta),
]
const CANDIDATE_DDL = [
  CREATE(KNOWN_SCHEMA_SQL.candidates),
  CREATE(KNOWN_SCHEMA_SQL.candidate_evidence),
  CREATE(KNOWN_SCHEMA_SQL.dispositions),
  CREATE(KNOWN_SCHEMA_SQL.disposition_evidence),
]
const SCHEMA_DDL = [...CORE_DDL, ...CANDIDATE_DDL]
const CORE_TABLES = ['events', 'reviews', 'confirmed_replies', 'tombstones', 'meta']
const SPECS = {
  events: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['event_id','TEXT',1,3],['kind','TEXT',1,0],['episode_id','TEXT',0,0],['at','INTEGER',1,0],['text','TEXT',1,0],['importance','REAL',1,0]],
    fks: [],
  },
  reviews: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['memory_id','TEXT',1,3],['review_id','TEXT',1,4],['at','INTEGER',1,0],['quality','REAL',1,0]],
    fks: [{ table: 'events', from: ['scope','uid','memory_id'], to: ['scope','uid','event_id'], onDelete: 'CASCADE' }],
  },
  confirmed_replies: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['event_id','TEXT',1,3],['seq','INTEGER',1,4],['text','TEXT',1,0]],
    fks: [{ table: 'events', from: ['scope','uid','event_id'], to: ['scope','uid','event_id'], onDelete: 'CASCADE' }],
  },
  tombstones: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['event_id','TEXT',1,3],['deleted_at','INTEGER',1,0]],
    fks: [],
  },
  refs: {
    columns: [['scope','TEXT',1,0],['uid','TEXT',1,0],['event_id','TEXT',1,0],['direction','TEXT',1,0],['reply_id','TEXT',1,0],['part_seq','INTEGER',1,0],['created_at','INTEGER',1,0]],
    fks: [],
  },
  meta: {
    columns: [['key','TEXT',0,1],['value','TEXT',1,0]],
    fks: [],
  },
  candidates: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['candidate_id','TEXT',1,3],['category','TEXT',1,0],['text','TEXT',1,0],['created_at','INTEGER',1,0]],
    fks: [],
  },
  candidate_evidence: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['candidate_id','TEXT',1,3],['seq','INTEGER',1,4],['event_id','TEXT',1,0]],
    fks: [{ table: 'candidates', from: ['scope','uid','candidate_id'], to: ['scope','uid','candidate_id'], onDelete: 'CASCADE' }],
  },
  dispositions: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['candidate_id','TEXT',1,0],['action_id','TEXT',1,3],['kind','TEXT',1,0],['at','INTEGER',1,0],['replacement_candidate_id','TEXT',0,0]],
    fks: [{ table: 'candidates', from: ['scope','uid','candidate_id'], to: ['scope','uid','candidate_id'], onDelete: 'CASCADE' }],
  },
  disposition_evidence: {
    columns: [['scope','TEXT',1,1],['uid','TEXT',1,2],['action_id','TEXT',1,3],['seq','INTEGER',1,4],['event_id','TEXT',1,0]],
    fks: [{ table: 'dispositions', from: ['scope','uid','action_id'], to: ['scope','uid','action_id'], onDelete: 'CASCADE' }],
  },
}
const KNOWN_TABLES = Object.keys(SPECS)

function userVersion(db) { return Number(db.prepare('PRAGMA user_version').get().user_version) }
function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x => String(x.name))
}
function validateTable(db, table) {
  const spec = SPECS[table]
  const info = db.prepare(`PRAGMA table_info(${table})`).all()
  if (info.length !== spec.columns.length) throw new SchemaError(`incompatible columns for ${table}`)
  for (let i = 0; i < spec.columns.length; i++) {
    const [name, type, notnull] = spec.columns[i]
    const row = info[i]
    if (String(row.name) !== name || String(row.type).toUpperCase() !== type || Number(row.notnull) !== notnull) {
      throw new SchemaError(`incompatible column definition for ${table}.${name}`)
    }
  }
  const expectedPk = spec.columns.filter(c => c[3] > 0).sort((a, b) => a[3] - b[3]).map(c => c[0])
  const actualPk = info.filter(row => Number(row.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map(row => String(row.name))
  if (actualPk.join('\u001f') !== expectedPk.join('\u001f')) throw new SchemaError(`incompatible primary key for ${table}`)
  const fkRows = db.prepare(`PRAGMA foreign_key_list(${table})`).all()
  const grouped = new Map()
  for (const row of fkRows) {
    const id = Number(row.id)
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(row)
  }
  const actualFks = [...grouped.values()].map(rows => {
    rows.sort((a, b) => Number(a.seq) - Number(b.seq))
    return { table: String(rows[0].table), from: rows.map(r => String(r.from)), to: rows.map(r => String(r.to)), onDelete: String(rows[0].on_delete).toUpperCase() }
  })
  if (actualFks.length !== spec.fks.length) throw new SchemaError(`incompatible foreign keys for ${table}`)
  for (let i = 0; i < spec.fks.length; i++) {
    const want = spec.fks[i], got = actualFks[i]
    if (!got || got.table !== want.table || got.onDelete !== want.onDelete
      || got.from.join('\u001f') !== want.from.join('\u001f')
      || got.to.join('\u001f') !== want.to.join('\u001f')) throw new SchemaError(`incompatible foreign keys for ${table}`)
  }
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || '')
  // Only exact, known schema text is accepted. Comments or weakened CHECK
  // constraints change the stored SQL and are rejected; no fragment matching.
  if (sql !== KNOWN_SCHEMA_SQL[table]) throw new SchemaError(`unknown schema for ${table}`)
}
function validateLegacy(db, names) {
  if (!names.includes('events') || !names.includes('reviews')) throw new SchemaError('unknown legacy schema')
  const extra = names.filter(name => !['events', 'reviews', 'confirmed_replies', 'tombstones', 'meta'].includes(name))
  if (extra.length) throw new SchemaError(`unexpected tables: ${extra.join(',')}`)
  validateTable(db, 'events')
  validateTable(db, 'reviews')
  for (const name of ['confirmed_replies', 'tombstones']) if (names.includes(name)) validateTable(db, name)
}
function rejectMigrationObjects(db) {
  const object = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger','view') ORDER BY type, name LIMIT 1").get()
  if (object) throw new SchemaError(`refusing schema migration with unexpected ${object.type}: ${object.name}`)
}
function migrate(db) {
  try {
    withTransaction(db, () => {
      for (const sql of SCHEMA_DDL) db.exec(sql)
      db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?)").run(SCHEMA_VERSION)
      db.exec('PRAGMA user_version=' + SCHEMA_VERSION)
    })
  } catch (error) {
    if (error instanceof HippocampusSqliteError) throw error
    throw new SchemaError('schema migration failed')
  }
}

const SAFE_ACTION_ID = /^[A-Za-z0-9_.:-]+$/
function rejectUnsafeLegacyActionIds(db) {
  const rows = db.prepare('SELECT action_id FROM dispositions').all()
  for (const row of rows) if (!SAFE_ACTION_ID.test(String(row.action_id))) throw new SchemaError('unsupported legacy Unicode actionId in dispositions')
}
function migrateV2(db, createCandidateTables = true, testFault = null) {
  try {
    withTransaction(db, () => {
      if (createCandidateTables) for (const sql of CANDIDATE_DDL) db.exec(sql)
      if (testFault) testFault()
      db.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(SCHEMA_VERSION)
      db.exec('PRAGMA user_version=' + SCHEMA_VERSION)
    })
  } catch (error) {
    if (error instanceof HippocampusSqliteError) throw error
    throw new SchemaError('schema v2->v3 migration failed')
  }
}

function migrateV3toV4(db, testFault = null) {
  try {
    withTransaction(db, () => {
      db.exec(CREATE(KNOWN_SCHEMA_SQL.refs))
      if (testFault) testFault()
      db.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(SCHEMA_VERSION)
      db.exec('PRAGMA user_version=' + SCHEMA_VERSION)
    })
  } catch (error) {
    if (error instanceof HippocampusSqliteError) throw error
    throw new SchemaError('schema v3->v4 migration failed')
  }
}

export class HippocampusSqlite {
  [CONFIRMED_CAPTURE_CONTRACT] = true
  constructor({ filePath, now = () => Date.now(), forgetting = 0.5, power = 0.5, busyTimeoutMs = 5000, testMigrationFault = null } = {}) {
    if (!filePath || typeof filePath !== 'string') throw new InputError('filePath is required')
    if (testMigrationFault !== null && typeof testMigrationFault !== 'function') throw new InputError('testMigrationFault must be a function')
    if (testMigrationFault !== null && process.env.DSH_HIPPOCAMPUS_TEST_HOOKS !== '1') throw new InputError('testMigrationFault is test-only')
    this.filePath = path.resolve(filePath)
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    this.now = now
    this.forgetting = finite(forgetting, 0.5, 'forgetting')
    this.power = finite(power, 0.5, 'power')
    if (this.forgetting < 0 || this.forgetting > 1 || this.power <= 0) throw new InputError('forgetting must be 0..1 and power > 0')
    const timeout = busyTimeoutMs === undefined ? 5000 : busyTimeoutMs
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 60000) throw new InputError('busyTimeoutMs must be an integer from 0 to 60000')
    this.db = new DatabaseSync(this.filePath)
    try {
      // Connection-scoped pragmas only: no file/schema write happens before compatibility is proven.
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=' + timeout)
      const version = userVersion(this.db)
      const names = tableNames(this.db)
      if (!names.length) {
        if (version !== 0) throw new SchemaError(`unknown schema version: ${version}`)
        migrate(this.db)
      } else if (names.includes('meta')) {
        validateTable(this.db, 'meta')
        const row = this.db.prepare("SELECT value FROM meta WHERE key='schema_version'").get()
        if (!row) throw new SchemaError('missing schema version')
        const storedVersion = String(row.value)
        if (storedVersion === '2') {
          throw new SchemaError('v2 schema migration is not enabled in this stage')
        } else if (storedVersion === '3') {
          if (![0, 3].includes(version)) throw new SchemaError(`unsupported schema version: ${version}`)
          for (const table of CORE_TABLES) if (!names.includes(table)) throw new SchemaError(`missing table: ${table}`)
          for (const table of CORE_TABLES) validateTable(this.db, table)
          const candidateTables = ['candidates', 'candidate_evidence', 'dispositions', 'disposition_evidence']
          const presentCandidates = candidateTables.filter(name => names.includes(name))
          if (presentCandidates.length && presentCandidates.length !== candidateTables.length) throw new SchemaError('partial candidate schema')
          for (const table of presentCandidates) validateTable(this.db, table)
          const extra = names.filter(name => !CORE_TABLES.includes(name) && !candidateTables.includes(name) && name !== 'refs')
          if (extra.length) throw new SchemaError(`unexpected tables: ${extra.join(',')}`)
          if (names.includes('refs')) throw new SchemaError('refs already exists at v3')
          rejectMigrationObjects(this.db)
          if (presentCandidates.length) rejectUnsafeLegacyActionIds(this.db)
          for (const table of [...CORE_TABLES, ...candidateTables]) {
            const n = table === 'meta'
              ? Number(this.db.prepare("SELECT COUNT(*) AS n FROM meta WHERE key<>'schema_version'").get().n)
              : Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
            if (n !== 0) throw new SchemaError('refusing non-empty v3 database')
          }
          migrateV3toV4(this.db, testMigrationFault)
        } else if (storedVersion === SCHEMA_VERSION) {
          if (![0, Number(SCHEMA_VERSION)].includes(version)) throw new SchemaError(`unsupported schema version: ${version}`)
          for (const table of KNOWN_TABLES) if (!names.includes(table)) throw new SchemaError(`missing table: ${table}`)
          for (const table of ['events', 'reviews', 'confirmed_replies', 'tombstones', 'refs']) validateTable(this.db, table)
          for (const table of ['candidates', 'candidate_evidence', 'dispositions', 'disposition_evidence']) validateTable(this.db, table)
          rejectUnsafeLegacyActionIds(this.db)
          const extra = names.filter(name => !KNOWN_TABLES.includes(name))
          if (extra.length) throw new SchemaError(`unexpected tables: ${extra.join(',')}`)
          if (version !== Number(SCHEMA_VERSION)) withTransaction(this.db, () => this.db.exec('PRAGMA user_version=' + SCHEMA_VERSION))
        } else {
          throw new SchemaError(`unsupported schema version: ${storedVersion}`)
        }
      } else {
        throw new SchemaError('legacy database without meta is not enabled in this stage')
      }
      // WAL only after the database is accepted. A rejected database keeps its original mode.
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
    } catch (error) {
      try { this.db.close() } catch {}
      throw error
    }
  }
  close() { if (this.db?.isOpen) this.db.close() }
  [Symbol.dispose]() { this.close() }
  _scope(scope, uid) { return scopeParts(scope, uid) }
  _tombstone(s, e) { return !!this.db.prepare('SELECT 1 AS present FROM tombstones WHERE scope=? AND uid=? AND event_id=?').get(s.scope, s.uid, e) }
  record({ scope, uid, eventId, text: body, at, importance = 0.5, kind = 'long', episodeId = null, confirmedReplies = null } = {}) {
    const s = this._scope(scope, uid), e = id(eventId, 'eventId'), t = text(body, 'text'), time = timestamp(at, 'at'), imp = finite(importance, 0.5, 'importance')
    if (!['short', 'long'].includes(kind)) throw new InputError('kind must be short or long')
    if (imp < 0 || imp > 1) throw new InputError('importance must be 0..1')
    const ep = episodeId == null ? null : id(episodeId, 'episodeId')
    const replies = replyList(confirmedReplies)
    return withTransaction(this.db, () => {
      // A tombstone is authoritative: neither identical nor changed payloads may revive it.
      if (this._tombstone(s, e)) return { accepted: false, deleted: true, eventId: e }
      const exists = this.db.prepare('SELECT kind,episode_id AS episodeId,at,text,importance FROM events WHERE scope=? AND uid=? AND event_id=?').get(s.scope, s.uid, e)
      if (exists) {
        const existingReplies = this.db.prepare('SELECT text FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=? ORDER BY seq ASC').all(s.scope, s.uid, e).map(row => row.text)
        const comparedReplies = replies ?? []
        if (exists.kind !== kind || exists.episodeId !== ep || Number(exists.at) !== time || exists.text !== t || Number(exists.importance) !== imp || !sameReplies(existingReplies, comparedReplies)) {
          throw new ConflictError('eventId already exists with different content')
        }
        return { accepted: false, duplicate: true, eventId: e }
      }
      this.db.prepare('INSERT INTO events(scope,uid,event_id,kind,episode_id,at,text,importance) VALUES(?,?,?,?,?,?,?,?)').run(s.scope, s.uid, e, kind, ep, time, t, imp)
      if (replies) {
        const insert = this.db.prepare('INSERT INTO confirmed_replies(scope,uid,event_id,seq,text) VALUES(?,?,?,?,?)')
        for (let i = 0; i < replies.length; i++) insert.run(s.scope, s.uid, e, i, replies[i])
      }
      return { accepted: true, duplicate: false, eventId: e }
    })
  }
  scanConversations({ scope, uid, from = 0, to, batchSize = 100, descending = false } = {}, onBatch) {
    const s = this._scope(scope, uid)
    const start = timestamp(from, 'from'), end = timestamp(to, 'to')
    if (start > end) throw new InputError('from must be <= to')
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 200) throw new InputError('batchSize must be 1..200')
    if (typeof onBatch !== 'function') throw new InputError('onBatch must be a function')
    return withReadTransaction(this.db, () => {
      const countSql = (op) => `SELECT COUNT(*) AS n FROM events e WHERE scope=? AND uid=? AND at ${op} ?
        AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)`
      const excludedFuture = Number(this.db.prepare(countSql('>')).get(s.scope, s.uid, end).n)
      const excludedBefore = Number(this.db.prepare(countSql('<')).get(s.scope, s.uid, start).n)
      const firstSql = descending
        ? `SELECT event_id AS eventId, at, text AS incomingText FROM events e
           WHERE scope=? AND uid=? AND at>=? AND at<=?
             AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
           ORDER BY at DESC, event_id DESC LIMIT ?`
        : `SELECT event_id AS eventId, at, text AS incomingText FROM events e
           WHERE scope=? AND uid=? AND at>=? AND at<=?
             AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
           ORDER BY at ASC, event_id ASC LIMIT ?`
      const nextSql = descending
        ? `SELECT event_id AS eventId, at, text AS incomingText FROM events e
           WHERE scope=? AND uid=? AND at>=? AND at<=?
             AND (at < ? OR (at = ? AND event_id < ?))
             AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
           ORDER BY at DESC, event_id DESC LIMIT ?`
        : `SELECT event_id AS eventId, at, text AS incomingText FROM events e
           WHERE scope=? AND uid=? AND at>=? AND at<=?
             AND (at > ? OR (at = ? AND event_id > ?))
             AND NOT EXISTS (SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
           ORDER BY at ASC, event_id ASC LIMIT ?`
      let scanned = 0, batches = 0, cursorAt = null, cursorId = null, stopped = false
      while (!stopped) {
        const rows = cursorAt === null
          ? this.db.prepare(firstSql).all(s.scope, s.uid, start, end, batchSize)
          : this.db.prepare(nextSql).all(s.scope, s.uid, start, end, cursorAt, cursorAt, cursorId, batchSize)
        if (!rows.length) break
        batches += 1
        scanned += rows.length
        const ids = rows.map(row => row.eventId)
        const placeholders = ids.map(() => '?').join(',')
        const replyRows = this.db.prepare(`SELECT event_id AS eventId, text FROM confirmed_replies
          WHERE scope=? AND uid=? AND event_id IN (${placeholders}) ORDER BY event_id ASC, seq ASC`).all(s.scope, s.uid, ...ids)
        const grouped = new Map(ids.map(id => [id, []]))
        for (const reply of replyRows) grouped.get(reply.eventId)?.push(reply.text)
        const units = rows.map(row => ({
          eventId: row.eventId,
          at: Number(row.at),
          incomingText: row.incomingText,
          confirmedReplies: grouped.get(row.eventId) ?? [],
        }))
        if (onBatch(units) === false) break
        if (rows.length < batchSize) break
        cursorAt = Number(rows[rows.length - 1].at)
        cursorId = rows[rows.length - 1].eventId
      }
      return { excludedFuture, excludedBefore, scanned, batches }
    })
  }
  conversation({ scope, uid, eventId } = {}) {
    const s = this._scope(scope, uid), e = id(eventId, 'eventId')
    // Event, replies and tombstone come from the same read snapshot: a concurrent
    // delete cannot yield "found with old text but no replies".
    return withReadTransaction(this.db, () => {
      const row = this.db.prepare('SELECT scope,uid,event_id AS eventId,kind,episode_id AS episodeId,at,text,importance FROM events WHERE scope=? AND uid=? AND event_id=?').get(s.scope, s.uid, e)
      if (!row) return { found: false, deleted: this._tombstone(s, e) }
      const replies = this.db.prepare('SELECT text FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=? ORDER BY seq ASC').all(s.scope, s.uid, e).map(x => x.text)
      return { found: true, deleted: false, event: row, replies }
    })
  }
  review({ scope, uid, memoryId, reviewId, quality = 1, at } = {}) {
    const s = this._scope(scope, uid), m = id(memoryId, 'memoryId'), r = id(reviewId, 'reviewId'), q = finite(quality, 1, 'quality'), time = timestamp(at, 'at')
    if (q < 0 || q > 1) throw new InputError('quality must be 0..1')
    return withTransaction(this.db, () => {
      const event = this.db.prepare('SELECT at FROM events WHERE scope=? AND uid=? AND event_id=?').get(s.scope, s.uid, m)
      if (!event) throw new HippocampusSqliteError('memory does not exist in scope')
      const existing = this.db.prepare('SELECT at,quality FROM reviews WHERE scope=? AND uid=? AND memory_id=? AND review_id=?').get(s.scope, s.uid, m, r)
      if (existing) {
        if (Number(existing.at) !== time || Number(existing.quality) !== q) throw new ConflictError('reviewId already exists with different content')
        return { accepted: false, duplicate: true, reviewId: r }
      }
      // A review cannot happen before the memory it reviews.
      if (time < Number(event.at)) throw new InputError('review.at must be >= event.at')
      this.db.prepare('INSERT INTO reviews(scope,uid,memory_id,review_id,at,quality) VALUES(?,?,?,?,?,?)').run(s.scope, s.uid, m, r, time, q)
      return { accepted: true, duplicate: false, reviewId: r }
    })
  }
  _rows(s) { return this.db.prepare('SELECT scope,uid,event_id AS eventId,kind,episode_id AS episodeId,at,text,importance FROM events WHERE scope=? AND uid=? ORDER BY at ASC,event_id ASC').all(s.scope, s.uid) }
  recall({ scope, uid, query, limit = 10, now = this.now() } = {}) {
    const s = this._scope(scope, uid), q = text(query, 'query', MAX_QUERY), n = Number(limit), time = timestamp(now === undefined ? this.now() : now, 'now')
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new InputError('limit must be 1..100')
    return withReadTransaction(this.db, () => {
      const qt = tokenize(q), rows = this._rows(s).filter(row => row.at <= time), total = rows.length
      const scored = rows.map(row => {
        const tokens = tokenize(row.text), counts = new Map()
        for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
        const matchedTokens = [...new Set(qt.filter(token => counts.has(token)))]
        if (!matchedTokens.length) return null
        // Only reviews that happened after the event and no later than `time` count.
        // Legacy rows written before the event cannot pollute recall or due dates.
        const reviews = this.db.prepare('SELECT review_id AS reviewId,at,quality FROM reviews WHERE scope=? AND uid=? AND memory_id=? AND at>=? AND at<=? ORDER BY at DESC,review_id DESC').all(s.scope, s.uid, row.eventId, row.at, time)
        const successfulReviews = reviews.reduce((sum, x) => sum + (x.quality >= 0.7 ? 1 : 0), 0)
        const age = Math.max(0, time - row.at), retention = Math.pow(1 + age / DAY, -this.power)
        const effectiveForgetting = this.forgetting * Math.pow(0.8, successfulReviews)
        const reviewFactor = 1 + successfulReviews * 0.1
        const lexical = matchedTokens.reduce((sum, token) => sum + (counts.get(token) ?? 0), 0) / Math.max(1, qt.length)
        const score = lexical * retention * (0.5 + row.importance) * reviewFactor * (1 - effectiveForgetting * (1 - retention))
        return { ...row, score, trace: { lexical, matchedTokens, retention, ageMs: age, importanceFactor: 0.5 + row.importance, successfulReviews, effectiveForgetting, reviewFactor, score, reviewId: reviews[0]?.reviewId ?? null, totalCandidates: total } }
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.at - b.at || a.eventId.localeCompare(b.eventId))
      return scored.slice(0, n)
    })
  }
  trace({ scope, uid, operation = 'recall', query, limit = 10, now = this.now() } = {}) {
    const s = this._scope(scope, uid), q = text(query, 'query', operation === 'exact' ? MAX_TEXT : MAX_QUERY)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InputError('limit must be 1..100')
    const time = timestamp(now === undefined ? this.now() : now, 'now')
    if (operation === 'exact') {
      const rows = this.db.prepare('SELECT scope,uid,event_id AS eventId,kind,episode_id AS episodeId,at,text,importance FROM events WHERE scope=? AND uid=? AND text=? AND at<=? ORDER BY at ASC,event_id ASC LIMIT ?').all(s.scope, s.uid, q, time, limit)
      return { operation, scope: s.scope, uid: s.uid, query: q, asOf: time, resultCount: rows.length, results: rows }
    }
    if (operation !== 'recall') throw new InputError('unsupported trace operation')
    const results = this.recall({ scope: s.scope, uid: s.uid, query: q, limit, now: time })
    return { operation: 'recall', scope: s.scope, uid: s.uid, query: q, asOf: time, resultCount: results.length, results }
  }
  deleteEvent({ scope, uid, eventId } = {}) {
    const s = this._scope(scope, uid), e = id(eventId, 'eventId')
    return withTransaction(this.db, () => {
      // The tombstone keeps only what is needed to refuse replays; no original text.
      // Retention: indefinite for this prototype. IDs are never reused after deletion.
      const e = id(eventId, 'eventId')
      this.db.prepare('INSERT OR IGNORE INTO tombstones(scope,uid,event_id,deleted_at) VALUES(?,?,?,?)').run(s.scope, s.uid, e, timestamp(this.now(), 'now'))
      this.db.prepare('DELETE FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=?').run(s.scope, s.uid, e)
      this.db.prepare('DELETE FROM reviews WHERE scope=? AND uid=? AND memory_id=?').run(s.scope, s.uid, e)
      const result = this.db.prepare('DELETE FROM events WHERE scope=? AND uid=? AND event_id=?').run(s.scope, s.uid, e)
      return { accepted: true, deleted: Number(result.changes) > 0, eventId: e }
    })
  }
  _shadowKey(s, suffix = '') { return `shadow_consent:${s.scope}:${s.uid}${suffix}` }
  shadowConsent({ scope, uid } = {}) {
    const s = this._scope(scope, uid)
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(this._shadowKey(s))
    if (!row) return null
    try { return JSON.parse(row.value) } catch { return null }
  }
  consentShadow({ scope, uid, granted, revision, runNonce, commandId, expectedRevision } = {}) {
    const s = this._scope(scope, uid)
    if (typeof granted !== 'boolean') throw new InputError('granted must be boolean')
    if (!Number.isSafeInteger(revision) || revision < 0) throw new InputError('revision must be a non-negative safe integer')
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new InputError('expectedRevision must be a non-negative safe integer')
    const nonce = id(runNonce, 'runNonce')
    const cmd = id(commandId, 'commandId')
    return withTransaction(this.db, () => {
      const current = this.shadowConsent({ scope: s.scope, uid: s.uid })
      const cmdKey = this._shadowKey(s, `:cmd:${cmd}`)
      const cmdRow = this.db.prepare('SELECT value FROM meta WHERE key=?').get(cmdKey)
      if (cmdRow) {
        let prior = null
        try { prior = JSON.parse(cmdRow.value) } catch {}
        if (prior && prior.granted === granted && Number(prior.revision) === revision && String(prior.runNonce) === nonce) {
          return { accepted: false, duplicate: true, granted, revision, runNonce: nonce }
        }
        // Legacy command rows stored the literal '1'; accept only an exact current-state replay.
        if (!prior && current && current.granted === granted && Number(current.revision) === revision) {
          return { accepted: false, duplicate: true, granted, revision, runNonce: nonce }
        }
        throw new ConflictError('commandId already used with different request')
      }
      if (expectedRevision !== undefined) {
        const curRevision = current ? Number(current.revision) : 0
        if (expectedRevision !== curRevision) throw new ConflictError('consent revision changed')
      }
      if (current && revision <= Number(current.revision || 0)) throw new ConflictError('consent revision must be monotonic')
      const value = { granted, revision, runNonce: nonce, commandId: cmd, at: this.now() }
      this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(this._shadowKey(s), JSON.stringify(value))
      this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(cmdKey, JSON.stringify({ granted, revision, runNonce: nonce }))
      return { accepted: true, duplicate: false, granted, revision, runNonce: nonce }
    })
  }

  captureShadow({ scope, uid, eventId, text: body, at, confirmedReplies = null, replyIds = null, runNonce } = {}) {
    const s = this._scope(scope, uid), e = id(eventId, 'eventId'), t = text(body, 'text'), time = timestamp(at, 'at')
    const replies = replyList(confirmedReplies)
    if (!replies || replies.length < 1) throw new InputError('confirmedReplies required')
    if (!Array.isArray(replyIds) || replyIds.length !== replies.length) throw new InputError('replyIds must match confirmedReplies')
    const ids = replyIds.map((x, i) => id(x, `replyIds[${i}]`))
    const nonce = id(runNonce, 'runNonce')
    return withTransaction(this.db, () => {
      const consent = this.shadowConsent({ scope: s.scope, uid: s.uid })
      if (!consent || consent.granted !== true || String(consent.runNonce) !== nonce) return { accepted: false, unauthorized: true }
      if (this._tombstone(s, e)) return { accepted: false, deleted: true, eventId: e }
      for (const rid of ids) {
        if (this._tombstone(s, `qq:${rid}:in`)) throw new ConflictError('reply was retracted')
      }
      const exists = this.db.prepare('SELECT kind,episode_id AS episodeId,at,text,importance FROM events WHERE scope=? AND uid=? AND event_id=?').get(s.scope, s.uid, e)
      if (exists) {
        const existingReplies = this.db.prepare('SELECT text FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=? ORDER BY seq ASC').all(s.scope, s.uid, e).map(row => row.text)
        const existingIds = this.db.prepare("SELECT reply_id FROM refs WHERE scope=? AND uid=? AND event_id=? AND direction='out' ORDER BY part_seq ASC").all(s.scope, s.uid, e).map(row => row.reply_id)
        if (exists.kind !== 'long' || exists.episodeId !== null || Number(exists.at) !== time || exists.text !== t || Number(exists.importance) !== 0.5 || !sameReplies(existingReplies, replies) || !sameReplies(existingIds, ids)) throw new ConflictError('eventId already exists with different content')
        return { accepted: false, duplicate: true, eventId: e }
      }
      this.db.prepare('INSERT INTO events(scope,uid,event_id,kind,episode_id,at,text,importance) VALUES(?,?,?,?,?,?,?,?)').run(s.scope, s.uid, e, 'long', null, time, t, 0.5)
      const insertReply = this.db.prepare('INSERT INTO confirmed_replies(scope,uid,event_id,seq,text) VALUES(?,?,?,?,?)')
      const insertRef = this.db.prepare('INSERT INTO refs(scope,uid,event_id,direction,reply_id,part_seq,created_at) VALUES(?,?,?,?,?,?,?)')
      insertRef.run(s.scope, s.uid, e, 'in', e, 0, this.now())
      for (let i = 0; i < replies.length; i++) {
        insertReply.run(s.scope, s.uid, e, i, replies[i])
        insertRef.run(s.scope, s.uid, e, 'out', ids[i], i, this.now())
      }
      return { accepted: true, duplicate: false, eventId: e }
    })
  }
  retractShadow({ scope, uid, eventId, replyId = '', runNonce } = {}) {
    const s = this._scope(scope, uid)
    const nonce = id(runNonce, 'runNonce')
    const reply = replyId === undefined || replyId === null ? '' : String(replyId)
    return withTransaction(this.db, () => {
      const consent = this.shadowConsent({ scope: s.scope, uid: s.uid })
      if (!consent || String(consent.runNonce) !== nonce) return { accepted: false, unauthorized: true }
      if (reply) {
        const targetEvent = eventId === undefined || eventId === null || String(eventId) === '' ? '' : id(eventId, 'eventId')
        const refs = targetEvent
          ? this.db.prepare("SELECT event_id AS eventId, part_seq AS partSeq FROM refs WHERE scope=? AND uid=? AND direction='out' AND reply_id=? AND event_id=?").all(s.scope, s.uid, reply, targetEvent)
          : this.db.prepare("SELECT event_id AS eventId, part_seq AS partSeq FROM refs WHERE scope=? AND uid=? AND direction='out' AND reply_id=?").all(s.scope, s.uid, reply)
        if (!refs.length) {
          this.db.prepare('INSERT OR IGNORE INTO tombstones(scope,uid,event_id,deleted_at) VALUES(?,?,?,?)').run(s.scope, s.uid, `qq:${reply}:in`, timestamp(this.now(), 'now'))
          return { accepted: false, not_found: true, replyId: reply }
        }
        if (refs.length > 1 && !targetEvent) return { accepted: false, ambiguous: true, replyId: reply, eventIds: refs.map(r => String(r.eventId)) }
        const delReply = this.db.prepare('DELETE FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=? AND seq=?')
        const delRef = this.db.prepare("DELETE FROM refs WHERE scope=? AND uid=? AND event_id=? AND direction='out' AND part_seq=?")
        for (const r of refs) {
          delReply.run(s.scope, s.uid, String(r.eventId), Number(r.partSeq))
          delRef.run(s.scope, s.uid, String(r.eventId), Number(r.partSeq))
        }
        this.db.prepare('INSERT OR IGNORE INTO tombstones(scope,uid,event_id,deleted_at) VALUES(?,?,?,?)').run(s.scope, s.uid, `qq:${reply}:in`, timestamp(this.now(), 'now'))
        return { accepted: true, deleted: true, eventId: String(refs[0].eventId), replyId: reply }
      }
      const e = id(eventId, 'eventId')
      this.db.prepare('INSERT OR IGNORE INTO tombstones(scope,uid,event_id,deleted_at) VALUES(?,?,?,?)').run(s.scope, s.uid, e, timestamp(this.now(), 'now'))
      this.db.prepare('DELETE FROM refs WHERE scope=? AND uid=? AND event_id=?').run(s.scope, s.uid, e)
      this.db.prepare('DELETE FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=?').run(s.scope, s.uid, e)
      this.db.prepare('DELETE FROM reviews WHERE scope=? AND uid=? AND memory_id=?').run(s.scope, s.uid, e)
      const result = this.db.prepare('DELETE FROM events WHERE scope=? AND uid=? AND event_id=?').run(s.scope, s.uid, e)
      return { accepted: true, deleted: Number(result.changes) > 0, eventId: e }
    })
  }

  dueReviews({ scope, uid, now = this.now(), maxAgeMs = DAY } = {}) {
    const s = this._scope(scope, uid), time = timestamp(now === undefined ? this.now() : now, 'now'), age = finite(maxAgeMs, DAY, 'maxAgeMs')
    if (age < 0) throw new InputError('maxAgeMs must be >= 0')
    // Rule: any review after the event postpones the next review, including a failed one;
    // only quality >= 0.7 increases the successful-review counter used by recall.
    return this.db.prepare(`SELECT e.event_id AS memoryId, MAX(r.at) AS lastReviewAt, e.text FROM events e LEFT JOIN reviews r ON r.scope=e.scope AND r.uid=e.uid AND r.memory_id=e.event_id AND r.at>=e.at AND r.at<=? WHERE e.scope=? AND e.uid=? AND e.at<=? GROUP BY e.event_id, e.text HAVING (? - COALESCE(MAX(r.at), e.at)) >= ? ORDER BY COALESCE(MAX(r.at), e.at) ASC`).all(time, s.scope, s.uid, time, time, age)
  }
}

export function openHippocampusSqlite(options) { return new HippocampusSqlite(options) }
