import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutobioLink } from '../autobio/link.mjs'

test('autobio link routes approved/match/format/observe', () => {
  const calls = []
  const f = {
    runtime: {
      listApproved: x => { calls.push(x); return [{ id: 'a', text: 't' }] },
      observeCommitted: x => { calls.push(x); return true },
    },
    matchApprovedReference: x => (x.text.includes('暗号') ? x.approved[0] : null),
    formatApprovedReference: x => `fmt:${x.id}`,
  }
  const link = createAutobioLink({ getFeature: () => f })
  assert.equal(link.available(), true)
  assert.equal(link.approved({ uid: 'u', generation: 2 })[0].id, 'a')
  const hit = link.match({ text: '暗号是什么', list: [{ id: 'a', text: 't' }] })
  assert.equal(hit.id, 'a')
  assert.equal(link.format(hit), 'fmt:a')
  assert.equal(link.observeCommitted({ eventId: 'e' }), true)
  assert.equal(calls.length, 2)
})

test('autobio link fails closed when missing', () => {
  const link = createAutobioLink({ getFeature: () => null })
  assert.equal(link.available(), false)
  assert.deepEqual(link.approved({ uid: 'u' }), [])
  assert.equal(link.match({ text: 'x' }), null)
  assert.equal(link.format({ id: 'a' }), '')
  assert.equal(link.observeCommitted({}), false)
})
