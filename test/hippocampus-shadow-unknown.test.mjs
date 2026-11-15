import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHippocampusShadow } from '../hippocampus/hippocampus-shadow.mjs'

test('unknown blocks automatic second worker until consent', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hipunknown-'))
  let queues = 0, captures = 0
  const queueFactory = async () => {
    queues++
    return {
      waitReady: async () => true,
      consentShadow: () => ({ accepted: true, result: Promise.resolve({ status: 'committed' }) }),
      captureShadow: () => ({ accepted: true, result: Promise.resolve({ status: captures++ === 0 ? 'unknown' : 'committed' }) }),
      close: async () => {},
    }
  }
  const s = createHippocampusShadow({ enabled: true, filePath: join(d, 'x.db'), ownerUid: '1', queueFactory })
  const c = await s.consent({ granted: true, revision: 1, commandId: 'c1' })
  assert.equal(c.accepted, true)
  const first = await s.capture({ messageId: 'm1', eventAt: 1, incoming: 'hi', deliveredParts: ['a'], replyIds: ['r1'] })
  assert.equal(first.accepted, false)
  assert.equal(first.status, 'unknown')
  assert.equal(s.state().blocked, true)
  const second = await s.capture({ messageId: 'm2', eventAt: 2, incoming: 'hi2', deliveredParts: ['b'], replyIds: ['r2'] })
  assert.equal(second.reason, 'reconsent_required')
  assert.equal(queues, 1)
  const c2 = await s.consent({ granted: true, revision: 2, commandId: 'c2' })
  assert.equal(c2.accepted, true)
  assert.equal(s.state().blocked, false)
  const third = await s.capture({ messageId: 'm3', eventAt: 3, incoming: 'hi3', deliveredParts: ['c'], replyIds: ['r3'] })
  assert.equal(third.accepted, true)
  assert.equal(queues, 2)
  await s.close()
  rmSync(d, { recursive: true, force: true })
})

test('runNonce is durable across shadow instances', async () => {
  const d = mkdtempSync(join(tmpdir(), 'hipnonce-'))
  const f = join(d, 'x.db')
  const fake = async () => ({ waitReady: async () => true, close: async () => {} })
  const a = createHippocampusShadow({ enabled: true, filePath: f, ownerUid: '1', queueFactory: fake })
  const nonce = a.state().runNonce
  await a.close()
  const b = createHippocampusShadow({ enabled: true, filePath: f, ownerUid: '1', queueFactory: fake })
  assert.equal(b.state().runNonce, nonce)
  await b.close()
  rmSync(d, { recursive: true, force: true })
})
