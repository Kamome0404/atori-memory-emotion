import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreferenceTurn } from '../preference/preference-policy.mjs'

test('compose-shaped final messages contain no superseded positive', () => {
  const turn = createPreferenceTurn({
    mention: { activity: '喝', object: '咖啡' },
    claim: { polarity: 'negative' },
  })
  const system = [
    '## 旧记忆参考\n他以前说过喜欢喝咖啡。',
    '## 今天\n下雨了。',
  ]
  const hist = [
    { role: 'assistant', content: '你以前喜欢喝咖啡。' },
    { role: 'user', content: '我不喜欢喝茶。' },
  ]
  const current = { role: 'user', content: '我想喝咖啡还是茶' }
  const filteredSystem = system.map(x => turn.sanitizeBlock(x)).filter(Boolean)
  const filteredHist = turn.filterMessages(hist)
  const finalText = [...filteredSystem, ...filteredHist.map(m => m.content), current.content].join('\n')
  assert.doesNotMatch(finalText, /喜欢喝咖啡/)
  assert.match(finalText, /下雨/)
  assert.match(finalText, /不喜欢喝茶/)
  assert.match(finalText, /我想喝咖啡还是茶/)
})

test('no preference turn leaves compose-shaped messages byte-identical', () => {
  const turn = createPreferenceTurn()
  assert.equal(turn, null)
})
