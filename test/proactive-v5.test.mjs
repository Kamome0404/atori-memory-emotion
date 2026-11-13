import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProactiveV5 } from '../runtime/proactive-v5.mjs'

const dirs = []
function make() {
  const dir = mkdtempSync(join(tmpdir(), 'proactive-v5-'))
  dirs.push(dir)
  let t = Date.UTC(2026, 10, 13, 4, 0, 0) // 12:00 Asia/Shanghai
  const clock = () => t
  const store = createProactiveV5({ dbPath: join(dir, 'proactive.sqlite'), clock, quietStart: 22, quietEnd: 9 })
  return { store, dir, clock, set: (v) => { t = v }, get: () => t }
}
test.after(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }) } catch {} })

test('default off: schedule and due are refused without consent', () => {
  const { store } = make()
  assert.equal(store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: Date.UTC(2026, 10, 13, 4, 1) }).ok, false)
  assert.equal(store.due(undefined, 480), null)
  store.close()
})

test('grant schedules one agenda and one send max', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  const first = store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  assert.equal(first.ok, true)
  set(clock() + 2000)
  const due = store.due(undefined, 480)
  assert.equal(due.uid, '10001')
  assert.equal(due.text, '提醒你喝水')
  assert.equal(store.finish(due.token, 'confirmed', 'm1'), true)
  const second = store.schedule({ uid: '10001', text: '提醒你吃饭', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  assert.equal(second.ok, true)
  set(clock() + 25 * 3600_000)
  assert.equal(store.due(undefined, 480), null)
  store.close()
})

test('unknown consumes quota and is never retried automatically', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  set(clock() + 2000)
  const due = store.due(undefined, 480)
  assert.ok(due)
  assert.equal(store.finish(due.token, 'unknown'), true)
  assert.equal(store.finish(due.token, 'unknown'), false)
  set(clock() + 30 * 3600_000)
  assert.equal(store.due(undefined, 480), null)
  store.close()
})

test('quiet hours and revoke cancel scheduled agendas', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  store.revoke('10001')
  set(clock() + 2000)
  assert.equal(store.due(undefined, 480), null)
  store.grant('10001')
  store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 40_000_000, expiresAt: clock() + 50_000_000 })
  set(Date.UTC(2026, 10, 13, 14, 30, 0)) // 22:30 Asia/Shanghai
  assert.equal(store.due(undefined, 480), null)
  store.close()
})


test('revoking the source message cancels its agenda', () => {
  const { store, clock } = make()
  store.grant('10001', 'src-grant')
  store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 1000, expiresAt: clock() + 60_000, sourceEventId: 'src-rem' })
  assert.equal(store.revokeSource('10001', 'src-rem'), true)
  assert.equal(store.due(clock() + 2000, 480), null)
  store.close()
})

test('consent revoke after due invalidates the claimed job', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  store.schedule({ uid: '10001', text: '提醒你喝水', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  set(clock() + 2000)
  const job = store.due(undefined, 480)
  assert.ok(job)
  store.revoke('10001')
  assert.equal(store.finish(job.token, 'confirmed'), false)
  store.close()
})


test('explicit reminder is not blocked by afterIncoming quiet', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  store.markIncoming('10001')
  store.schedule({ uid: '10001', text: '提醒你喝水', kind: 'agreed_once', notBefore: clock() + 60_000, expiresAt: clock() + 120_000 })
  set(clock() + 61_000)
  const job = store.due(undefined, 480)
  assert.ok(job)
  assert.equal(job.text, '提醒你喝水')
  store.close()
})


test('explicit reminder still fires after a previous confirmed proactive message', () => {
  const { store, clock, set } = make()
  store.grant('10001')
  store.schedule({ uid: '10001', text: '旧提醒', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  set(clock() + 2000)
  const old = store.due(undefined, 480)
  assert.ok(old)
  assert.equal(store.finish(old.token, 'confirmed', 'old'), true)
  store.schedule({ uid: '10001', text: '新提醒', kind: 'agreed_once', notBefore: clock() + 1000, expiresAt: clock() + 60_000 })
  set(clock() + 2000)
  const fresh = store.due(undefined, 480)
  assert.ok(fresh)
  assert.equal(fresh.text, '新提醒')
  store.close()
})
