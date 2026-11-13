import test from 'node:test'
import assert from 'node:assert/strict'
import { REGISTRY_VERSION, isBaseObject, isSafeObject, PREFERENCE_TERMS } from '../portable-memory-core/preference-registry.mjs'
import { extractPreference } from '../portable-memory-core/claims.mjs'
import { findPreferenceMention } from '../portable-memory-core/preference-context.mjs'

const pref = (text, version) => extractPreference({ channel: 'private', eventId: 'e1', text }, { version })

test('write/read registry accepts audited compounds and rejects lookalikes', () => {
  assert.equal(isSafeObject('喝', '无糖咖啡'), true)
  assert.equal(isSafeObject('喝', '水'), true)
  assert.equal(isSafeObject('喝', '咖啡店'), false)
  assert.equal(isBaseObject('喝', '冰咖啡'), false)
  assert.equal(isSafeObject('看', '科幻电影'), true)
})

test('version 1 stays base-only; version 2 accepts audited compounds', () => {
  assert.equal(pref('我喜欢喝无糖咖啡', 1), null)
  assert.equal(pref('我喜欢喝无糖咖啡', 2).object, '无糖咖啡')
  assert.equal(pref('我喜欢喝水', 1).object, '水')
})

test('context recognizes the same compounds the writer accepts', () => {
  assert.deepEqual(findPreferenceMention('我想喝无糖咖啡还是咖啡'), { activity: '喝', object: '无糖咖啡' })
  assert.deepEqual(findPreferenceMention('我想喝水还是茶'), { activity: '喝', object: '水' })
  assert.equal(findPreferenceMention('我想喝咖啡店'), null)
})

test('registry is versioned and exposes water without duplicates', () => {
  assert.equal(REGISTRY_VERSION, 2)
  const keys = PREFERENCE_TERMS.map(x => `${x.activity}:${x.object}`)
  assert.ok(keys.includes('喝:水'))
  assert.equal(new Set(keys).size, keys.length)
})
