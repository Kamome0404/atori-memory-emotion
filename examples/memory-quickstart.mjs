import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryCore } from '../portable-memory-core/core.mjs'

const dir = mkdtempSync(join(tmpdir(), 'atori-memory-example-'))
const memory = createMemoryCore({
  dbPath: join(dir, 'memory.sqlite'),
  tenant: 'alice',
  scope: 'private:alice',
  scopeKind: 'direct',
})

try {
  const generation = memory.setAuthorization(true)
  memory.capture({
    generation,
    eventId: 'example-1',
    created: Date.now(),
    text: 'I like jasmine tea.',
    replies: [{ id: 'example-r1', text: 'Noted.', status: 'confirmed' }],
  })

  const events = memory.recall({ generation, limit: 10 })
  console.log(events.map(e => e.text))

  memory.revokeReply('example-r1')
  console.log('after retraction:', memory.recall({ generation, limit: 10 }))
} finally {
  memory.close()
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}
