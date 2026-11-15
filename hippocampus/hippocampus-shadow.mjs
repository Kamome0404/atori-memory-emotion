// 海马体影子后端：默认关闭；关闭时零 import/worker/DB。
// 只做 owner 私聊 confirmed exchange 的影子写入，不 recall、不进提示词。
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function createHippocampusShadow({ enabled = false, filePath, ownerUid, onEvent = () => {}, log = () => {}, queueFactory = null } = {}) {
  const owner = String(ownerUid || '')
  let queue = null
  let starting = null
  let closed = false
  let blocked = false
  // Durable process-nonce: restart keeps the same consent binding. Explicit revoke
  // still invalidates; config/owner changes produce a different consent scope.
  const nonceFile = filePath ? `${filePath}.run-nonce` : ''
  function loadRunNonce() {
    try {
      if (nonceFile && existsSync(nonceFile)) {
        const v = readFileSync(nonceFile, 'utf8').trim()
        if (/^[0-9a-f]{32}$/.test(v)) return v
      }
    } catch {}
    const n = randomBytes(16).toString('hex')
    try {
      if (nonceFile) {
        mkdirSync(dirname(nonceFile), { recursive: true })
        try { writeFileSync(nonceFile, n + '\n', { encoding: 'utf8', flag: 'wx' }) }
        catch {
          const v = readFileSync(nonceFile, 'utf8').trim()
          if (/^[0-9a-f]{32}$/.test(v)) return v
        }
      }
    } catch {}
    return n
  }
  let runNonce = enabled ? loadRunNonce() : randomBytes(16).toString('hex')

  function state() {
    return { enabled: !!enabled, owner, ready: !!queue, runNonce, closed, blocked }
  }

  async function ensure(allowBlocked = false) {
    if (!enabled || closed || (blocked && !allowBlocked)) return null
    if (queue) return queue
    if (starting) return starting
    starting = (async () => {
      try {
        let q
        if (typeof queueFactory === 'function') q = await queueFactory({ filePath, onEvent })
        else {
          const { HippocampusWorkerQueue } = await import('./hippocampus-worker-queue.mjs')
          q = new HippocampusWorkerQueue({ filePath, onEvent })
        }
        const ready = await q.waitReady()
        if (!ready || closed) { try { await q.close() } catch {} ; return null }
        queue = q
        log('[海马体] 影子后端已启动（不召回）')
        return q
      } catch (e) {
        log(`[海马体] 影子后端不可用：${String(e?.message || e).slice(0, 120)}`)
        return null
      } finally { starting = null }
    })()
    return starting
  }

  async function call(method, payload, successStatuses = new Set(['committed'])) {
    if (!enabled) return { accepted: false, reason: 'disabled' }
    if (!owner) return { accepted: false, reason: 'owner_missing' }
    if (blocked && method !== 'consentShadow') return { accepted: false, reason: 'reconsent_required' }
    const q = await ensure(method === 'consentShadow')
    if (!q) return { accepted: false, reason: 'unavailable' }
    const sent = q[method]({ ...payload, scope: `private:${owner}`, uid: owner, runNonce })
    if (!sent?.accepted) return { accepted: false, reason: sent?.reason || 'rejected' }
    const result = await sent.result
    if (!result || !successStatuses.has(result.status)) {
      if (result?.status === 'unknown') { try { await q.close() } catch {} ; queue = null; blocked = true }
      return { accepted: false, status: result?.status || 'unknown', not_found: result?.status === 'not_found' }
    }
    if (method === 'consentShadow' && result.status === 'committed') blocked = false
    return { accepted: true, status: result.status }
  }

  async function consent({ granted, revision, commandId, expectedRevision } = {}) {
    return call('consentShadow', { granted: !!granted, revision, commandId, expectedRevision }, new Set(['committed', 'duplicate']))
  }

  async function capture({ messageId, eventAt, incoming, deliveredParts, replyIds } = {}) {
    if (!Array.isArray(deliveredParts) || !Array.isArray(replyIds) || deliveredParts.length !== replyIds.length) {
      return { accepted: false, reason: 'invalid_parts' }
    }
    return call('captureShadow', {
      eventId: `qq:${String(messageId)}:in`, text: String(incoming || ''), at: eventAt,
      confirmedReplies: deliveredParts, replyIds,
    }, new Set(['committed', 'duplicate']))
  }

  async function retract({ eventId, replyId = '' } = {}) {
    return call('retractShadow', { eventId, replyId }, new Set(['committed', 'deleted', 'duplicate']))
  }

  async function close() {
    closed = true
    if (queue) { const q = queue; queue = null; try { await q.close() } catch {} }
  }

  return { consent, capture, retract, close, state }
}
