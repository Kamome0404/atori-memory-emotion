import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { createAutobioRuntime } from '../autobio/factory.mjs'

test('autobio runtime validates exports and passes scope', async () => {
  const d = mkdtempSync(join(tmpdir(), 'ab-'))
  let got
  const api = await createAutobioRuntime({
    dataDir: d, ownerUid: 'owner', memoryPort: {},
    loadRuntime: async () => ({ createAutobio: opts => { got = opts; return { runtime: true } } }),
    loadIntegration: async () => ({ matchApprovedReference: () => null, formatApprovedReference: () => '' }),
  })
  assert.ok(api.runtime)
  assert.equal(got.ownerScope, 'private:owner')
  assert.equal(got.mode, 'shadow')
  rmSync(d, { recursive: true, force: true })
})

test('autobio runtime fails closed on bad exports/owner', async () => {
  await assert.rejects(createAutobioRuntime({ dataDir: '.', ownerUid: '', loadRuntime: async () => ({}), loadIntegration: async () => ({}) }), /owner missing/)
  await assert.rejects(createAutobioRuntime({ dataDir: '.', ownerUid: 'o', loadRuntime: async () => ({}), loadIntegration: async () => ({}) }), /missing autobio exports/)
})
