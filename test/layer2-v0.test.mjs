import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryCore } from '../portable-memory-core/core.mjs'

const dirs = []
function make(tenant = '10001', dir = '') {
  if (!dir) {
    dir = mkdtempSync(join(tmpdir(), 'layer2-v0-'))
    dirs.push(dir)
  }
  const core = createMemoryCore({
    dbPath: join(dir, 'memory.sqlite'),
    tenant,
    scope: `private:${tenant}`,
    scopeKind: 'direct',
  })
  return core
}
function boot(tenant = '10001') {
  const dir = mkdtempSync(join(tmpdir(), 'layer2-v0-'))
  dirs.push(dir)
  const c = make(tenant, dir)
  assert.equal(c.enrollIfUnseen(), 1)
  c.beginSession()
  return { c, generation: c.authorization().generation, dir }
}
function add(c, generation, eventId, text, created = 1000) {
  return c.capture({
    generation,
    eventId,
    text,
    created,
    replies: [{ id: `r-${eventId}`, status: 'confirmed', text: '嗯' }],
  })
}
function close(c) {
  try { c.endSession() } catch {}
  try { c.close() } catch {}
}
test.after(() => { for (const d of dirs) try { rmSync(d, { recursive: true, force: true }) } catch {} })

test('1 本人明确偏好可跨会话读取', () => {
  const { c, generation, dir } = boot()
  add(c, generation, 'e1', '我喜欢喝咖啡', 1000)
  const first = c.readPreference({ generation, activity: '喝', object: '咖啡' })
  assert.equal(first.eventId, 'e1')
  assert.equal(first.polarity, 'positive')
  assert.ok([1, 2].includes(first.version))
  close(c)
  const c2 = make('10001', dir)
  assert.equal(c2.readPreference({ generation, activity: '喝', object: '咖啡' }).polarity, 'positive')
  close(c2)
})

test('2 引用别人的偏好不会存成本人偏好', () => {
  const { c, generation } = boot()
  add(c, generation, 'e2', '我朋友喜欢喝咖啡', 1000)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  close(c)
})

test('3 纠正后最新为 negative，旧 positive 不复活', () => {
  const { c, generation } = boot()
  add(c, generation, 'e3a', '我喜欢喝咖啡', 1000)
  add(c, generation, 'e3b', '我不喜欢喝咖啡', 2000)
  const got = c.readPreference({ generation, activity: '喝', object: '咖啡' })
  assert.equal(got.polarity, 'negative')
  assert.equal(got.eventId, 'e3b')
  close(c)
})

test('4 重开后仍取最新 negative', () => {
  const { c, generation, dir } = boot()
  add(c, generation, 'e4a', '我喜欢喝咖啡', 1000)
  add(c, generation, 'e4b', '我不喜欢喝咖啡', 2000)
  close(c)
  const c2 = make('10001', dir)
  const got = c2.readPreference({ generation, activity: '喝', object: '咖啡' })
  assert.equal(got.polarity, 'negative')
  close(c2)
})

test('5 模糊句 / 引用句不写入，查询返回 null', () => {
  const { c, generation } = boot()
  add(c, generation, 'e5a', '咖啡还行', 1000)
  add(c, generation, 'e5b', '他说他喜欢喝咖啡', 1001)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  close(c)
})

test('6 无关对象不返回，精确对象不串位', () => {
  const { c, generation } = boot()
  add(c, generation, 'e6', '我喜欢喝冰咖啡', 1000)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '冰咖啡' }).polarity, 'positive')
  close(c)
})

test('7 同时间相反极性为歧义，不静默选一个', () => {
  const { c, generation } = boot()
  add(c, generation, 'e7a', '我喜欢喝咖啡', 1000)
  add(c, generation, 'e7b', '我不喜欢喝咖啡', 1000)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  close(c)
})

test('9 同时间第三条相反极性也不能漏掉', () => {
  const { c, generation } = boot()
  add(c, generation, 'e9a', '我喜欢喝咖啡', 1000)
  add(c, generation, 'e9b', '我不喜欢喝咖啡', 1000)
  add(c, generation, 'e9c', '我喜欢喝咖啡', 1000)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  close(c)
})

test('8 未授权/过期 generation 拒绝读取', () => {
  const { c, generation } = boot()
  assert.throws(() => c.readPreference({ generation: generation + 1, activity: '喝', object: '咖啡' }), /authorization/)
  close(c)
})


test('10 A2: revoking the latest negative does not revive the old positive', () => {
  const { c, generation } = boot()
  add(c, generation, 'a2p', '我喜欢喝咖啡', 1000)
  add(c, generation, 'a2n', '我不喜欢喝咖啡', 2000)
  c.revokeEvent('a2n')
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  add(c, generation, 'a2p2', '我喜欢喝咖啡', 3000)
  assert.equal(c.readPreference({ generation, activity: '喝', object: '咖啡' }).polarity, 'positive')
  close(c)
})


test('11 A4: a new transport session requires a fresh declaration', () => {
  const { c, generation, dir } = boot()
  add(c, generation, 'a4p', '我喜欢喝咖啡', 1000)
  close(c)
  const c2 = make('10001', dir)
  c2.beginSession()
  assert.equal(c2.readPreference({ generation, activity: '喝', object: '咖啡' }), null)
  const past = c2.readPreferenceHistory({ generation, activity: '喝', object: '咖啡' })
  assert.equal(past.polarity, 'positive')
  assert.equal(past.historical, true)
  c2.revokeEvent('a4p')
  assert.equal(c2.readPreferenceHistory({ generation, activity: '喝', object: '咖啡' }), null)
  const g2 = c2.authorization().generation
  add(c2, g2, 'a4p2', '我喜欢喝咖啡', 2000)
  assert.equal(c2.readPreference({ generation: g2, activity: '喝', object: '咖啡' }).polarity, 'positive')
  close(c2)
})

test('12 A4: resumeAfterGap clears old preference claims but keeps events', () => {
  const { c, generation } = boot()
  add(c, generation, 'a4gap', '我喜欢喝咖啡', 1000)
  c.markGap()
  const before = c.authorization()
  const resumed = c.resumeAfterGap({ reason: 'test gap', evidence: 'offline window' })
  assert.ok(resumed.generation > before.generation)
  assert.equal(c.readPreference({ generation: resumed.generation, activity: '喝', object: '咖啡' }), null)
  assert.ok(resumed.events >= 1)
  close(c)
})


test('13 history is cleared by reply revoke', () => {
  const { c, generation } = boot()
  add(c, generation, 'hrep', '我喜欢喝咖啡', 1000)
  c.revokeReply('r-hrep')
  assert.equal(c.readPreferenceHistory({ generation, activity: '喝', object: '咖啡' }), null)
  close(c)
})

test('14 withdraw and regrant cannot resurrect history', () => {
  const { c, generation } = boot()
  add(c, generation, 'hwd', '我喜欢喝咖啡', 1000)
  c.setAuthorization(false)
  const next = c.setAuthorization(true)
  assert.equal(c.readPreferenceHistory({ generation: next, activity: '喝', object: '咖啡' }), null)
  close(c)
})
