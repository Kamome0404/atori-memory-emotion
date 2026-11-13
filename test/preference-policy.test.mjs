import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreferenceTurn } from '../preference/preference-policy.mjs'

const turn = () => createPreferenceTurn({
  mention: { activity: '喝', object: '咖啡' },
  claim: { polarity: 'negative' },
})

test('removes stale positive lines from history messages', () => {
  const t = turn()
  const out = t.filterMessages([
    { role: 'assistant', content: '你以前说过喜欢喝咖啡，我记得。' },
    { role: 'user', content: '今天食堂的菜太咸。' },
    { role: 'assistant', content: '我不喜欢喝咖啡了。' },
  ])
  assert.equal(out.length, 3)
  assert.equal(out[0].content, '我记得。')
  assert.equal(out[1].content, '今天食堂的菜太咸。')
  assert.match(out[2].content, /不喜欢/)
  assert.doesNotMatch(out[0].content, /喜欢喝咖啡/)
})

test('drops a block if it only had a header and a stale line', () => {
  const t = turn()
  assert.equal(t.sanitizeBlock('## 旧记忆\n他说他喜欢喝咖啡。'), '')
})

test('keeps unrelated blocks and current negative statements', () => {
  const t = turn()
  assert.equal(t.sanitizeBlock('## 今天\n食堂的菜太咸。'), '## 今天\n食堂的菜太咸。')
  assert.match(t.sanitizeBlock('## 偏好\n我现在不喜欢喝咖啡。'), /不喜欢/)
})

test('does not remove a same-word non-preference mention', () => {
  const t = turn()
  assert.equal(t.sanitizeText('咖啡店今天关门了。'), '咖啡店今天关门了。')
})

test('object-specific: tea is not filtered for a coffee turn', () => {
  const t = turn()
  assert.equal(t.sanitizeText('我喜欢喝茶。'), '我喜欢喝茶。')
})

test('mixed positive and negative clauses: keep the negative, drop the positive', () => {
  const t = turn()
  const out = t.sanitizeText('我喜欢喝咖啡但不喜欢喝茶。')
  assert.doesNotMatch(out, /喜欢喝咖啡/)
  assert.match(out, /不喜欢喝茶/)
})

test('unrelated fact survives after the stale clause', () => {
  const t = turn()
  const out = t.sanitizeText('我喜欢喝咖啡，今天下雨了。')
  assert.doesNotMatch(out, /喜欢喝咖啡/)
  assert.match(out, /今天下雨/)
})

test('near-negation is not treated as stale positive', () => {
  const t = turn()
  assert.equal(t.sanitizeText('我并不怎么喜欢喝咖啡。'), '我并不怎么喜欢喝咖啡。')
})

test('object-first negation and unrelated compounds survive', () => {
  const t = turn()
  assert.equal(t.sanitizeText('咖啡我不喜欢。'), '咖啡我不喜欢。')
  assert.equal(t.sanitizeText('咖啡不是我喜欢的饮料。'), '咖啡不是我喜欢的饮料。')
  assert.equal(t.sanitizeText('我喜欢咖啡店的装修。'), '我喜欢咖啡店的装修。')
})

test('a later predicate with another object is not paired to this object', () => {
  const t = turn()
  const out = t.sanitizeText('我不喜欢喝咖啡也喜欢音乐。')
  assert.match(out, /不喜欢喝咖啡/)
  assert.match(out, /喜欢音乐/)
  assert.match(t.sanitizeText('我不喜欢喝咖啡也喜欢跑步。'), /不喜欢喝咖啡/)
  assert.doesNotMatch(t.sanitizeText('咖啡我喜欢。'), /咖啡我喜欢/)
})

test('object and predicate are paired per occurrence', () => {
  const t = turn()
  const a = t.sanitizeText('我不喜欢音乐也喜欢喝咖啡。')
  assert.doesNotMatch(a, /喜欢喝咖啡/)
  const b = t.sanitizeText('我喜欢音乐也不喜欢喝咖啡。')
  assert.match(b, /不喜欢喝咖啡/)
  const c = t.sanitizeText('咖啡店关门了我以前喜欢喝咖啡。')
  assert.doesNotMatch(c, /喜欢喝咖啡/)
})

test('no mention means no turn', () => {
  assert.equal(createPreferenceTurn(), null)
})
