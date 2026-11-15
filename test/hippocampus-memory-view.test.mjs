import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openHippocampusSqlite } from '../hippocampus/hippocampus-sqlite.mjs'
import { readHippocampusMemory } from '../hippocampus/hippocampus-memory-view.mjs'

test('memory view reads events/replies/refs without writing', () => {
  const d = mkdtempSync(join(tmpdir(), 'hipview-'))
  const f = join(d, 'x.db')
  const db = openHippocampusSqlite({ filePath: f })
  const c = db.consentShadow({ scope: 'private:1', uid: '1', granted: true, revision: 1, runNonce: 'n1', commandId: 'c1' })
  db.captureShadow({ scope: 'private:1', uid: '1', eventId: 'e1', text: '今天很累', at: 1000, confirmedReplies: ['在呢'], replyIds: ['r1'], runNonce: c.runNonce })
  db.close()
  const v = readHippocampusMemory({ dbPath: f, ownerUid: '1' })
  assert.equal(v.ok, true)
  assert.equal(v.items.length, 1)
  assert.equal(v.items[0].text, '今天很累')
  assert.deepEqual(v.items[0].replies, ['在呢'])
  assert.equal(v.items[0].refs.find(x => x.direction === 'out').replyId, 'r1')
  const s = readHippocampusMemory({ dbPath: f, ownerUid: '1', query: '累' })
  assert.equal(s.items.length, 1)
  rmSync(d, { recursive: true, force: true })
})
