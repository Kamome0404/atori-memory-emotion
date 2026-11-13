import test from 'node:test'
import assert from 'node:assert/strict'
import { readRequest, buildReaderPrompt, READER_CASES } from '../reader/reader.mjs'

const ALL = Object.entries(READER_CASES).flatMap(([mode, cases]) => cases.map(text => ({ mode, text })))

test('明确“先接住”的诉求识别为 catch', () => {
  for (const text of READER_CASES.catch) {
    const r = readRequest(text)
    assert.equal(r.mode, 'catch', text)
    assert.ok(r.matched, text)
  }
})

test('明确“直接答”的诉求识别为 reply', () => {
  for (const text of READER_CASES.reply) {
    const r = readRequest(text)
    assert.equal(r.mode, 'reply', text)
    assert.ok(r.matched, text)
  }
})

test('没有明确信号时绝不猜，返回 none', () => {
  for (const text of READER_CASES.none) {
    const r = readRequest(text)
    assert.deepEqual(r, { mode: 'none', matched: '', reason: 'no-explicit-signal' }, text)
  }
})

test('none 的 prompt 增量为空字符串，调用方可以保持 prompt 一字不改', () => {
  assert.equal(buildReaderPrompt({ mode: 'none' }), '')
  assert.equal(buildReaderPrompt(null), '')
})

test('catch / reply 的 prompt 增量最多三行且方向不混', () => {
  const catchText = buildReaderPrompt({ mode: 'catch' })
  const replyText = buildReaderPrompt({ mode: 'reply' })
  assert.ok(catchText.includes('先接住'))
  assert.ok(catchText.includes('不主动给建议'))
  assert.ok(replyText.includes('直接答'))
  assert.ok(replyText.includes('先给结论'))
  for (const text of [catchText, replyText]) {
    assert.ok(text.split('\n').length <= 3, text)
  }
})

test('配对样本全部命中，且 none 样本不被误触发', () => {
  const catchCount = ALL.filter(x => x.mode === 'catch').length
  const replyCount = ALL.filter(x => x.mode === 'reply').length
  const noneCount = ALL.filter(x => x.mode === 'none').length
  assert.ok(catchCount >= 10, `catch=${catchCount}`)
  assert.ok(replyCount >= 10, `reply=${replyCount}`)
  assert.ok(noneCount >= 5, `none=${noneCount}`)
  for (const { mode, text } of ALL) {
    assert.equal(readRequest(text).mode, mode, text)
  }
})

test('revision 2 回归：否定方向、裸听着、第三人称“直接说”不再误判', () => {
  assert.equal(readRequest('先别给方案').mode, 'catch')
  assert.equal(readRequest('我在听着，你继续').mode, 'none')
  assert.equal(readRequest('这首歌听着真舒服').mode, 'none')
  assert.equal(readRequest('他直接说了不用我管').mode, 'none')
  assert.equal(readRequest('别安慰，给个办法').mode, 'reply')
})
