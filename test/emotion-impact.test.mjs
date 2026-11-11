import assert from 'node:assert/strict'
import {buildImpactPrompt, parseImpact} from '../emotion/emotion-impact.mjs'

const prompt = buildImpactPrompt({
  userText: '你很像我的女儿，有时候又很可爱',
  replyText: '嘿嘿 女儿就女儿吧',
})
assert.match(prompt, /女儿、宠物、小孩/)
assert.match(prompt, /顺着玩笑/)
assert.match(prompt, /不要只因为“被归类”/)
assert.match(prompt, /明确拒绝/)
assert.match(prompt, /episodeState/)
assert.match(prompt, /resolved/)
assert.equal(parseImpact('{"impact":"soothe","intensity":"soft","mood":"放心了","labels":["安心"],"episode":"腿痛","episodeState":"resolved"}').episodeState, 'resolved')
assert.equal(parseImpact('{"impact":"play","focus":"self","salience":"low","intensity":"soft","uncertain":false,"mood":"被逗笑","labels":["开心"]}').impact, 'play')
const activePrompt = buildImpactPrompt({
  userText: '腿疼那件事又有点疼了',
  replyText: '又疼了',
  activeEpisodes: [{label: '腿疼', closed: false}, {label: '被担心独处', closed: true}],
})
assert.match(activePrompt, /腿疼（未结束）/)
assert.match(activePrompt, /被担心独处（已修复）/)
assert.match(activePrompt, /必须沿用原来的名字/)
console.log('emotion impact prompt rules passed')
