import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const modes = new Set(['mute', 'forget', 'purge'])
const normId = v => String(v || '').replace(/^qq:/, '').replace(/:in$/, '')

export function isForgotten(file, eventId) {
  try {
    if (!file || !existsSync(file)) return false
    const id = String(eventId || '').replace(/^qq:/, '').replace(/:in$/, '')
    return readFileSync(file, 'utf8').split('\n').some(line => {
      if (!line.trim()) return false
      try { const r = JSON.parse(line); const e = String(r.eventId || '').replace(/^qq:/, '').replace(/:in$/, ''); return e === id && r.mode !== 'restore' } catch { return false }
    })
  } catch { return false }
}

export function appendDecision(file, { eventId, mode, scope = '', at = Date.now(), status = 'done' } = {}) {
  if (!file) throw new Error('forget file required')
  if (!modes.has(String(mode))) throw new Error('bad mode')
  if (!eventId) throw new Error('eventId required')
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify({ eventId: String(eventId), mode: String(mode), scope: String(scope), at: Number(at), status: String(status) }) + '\n', 'utf8')
}

export function previewForget({ hippocampusDb, v2Db, autobioDb, convFile, eventId, owner } = {}) {
  const id = String(eventId || '')
  const out = { eventId: id, source: false, v2Source: 0, v2Rows: 0, autobioCandidates: 0, localConvLines: 0, backups: 'not-touched' }
  try {
    if (hippocampusDb && existsSync(hippocampusDb)) {
      const db = new DatabaseSync(hippocampusDb, { readOnly: true })
      out.source = !!db.prepare('SELECT 1 AS p FROM events WHERE event_id=?').get(id)
      db.close()
    }
  } catch {}
  try {
    if (v2Db && existsSync(v2Db)) {
      const db = new DatabaseSync(v2Db, { readOnly: true })
      const rows = db.prepare("SELECT value FROM meta WHERE key LIKE 'scenev2:%:staging:%'").all()
      out.v2Rows = rows.filter(r => { try { return String(JSON.parse(r.value).eventId) === id } catch { return false } }).length
      const srcRows = db.prepare("SELECT value FROM meta WHERE key LIKE 'scenev2:%:source:%'").all()
      const nid = id.replace(/^qq:/,'').replace(/:in$/,'')
      out.v2Source = srcRows.filter(r => { try { const v=JSON.parse(r.value); return String(v.messageId)===nid || String(v.inboundRef)===id } catch { return false } }).length
      if (out.v2Source) out.source = true
      db.close()
    }
  } catch {}
  try {
    if (autobioDb && existsSync(autobioDb)) {
      const db = new DatabaseSync(autobioDb, { readOnly: true })
      const srows = db.prepare('SELECT DISTINCT candidate_id,event_id FROM sources').all()
      out.autobioCandidates = new Set(srows.filter(r => normId(r.event_id) === normId(id)).map(r => String(r.candidate_id))).size
      db.close()
    }
  } catch {}
  try { if (convFile && existsSync(convFile)) out.localConvLines = readFileSync(convFile,'utf8').split('\n').filter(l => { try { const e=String(JSON.parse(l).eventId||''); return e === id || e === id.replace(/^qq:/,'').replace(/:in$/,'') } catch { return false } }).length } catch {}
  return out
}

export function removeV2Source({ v2Db, eventId } = {}) {
  const id = String(eventId || '')
  if (!v2Db || !existsSync(v2Db)) return 0
  const db = new DatabaseSync(v2Db)
  let n = 0
  try {
    const rows = db.prepare("SELECT key,value FROM meta WHERE key LIKE 'scenev2:%:source:%' OR key LIKE 'scenev2:%:staging:%'").all()
    for (const r of rows) {
      let v
      try { v = JSON.parse(r.value) } catch { continue }
      if (String(v.eventId || '') === id || `qq:${v.messageId}:in` === id) {
        db.prepare('DELETE FROM meta WHERE key=?').run(r.key)
        n++
      }
    }
    return n
  } finally { db.close() }
}

export function removeLocalConvLines({ file, eventId } = {}) {
  const id = String(eventId || '')
  if (!file || !existsSync(file)) return 0
  const lines = readFileSync(file, 'utf8').split('\n')
  const norm = id.replace(/^qq:/, '').replace(/:in$/, '')
  const kept = lines.filter(l => { try { const e=String(JSON.parse(l).eventId || ''); return !(e === id || e === norm) } catch { return true } })
  const removed = lines.length - kept.length
  if (removed) {
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, kept.join('\n'), 'utf8')
    renameSync(tmp, file)
  }
  return removed
}

export function invalidateAutobioEvent({ autobioDb, eventId, reason = 'owner_forgot' } = {}) {
  if (!autobioDb || !existsSync(autobioDb)) return 0
  const db = new DatabaseSync(autobioDb)
  try {
    const ids = db.prepare('SELECT DISTINCT candidate_id,event_id FROM sources').all().filter(r => normId(r.event_id) === normId(eventId)).map(r => r.candidate_id)
    for (const id of ids) db.prepare("UPDATE candidates SET status='invalidated',text='',invalid_reason=?,reviewed_at=? WHERE id=?").run(String(reason), Date.now(), id)
    return ids.length
  } finally { db.close() }
}
