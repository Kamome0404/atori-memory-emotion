import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryAdapter } from '../portable-memory-core/adapter.mjs'

test('adapter exposes the read-only preference lookup after a confirmed turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-pref-'))
  const dbPath = join(dir, 'memory.sqlite')
  const adapter = createMemoryAdapter({ dbPath, users: ['10001'], enabled: true })
  try {
    assert.equal(adapter.consent({ uid: '10001', action: 'grant', authenticated: true, disclosed: true }), 1)
    const turn = adapter.begin({
      uid: '10001', scopeKind: 'direct', eventId: 'e1', created: 1000,
      text: '我喜欢喝咖啡', query: '咖啡', authenticated: true,
    })
    assert.ok(turn)
    turn.attempt('嗯')
    turn.confirm('嗯', { status: 'ok', retcode: 0, id: 1 })
    assert.equal(turn.finish(true), true)
    assert.deepEqual(adapter.readPreference({ uid: '10001', activity: '喝', object: '咖啡' }), {
      eventId: 'e1', version: 1, created: 1000, polarity: 'positive', activity: '喝', object: '咖啡',
    })
    assert.equal(adapter.readPreference({ uid: '10001', activity: '喝', object: '冰咖啡' }), null)
    assert.equal(adapter.readPreference({ uid: '99999', activity: '喝', object: '咖啡' }), null)
    const query = adapter.begin({
      uid: '10001', scopeKind: 'direct', eventId: 'e2', created: 2000,
      text: '我想喝咖啡还是茶', query: '我想喝咖啡还是茶', authenticated: true,
    })
    const reference = query.reference
    assert.equal(reference.preference, true)
    assert.equal(reference.mentions.length, 2)
    assert.match(reference.text, /喜欢喝咖啡/)
    assert.doesNotMatch(reference.text, /已确认私聊事件/)
    query.finish(false)
    const secondHasClaim = adapter.begin({
      uid: '10001', scopeKind: 'direct', eventId: 'e2b', created: 2500,
      text: '我想喝茶还是咖啡', query: '我想喝茶还是咖啡', authenticated: true,
    })
    const secondRef = secondHasClaim.reference
    assert.equal(secondRef.preference, true)
    assert.equal(secondRef.mentions.length, 2)
    assert.match(secondRef.text, /咖啡/)
    secondHasClaim.finish(false)
    const correction = adapter.begin({
      uid: '10001', scopeKind: 'direct', eventId: 'e3', created: 3000,
      text: '我不喜欢喝咖啡', query: '我不喜欢喝咖啡', authenticated: true,
    })
    correction.attempt('好')
    correction.confirm('好', { status: 'ok', retcode: 0, id: 2 })
    assert.equal(correction.finish(true), true)
    const corrected = adapter.begin({
      uid: '10001', scopeKind: 'direct', eventId: 'e4', created: 4000,
      text: '我想喝咖啡还是茶', query: '我想喝咖啡还是茶', authenticated: true,
    })
    const correctedRef = corrected.reference
    assert.equal(correctedRef.preference, true)
    assert.match(correctedRef.text, /不喜欢/)
    assert.doesNotMatch(correctedRef.text, /明确说过喜欢/)
    corrected.finish(false)
  } finally {
    try { adapter.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
