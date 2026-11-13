import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createOneBotMemory } from '../portable-memory-core/onebot.mjs'
import { referenceStillCurrent } from '../preference/memory-reference.mjs'

const SELF = '3112975836'
const UID = '900000001'
const receipt = id => ({ status: 'ok', retcode: 0, data: { message_id: id } })
const msg = (id, text) => ({
  post_type: 'message', message_type: 'private', self_id: SELF,
  user_id: UID, sender: { user_id: UID }, message_id: id, time: 1700000000 + id,
  message: [{ type: 'text', data: { text } }],
})

test('OneBot B1: positive then negative preference replaces episode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b1-onebot-'))
  const mem = createOneBotMemory({ dbPath: join(dir, 'memory.sqlite'), selfId: SELF, users: ['*'], enabled: true })
  try {
    const first = mem.begin(msg(1, '我喜欢喝牛奶'))
    assert.ok(first)
    first.attempt('嗯')
    first.confirm('嗯', receipt(2))
    assert.equal(first.finish(true), true)

    const positive = mem.begin(msg(3, '我想喝牛奶还是咖啡'))
    const positiveRef = positive.take()
    assert.equal(positiveRef.preference, true)
    assert.match(positiveRef.text, /喜欢喝牛奶/)
    assert.doesNotMatch(positiveRef.text, /已确认私聊事件/)
    positive.finish(false)

    const correction = mem.begin(msg(4, '我不喜欢喝牛奶'))
    assert.ok(correction)
    correction.attempt('好')
    correction.confirm('好', receipt(5))
    assert.equal(correction.finish(true), true)

    const negative = mem.begin(msg(6, '我想喝牛奶还是咖啡'))
    const negativeRef = negative.take()
    assert.equal(negativeRef.preference, true)
    assert.match(negativeRef.text, /不喜欢/)
    assert.doesNotMatch(negativeRef.text, /明确说过喜欢/)
    negative.finish(false)
  } finally {
    try { mem.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})


test('revoking the cached source makes the old reference fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b1-revoke-'))
  const mem = createOneBotMemory({ dbPath: join(dir, 'memory.sqlite'), selfId: SELF, users: ['*'], enabled: true })
  try {
    const first = mem.begin(msg(1, '我喜欢喝牛奶'))
    first.attempt('嗯'); first.confirm('嗯', receipt(2)); assert.equal(first.finish(true), true)
    const query = mem.begin(msg(3, '我想喝牛奶还是咖啡'))
    const ref = query.take()
    assert.equal(ref.preference, true)
    assert.equal(ref.provenance.kind, 'preference')
    const currentProv = mem.revalidatePreference({ uid: UID, provenance: ref.provenance })
    assert.equal(currentProv.generation, ref.provenance.generation)
    assert.equal(currentProv.mentions[0].claim.eventId, ref.provenance.mentions[0].claim.eventId)
    assert.equal(referenceStillCurrent({ used: true, turn: query, reference: ref.text, provenance: ref.provenance, currentProvenance: currentProv }), true)
    assert.equal(mem.notice({ post_type: 'notice', notice_type: 'friend_recall', self_id: SELF, user_id: UID, message_id: 1 }), true)
    const afterRevoke = mem.revalidatePreference({ uid: UID, provenance: ref.provenance })
    assert.equal(afterRevoke.mentions.every(m => m.claim === null), true)
    assert.equal(referenceStillCurrent({ used: true, turn: query, reference: ref.text, provenance: ref.provenance, currentProvenance: afterRevoke }), false)
    assert.equal(query.take(), null)
    query.finish(false)
  } finally {
    try { mem.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})
