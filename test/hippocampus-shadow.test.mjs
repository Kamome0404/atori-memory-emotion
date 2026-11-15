import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHippocampusShadow } from '../hippocampus/hippocampus-shadow.mjs'
import { openHippocampusSqlite } from '../hippocampus/hippocampus-sqlite.mjs'

test('shadow disabled creates no worker or db', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hipshadow-'))
  const f = join(d, 'off.db')
  const s = createHippocampusShadow({ enabled: false, filePath: f, ownerUid: '1' })
  assert.equal((await s.consent({ granted: true })).accepted, false)
  assert.equal(existsSync(f), false)
  await s.close()
  rmSync(d, { recursive: true, force: true })
})

test('shadow consent/capture/refs/retract through worker', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hipshadow-'))
  const f = join(d, 'shadow.db')
  const s = createHippocampusShadow({ enabled: true, filePath: f, ownerUid: '1' })
  const c = await s.consent({ granted: true, revision: 1, commandId: 'c1' })
  assert.equal(c.accepted, true, JSON.stringify(c))
  const cap = await s.capture({ messageId: 'm1', eventAt: 1, incoming: '你好', deliveredParts: ['在呢'], replyIds: ['r1'] })
  assert.equal(cap.accepted, true, JSON.stringify(cap))
  await s.close()
  const db = openHippocampusSqlite({ filePath: f })
  try {
    const refs = db.db.prepare('SELECT direction,reply_id,part_seq FROM refs ORDER BY direction,part_seq').all()
    assert.equal(refs.length, 2)
    assert.equal(refs.find(x => x.direction === 'in').reply_id, 'qq:m1:in')
    assert.equal(refs.find(x => x.direction === 'out').reply_id, 'r1')
  } finally { db.close() }
  rmSync(d, { recursive: true, force: true })
})
