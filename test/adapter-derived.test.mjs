import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryAdapter } from '../portable-memory-core/adapter.mjs'

test('adapter registers and loads derived history by uid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adapter-derived-'))
  const adapter = createMemoryAdapter({ dbPath: join(dir, 'memory.sqlite'), users: ['10001'], enabled: true })
  try {
    assert.equal(adapter.consent({ uid: '10001', action: 'grant', authenticated: true, disclosed: true }), 1)
    const save = (id, text) => {
      const t = adapter.begin({ uid: '10001', scopeKind: 'direct', eventId: id, created: 1000 + Number(id.slice(1)), text, query: text, authenticated: true })
      assert.ok(t)
      t.attempt('嗯')
      t.confirm('嗯', { status: 'ok', retcode: 0, id: Number(id.slice(1)) + 100 })
      assert.equal(t.finish(true), true)
    }
    save('e1', '今天下雨了')
    save('e2', '记得带伞')
    const generation = adapter.status('10001').allowed ? 1 : 1
    assert.equal(adapter.registerDerived({ uid: '10001', generation, ownEventId: 'e2', sourceEventIds: ['e1'] }), true)
    const rows = adapter.loadDerived({ uid: '10001', generation, limit: 8 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].ownEvent.text, '记得带伞')
    assert.equal(adapter.loadDerived({ uid: '99999', generation, limit: 8 }).length, 0)
  } finally {
    try { adapter.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
