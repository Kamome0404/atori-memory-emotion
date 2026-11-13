import test from 'node:test'
import assert from 'node:assert/strict'
import { findPreferenceMention, findPreferenceMentions, isPreferenceQuery, formatPreferenceBlock, formatPreferenceReference } from '../portable-memory-core/preference-context.mjs'

test('exact object mention is eligible', () => {
  assert.deepEqual(findPreferenceMention('我想喝咖啡还是茶'), { activity: '喝', object: '咖啡' })
  assert.deepEqual(findPreferenceMention('我想听音乐还是听播客'), { activity: '听', object: '音乐' })
})

test('multi-object question returns each mention in text order', () => {
  const ms = findPreferenceMentions('我想喝咖啡还是茶')
  assert.deepEqual(ms.map(x => x.object), ['咖啡', '茶'])
  assert.deepEqual(findPreferenceMentions('我想喝冰咖啡还是咖啡').map(x => x.object), ['冰咖啡', '咖啡'])
})

test('longest exact object wins, no substring cross-talk', () => {
  assert.deepEqual(findPreferenceMention('我想喝冰咖啡还是咖啡'), { activity: '喝', object: '冰咖啡' })
  assert.equal(findPreferenceMention('咖啡店在哪'), null)
})

test('third-party and quoted statements are rejected', () => {
  assert.equal(findPreferenceMention('我朋友说他喜欢喝咖啡'), null)
  assert.equal(findPreferenceMention('他说“我喜欢喝咖啡”'), null)
})

test('current self-report is not treated as an old preference lookup', () => {
  assert.equal(findPreferenceMention('我喜欢喝咖啡'), null)
  assert.deepEqual(findPreferenceMention('我喜欢喝咖啡吗'), { activity: '喝', object: '咖啡' })
  assert.equal(findPreferenceMention('我想喝牛奶'), null)
  assert.equal(findPreferenceMention('你想喝咖啡还是茶'), null)
  assert.equal(findPreferenceMention('我不喜欢喝咖啡'), null)
})

test('no object means no context', () => {
  assert.equal(findPreferenceMention('今天好累'), null)
  assert.equal(findPreferenceMention(''), null)
})

test('compound lookalikes do not trigger a preference mention', () => {
  assert.equal(findPreferenceMention('我想买水果还是茶叶？'), null)
  assert.equal(findPreferenceMention('我想知道咖啡因是什么？'), null)
  assert.equal(findPreferenceMention('我想买水泥还是茶几？'), null)
  assert.equal(findPreferenceMention('我想查水电费还是茶文化？'), null)
  assert.equal(findPreferenceMention('我想买水彩还是茶具？'), null)
  assert.deepEqual(findPreferenceMentions('我想喝奶茶还是咖啡？').map(x => x.object), ['咖啡'])
  assert.deepEqual(findPreferenceMentions('我想喝咖啡、茶还是水？').map(x => x.object), ['咖啡', '茶', '水'])
})

test('format keeps one short line and negative overrides old positive', () => {
  const pos = formatPreferenceBlock({ polarity: 'positive', activity: '喝', object: '咖啡' })
  const neg = formatPreferenceBlock({ polarity: 'negative', activity: '喝', object: '咖啡' })
  assert.ok(pos.includes('旧话'))
  assert.ok(neg.includes('以现在为准'))
  assert.ok(pos.length <= 30)
  assert.ok(neg.length <= 30)
  assert.equal(formatPreferenceBlock(null), '')
})

test('actual preference reference is short and does not invent history', () => {
  const pos = formatPreferenceReference({ polarity: 'positive', activity: '听', object: '古典音乐' }, { activity: '听', object: '古典音乐' })
  const neg = formatPreferenceReference({ polarity: 'negative', activity: '听', object: '古典音乐' }, { activity: '听', object: '古典音乐' })
  const nil = formatPreferenceReference(null, { activity: '听', object: '古典音乐' })
  for (const text of [pos, neg, nil]) assert.ok(text.length <= 30, text)
  assert.ok(pos.includes('旧话'))
  assert.ok(neg.includes('不喜欢'))
  assert.ok(!neg.includes('以前说过喜欢'))
  assert.ok(nil.includes('无法确认'))
})


test('broad preference queries are detected even without an exact object', () => {
  assert.equal(isPreferenceQuery('我喜欢喝什么？'), true)
  assert.equal(isPreferenceQuery('你还记得咖啡吗'), true)
  assert.equal(isPreferenceQuery('你还记得咖啡'), true)
  assert.equal(isPreferenceQuery('咖啡因是什么？'), false)
  assert.equal(isPreferenceQuery('今天好累'), false)
})
