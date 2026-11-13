import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReminder, createProactiveV5Runtime } from '../runtime/proactive-v5-runtime.mjs'

test('parser supports Arabic, Chinese, address prefix and tomorrow', () => {
  assert.equal(parseReminder('提醒我10分钟后喝水').text, '喝水')
  assert.equal(parseReminder('亚托莉，提醒我十分钟后喝水').text, '喝水')
  assert.equal(parseReminder('提醒我半小时后喝水'), null)
  assert.ok(parseReminder('明天9点提醒我喝水').notBefore > Date.now())
})

test('command and tick keep owner/consent behavior', async () => {
  const calls = []
  const store = {
    status: () => ({ consent: { allowed: true, version: 1 } }),
    grant: () => {}, revoke: () => {},
    schedule: () => ({ ok: true, notBefore: 1 }),
    due: () => ({ token: 't', uid: '10001', text: '喝水', consentVersion: 1 }),
    finish: (token, outcome) => calls.push([token, outcome]),
    markIncoming: () => {}, revokeSource: () => true,
  }
  const rt = createProactiveV5Runtime({
    store, isOwner: uid => String(uid) === '10001',
    sendPrivate: async (uid, text) => { calls.push([uid, text]); return { status: 'ok', retcode: 0 } },
    log: () => {}, clock: () => 1000, offsetMinutes: () => 480, setIntervalFn: () => ({ unref() {} }),
  })
  assert.equal(await rt.handleCommand({ message_type: 'private', raw_message: '开启主动联系' }, '10001'), true)
  assert.equal(await rt.handleCommand({ message_type: 'private', raw_message: '提醒我十分钟后喝水' }, '10001'), true)
  await rt.tick()
  assert.deepEqual(calls[0], ['10001', '好，我只在明确约定的事情上主动找你；随时发“关闭主动联系”可以停。'])
  assert.equal(calls.some(x => x[0] === 't' && x[1] === 'confirmed'), true)
})
