import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceStillCurrent } from '../preference/memory-reference.mjs'

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
