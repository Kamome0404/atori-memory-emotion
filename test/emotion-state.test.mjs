import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createEmotionState, allowedNext} from '../emotion/emotion-state.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atri-emotion-state-'))
const file = path.join(dir, 'owner.json')
try {
  const s = createEmotionState({filePath: file, ownerUid: '999999999'})
  let snap = s.snapshot()
  assert.equal(snap.stance, 'neutral')
  assert.ok(snap.options.length >= 1)
  assert.ok(!s.promptBlock().includes('“我有点难受”'))

  // Inertia: hold and soft events do not force a stance jump.
  const held = s.observe({eventId: 'qq:h1', confirmed: true, impact: 'hurt', intensity: 'soft', hold: true, preferredStance: 'neutral', at: 1})
  assert.equal(held.applied, true)
  assert.equal(held.state.stance, 'neutral')
  const soft = s.observe({eventId: 'qq:h2', confirmed: true, impact: 'hurt', intensity: 'soft', preferredStance: 'hurt', at: 2})
  assert.equal(soft.state.stance, 'neutral')
  const strong = s.observe({eventId: 'qq:h3', confirmed: true, impact: 'hurt', intensity: 'strong', preferredStance: 'hurt', at: 3})
  assert.equal(strong.state.stance, 'hurt')

  const hurt = s.observe({
    eventId: 'qq:1', confirmed: true, impact: 'hurt',
    mood: '有点在意，但不想闹', labels: ['在意', '嘴硬'], at: 10,
  })
  assert.equal(hurt.applied, true)
  assert.equal(hurt.state.stance, 'hurt')
  assert.ok(hurt.options.includes('先安静一会儿'))

  // Non-linear jump: hurt -> playful is allowed when play impact arrives.
  const jump = s.observe({eventId: 'qq:2', confirmed: true, impact: 'play', preferredStance: 'playful', at: 20})
  assert.equal(jump.applied, true)
  assert.equal(jump.state.stance, 'playful')

  // Duplicate and out-of-order are rejected without changing state.
  assert.equal(s.observe({eventId: 'qq:2', confirmed: true, impact: 'hurt', at: 30}).reason, 'duplicate_event')
  assert.equal(s.observe({eventId: 'qq:3', confirmed: true, impact: 'hurt', at: 5}).reason, 'out_of_order_event')

  // Forbidden relationship labels are not stored.
  const labels = s.observe({eventId: 'qq:4', confirmed: true, impact: 'soothe', mood: '有点安心', labels: ['爱', '平静'], at: 40})
  assert.equal(labels.state.labels.includes('爱'), false)
  assert.equal(labels.state.labels.includes('平静'), true)

  // Persistence and retraction.
  const s2 = createEmotionState({filePath: file, ownerUid: '999999999'})
  assert.ok(s2.snapshot().causes.length >= 1)
  assert.equal(s2.retract({eventId: 'qq:1'}).applied, true)
  assert.equal(s2.retract({eventId: 'qq:2'}).applied, true)
  for (const id of ['qq:4', 'qq:h1', 'qq:h2', 'qq:h3']) assert.equal(s2.retract({eventId: id}).applied, true)
  const after = s2.snapshot()
  assert.equal(after.stance, 'neutral')
  assert.equal(after.causes.length, 0)
  assert.equal(after.mood, '平静')

  // boundary is a first-class impact and maps to guarded.
  const b = createEmotionState({filePath: path.join(dir, 'boundary.json'), ownerUid: '999999999'})
  const br = b.observe({eventId: 'qq:b1', confirmed: true, impact: 'boundary', intensity: 'normal', mood: '这个不行', labels: ['嘴硬'], at: 1})
  assert.equal(br.state.stance, 'guarded')

  // Uncertainty, residue and attention are prompt-level boundaries, not scripts.
  let clock = 1000
  const t = createEmotionState({filePath: path.join(dir, 'timed.json'), ownerUid: '999999999', now: () => clock})
  assert.equal(t.observe({eventId: 'qq:t1', confirmed: true, impact: 'hurt', mood: '有点被刺到', at: 1000, uncertain: true}).applied, true)
  const jumped = t.observe({eventId: 'qq:t2', confirmed: true, impact: 'play', preferredStance: 'playful', mood: '想笑，但还没完全过去', at: 2000, uncertain: false})
  assert.equal(jumped.state.residue.eventId, 'qq:t1')
  assert.equal(jumped.attention, '先看能不能轻轻接住这个玩笑')
  assert.ok(t.promptBlock().includes('这一轮先注意'))
  assert.ok(t.promptBlock().includes('余韵'))
  clock = 2000 + 30 * 60 * 1000 + 1
  assert.equal(t.snapshot().residue, null, 'residue must expire')
  assert.equal(t.snapshot().uncertain, false)

  assert.ok(allowedNext('neutral').includes('hurt'))
  assert.ok(allowedNext('hurt').includes('playful'))
  console.log('emotion state passed')
} finally {
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 50})
}
