import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {buildImpactPrompt, parseImpact, createImpactClassifier} from '../emotion/emotion-impact.mjs'
import {createEmotionStateShadow} from '../emotion/emotion-state-shadow.mjs'

assert.equal(parseImpact('{"impact":"hurt","intensity":"normal","uncertain":false,"mood":"有点在意","labels":["在意"]}').impact, 'hurt')
assert.equal(parseImpact('```json\n{"impact":"play","intensity":"soft","mood":"想笑","labels":["开心"]}\n```').intensity, 'soft')
assert.equal(parseImpact('not json').impact, 'neutral')
assert.equal(parseImpact('{"impact":"love","intensity":"strong","labels":["爱"]}').labels.includes('爱'), false)

const fakeClassifier = createImpactClassifier({
  ask: async prompt => {
    assert.ok(prompt.includes('只判断'))
    assert.ok(prompt.includes('用户：'))
    return '{"impact":"hurt","intensity":"normal","uncertain":true,"mood":"有点被刺到","labels":["在意"]}'
  },
})
const classified = await fakeClassifier.classify({userText: '你怎么这么笨', replyText: '……'})
assert.equal(classified.impact, 'hurt')
assert.equal(classified.intensity, 'normal')
assert.equal(classified.uncertain, true)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-emotion-shadow-state-'))
try {
  const disabled = createEmotionStateShadow({enabled: false, ownerUid: '999999999', stateFilePath: path.join(dir, 'off.json'), classifier: fakeClassifier})
  assert.equal((await disabled.observe({eventId: 'x', confirmed: true, userText: '在吗', replyText: '在'})).reason, 'disabled')

  const stateFile = path.join(dir, 'owner.json')
  const shadow = createEmotionStateShadow({enabled: true, ownerUid: '999999999', stateFilePath: stateFile, classifier: fakeClassifier})
  const r = await shadow.observe({eventId: 'qq:1', confirmed: true, userText: '你怎么这么笨', replyText: '……'})
  assert.match(shadow.attentionBlock(), /先注意/)
  assert.ok(!shadow.attentionBlock().includes('你怎么这么笨'))
  assert.equal(r.applied, true)
  assert.equal(r.state.stance, 'hurt')
  assert.ok(fs.existsSync(stateFile))
  const raw = fs.readFileSync(stateFile, 'utf8')
  assert.ok(!raw.includes('你怎么这么笨'), 'state file must not contain raw user text')

  const duplicate = await shadow.observe({eventId: 'qq:1', confirmed: true, userText: '你怎么这么笨', replyText: '……'})
  assert.equal(duplicate.reason, 'duplicate_event')

  const queue = [
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', uncertain: false, mood: '被刺到', labels: ['在意']},
    {impact: 'hurt', focus: 'self', salience: 'medium', intensity: 'normal', uncertain: false, mood: '还在意', labels: ['在意']},
    {impact: 'play', focus: 'self', salience: 'high', intensity: 'normal', uncertain: false, mood: '想逗回去', labels: ['嘴硬']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', uncertain: false, mood: '又被刺到', labels: ['在意']},
    {impact: 'neutral', focus: 'self', salience: 'low', intensity: 'soft', uncertain: false, mood: '平静', labels: ['平静']},
  ]
  const gated = createEmotionStateShadow({
    enabled: true, ownerUid: '999999999', stateFilePath: path.join(dir, 'gated.json'),
    classifier: {async classify() { return queue.shift() }},
  })
  assert.equal(gated.nextAttentionBlock(), '')
  await gated.observe({eventId: 'qq:g1', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(gated.nextAttentionBlock(), /先注意/)
  await gated.observe({eventId: 'qq:g2', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(gated.nextAttentionBlock(), '')
  await gated.observe({eventId: 'qq:g3', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(gated.nextAttentionBlock(), /先注意/)
  await gated.observe({eventId: 'qq:g4', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(gated.nextAttentionBlock(), /先注意/)
  await gated.observe({eventId: 'qq:g5', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(gated.nextAttentionBlock(), '')

  const caring = createEmotionStateShadow({
    enabled: true, ownerUid: '999999999', stateFilePath: path.join(dir, 'caring.json'),
    classifier: {async classify() { return {impact: 'worry', focus: 'other', intensity: 'normal', uncertain: false, mood: '有点担心，先听他说', labels: ['担心']} }},
  })
  assert.equal((await caring.observe({eventId: 'qq:care', confirmed: true, userText: '今天好累啊', replyText: '累就早点躺下吧'})).state.stance, 'quiet')

  const failed = createEmotionStateShadow({
    enabled: true, ownerUid: '999999999', stateFilePath: path.join(dir, 'failed.json'),
    classifier: {async classify() { throw new Error('model down') }},
  })
  assert.equal((await failed.observe({eventId: 'qq:2', confirmed: true, userText: '在吗', replyText: '在'})).reason, 'classify_failed')

  assert.equal((await shadow.observe({eventId: 'qq:3', confirmed: false, userText: '在吗', replyText: '在'})).reason, 'not_confirmed')
  console.log('emotion impact and shadow passed')
} finally {
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50})
}
