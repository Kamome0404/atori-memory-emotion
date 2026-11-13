import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryAdapter } from '../portable-memory-core/adapter.mjs'

test('adapter consolidates recent events by uid and generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-consolidated-'))
  const adapter = createMemoryAdapter({ dbPath: join(dir, 'memory.sqlite'), users: ['10001'], enabled: true })
  try {
    assert.equal(adapter.consent({ uid: '10001', action: 'grant', authenticated: true, disclosed: true }), 1)
    const turn = (id, text) => {
      const t = adapter.begin({ uid: '10001', scopeKind: 'direct', eventId: id, created: 1000 + Number(id.slice(1)), text, query: text, authenticated: true })
      t.attempt('嗯')
      t.confirm('嗯', { status: 'ok', retcode: 0, id: Number(id.slice(1)) + 100 })
      assert.equal(t.finish(true), true)
    }
    turn('e1', '今天在楼下看到一只猫')
    turn('e2', '它趴在电动车上')
    const status = adapter.status(10001)
    assert.ok(status.allowed)
    assert.ok(Number.isSafeInteger(status.generation))
    const made = adapter.consolidateRecent({ uid: 10001, generation: status.generation, limit: 2 })
    assert.equal(made.length, 1)
    const rows = adapter.loadConsolidated({ uid: 10001, generation: status.generation, limit: 4 })
    assert.equal(rows.length, 1)
  } finally {
    try { adapter.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
