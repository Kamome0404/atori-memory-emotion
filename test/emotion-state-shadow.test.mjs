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
  const disabled = createEmotionStateShadow({enabled: false, ownerUid: '1000000001', stateFilePath: path.join(dir, 'off.json'), classifier: fakeClassifier})
  assert.equal((await disabled.observe({eventId: 'x', confirmed: true, userText: '在吗', replyText: '在'})).reason, 'disabled')

  const stateFile = path.join(dir, 'owner.json')
  const shadow = createEmotionStateShadow({enabled: true, ownerUid: '1000000001', stateFilePath: stateFile, classifier: fakeClassifier})
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
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'gated.json'),
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
  // same hurt:self episode within ten minutes -> no second reminder
  assert.equal(gated.nextAttentionBlock(), '')
  await gated.observe({eventId: 'qq:g5', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(gated.nextAttentionBlock(), '')

  const injuryQueue = [
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', uncertain: false, mood: '担心他疼', labels: ['担心']},
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', uncertain: false, mood: '还在担心', labels: ['担心']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', uncertain: false, mood: '自己也被刺到', labels: ['在意']},
  ]
  const injury = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'injury.json'),
    classifier: {async classify() { return injuryQueue.shift() }},
  })
  await injury.observe({eventId: 'qq:inj1', confirmed: true, userText: '拉伤了', replyText: '疼得厉害吗'})
  assert.match(injury.nextAttentionBlock(), /先注意/)
  await injury.observe({eventId: 'qq:inj2', confirmed: true, userText: '好难受', replyText: '我在'})
  assert.equal(injury.nextAttentionBlock(), '')
  await injury.observe({eventId: 'qq:inj3', confirmed: true, userText: '算了', replyText: '嗯'})
  assert.match(injury.nextAttentionBlock(), /先注意/)

  const semanticQueue = [
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: '拉伤', uncertain: false, mood: '担心拉伤', labels: ['担心']},
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: '拉伤', uncertain: false, mood: '还在担心', labels: ['担心']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: '玩笑被刺', uncertain: false, mood: '有点被刺到', labels: ['在意']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'strong', episode: '玩笑被刺', uncertain: false, mood: '更难受了', labels: ['难受']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: '玩笑被刺', uncertain: false, mood: '还在意', labels: ['在意']},
    {impact: 'repair', focus: 'self', salience: 'low', intensity: 'soft', episode: '玩笑被刺', uncertain: false, mood: '说开了', labels: ['平静']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: '玩笑被刺', uncertain: false, mood: '又提起', labels: ['在意']},
  ]
  const semantic = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'semantic.json'),
    classifier: {async classify() { return semanticQueue.shift() }},
  })
  await semantic.observe({eventId: 'qq:s1', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(semantic.nextAttentionBlock(), /先注意/)
  await semantic.observe({eventId: 'qq:s2', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(semantic.nextAttentionBlock(), '')
  await semantic.observe({eventId: 'qq:s3', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(semantic.nextAttentionBlock(), /先注意/)
  await semantic.observe({eventId: 'qq:s4', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(semantic.nextAttentionBlock(), /先注意/)
  await semantic.observe({eventId: 'qq:s5', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(semantic.nextAttentionBlock(), '')
  await semantic.observe({eventId: 'qq:s6', confirmed: true, userText: 'a', replyText: 'b'})
  await semantic.observe({eventId: 'qq:s7', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(semantic.nextAttentionBlock(), /先注意/)

  const interQueue = [
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: 'A', uncertain: false, mood: 'A', labels: ['A']},
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: 'B', uncertain: false, mood: 'B', labels: ['B']},
    {impact: 'repair', focus: 'self', salience: 'low', intensity: 'soft', episode: 'A', uncertain: false, mood: 'A说开', labels: ['平静']},
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: 'A', uncertain: false, mood: 'A again', labels: ['A']},
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: 'B', uncertain: false, mood: 'B again', labels: ['B']},
  ]
  const inter = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'interleaved.json'),
    classifier: {async classify() { return interQueue.shift() }},
  })
  await inter.observe({eventId: 'qq:i1', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(inter.nextAttentionBlock(), /先注意/)
  await inter.observe({eventId: 'qq:i2', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(inter.nextAttentionBlock(), /先注意/)
  await inter.observe({eventId: 'qq:i3', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(inter.nextAttentionBlock(), '')
  await inter.observe({eventId: 'qq:i4', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(inter.nextAttentionBlock(), /先注意/)
  await inter.observe({eventId: 'qq:i5', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(inter.nextAttentionBlock(), '')

  let sawActive = null
  let ctxCall = 0
  const context = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'context.json'),
    classifier: {async classify(args) {
      ctxCall++
      if (ctxCall === 2) sawActive = args.activeEpisodes
      return ctxCall === 1
        ? {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: '腿疼', uncertain: false, mood: 'A', labels: ['A']}
        : {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: '腿疼', uncertain: false, mood: 'A2', labels: ['A']}
    }},
  })
  await context.observe({eventId: 'qq:ctx1', confirmed: true, userText: 'a', replyText: 'b'})
  await context.observe({eventId: 'qq:ctx2', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(sawActive?.[0]?.label, '腿疼')
  assert.equal(sawActive?.[0]?.closed, false)

  const stateQueue = [
    {impact: 'hurt', focus: 'self', salience: 'high', intensity: 'normal', episode: '腿痛', episodeState: 'open', uncertain: false, mood: 'A', labels: ['A']},
    {impact: 'soothe', focus: 'other', salience: 'medium', intensity: 'soft', episode: '腿痛', episodeState: 'resolved', uncertain: false, mood: '放心了', labels: ['安心']},
    {impact: 'worry', focus: 'other', salience: 'high', intensity: 'normal', episode: '腿痛', episodeState: 'reopened', uncertain: false, mood: '又疼了', labels: ['担心']},
  ]
  const episodeStateShadow = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'episode-state.json'),
    classifier: {async classify() { return stateQueue.shift() }},
  })
  await episodeStateShadow.observe({eventId: 'qq:es1', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(episodeStateShadow.nextAttentionBlock(), /先注意/)
  await episodeStateShadow.observe({eventId: 'qq:es2', confirmed: true, userText: 'a', replyText: 'b'})
  assert.equal(episodeStateShadow.nextAttentionBlock(), '')
  await episodeStateShadow.observe({eventId: 'qq:es3', confirmed: true, userText: 'a', replyText: 'b'})
  assert.match(episodeStateShadow.nextAttentionBlock(), /先注意/)

  const softPlay = createEmotionStateShadow({
    enabled: true, ownerUid: '999999999', stateFilePath: path.join(dir, 'soft-play.json'),
    classifier: {async classify() { return {impact: 'play', focus: 'self', salience: 'medium', intensity: 'soft', uncertain: false, mood: '想逗一下', labels: ['开心']} }},
  })
  await softPlay.observe({eventId: 'qq:sp', confirmed: true, userText: '逗你', replyText: '哼'})
  assert.equal(softPlay.nextAttentionBlock(), '')
  const softHurt = createEmotionStateShadow({
    enabled: true, ownerUid: '999999999', stateFilePath: path.join(dir, 'soft-hurt.json'),
    classifier: {async classify() { return {impact: 'hurt', focus: 'self', salience: 'medium', intensity: 'soft', uncertain: false, mood: '轻轻被刺到', labels: ['在意']} }},
  })
  await softHurt.observe({eventId: 'qq:sh', confirmed: true, userText: '随口一句', replyText: '嗯'})
  // soft events do not move a neutral stance, so there is no stance change to gate.
  assert.equal(softHurt.nextAttentionBlock(), '')

  const caring = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'caring.json'),
    classifier: {async classify() { return {impact: 'worry', focus: 'other', intensity: 'normal', uncertain: false, mood: '有点担心，先听他说', labels: ['担心']} }},
  })
  assert.equal((await caring.observe({eventId: 'qq:care', confirmed: true, userText: '今天好累啊', replyText: '累就早点躺下吧'})).state.stance, 'quiet')

  const failed = createEmotionStateShadow({
    enabled: true, ownerUid: '1000000001', stateFilePath: path.join(dir, 'failed.json'),
    classifier: {async classify() { throw new Error('model down') }},
  })
  assert.equal((await failed.observe({eventId: 'qq:2', confirmed: true, userText: '在吗', replyText: '在'})).reason, 'classify_failed')

  assert.equal((await shadow.observe({eventId: 'qq:3', confirmed: false, userText: '在吗', replyText: '在'})).reason, 'not_confirmed')
  console.log('emotion impact and shadow passed')
} finally {
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50})
}
