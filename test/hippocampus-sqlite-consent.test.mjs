import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openHippocampusSqlite, ConflictError } from '../hippocampus/hippocampus-sqlite.mjs'

function setup() {
  const d = mkdtempSync(join(tmpdir(), 'hipfix-'))
  const db = openHippocampusSqlite({ filePath: join(d, 'x.db'), now: () => 2000 })
  return { d, db, scope: 'private:1', uid: '1' }
}

test('same commandId same request is duplicate; different request conflicts', () => {
  const { d, db, scope, uid } = setup()
  const base = { scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'cmd1' }
  const a = db.consentShadow(base)
  assert.equal(a.accepted, true)
  const b = db.consentShadow(base)
  assert.equal(b.accepted, false)
  assert.equal(b.duplicate, true)
  assert.throws(() => db.consentShadow({ ...base, granted: false, revision: 2 }), ConflictError)
  assert.equal(db.shadowConsent({ scope, uid }).granted, true)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('expectedRevision CAS rejects stale revision', () => {
  const { d, db, scope, uid } = setup()
  db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'cmd1' })
  assert.throws(() => db.consentShadow({ scope, uid, granted: true, revision: 2, runNonce: 'n2', commandId: 'cmd2', expectedRevision: 0 }), ConflictError)
  const ok = db.consentShadow({ scope, uid, granted: true, revision: 2, runNonce: 'n2', commandId: 'cmd2', expectedRevision: 1 })
  assert.equal(ok.accepted, true)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('capture replay validates reply id order', () => {
  const { d, db, scope, uid } = setup()
  const c = db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'cmd1' })
  const cap = { scope, uid, eventId: 'e1', text: 'hi', at: 1000, confirmedReplies: ['a', 'b'], replyIds: ['r1', 'r2'], runNonce: c.runNonce }
  assert.equal(db.captureShadow(cap).accepted, true)
  assert.throws(() => db.captureShadow({ ...cap, replyIds: ['r2', 'r1'] }), ConflictError)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('reply retract removes only that reply/ref', () => {
  const { d, db, scope, uid } = setup()
  const c = db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'cmd1' })
  db.captureShadow({ scope, uid, eventId: 'e1', text: 'hi', at: 1000, confirmedReplies: ['a', 'b'], replyIds: ['r1', 'r2'], runNonce: c.runNonce })
  const r = db.retractShadow({ scope, uid, replyId: 'r2', runNonce: c.runNonce })
  assert.equal(r.accepted, true)
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM refs WHERE scope=? AND uid=? AND event_id=? AND direction='out'").get(scope, uid, 'e1').n, 1)
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM confirmed_replies WHERE scope=? AND uid=? AND event_id=?').get(scope, uid, 'e1').n, 1)
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM events WHERE scope=? AND uid=? AND event_id=?').get(scope, uid, 'e1').n, 1)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('reply retract without eventId reports not_found (fallback path)', () => {
  const { d, db, scope, uid } = setup()
  const c = db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'c1' })
  const r = db.retractShadow({ scope, uid, replyId: 'missing', runNonce: c.runNonce })
  assert.equal(r.accepted, false)
  assert.equal(r.not_found, true)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('retract before capture blocks the later reply', () => {
  const { d, db, scope, uid } = setup()
  const c = db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'c1' })
  const r = db.retractShadow({ scope, uid, replyId: 'r1', runNonce: c.runNonce })
  assert.equal(r.not_found, true)
  assert.throws(() => db.captureShadow({ scope, uid, eventId: 'e1', text: 'hi', at: 1000, confirmedReplies: ['a'], replyIds: ['r1'], runNonce: c.runNonce }), ConflictError)
  db.close(); rmSync(d, { recursive: true, force: true })
})

test('ambiguous reply id is not bulk-deleted; eventId targets one', () => {
  const { d, db, scope, uid } = setup()
  const c = db.consentShadow({ scope, uid, granted: true, revision: 1, runNonce: 'n1', commandId: 'c1' })
  db.captureShadow({ scope, uid, eventId: 'e1', text: 'a', at: 1000, confirmedReplies: ['a'], replyIds: ['same'], runNonce: c.runNonce })
  db.captureShadow({ scope, uid, eventId: 'e2', text: 'b', at: 2000, confirmedReplies: ['b'], replyIds: ['same'], runNonce: c.runNonce })
  const amb = db.retractShadow({ scope, uid, replyId: 'same', runNonce: c.runNonce })
  assert.equal(amb.accepted, false)
  assert.equal(amb.ambiguous, true)
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM refs WHERE scope=? AND uid=? AND direction='out'").get(scope, uid).n, 2)
  const one = db.retractShadow({ scope, uid, eventId: 'e1', replyId: 'same', runNonce: c.runNonce })
  assert.equal(one.accepted, true)
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM refs WHERE scope=? AND uid=? AND event_id='e1' AND direction='out'").get(scope, uid).n, 0)
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM refs WHERE scope=? AND uid=? AND event_id='e2' AND direction='out'").get(scope, uid).n, 1)
  db.close(); rmSync(d, { recursive: true, force: true })
})
