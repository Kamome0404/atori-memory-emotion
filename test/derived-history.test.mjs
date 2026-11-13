import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryCore } from '../portable-memory-core/core.mjs'

const dirs = []
function make(dir = '') {
  if (!dir) { dir = mkdtempSync(join(tmpdir(), 'derived-v1-')); dirs.push(dir) }
  return createMemoryCore({ dbPath: join(dir, 'memory.sqlite'), tenant: '10001', scope: 'private:10001', scopeKind: 'direct' })
}
function boot() { const dir = mkdtempSync(join(tmpdir(), 'derived-v1-')); dirs.push(dir); const c = make(dir); assert.equal(c.enrollIfUnseen(), 1); c.beginSession(); return { c, generation: c.authorization().generation, dir } }
function add(c, generation, id, text, created = 1000) {
  return c.capture({ generation, eventId: id, text, created, replies: [{ id: `r-${id}`, status: 'confirmed', text: '嗯' }] })
}
function close(c) { try { c.endSession() } catch {}; try { c.close() } catch {} }
test.after(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }) } catch {} })

test('registers and loads a derived history across reopen', () => {
  const { c, generation, dir } = boot()
  add(c, generation, 'src', '今天在楼下看到一只猫', 1000)
  add(c, generation, 'own', '它趴在电动车上', 2000)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own', sourceEventIds: ['src'] }), true)
  const first = c.loadDerived({ generation })
  assert.equal(first.length, 1)
  assert.equal(first[0].ownEvent.text, '它趴在电动车上')
  close(c)
  const c2 = make(dir)
  c2.beginSession()
  const second = c2.loadDerived({ generation })
  assert.equal(second.length, 1)
  close(c2)
})

test('revoking a source deletes the derived record, even if another event has the same text', () => {
  const { c, generation } = boot()
  add(c, generation, 'srcA', '同一句话', 1000)
  add(c, generation, 'srcB', '同一句话', 1001)
  add(c, generation, 'own', '回复', 2000)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own', sourceEventIds: ['srcA'] }), true)
  c.revokeEvent('srcA')
  assert.equal(c.loadDerived({ generation }).length, 0)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own', sourceEventIds: ['srcB'] }), true)
  assert.equal(c.loadDerived({ generation }).length, 1)
  close(c)
})

test('preference-tainted own/source is refused', () => {
  const { c, generation } = boot()
  add(c, generation, 'pref', '我喜欢喝咖啡', 1000)
  add(c, generation, 'own2', '普通回复', 2000)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own2', sourceEventIds: ['pref'] }), false)
  assert.equal(c.loadDerived({ generation }).length, 0)
  close(c)
})

test('withdraw clears derived history', () => {
  const { c, generation } = boot()
  add(c, generation, 'src', '普通来源', 1000)
  add(c, generation, 'own', '普通回答', 2000)
  c.registerDerived({ generation, ownEventId: 'own', sourceEventIds: ['src'] })
  c.setAuthorization(false)
  const next = c.setAuthorization(true)
  assert.equal(c.loadDerived({ generation: next }).length, 0)
  close(c)
})


test('preference taint in a reply is refused', () => {
  const { c, generation } = boot()
  c.capture({ generation, eventId: 'ownreply', text: '普通问题', created: 1000, replies: [{ id: 'rr', status: 'confirmed', text: '我喜欢喝咖啡' }] })
  c.capture({ generation, eventId: 'srcok', text: '普通来源', created: 900, replies: [{ id: 'rs', status: 'confirmed', text: '嗯' }] })
  assert.equal(c.registerDerived({ generation, ownEventId: 'ownreply', sourceEventIds: ['srcok'] }), false)
  close(c)
})


test('rebinding the same derived id to a different snapshot is refused', () => {
  const { c, generation } = boot()
  add(c, generation, 'sa', '来源A', 1000)
  add(c, generation, 'sb', '来源B', 1001)
  add(c, generation, 'own3', '回答', 2000)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own3', sourceEventIds: ['sa'] }), true)
  assert.equal(c.registerDerived({ generation, ownEventId: 'own3', sourceEventIds: ['sb'] }), false)
  assert.equal(c.loadDerived({ generation }).length, 1)
  close(c)
})
