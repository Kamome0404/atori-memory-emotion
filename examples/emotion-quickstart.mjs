import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmotionState } from '../emotion/emotion-state.mjs'

const dir = mkdtempSync(join(tmpdir(), 'atori-emotion-example-'))
const state = createEmotionState({
  filePath: join(dir, 'owner.json'),
  ownerUid: '123456789',
})

try {
  const result = state.observe({
    eventId: 'example-1',
    confirmed: true,
    impact: 'hurt',
    intensity: 'normal',
    mood: '有点在意，但不想闹',
    labels: ['在意', '嘴硬'],
  })
  console.log('stance:', result.state.stance)
  console.log('mood:', result.state.mood)
  console.log(state.promptBlock())

  state.retract({ eventId: 'example-1' })
  console.log('after retraction:', state.snapshot().stance)
} finally {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}
