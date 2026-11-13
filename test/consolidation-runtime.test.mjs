import test from 'node:test'
import assert from 'node:assert/strict'
import { createConsolidationRuntime } from '../runtime/consolidation-runtime.mjs'

test('load/prompt/current and throttled schedule are isolated', () => {
  let serviceCalls = 0
  const rows = [{ id: 'n1', content: '片段', provenance: { contentDigest: 'c', sourceSetDigest: 's' } }]
  const service = {
    status: () => ({ allowed: true, generation: 1 }),
    loadConsolidated: () => { serviceCalls++; return rows },
    consolidateRecent: () => ['made'],
  }
  const timers = []
  const runtime = createConsolidationRuntime({
    getService: () => service,
    memoryScope: () => 'private:10001',
    log: () => {},
    clock: () => 1_000_000_000,
    setTimeoutFn: (fn) => { timers.push(fn) },
  })
  const target = { uid: 10001, private: true, _pilotTurn: { generation: 1 } }
  const loaded = runtime.load(target)
  assert.equal(loaded.length, 1)
  assert.equal(target._consolidatedInjected, true)
  assert.equal(runtime.promptBlock(loaded, target, { broad: true }), '')
  assert.equal(runtime.stillCurrent(target), true)
  assert.equal(runtime.schedule(10001), true)
  assert.equal(runtime.schedule(10001), false)
  timers[0]()
  assert.equal(serviceCalls >= 2, true)
})
