import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryAdapter } from '../portable-memory-core/adapter.mjs'
import { referenceStillCurrent } from '../preference/memory-reference.mjs'

test('numeric and string uid both revalidate episode provenance', () => {
  const dir = mkdtempSync(join(tmpdir(), 'numeric-uid-'))
  const adapter = createMemoryAdapter({ dbPath: join(dir, 'memory.sqlite'), users: ['10001'], enabled: true })
  try {
    assert.equal(adapter.consent({ uid: '10001', action: 'grant', authenticated: true, disclosed: true }), 1)
    const save = (uid, id, text) => {
      const t = adapter.begin({ uid, scopeKind: 'direct', eventId: id, created: 1000 + Number(id.slice(1)), text, query: text, authenticated: true })
      assert.ok(t)
      t.attempt('嗯')
      t.confirm('嗯', { status: 'ok', retcode: 0, id: Number(id.slice(1)) + 100 })
      assert.equal(t.finish(true), true)
    }
    save('10001', 'e1', '今天在楼下看到一只猫')
    const turn = adapter.begin({ uid: '10001', scopeKind: 'direct', eventId: 'e2', created: 2000, text: '它趴在电动车上', query: '它趴在电动车上', authenticated: true })
    const ref = turn.reference
    assert.ok(ref?.provenance?.kind === 'episode')
    for (const uid of [10001, '10001']) {
      const cur = adapter.revalidateEpisode({ uid, provenance: ref.provenance })
      assert.ok(cur)
      assert.equal(referenceStillCurrent({
        used: true, turn: { take: () => ref }, reference: ref.text,
        episodeProvenance: ref.provenance, currentEpisodeProvenance: cur,
      }), true)
    }
    adapter.notice({ uid: 10001, kind: 'event', messageId: 'e1', authenticated: true })
    assert.equal(adapter.revalidateEpisode({ uid: 10001, provenance: ref.provenance }), null)
  } finally {
    try { adapter.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
