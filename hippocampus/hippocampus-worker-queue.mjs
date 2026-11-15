// Worker-backed capture queue. The main thread only validates, copies and routes
// messages; all SQLite reads/writes happen in hippocampus-worker.mjs.
// Business success comes from an explicit worker result, never from Promise resolution.
// onEvent is a synchronous observer: exceptions are swallowed, but async rejections
// are NOT handled. Do not pass an async callback or rely on monitoring for correctness.
import { Worker } from 'node:worker_threads'

const DEFAULT_WORKER = new URL('./hippocampus-worker.mjs', import.meta.url)
const RESULTS = new Set(['committed', 'duplicate', 'conflict', 'deleted', 'invalid', 'unauthorized', 'unsupported', 'not_found'])
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
// Test/fault-injection knobs are a fixed allow-list. The authoritative database
// path is added last and can never be overridden by workerData.
const WORKER_DATA_KEYS = new Set(['slowMs', 'crash', 'replyMode', 'replyDelayMs', 'failRecord', 'initFail', 'initFailDelayMs', 'initHang', 'initDelayMs'])

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const scope = String(payload.scope ?? '').trim()
  const uid = String(payload.uid ?? '').trim()
  const eventId = String(payload.eventId ?? '').trim()
  const text = String(payload.text ?? '')
  const at = payload.at
  if (!scope || scope.length > 128 || !uid || uid.length > 256 || !eventId || eventId.length > 256) return null
  if (!text || text.length > 4000 || CONTROL.test(text)) return null
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at < 0) return null
  let confirmedReplies = null
  if (payload.confirmedReplies !== undefined && payload.confirmedReplies !== null) {
    if (!Array.isArray(payload.confirmedReplies) || payload.confirmedReplies.length < 1 || payload.confirmedReplies.length > 8) return null
    confirmedReplies = payload.confirmedReplies.map(item => {
      const part = String(item ?? '')
      if (!part.trim() || part.length > 2000 || CONTROL.test(part)) throw new Error('invalid reply')
      return part
    })
  }
  return { scope, uid, eventId, text, at, confirmedReplies }
}

export class HippocampusWorkerQueue {
  constructor({ filePath, workerFile = DEFAULT_WORKER, capacity = 8, maxInFlight = 1, opTimeoutMs = 5000, startupTimeoutMs = 5000, terminationTimeoutMs = 500, onEvent = () => {}, workerData = {} } = {}) {
    if (!filePath || typeof filePath !== 'string') throw new TypeError('filePath is required')
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1024) throw new TypeError('capacity must be 1..1024')
    if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > capacity) throw new TypeError('maxInFlight must be 1..capacity')
    if (!Number.isSafeInteger(opTimeoutMs) || opTimeoutMs < 1 || opTimeoutMs > 300000) throw new TypeError('opTimeoutMs must be 1..300000')
    if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 300000) throw new TypeError('startupTimeoutMs must be 1..300000')
    if (!Number.isSafeInteger(terminationTimeoutMs) || terminationTimeoutMs < 1 || terminationTimeoutMs > 300000) throw new TypeError('terminationTimeoutMs must be 1..300000')
    if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function')
    this.filePath = filePath
    this.capacity = capacity
    this.maxInFlight = maxInFlight
    this.opTimeoutMs = opTimeoutMs
    this.startupTimeoutMs = startupTimeoutMs
    this.terminationTimeoutMs = terminationTimeoutMs
    this.workerFile = workerFile
    this.onEvent = onEvent
    this.closed = false
    this.failed = false
    this.aborting = false
    this.ready = false
    this.workerExited = false
    this.nextId = 1
    this.queue = []
    this.inFlight = new Map()
    this.counts = { accepted: 0, committed: 0, duplicate: 0, conflict: 0, deleted: 0, invalid: 0, unknown: 0, rejected: 0 }
    this.closePromise = null
    this.terminationPromise = null
    this.startupTimer = null
    let resolveReady
    this.readyPromise = new Promise(resolve => { resolveReady = resolve })
    this.resolveReady = resolveReady
    const safeData = {}
    for (const key of WORKER_DATA_KEYS) if (Object.prototype.hasOwnProperty.call(workerData, key)) safeData[key] = workerData[key]
    const authoritative = { ...safeData, filePath }
    try {
      this.worker = new Worker(workerFile, { workerData: authoritative })
    } catch {
      this.failed = true
      this.closed = true
      this.worker = null
      this.terminationPromise = Promise.resolve(false)
      this.resolveReady(false)
      return
    }
    this.worker.on('message', message => this._onMessage(message))
    this.worker.on('error', () => this._failWorker())
    this.worker.on('exit', () => this._onExit())
    this.startupTimer = setTimeout(() => this._onStartupTimeout(), startupTimeoutMs)
  }

  waitReady() { return this.readyPromise }

  _clearStartup() {
    if (this.startupTimer) { clearTimeout(this.startupTimer); this.startupTimer = null }
  }

  _onMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'ready') {
      this._clearStartup()
      if (this.closed || this.failed) {
        this.resolveReady(false)
        return
      }
      this.ready = true
      this.resolveReady(true)
      this._pump()
      return
    }
    if (message.type === 'init_error') {
      this._failWorker()
      return
    }
    if (message.type === 'started' || message.type === 'pong') {
      try { this.onEvent({ type: message.type === 'pong' ? 'pong' : 'record_started', id: String(message.id || '') }) } catch {}
      return
    }
    if (message.type !== 'result' || !message.id) return
    const id = String(message.id)
    const ticket = this.inFlight.get(id)
    if (!ticket) return // late, duplicate or wrong-id reply
    // An unrecognised/missing status cannot prove the worker finished the job.
    // Do not free capacity and keep dispatching; stop and terminate.
    if (typeof message.status !== 'string' || !RESULTS.has(message.status)) {
      this._abortProtocol()
      return
    }
    this._settle(ticket, message.status)
  }

  _onStartupTimeout() {
    if (this.ready || this.failed || this.closed) return
    this.failed = true
    this.closed = true
    this.resolveReady(false)
    for (const ticket of this.queue.splice(0)) this._reject(ticket)
    this.terminationPromise = this._ensureTermination()
  }

  _onExit() {
    this.workerExited = true
    this._clearStartup()
    if (this.terminationPromise || this.closePromise || this.closed) {
      this.resolveReady(false)
      return
    }
    this._failWorker()
  }

  _failWorker() {
    if (this.failed) return
    this.failed = true
    this.closed = true
    this.ready = false
    this._clearStartup()
    this.resolveReady(false)
    for (const ticket of this.queue.splice(0)) this._reject(ticket)
    for (const ticket of [...this.inFlight.values()]) this._settle(ticket, 'unknown', 'worker_lost')
    // Never overwrite an in-progress termination with a second one.
    this.terminationPromise = this._ensureTermination()
  }

  enqueue(payload) {
    if (this.closed || this.failed) {
      this.counts.rejected += 1
      return { accepted: false, reason: this.failed ? 'worker_unavailable' : 'closed', result: Promise.resolve({ status: 'rejected', reason: this.failed ? 'worker_unavailable' : 'closed' }) }
    }
    let normalized
    try { normalized = normalizePayload(payload) } catch { normalized = null }
    if (!normalized) {
      this.counts.invalid += 1
      return { accepted: false, reason: 'invalid', result: Promise.resolve({ status: 'invalid', reason: 'invalid_payload' }) }
    }
    if (this.queue.length + this.inFlight.size >= this.capacity) {
      this.counts.rejected += 1
      return { accepted: false, reason: 'full', result: Promise.resolve({ status: 'rejected', reason: 'full' }) }
    }
    const id = `capture-${this.nextId++}`
    let resolveResult
    const result = new Promise(resolve => { resolveResult = resolve })
    const ticket = { id, op: 'capture', payload: normalized, result, resolveResult, settled: false, timer: null }
    this.queue.push(ticket)
    this.counts.accepted += 1
    this._pump()
    return { accepted: true, id, result }
  }

  _submit(op, payload) {
    if (this.closed || this.failed) {
      this.counts.rejected += 1
      return { accepted: false, reason: this.failed ? 'worker_unavailable' : 'closed', result: Promise.resolve({ status: 'rejected', reason: this.failed ? 'worker_unavailable' : 'closed' }) }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.counts.invalid += 1
      return { accepted: false, reason: 'invalid', result: Promise.resolve({ status: 'invalid', reason: 'invalid_payload' }) }
    }
    if (this.queue.length + this.inFlight.size >= this.capacity) {
      this.counts.rejected += 1
      return { accepted: false, reason: 'full', result: Promise.resolve({ status: 'rejected', reason: 'full' }) }
    }
    const id = `op-${this.nextId++}`
    let resolveResult
    const result = new Promise(resolve => { resolveResult = resolve })
    const ticket = { id, op, payload, result, resolveResult, settled: false, timer: null }
    this.queue.push(ticket)
    this.counts.accepted += 1
    this._pump()
    return { accepted: true, id, result }
  }

  captureShadow(payload) { return this._submit('capture_shadow', payload) }
  retractShadow(payload) { return this._submit('retract_shadow', payload) }
  consentShadow(payload) { return this._submit('consent_shadow', payload) }

  _pump() {
    if (!this.ready || this.failed || this.closed) return
    while (this.queue.length && this.inFlight.size < this.maxInFlight) {
      const ticket = this.queue.shift()
      this.inFlight.set(ticket.id, ticket)
      ticket.timer = setTimeout(() => this._abortOnTimeout(ticket), this.opTimeoutMs)
      try {
        this.worker.postMessage({ type: ticket.op, id: ticket.id, payload: ticket.payload })
      } catch {
        // Delivery failed: the current job was attempted (unknown); queued jobs
        // were never handed over (rejected). Stop dispatching and terminate.
        this._stopAndTerminate('post_failed')
        break
      }
    }
  }

  _stopAndTerminate(reason = 'timeout') {
    if (this.aborting || this.failed) return
    this.aborting = true
    this.closed = true
    this._clearStartup()
    for (const pending of [...this.inFlight.values()]) this._settle(pending, 'unknown', reason)
    for (const queued of this.queue.splice(0)) this._reject(queued)
    this.terminationPromise = this._ensureTermination()
  }

  _abortOnTimeout() {
    if (this.aborting || this.failed) return
    this._stopAndTerminate()
  }

  _abortProtocol() {
    this._stopAndTerminate('invalid_result')
  }

  _settle(ticket, status, reason = '') {
    if (!ticket || ticket.settled) return
    ticket.settled = true
    if (ticket.timer) { clearTimeout(ticket.timer); ticket.timer = null }
    this.inFlight.delete(ticket.id)
    const key = RESULTS.has(status) || status === 'unknown' ? status : 'unknown'
    this.counts[key] = (this.counts[key] || 0) + 1
    ticket.resolveResult(reason ? { status: key, id: ticket.id, reason } : { status: key, id: ticket.id })
    if (key === 'unknown') this._stopAndTerminate('unknown_result')
    else this._pump()
  }

  _reject(ticket) {
    if (!ticket || ticket.settled) return
    ticket.settled = true
    if (ticket.timer) { clearTimeout(ticket.timer); ticket.timer = null }
    this.counts.rejected += 1
    ticket.resolveResult({ status: 'rejected', id: ticket.id, reason: 'never_submitted' })
  }

  stats() {
    return {
      state: this.failed ? 'failed' : (this.closed ? 'closed' : (this.ready ? 'open' : 'starting')),
      capacity: this.capacity,
      maxInFlight: this.maxInFlight,
      queued: this.queue.length,
      inFlight: this.inFlight.size,
      counts: { ...this.counts },
    }
  }

  _ensureTermination() {
    if (!this.terminationPromise) this.terminationPromise = this._terminateWorker()
    return this.terminationPromise
  }

  close({ timeoutMs = 1000 } = {}) {
    if (this.closePromise) return this.closePromise
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be non-negative')
    this.closePromise = this._close(timeoutMs)
    return this.closePromise
  }

  async _close(timeoutMs) {
    this.closed = true
    this._clearStartup()
    if (!this.ready || this.failed) this.resolveReady(false)
    // Never-submitted jobs are rejected immediately; in-flight jobs keep waiting.
    for (const ticket of this.queue.splice(0)) this._reject(ticket)
    const pending = [...this.inFlight.values()]
    if (pending.length && !this.aborting) {
      let timer
      const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) })
      await Promise.race([Promise.all(pending.map(ticket => ticket.result)), timeout])
      clearTimeout(timer)
      for (const ticket of [...this.inFlight.values()]) this._settle(ticket, 'unknown', 'close_timeout')
    }
    const terminated = await this._ensureTermination()
    const report = this.stats()
    report.termination = terminated ? 'terminated' : 'termination_unknown'
    return report
  }

  async _terminateWorker() {
    if (!this.worker) return this.workerExited
    const worker = this.worker
    this.worker = null
    try { worker.postMessage({ type: 'close' }) } catch {}
    return await new Promise(resolve => {
      let done = false
      const finish = (value) => { if (done) return; done = true; resolve(value) }
      const timer = setTimeout(() => finish(false), this.terminationTimeoutMs)
      worker.once('exit', () => { this.workerExited = true; clearTimeout(timer); finish(true) })
      try {
        const termination = worker.terminate()
        if (termination && typeof termination.then === 'function') termination.then(() => { clearTimeout(timer); finish(true) }).catch(() => { clearTimeout(timer); finish(false) })
        else { clearTimeout(timer); finish(true) }
      } catch {
        clearTimeout(timer)
        finish(false)
      }
    })
  }
}

export default HippocampusWorkerQueue
