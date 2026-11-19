import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deriveMemoryState, stateWeight } from '../hippocampus/memory-state-contract.mjs'
import { parseExplicitTimeCue } from '../hippocampus/memory-time-cue.mjs'
import { isForgotten, appendDecision } from '../hippocampus/forget-closure.mjs'

test('memory state weakens with age but keeps owner-confirmed weight', () => {
  const now = Date.parse('2026-11-19T12:00:00+08:00')
  const recent = deriveMemoryState({ at: now - 86400000, now, ownerConfirmed: true })
  assert.equal(recent.state, 'active')
  assert.ok(stateWeight(recent) >= 1)
  const old = deriveMemoryState({ at: now - 200 * 86400000, now, ownerConfirmed: false })
  assert.equal(old.state, 'archived')
})

test('explicit time cue only matches explicit day words', () => {
  const now = Date.parse('2026-11-19T12:00:00+08:00')
  assert.equal(parseExplicitTimeCue('昨天', now).label, '昨天')
  assert.equal(parseExplicitTimeCue('今天', now).label, '今天')
  assert.equal(parseExplicitTimeCue('前几天', now), null)
})

test('forget decisions normalize QQ inbound ids', () => {
  const d = mkdtempSync(join(tmpdir(), 'forget-'))
  const f = join(d, 'forget.jsonl')
  appendDecision(f, { eventId: 'qq:12345:in', mode: 'mute' })
  assert.equal(isForgotten(f, '12345'), true)
  assert.equal(isForgotten(f, 'qq:12345:in'), true)
  assert.equal(isForgotten(f, '99999'), false)
  rmSync(d, { recursive: true, force: true })
})
