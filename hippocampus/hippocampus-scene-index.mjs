// v2 scene index: S1 only owns an empty, owner-scoped head in the existing
// meta table. No source scan, no rows, no publication, no new table.
import { readFileSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { openHippocampusSqlite } from './hippocampus-sqlite.mjs'
import { parseExplicitTimeCue } from './memory-time-cue.mjs'
import { isForgotten } from './forget-closure.mjs'
import { memoryKey, validateMemoryState, stateWeight } from './memory-state-contract.mjs'

const SCHEMA = 1
const HEAD_VERSION = 1
const PREFIX = 'scenev2:'

function ownerOf(owner) {
  const s = String(owner || '').trim()
  if (!/^[0-9]{1,20}$/.test(s)) throw new Error('owner must be a numeric uid')
  return s
}

export function sceneHeadKey(owner) { return `${PREFIX}${ownerOf(owner)}:head` }
export function scenePrefix(owner) { return `${PREFIX}${ownerOf(owner)}:` }

function readHead(db, owner) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(sceneHeadKey(owner))
  if (!row) return null
  let head
  try { head = JSON.parse(row.value) } catch { throw new Error('scene index head corrupt') }
  if (!head || head.schema !== SCHEMA || String(head.owner) !== String(owner) || !Number.isSafeInteger(head.generation)) throw new Error('scene index head incompatible')
  return head
}

function openDb(dbPath) {
  if (!dbPath) throw new Error('dbPath required')
  // openHippocampusSqlite validates the v1 schema before we touch meta.
  return openHippocampusSqlite({ filePath: dbPath })
}

export function initSceneIndex({ dbPath, owner, now = Date.now() } = {}) {
  const uid = ownerOf(owner)
  const h = openDb(dbPath)
  try {
    const cur = readHead(h.db, uid)
    if (cur) return { ok: true, created: false, head: cur }
    const head = { schema: SCHEMA, version: HEAD_VERSION, owner: uid, generation: 0, status: 'empty', createdAt: Number(now), updatedAt: Number(now) }
    h.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(sceneHeadKey(uid), JSON.stringify(head))
    return { ok: true, created: true, head }
  } finally { try { h.close() } catch {} }
}

export function readSceneIndexHead({ dbPath, owner } = {}) {
  const uid = ownerOf(owner)
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    return { ok: true, head: readHead(db, uid) }
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 120) } }
  finally { try { db?.close() } catch {} }
}


const FEELINGS = new Set(['开心','难过','生气','害怕','安心','累','兴奋','平静','委屈','紧张','喜欢','讨厌','尴尬','愧疚','期待','失落','感动','无聊','幸福','焦虑','心疼','放松','害羞','烦','后悔','惊讶'])
const CUE_START = /^\s*(?:〔|【)?\s*线索(?=\s|[：:＝=]|$)/
const FIELD = /(人物|我的感受)\s*[=＝:：]\s*([^;；\n〕】]{1,40})/g

function digestText(v) { return createHash('sha256').update(String(v)).digest('hex') }
function taskScopeKey(scope, raw) { return `${scope}:${raw}` }
function rawEventId(eventId) { const m=String(eventId||'').match(/^qq:([^:]+):in$/); return m?m[1]:'' }
function parseMarker(text) {
  const first = String(text||'').split(/\r?\n/).map(x=>x.trim()).find(x=>x) || ''
  if (!CUE_START.test(first)) return null
  const fields = {}
  let m
  FIELD.lastIndex = 0
  while ((m=FIELD.exec(first)) !== null) {
    const key=m[1], val=String(m[2]).trim()
    if (fields[key] !== undefined) {
      if (fields[key] !== val) fields[key] = ''
      continue
    }
    fields[key]=val
  }
  let person = fields['人物'] || ''
  let feeling = fields['我的感受'] || ''
  if (!FEELINGS.has(feeling)) feeling=''
  if (!person) person=''
  if (!person && !feeling) return null
  return { person: person || null, feeling: feeling || null, personOffset: person ? first.indexOf(person) : null, feelingOffset: feeling ? first.indexOf(feeling) : null }
}

function sourceMetaKey(account, scope, messageId) { return `scenev2:${String(scope).replace(/^private:/,'')}:source:${account}:${scope}:${messageId}` }
function sourcePrefix(owner) { return `${scenePrefix(owner)}source:` }
function sourceRowKey(account, scope, messageId, inboundRef) { return `${'scenev2:'}${String(scope).replace(/^private:/,'')}:source:${account}:${scope}:${messageId}:${digestText(inboundRef).slice(0,8)}` }

/** S2-P0: early inbound observation, independent of v1 confirmed capture. */
export function recordInboundObserved({ dbPath, owner, account = 'onebot', scope, messageId, inboundRef = '', at = Date.now(), text = '', mediaType = '', authorizationGeneration = null } = {}) {
  const uid=ownerOf(owner)
  const sc=String(scope || `private:${uid}`)
  if (sc !== `private:${uid}`) throw new Error('scope must be private:owner')
  const mid=String(messageId||'').trim()
  if (!/^[0-9]{1,20}$/.test(mid)) throw new Error('valid messageId required')
  const body=String(text||'').trim()
  const type=String(mediaType||'').trim().slice(0,40)
  if (!body && !type) throw new Error('text or mediaType required')
  const ref=String(inboundRef || `qq:${mid}:in`)
  if (ref !== `qq:${mid}:in`) throw new Error('inboundRef must match messageId')
  const h=openDb(dbPath); const db=h.db
  try {
    const key=sourceRowKey(account,sc,mid,ref)
    const val={schema:SCHEMA,version:HEAD_VERSION,kind:'inbound_observed',owner:uid,account:String(account),scope:sc,messageId:mid,inboundRef:ref,at:Number(at),text:body,mediaType:type,authorizationGeneration:authorizationGeneration == null ? null : Number(authorizationGeneration),digest:digestText(JSON.stringify({body,type,ref,at:Number(at)}))}
    const prior=db.prepare('SELECT value FROM meta WHERE key=?').get(key)
    if (prior) {
      let p=null; try{p=JSON.parse(prior.value)}catch{}
      if (p && p.kind==='inbound_observed' && p.digest===val.digest) return {accepted:false,duplicate:true}
      return {accepted:false,conflict:true}
    }
    const tomb=db.prepare('SELECT 1 AS present FROM tombstones WHERE scope=? AND uid=? AND event_id=?').get(sc,uid,`qq:${mid}:in`)
    if (tomb) return {accepted:false,retracted:true}
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify(val))
    return {accepted:true,duplicate:false,key}
  } finally { try{h.close()}catch{} }
}

function readJsonFile(file) {
  if(!file || !existsSync(file)) return []
  try { return JSON.parse(readFileSync(file,'utf8')) } catch { return [] }
}
function readExperience(file, owner, scope) {
  if(!file || !existsSync(file)) return []
  const byId=new Map(), invalidated=new Set()
  try {
    for(const line of readFileSync(file,'utf8').split('\n')) {
      if(!line.trim()) continue
      let o; try{o=JSON.parse(line)}catch{continue}
      const p=o?.payload || {}
      if((o?.type==='invalidated'||p.type==='invalidated') && (p.recordId||o.recordId)) { invalidated.add(String(p.recordId||o.recordId)); continue }
      const r=p.record
      if(!r || r.scope!==scope || String(r.uid)!==String(owner) || r.invalidatedAt != null) continue
      const prev=byId.get(String(r.id))
      if(!prev || Number(r.revision||0) >= Number(prev.revision||0)) byId.set(String(r.id),r)
    }
  } catch {}
  for(const id of invalidated) byId.delete(id)
  return [...byId.values()]
}
function sourceRows(db, owner, account = '') {
  const rows=db.prepare(`SELECT e.event_id AS eventId,e.scope,e.uid,e.at,e.text,e.importance FROM events e
    WHERE e.scope=? AND e.uid=? AND EXISTS(SELECT 1 FROM refs r WHERE r.scope=e.scope AND r.uid=e.uid AND r.event_id=e.event_id AND r.direction='in')
    AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.scope=e.scope AND t.uid=e.uid AND t.event_id=e.event_id)
    ORDER BY e.at DESC, e.event_id ASC LIMIT 500`).all(`private:${owner}`, String(owner))
  const seen=new Set(rows.map(r=>String(r.eventId)))
  try {
    const v2=db.prepare("SELECT key,value FROM meta WHERE key LIKE ?").all(`${scenePrefix(owner)}source:%`)
    for(const r of v2){
      let v=null; try{v=JSON.parse(r.value)}catch{continue}
      if(!v || v.kind!=='inbound_observed' || String(v.owner)!==String(owner)) continue
      if(account && String(v.account||'')!==String(account)) continue
      const eid=`qq:${v.messageId}:in`
      if(seen.has(eid)) continue
      const tomb=db.prepare('SELECT 1 AS present FROM tombstones WHERE scope=? AND uid=? AND event_id=?').get(v.scope,String(owner),eid)
      if(tomb) continue
      seen.add(eid)
      rows.push({eventId:eid,scope:v.scope,uid:String(owner),at:Number(v.at),text:String(v.text||''),importance:null,sourceKind:'inbound_observed',mediaType:String(v.mediaType||''),account:String(v.account||''),inboundRef:String(v.inboundRef||'')})
    }
  } catch {}
  rows.sort((a,b)=>Number(b.at)-Number(a.at)||String(a.eventId).localeCompare(String(b.eventId)))
  return rows.slice(0,500)
}
function sourceDigest(db, owner, tasksFile, experienceFile) {
  const rows=db.prepare('SELECT event_id,scope,uid,at,text FROM events WHERE scope=? AND uid=? ORDER BY event_id').all(`private:${owner}`, String(owner))
  const v2=db.prepare('SELECT key,value FROM meta WHERE key LIKE ? ORDER BY key').all(`${scenePrefix(owner)}source:%`)
  const files=[tasksFile, experienceFile].map(f => { try{return f&&existsSync(f)?readFileSync(f,'utf8'):''}catch{return ''} })
  return digestText(JSON.stringify({rows, v2, files, owner:String(owner)}))
}
function stagingPrefix(owner) { return `${scenePrefix(owner)}staging:` }
function stagingHeadKey(owner) { return `${stagingPrefix(owner)}head` }
function stagingRowKey(owner, generation, eventId) { return `${stagingPrefix(owner)}${generation}:${Buffer.from(String(eventId)).toString('base64url')}` }
function deleteStaging(db, owner, generation = null) {
  const prefix=stagingPrefix(owner)
  if(generation == null) db.prepare('DELETE FROM meta WHERE key LIKE ?').run(`${prefix}%`)
  else {
    db.prepare('DELETE FROM meta WHERE key=?').run(stagingHeadKey(owner))
    db.prepare('DELETE FROM meta WHERE key LIKE ?').run(`${prefix}${generation}:%`)
  }
}
function deleteStagingForRestage(db, owner, publishedGeneration) {
  const prefix=stagingPrefix(owner)
  db.prepare('DELETE FROM meta WHERE key=?').run(stagingHeadKey(owner))
  const keep=Number(publishedGeneration||0)
  for(const r of db.prepare('SELECT key FROM meta WHERE key LIKE ?').all(`${prefix}%`)) {
    const m=String(r.key).slice(prefix.length).match(/^(\d+):/)
    if(!m || Number(m[1])!==keep) db.prepare('DELETE FROM meta WHERE key=?').run(r.key)
  }
}

/** S2 offline staging. Reads at most 500 inbound events, writes only meta staging. */
export function stageSceneIndex({ dbPath, owner, spaceTasksFile = '', experienceFile = '', now = Date.now(), batch = 100, onBatch = null } = {}) {
  const uid = ownerOf(owner)
  const h = openDb(dbPath)
  const db = h.db
  let generation = null
  try {
    const head = readHead(db, uid)
    if (!head) throw new Error('scene index head required (init first)')
    generation = Number(head.generation || 0) + 1
    const source = sourceDigest(db, uid, spaceTasksFile, experienceFile)
    const tasks = readJsonFile(spaceTasksFile)
    const taskList = Array.isArray(tasks) ? tasks : (Array.isArray(tasks?.tasks) ? tasks.tasks : [])
    const taskByEvent = new Map(taskList.filter(t => t && t.status === 'finished' && t.eventKey).map(t => [String(t.eventKey), t]))
    const experiences = readExperience(experienceFile, uid, `private:${uid}`)
    const recsByTask = new Map()
    for (const r of experiences) {
      const tid=String(r.taskId||'')
      if(!tid) continue
      if(!recsByTask.has(tid)) recsByTask.set(tid, [])
      recsByTask.get(tid).push(r)
    }
    deleteStagingForRestage(db, uid, head.generation)
    const headRow = { schema: SCHEMA, version: HEAD_VERSION, owner: uid, generation, status: 'building', sourceDigest: source, startedAt: Number(now), count: 0 }
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(stagingHeadKey(uid), JSON.stringify(headRow))
    const rows = sourceRows(db, uid)
    let written=0
    for (let start=0; start<rows.length; start+=Math.max(1, Math.min(100, Number(batch)||100))) {
      for (const row of rows.slice(start, start+Math.max(1, Math.min(100, Number(batch)||100)))) {
        const live = row.sourceKind === 'inbound_observed'
          ? { present: 1 }
          : db.prepare('SELECT 1 AS present FROM events WHERE scope=? AND uid=? AND event_id=?').get(row.scope,row.uid,row.eventId)
        const tomb = db.prepare('SELECT 1 AS present FROM tombstones WHERE scope=? AND uid=? AND event_id=?').get(row.scope,row.uid,row.eventId)
        if (!live || tomb) throw new Error('source_changed')
        const marker = parseMarker(row.text)
        const raw = rawEventId(row.eventId)
        const task = raw ? taskByEvent.get(taskScopeKey(row.scope, raw)) : null
        let scene = null
        if (task && task.promiseId) {
          const recs = recsByTask.get(String(task.promiseId)) || []
          const rec = recs.find(x => {
            const refs = x.sourceRefs || []
            const eventOk = refs.some(ref => ref.kind === 'event' && String(ref.eventId) === raw && String(ref.scope || row.scope) === row.scope)
            const sessionOk = refs.some(ref => ref.kind === 'session' && String(ref.sessionId || '') && String(ref.sessionId) === String(x.sessionId || ''))
            return eventOk && sessionOk
          })
          if (rec) scene = { taskId: String(task.promiseId), sessionId: String(rec.sessionId || ''), scenarioKey: String(rec.scenarioKey || '') }
        }
        const cue = {
          schema: SCHEMA, version: HEAD_VERSION, owner: uid, generation, eventId: String(row.eventId), scope: String(row.scope), uid: String(row.uid), at: Number(row.at),
          textDigest: digestText(row.text), mediaType: String(row.mediaType || ''), sourceKind: String(row.sourceKind || 'v1_event'), account: String(row.account || ''), inboundRef: String(row.inboundRef || ''), person: marker?.person || null, feeling: marker?.feeling || null,
          personOffset: marker ? Number(marker.personOffset) : null, feelingOffset: marker ? Number(marker.feelingOffset) : null,
          scene, sourceDigest: source,
        }
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(stagingRowKey(uid,generation,row.eventId), JSON.stringify(cue))
        written++
      }
      if (typeof onBatch === 'function') onBatch({ generation, written, batchStart: start })
    }
    const after = sourceDigest(db, uid, spaceTasksFile, experienceFile)
    if (after !== source) { deleteStaging(db, uid, generation); return { ok: false, error: 'source_changed', generation, written: 0 } }
    const cur = JSON.parse(db.prepare('SELECT value FROM meta WHERE key=?').get(stagingHeadKey(uid)).value)
    cur.status='ready'; cur.count=written; cur.completedAt=Number(now); cur.updatedAt=Number(now)
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(stagingHeadKey(uid), JSON.stringify(cur))
    return { ok: true, generation, written, status: 'ready', headChanged: false }
  } catch (e) {
    try { if (generation != null) deleteStaging(db, uid, generation) } catch {}
    throw e
  } finally { try { h.close() } catch {} }
}


function sourceRowPresent(db, owner, row) {
  if (row.sourceKind === 'inbound_observed') {
    const keys=db.prepare("SELECT key,value FROM meta WHERE key LIKE ?").all(`${scenePrefix(owner)}source:%`)
    const raw=rawEventId(row.eventId)
    for(const r of keys){ try{const v=JSON.parse(r.value); if(String(v.messageId)===String(raw) && String(v.scope)===String(row.scope) && String(v.account||'')===String(row.account||'') && String(v.inboundRef||'')===String(row.inboundRef||'')){ return true }}catch{} }
    return false
  }
  const live=db.prepare('SELECT 1 AS present FROM events WHERE scope=? AND uid=? AND event_id=?').get(row.scope,String(owner),row.eventId)
  return !!live
}
function sourceRowBlocked(db, owner, row) {
  const tomb=db.prepare('SELECT 1 AS present FROM tombstones WHERE scope=? AND uid=? AND event_id=?').get(row.scope,String(owner),row.eventId)
  return !!tomb
}
function readPublishedRows(db, owner, generation) {
  const rows=db.prepare("SELECT key,value FROM meta WHERE key LIKE ?").all(`${stagingPrefix(owner)}${generation}:%`)
  return rows.map(r=>{try{return JSON.parse(r.value)}catch{return null}}).filter(Boolean)
}

/** S3: validate then atomically switch head to ready staging generation. */

export function setSceneGate({ dbPath, owner, open, reason = '', now = Date.now() } = {}) {
  const uid=ownerOf(owner); const h=openDb(dbPath)
  try {
    const key=`${scenePrefix(uid)}gate`
    h.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify({schema:SCHEMA,owner:uid,open:open===true,reason:String(reason||'').slice(0,120),at:Number(now)}))
    return {ok:true,open:open===true}
  } finally { try{h.close()}catch{} }
}
export function readSceneGate({ dbPath, owner } = {}) {
  const uid=ownerOf(owner); let db
  try { db=new DatabaseSync(dbPath,{readOnly:true}); const r=db.prepare('SELECT value FROM meta WHERE key=?').get(`${scenePrefix(uid)}gate`); return r?{ok:true,gate:JSON.parse(r.value)}:{ok:true,gate:null} }
  catch(e){ return {ok:false,error:String(e?.message||e)} }
  finally{ try{db?.close()}catch{} }
}

export function publishSceneIndex({ dbPath, owner, expectedGeneration = null, spaceTasksFile = '', experienceFile = '', now = Date.now(), openGate = false } = {}) {
  const uid=ownerOf(owner)
  const h=openDb(dbPath); const db=h.db
  try {
    db.exec('BEGIN IMMEDIATE')
    const head=readHead(db,uid)
    if(!head) throw new Error('scene index head required')
    const srow=db.prepare('SELECT value FROM meta WHERE key=?').get(stagingHeadKey(uid))
    if(!srow) throw new Error('staging_not_ready')
    let staging=null; try{staging=JSON.parse(srow.value)}catch{throw new Error('staging_corrupt')}
    if(!staging || staging.status!=='ready') throw new Error('staging_not_ready')
    if(expectedGeneration != null && Number(expectedGeneration)!==Number(staging.generation)) throw new Error('generation_mismatch')
    if(Number(staging.generation)!==Number(head.generation)+1) throw new Error('generation_not_next')
    if(!spaceTasksFile || !experienceFile) throw new Error('source_files_required')
    const current=sourceDigest(db,uid,spaceTasksFile,experienceFile)
    if(current!==staging.sourceDigest) throw new Error('source_changed')
    const rows=readPublishedRows(db,uid,staging.generation)
    if(Number(staging.count) !== rows.length) throw new Error('staging_count_mismatch')
    for(const row of rows){
      if(!sourceRowPresent(db,uid,row) || sourceRowBlocked(db,uid,row)) throw new Error('source_changed')
    }
    const next={...head,generation:Number(staging.generation),status:'published',sourceDigest:String(staging.sourceDigest||''),count:rows.length,publishedAt:Number(now),updatedAt:Number(now)}
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(sceneHeadKey(uid),JSON.stringify(next))
    const gateRow=db.prepare('SELECT value FROM meta WHERE key=?').get(`${scenePrefix(uid)}gate`)
    let gateOpen=openGate===true
    try { if(gateRow){ const g=JSON.parse(gateRow.value); gateOpen = !!(g && g.open===true) } } catch { gateOpen=false }
    if(gateOpen) db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`${scenePrefix(uid)}gate`,JSON.stringify({schema:SCHEMA,owner:uid,open:true,reason:'published',at:Number(now)}))
    db.exec('COMMIT')
    return {ok:true,head:next,rows:rows.length}
  } catch(e) { try{db.exec('ROLLBACK')}catch{}; return {ok:false,error:String(e?.message||e)} }
  finally { try{h.close()}catch{} }
}

/** S3: drop rows whose source became tombstoned/absent and update head count. */
export function reconcileSceneIndex({ dbPath, owner, now = Date.now() } = {}) {
  const uid=ownerOf(owner)
  const h=openDb(dbPath); const db=h.db
  try {
    db.exec('BEGIN IMMEDIATE')
    const head=readHead(db,uid)
    if(!head) { db.exec('COMMIT'); return {ok:true,head:null,removed:0} }
    const prefix=`${stagingPrefix(uid)}${Number(head.generation)}:`
    const rows=readPublishedRows(db,uid,Number(head.generation))
    let removed=0
    for(const row of rows){
      if(!sourceRowPresent(db,uid,row) || sourceRowBlocked(db,uid,row)) {
        const key=`${prefix}${Buffer.from(String(row.eventId)).toString('base64url')}`
        removed += Number(db.prepare('DELETE FROM meta WHERE key=?').run(key).changes||0)
      }
    }
    const count=readPublishedRows(db,uid,Number(head.generation)).length
    const next={...head,count,updatedAt:Number(now)}
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(sceneHeadKey(uid),JSON.stringify(next))
    db.exec('COMMIT')
    return {ok:true,head:next,removed}
  } catch(e){ try{db.exec('ROLLBACK')}catch{}; return {ok:false,error:String(e?.message||e)} }
  finally { try{h.close()}catch{} }
}


function buildSourceMap(db, owner) {
  const map=new Map()
  for(const r of db.prepare("SELECT value FROM meta WHERE key LIKE ?").all(`${scenePrefix(owner)}source:%`)){
    try{const v=JSON.parse(r.value); if(v.kind==='inbound_observed') map.set(String(v.messageId)+'|'+String(v.account||'')+'|'+String(v.inboundRef||''),v)}catch{}
  }
  return map
}
function sourceText(db, owner, row, sourceMap = null) {
  if (row.sourceKind === 'inbound_observed') {
    const raw=rawEventId(row.eventId)
    if(sourceMap){ const v=sourceMap.get(String(raw)+'|'+String(row.account||'')+'|'+String(row.inboundRef||'')); if(v) return {text:String(v.text||''),mediaType:String(v.mediaType||'')}; return null }
    const rows=db.prepare("SELECT value FROM meta WHERE key LIKE ?").all(`${scenePrefix(owner)}source:%`)
    for(const r of rows){ try{const v=JSON.parse(r.value); if(String(v.messageId)===String(raw) && String(v.account||'')===String(row.account||'') && String(v.inboundRef||'')===String(row.inboundRef||'')) return {text:String(v.text||''),mediaType:String(v.mediaType||'')}}catch{} }
    return null
  }
  const e=db.prepare('SELECT text FROM events WHERE scope=? AND uid=? AND event_id=?').get(row.scope,String(owner),row.eventId)
  return e ? {text:String(e.text||''),mediaType:''} : null
}
function tokenizeProbe(s){
  const out=[]; const str=String(s||'').toLowerCase()
  for(const run of str.match(/\p{Script=Han}+/gu)||[]){ if(run.length===1) out.push(run); for(let i=0;i+2<=run.length;i++) out.push(run.slice(i,i+2)) }
  out.push(...(str.match(/[a-z0-9]+/g)||[])); return [...new Set(out)]
}
function parseProbeCues(query){
  const q=String(query||''); const cues={}
  const all=[...q.matchAll(/(人物|谁|感受|心情|场景|任务)\s*[=＝:：]\s*([^\s；;，,。]+)/g)]
  const seen=new Map()
  const alias={ '谁':'人物','心情':'感受','任务':'场景' }
  for(const m of all){ const k=alias[m[1]]||m[1]; const v=m[2]; if(seen.has(k) && seen.get(k)!==v) { cues.__conflict=true } else seen.set(k,v) }
  const m1=q.match(/(?:人物|谁)\s*[=＝:：]\s*([^\s；;，,。]{1,40})/); if(m1) cues.person=m1[1]
  const m2=q.match(/(?:感受|心情)\s*[=＝:：]\s*([^\s；;，,。]{1,20})/); if(m2) cues.feeling=m2[1]
  const m3=q.match(/(?:场景|任务)\s*[=＝:：]\s*([^\s；;，,。]{1,80})/); if(m3) cues.scene=m3[1]
  return cues
}

/** S4: read-only single-group probe. Source evidence first; no silent widening. */
export function probeSceneIndex({ dbPath, owner, query = '', now = Date.now(), account = '', forgetFile = '' } = {}) {
  const uid=ownerOf(owner)
  let db
  try {
    db=new DatabaseSync(dbPath,{readOnly:true})
    const head=readHead(db,uid)
    if(!head || head.status!=='published') return {ok:false,error:'not_published'}
    const grow=db.prepare('SELECT value FROM meta WHERE key=?').get(`${scenePrefix(uid)}gate`)
    let gate=null; try{gate=grow?JSON.parse(grow.value):null}catch{gate={open:false}}
    if(!gate || gate.open!==true) return {ok:false,error:'scene_gate_closed'}
    const rows=readPublishedRows(db,uid,Number(head.generation)).slice(0,500)
    const sourceMap=buildSourceMap(db,uid)
    const cues=parseProbeCues(query)
    if(cues.__conflict) return {ok:true,generation:Number(head.generation),cues:{},timeCue:null,evidence:[],reason:'conflict',conflict:true}
    const timeCue=parseExplicitTimeCue(query,now)
    const qTokens=tokenizeProbe(String(query).replace(/(?:人物|谁|感受|心情|场景|任务)\s*[=＝:：]\s*[^\s；;，,。]+/g,' ').replace(/(?:昨天|今天|前天|明天|上周|这周|上个月|这个月|去年|今年|最近|刚才|早上|中午|晚上|凌晨|深夜|\d{1,4}[-/年]\d{1,2}[-/月]?\d{0,2}日?)/g,' '))
    const evidence=[]
    for(const row of rows){
      if(forgetFile && isForgotten(forgetFile, row.eventId)) continue
      if(!sourceRowPresent(db,uid,row) || sourceRowBlocked(db,uid,row)) continue
      if(timeCue && (Number(row.at)<timeCue.start || Number(row.at)>=timeCue.end)) continue
      if(cues.person && String(row.person||'')!==String(cues.person)) continue
      if(cues.feeling && String(row.feeling||'')!==String(cues.feeling)) continue
      if(cues.scene && !(String(row.scene?.taskId||'')===String(cues.scene) || String(row.scene?.sessionId||'')===String(cues.scene))) continue
      let stateWeightValue=1
      try {
        const mkey=memoryKey({source:'hippocampus',scope:row.scope,uid:uid,sourceRecordId:row.eventId})
        const sr=db.prepare('SELECT value FROM meta WHERE key=?').get(`memstate:${mkey}`)
        if(sr){const st=JSON.parse(sr.value); if(!validateMemoryState(st).length){ if(st.state==='archived'||st.sourceValidity!=='current') continue; stateWeightValue=stateWeight(st)}}
      } catch {}
      if(account && row.sourceKind==='inbound_observed' && String(row.account||'')!==String(account)) continue
      const src=sourceText(db,uid,row,sourceMap)
      if(!src) continue
      const hit=qTokens.filter(t=>t.length>1 && src.text.toLowerCase().includes(t))
      const hasStructured=cues.person||cues.feeling||cues.scene||timeCue
      if((qTokens.length && !hit.length) || (!hasStructured && !hit.length)) continue
      evidence.push({
        eventId:row.eventId, at:Number(row.at), text:src.text, mediaType:src.mediaType,
        person:row.person||null, feeling:row.feeling||null, scene:row.scene||null, account:String(row.account||''), inboundRef:String(row.inboundRef||''), textDigest:digestText(src.text),
        matchedCues:[...(cues.person?['person']:[]),...(cues.feeling?['feeling']:[]),...(cues.scene?['scene']:[]),...(timeCue?['time:'+timeCue.label]:[]),...(hit.length?['keyword']:[])],
        keywordHits:hit.slice(0,6), retrievalWeight:stateWeightValue,
      })
    }
    evidence.sort((a,b)=>Number(b.retrievalWeight)-Number(a.retrievalWeight) || Number(b.at)-Number(a.at))
    return {ok:true,generation:Number(head.generation),cues,timeCue,evidence:evidence.slice(0,3),reason:evidence.length?'matched':'no_evidence'}
  } catch(e){ return {ok:false,error:String(e?.message||e).slice(0,120)} }
  finally{ try{db?.close()}catch{} }
}


/** S6: up to 3 explicit groups separated by ; or ；. Conflict is reported, not resolved. */
export function probeSceneIndexMulti({ dbPath, owner, query = '', now = Date.now(), maxItems = 3, account = '', forgetFile = '' } = {}) {
  const gate=readSceneGate({dbPath,owner})
  if(!gate.ok || gate.gate?.open !== true) return {ok:false,error:'scene_gate_closed'}
  const groups=String(query||'').split(/[；;]/).map(x=>x.trim()).filter(Boolean).slice(0,3)
  if(!groups.length) return {ok:false,error:'no_query'}
  const parsed=[]
  for(const g of groups){
    const r=probeSceneIndex({dbPath,owner,query:g,now,account,forgetFile})
    parsed.push({query:g,ok:r.ok,cues:r.cues||{},timeCue:r.timeCue||null,evidence:r.evidence||[],reason:r.reason||r.error||'unknown'})
  }
  const failed=parsed.find(g=>!g.ok)
  if(failed) return {ok:false,error:String(failed.reason||failed.error||'probe_failed'),groups:parsed.map(g=>({query:g.query,reason:g.reason}))}
  const conflicts=parsed.filter(g=>g.reason==='conflict').map(g=>g.query)
  const slim=parsed.map(g=>({query:g.query,cues:g.cues,timeCue:g.timeCue,reason:g.reason,evidenceCount:g.evidence.length}))
  if(conflicts.length) return {ok:true,groups:slim,evidence:[],conflict:true,conflictReasons:conflicts,reason:'conflict'}
  const cap=Math.max(1,Math.min(3,Number(maxItems)||3))
  const out=[]; const seen=new Set()
  for(const g of parsed){
    for(const e of g.evidence){
      const k=e.scene?.taskId ? `task:${e.scene.taskId}` : (e.scene?.sessionId ? `session:${e.scene.sessionId}` : `event:${e.eventId}`)
      if(seen.has(k)) continue
      seen.add(k)
      out.push({...e,group:g.query,text:String(e.text||'').slice(0,120)})
      if(out.length>=cap) break
    }
    if(out.length>=cap) break
  }
  return {ok:true,groups:slim,evidence:out,conflict:false,reason:out.length?'matched':'no_evidence'}
}

export function claimSpaceTaskReply({ dbPath, owner, taskId, now = Date.now() } = {}) {
  const uid=ownerOf(owner), tid=String(taskId||'')
  if(!tid) return {ok:false,error:'task_id'}
  const h=openDb(dbPath)
  try {
    const key=`${scenePrefix(uid)}replyclaim:space:${tid}`
    if(h.db.prepare('SELECT 1 AS p FROM meta WHERE key=?').get(key)) return {ok:true,duplicate:true}
    h.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify({schema:SCHEMA,owner:uid,taskId:tid,at:Number(now)}))
    return {ok:true,duplicate:false}
  } finally { try{h.close()}catch{} }
}

export function claimSceneReply({ dbPath, owner, messageId, account = '', inboundRef = '', now = Date.now() } = {}) {
  const uid=ownerOf(owner), mid=String(messageId||'')
  if(!/^[0-9]{1,20}$/.test(mid)) return {ok:false,error:'message_id'}
  if(!String(account||'')) return {ok:false,error:'account'}
  const h=openDb(dbPath)
  try {
    const key=`${scenePrefix(uid)}replyclaim:${mid}:${String(account||'')}:${String(inboundRef||'')}`
    const prior=h.db.prepare('SELECT 1 AS p FROM meta WHERE key=?').get(key) || h.db.prepare('SELECT 1 AS p FROM meta WHERE key=?').get(`${scenePrefix(uid)}replyclaim:${mid}`)
    if(prior) return {ok:true,duplicate:true}
    h.db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify({schema:SCHEMA,owner:uid,messageId:mid,at:Number(now)}))
    return {ok:true,duplicate:false}
  } finally { try{h.close()}catch{} }
}

export function readSceneRows({ dbPath, owner } = {}) {
  const uid=ownerOf(owner); let db
  try {
    db=new DatabaseSync(dbPath,{readOnly:true})
    const head=readHead(db,uid)
    if(!head) return {ok:true,head:null,rows:[]}
    return {ok:true,head,rows:readPublishedRows(db,uid,Number(head.generation))}
  } catch(e){ return {ok:false,error:String(e?.message||e)} }
  finally { try{db?.close()}catch{} }
}

export function clearSceneIndex({ dbPath, owner } = {}) {
  const uid = ownerOf(owner)
  const h = openDb(dbPath)
  try {
    const prefix = scenePrefix(uid)
    h.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`${prefix}gate`,JSON.stringify({schema:SCHEMA,owner:uid,open:false,reason:'cleared',at:Date.now()})).changes || 0
    const head = h.db.prepare('DELETE FROM meta WHERE key=?').run(`${prefix}head`).changes || 0
    const staging = h.db.prepare('DELETE FROM meta WHERE key LIKE ?').run(`${prefix}staging:%`).changes || 0
    return { ok: true, cleared: Number(head) + Number(staging), sourceKept: true }
  } finally { try { h.close() } catch {} }
}
