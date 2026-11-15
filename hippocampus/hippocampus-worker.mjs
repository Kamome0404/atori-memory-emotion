// SQLite worker: the main thread never reads or writes the database directly.
// Only categories are returned; message text and raw database errors never leave the worker.
import { parentPort, workerData } from 'node:worker_threads'
import { HippocampusSqlite, ConflictError, InputError, ScopeError } from './hippocampus-sqlite.mjs'

const dbPath = workerData?.filePath
const slowMs = Number(workerData?.slowMs) || 0
const crash = String(workerData?.crash || '')
const replyMode = String(workerData?.replyMode || '')
const replyDelayMs = Number(workerData?.replyDelayMs) || 0
const initFailDelayMs = Number(workerData?.initFailDelayMs) || 0
const initFail = Boolean(workerData?.initFail)
const initDelayMs = Number(workerData?.initDelayMs) || 0
const initHang = Boolean(workerData?.initHang)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function classify(error) {
  if (error instanceof ConflictError) return 'conflict'
  if (error instanceof InputError || error instanceof ScopeError) return 'invalid'
  return 'unknown'
}

async function boot() {
  // Test-only startup wedge: stay alive, never send ready. The queue's startup
  // timeout is responsible for rejecting queued work and terminating this worker.
  if (initHang) {
    setInterval(() => {}, 1000)
    return
  }
  if (initFail) {
    if (initFailDelayMs > 0) await sleep(initFailDelayMs)
    parentPort.postMessage({ type: 'init_error' })
    process.exit(1)
  }
  let store
  try {
    if (!dbPath) throw new Error('filePath required')
    store = new HippocampusSqlite({ filePath: dbPath })
  } catch {
    parentPort.postMessage({ type: 'init_error' })
    process.exit(1)
  }
  if (initDelayMs > 0) await sleep(initDelayMs)
  parentPort.postMessage({ type: 'ready' })

  function statusOf(result) {
    if (result && result.deleted) return 'deleted'
    if (result && result.unauthorized) return 'unauthorized'
    if (result && result.not_found) return 'not_found'
    if (result && result.unsupported_reply) return 'unsupported'
    if (result && result.accepted) return 'committed'
    if (result && result.duplicate) return 'duplicate'
    return 'unknown'
  }

  parentPort.on('message', async (message) => {
    if (!message || !['capture', 'capture_shadow', 'retract_shadow', 'consent_shadow'].includes(message.type)) return
    const id = message.id
    if (crash === 'before_commit') process.exit(1)
    try { if (slowMs > 0) await sleep(slowMs) } catch { process.exit(1) }
    try { parentPort.postMessage({ type: 'started', id }) } catch {}
    let status
    try {
      if (workerData?.failRecord) throw new Error('synthetic database failure')
      let result
      if (message.type === 'capture') result = store.record(message.payload)
      else if (message.type === 'capture_shadow') result = store.captureShadow(message.payload)
      else if (message.type === 'retract_shadow') result = store.retractShadow(message.payload)
      else result = store.consentShadow(message.payload)
      status = statusOf(result)
    } catch (error) {
      status = classify(error)
    }
    if (crash === 'after_commit') process.exit(1)
    if (replyDelayMs > 0) await new Promise(resolve => setTimeout(resolve, replyDelayMs))
    if (replyMode === 'undefined') {
      parentPort.postMessage({ type: 'result', id })
      return
    }
    if (replyMode === 'wrong_id') {
      parentPort.postMessage({ type: 'result', id: `wrong-${id}`, status })
      return
    }
    if (replyMode === 'unknown_status') {
      parentPort.postMessage({ type: 'result', id, status: 'looks-ok' })
      return
    }
    parentPort.postMessage({ type: 'result', id, status })
    if (replyMode === 'late_duplicate') setTimeout(() => { try { parentPort.postMessage({ type: 'result', id, status }) } catch {} }, 80)
  })

  parentPort.on('message', (message) => {
    if (message && message.type === 'ping') {
      parentPort.postMessage({ type: 'pong', id: String(message.id || '') })
      return
    }
    if (message && message.type === 'close') {
      try { store.close() } catch {}
      process.exit(0)
    }
  })
}

boot()
