import test from 'node:test'
import assert from 'node:assert/strict'
import { preferenceProvenanceEqual, referenceStillCurrent } from '../preference/memory-reference.mjs'

const turn = text => ({ take: () => ({ text }) })

test('no memory used or answered passes', () => {
  assert.equal(referenceStillCurrent({}), true)
})

test('used ordinary episode must still match at send time', () => {
  assert.equal(referenceStillCurrent({
    used: true, answer: false, turn: turn('old'), reference: 'old', historyRev: 1, currentRev: 1,
  }), true)
  assert.equal(referenceStillCurrent({
    used: true, answer: false, turn: turn('changed'), reference: 'old', historyRev: 1, currentRev: 1,
  }), false)
})

test('owner answer path is validated too', () => {
  assert.equal(referenceStillCurrent({
    used: false, answer: true, turn: turn('old'), reference: 'old', historyRev: 1, currentRev: 1,
  }), true)
  assert.equal(referenceStillCurrent({
    used: false, answer: true, turn: turn('revoked'), reference: 'old', historyRev: 1, currentRev: 1,
  }), false)
})

test('missing turn, missing reference, and history revision change fail closed', () => {
  assert.equal(referenceStillCurrent({ used: true, answer: false, turn: null, reference: 'old' }), false)
  assert.equal(referenceStillCurrent({ used: true, answer: false, turn: turn('old'), reference: '' }), false)
  assert.equal(referenceStillCurrent({
    used: true, answer: false, turn: turn('old'), reference: 'old', historyRev: 2, currentRev: 1,
  }), false)
})

const snapshot = (eventId = 'e1') => ({
  schema: 1, kind: 'preference', tenant: '10001', scope: 'private:10001', generation: 1,
  mentions: [{ activity: '喝', object: '咖啡', claim: { eventId, version: 1, created: 1000, polarity: 'positive', activity: '喝', object: '咖啡' } }],
})

test('provenance comparison is structural, not text-based', () => {
  assert.equal(preferenceProvenanceEqual(snapshot('e1'), snapshot('e1')), true)
  assert.equal(preferenceProvenanceEqual(snapshot('e1'), snapshot('e2')), false)
  assert.equal(preferenceProvenanceEqual(snapshot('e1'), null), false)
})

test('provenance must still be current at send time', () => {
  const p = snapshot('e1')
  assert.equal(referenceStillCurrent({
    used: true, turn: turn('ref'), reference: 'ref', provenance: p, currentProvenance: snapshot('e1'),
  }), true)
  assert.equal(referenceStillCurrent({
    used: true, turn: turn('ref'), reference: 'ref', provenance: p, currentProvenance: snapshot('e2'),
  }), false)
  assert.equal(referenceStillCurrent({
    used: true, turn: turn('ref'), reference: 'ref', provenance: p, currentProvenance: null,
  }), false)
})


test('malformed or missing provenance fails closed', () => {
  assert.equal(preferenceProvenanceEqual({ schema: 1, kind: 'preference' }, snapshot('e1')), false)
  assert.equal(referenceStillCurrent({
    used: true, turn: { take: () => ({ text: 'ref', preference: true }) }, reference: 'ref',
  }), false)
  assert.equal(referenceStillCurrent({
    used: true, turn: { take: () => ({ text: 'ref', provenance: snapshot('e1') }) }, reference: 'ref',
  }), false)
})


test('normal episode reference is not rejected by the preference provenance field', () => {
  const episode = { schema: 1, kind: 'episode', tenant: '10001', scope: 'private:10001', generation: 1, ownEventId: 'e1', sources: [] }
  assert.equal(referenceStillCurrent({
    used: true, turn: { take: () => ({ text: 'ep', provenance: episode }) }, reference: 'ep',
  }), true)
})
