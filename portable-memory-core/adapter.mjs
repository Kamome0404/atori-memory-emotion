// Caller must authenticate transport events. This deployment automatically enrolls
// previously unseen private users; enrollment does not itself establish consent.
import {createMemoryCore,MemoryAuthorizationError,MemoryGapError,MemoryTombstonedError} from './core.mjs'
import {formatEpisodeReference} from './episode-reference.mjs'
import {filterPrivacyEvent} from './privacy.mjs'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const id=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v)
export function createMemoryAdapter({dbPath,users,enabled=false}={}){
 if(typeof enabled!=='boolean'||!Array.isArray(users)||users.some(u=>!id(u))||new Set(users).size!==users.length)throw Error('invalid memory configuration')
 const permitted=new Set(users),allUsers=users.length===1&&users[0]==='*',cores=new Map(),blocked=new Set(),unpersisted=new Set(),started=new Set();let closed=false
 function startSession(uid,c){if(!started.has(uid)){if(!c.beginSession())blocked.add(uid);started.add(uid)}}
 function core(uid,allowBlocked=false){if(closed||!enabled||(!allUsers&&!permitted.has(uid))||(!allowBlocked&&blocked.has(uid))||(!cores.has(uid)&&cores.size>=128))return null;if(!cores.has(uid)){const c=createMemoryCore({dbPath,tenant:uid,scope:`private:${uid}`,scopeKind:'direct'});cores.set(uid,c);if(c.authorization().allowed)startSession(uid,c)}return !allowBlocked&&blocked.has(uid)?null:cores.get(uid)}
 function gap(uid,c){blocked.add(uid);try{c.markGap();unpersisted.delete(uid)}catch{unpersisted.add(uid)} }
 // Start continuity tracking for every previously authorized private user,
 // including those who have not spoken since this process restarted.
 if(enabled&&fs.existsSync(dbPath)){const stat=fs.lstatSync(dbPath);if(!stat.isFile()||stat.isSymbolicLink())throw Error('invalid memory database');const db=new DatabaseSync(dbPath,{readOnly:true});let rows;try{if(db.prepare("SELECT value FROM pm_metadata WHERE key='marker'").get()?.value!=='portable-memory-v1')throw Error('invalid memory database');rows=db.prepare('SELECT tenant,scope FROM pm_authorization WHERE allowed=1 LIMIT 129').all()}finally{db.close()}if(rows.length>128||rows.some(r=>!id(r.tenant)||r.scope!==`private:${r.tenant}`))throw Error('invalid memory accounts');try{for(const r of rows)if(allUsers||permitted.has(r.tenant))core(r.tenant)}catch(e){for(const c of cores.values())try{c.close()}catch{};throw e}}
 return Object.freeze({
  consent({uid,action,authenticated=false,disclosed=false}={}){const c=core(uid,action==='withdraw');if(!c||authenticated!==true||!['grant','withdraw'].includes(action)||(action==='grant'&&disclosed!==true))return false;try{const result=c.setAuthorization(action==='grant');if(action==='grant')startSession(uid,c);return result}catch(e){gap(uid,c);throw e}},
  status(uid){const c=core(uid,true);if(!c)return null;const s=c.authorization();return {allowed:s.allowed,gap:s.gap||blocked.has(uid),seen:s.generation>0}},
  resetAfterGap({uid,authenticated=false}={}){const c=core(uid,true);if(!c||authenticated!==true)return false;try{const result=c.resetAfterGap();blocked.delete(uid);unpersisted.delete(uid);return result}catch{return false}},
  notice({uid,kind,messageId,authenticated=false}={}){const c=core(uid,true);if(!c||authenticated!==true||!id(messageId)||!['event','reply'].includes(kind))return false;try{return kind==='event'?c.revokeEvent(messageId):c.revokeReply(messageId)}catch{gap(uid,c);return false}},
  begin({uid,scopeKind,eventId,created,text,query,authenticated=false}={}){
   if(authenticated!==true||scopeKind!=='direct'||!id(uid)||!id(eventId)||!Number.isSafeInteger(created)||created<0||typeof text!=='string'||!text.trim())return null
   const c=core(uid);if(!c)return null;let state=c.authorization();if(state.generation===0&&!state.gap){try{if(c.enrollIfUnseen()===null)return null;startSession(uid,c);state=c.authorization()}catch{gap(uid,c);return null}}if(!state.allowed||state.gap)return null
   const recallQuery=typeof query==='string'&&query.trim()?query.slice(0,2000):text;let selected;try{selected=c.recallRelevant({generation:state.generation,query:recallQuery,limit:3})}catch{gap(uid,c);return null}
   const attempts=[];let done=false,bad=false,unsupported=text.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
   return Object.freeze({generation:state.generation,get reference(){if(done||closed||blocked.has(uid))return null;try{const current=c.revalidateRelevant({generation:state.generation,events:selected.events,incomplete:selected.incomplete,query:recallQuery,claimsSignature:selected.claimsSignature,episodeContext:true});return formatEpisodeReference(current.events,{scope:`private:${uid}`,incomplete:current.incomplete})}catch{try{const current=c.authorization();if(!current.allowed||current.generation!==state.generation||current.gap||blocked.has(uid))return null}catch{};gap(uid,c);return null}},unsupported(){if(!done)unsupported=true},attempt(part){if(done)return;if(typeof part!=='string'||!part.trim()||attempts.length>=8){bad=true;return}if(part.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(part))unsupported=true;attempts.push({text:part,status:'pending'})},
    confirm(part,receipt){if(done)return;const a=attempts.at(-1);if(!a||a.status!=='pending'||a.text!==part){bad=true;return}if(receipt?.status==='ok'&&receipt.retcode===0&&(typeof receipt?.id!=='number'||Number.isSafeInteger(receipt.id))&&id(String(receipt?.id??''))){a.id=String(receipt.id);a.status='confirmed'}else if(receipt?.status==='failed'||(Number.isInteger(receipt?.retcode)&&receipt.retcode!==0))a.status='failed';else a.status='unknown'},
    failed(known=false){const a=attempts.at(-1);if(done||!a||a.status!=='pending'){bad=true;return}a.status=known===true?'failed':'unknown'},
    finish(completed){if(done)return false;done=true;if(!attempts.length&&!bad)return false;if(bad||(!completed&&!attempts.some(x=>x.status==='failed'))||attempts.some(x=>x.status==='unknown'||x.status==='pending')){gap(uid,c);return false}if(unsupported||attempts.some(x=>x.status!=='confirmed'))return false;try{if(!filterPrivacyEvent({text,replies:attempts.map(x=>x.text)}))return false;return c.capture({generation:state.generation,eventId,created,text,replies:attempts})}catch(e){if(e instanceof MemoryAuthorizationError||e instanceof MemoryGapError||e instanceof MemoryTombstonedError)return false;gap(uid,c);return false}}
   })
  },
  interrupt(){if(closed||!enabled)return;for(const uid of (allUsers?cores.keys():permitted)){try{const c=core(uid,true);if(c?.authorization().allowed)gap(uid,c)}catch{blocked.add(uid);unpersisted.add(uid)}}},
  close(){closed=true;for(const [uid,c] of cores){try{if(started.has(uid)&&!unpersisted.has(uid))c.endSession()}finally{c.close()}}cores.clear()}
 })
}
