import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryCore } from '../portable-memory-core/core.mjs'

const dirs = []
function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'consolidated-v1-'))
  dirs.push(dir)
  const c = createMemoryCore({ dbPath: join(dir, 'memory.sqlite'), tenant: '10001', scope: 'private:10001', scopeKind: 'direct' })
  assert.equal(c.enrollIfUnseen(), 1)
  c.beginSession()
  return { c, generation: c.authorization().generation, dir }
}
function make(dir) {
  return createMemoryCore({ dbPath: join(dir, 'memory.sqlite'), tenant: '10001', scope: 'private:10001', scopeKind: 'direct' })
}
function add(c, generation, id, text, created = 1000) {
  return c.capture({ generation, eventId: id, text, created, replies: [{ id: `r-${id}`, status: 'confirmed', text: '嗯' }] })
}
function close(c) { try { c.endSession() } catch {}; try { c.close() } catch {} }
test.after(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }) } catch {} })

const unit = { eventId: 'e1', field: 'text', quote: '楼下看到一只猫' }
const register = (c, generation, extra = {}) => c.registerConsolidated({
  generation,
  kind: 'episode_summary',
  content: '那段时间留下了这些片段：「楼下看到一只猫」',
  units: [unit],
  ...extra,
})

test('registers and loads an excerpt-backed summary across reopen', () => {
  const { c, generation, dir } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫，它趴在电动车上。', 1000)
  assert.equal(register(c, generation), true)
  const first = c.loadConsolidated({ generation })
  assert.equal(first.length, 1)
  assert.equal(first[0].kind, 'episode_summary')
  close(c)
  const c2 = make(dir)
  c2.beginSession()
  const second = c2.loadConsolidated({ generation })
  assert.equal(second.length, 1)
  close(c2)
})

test('quote must be present in the source span', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫。', 1000)
  assert.equal(register(c, generation, { units: [{ ...unit, quote: '看到一只狗' }] }), false)
  assert.equal(c.loadConsolidated({ generation }).length, 0)
  close(c)
})

test('revoking a source deletes the summary', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫。', 1000)
  assert.equal(register(c, generation), true)
  c.revokeEvent('e1')
  assert.equal(c.loadConsolidated({ generation }).length, 0)
  close(c)
})

test('preference source is refused', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '我喜欢喝咖啡', 1000)
  assert.equal(register(c, generation), false)
  close(c)
})

test('same node id cannot be rebound to different content', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫。', 1000)
  assert.equal(register(c, generation, { id: 'n1' }), true)
  assert.equal(register(c, generation, { id: 'n1', content: '完全不同的摘要' }), false)
  close(c)
})


test('rule-based recent consolidation creates an excerpt summary', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫。', 1000)
  add(c, generation, 'e2', '它趴在电动车上。', 1001)
  const made = c.consolidateRecent({ generation, limit: 2 })
  assert.equal(made.length, 1)
  const rows = c.loadConsolidated({ generation })
  assert.equal(rows.length, 1)
  assert.match(made[0], /楼下看到一只猫/)
  close(c)
})


test('arbitrary prose and protected boundary sources are refused', () => {
  const { c, generation } = boot()
  add(c, generation, 'e1', '今天在楼下看到一只猫。', 1000)
  assert.equal(register(c, generation, { content: '他已承诺明天搬家' }), false)
  add(c, generation, 'e2', '以后不要再记我的地址，也别再提', 1001)
  c.consolidateRecent({ generation, limit: 5 })
  assert.equal(c.loadConsolidated({ generation }).some(x => /地址|不要再记/.test(x.content)), false)
  close(c)
})


test('direct register rejects a boundary source', () => {
  const { c, generation } = boot()
  add(c, generation, 'b1', '以后不要再记我的地址', 1000)
  assert.equal(c.registerConsolidated({ generation, kind: 'episode_summary', content: '那段时间留下了这些片段：「以后不要再记我的地址」', units: [{ eventId: 'b1', field: 'text', quote: '以后不要再记我的地址' }] }), false)
  close(c)
})
