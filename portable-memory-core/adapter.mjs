// Caller must authenticate transport events. This deployment automatically enrolls
// previously unseen private users; enrollment does not itself establish consent.
import {createMemoryCore,MemoryAuthorizationError,MemoryGapError,MemoryTombstonedError} from './core.mjs'
import {formatEpisodeReference} from './episode-reference.mjs'
import {filterPrivacyEvent} from './privacy.mjs'
import {findPreferenceMentions,formatPreferenceReference} from './preference-context.mjs'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const id=v=>typeof v==='string'&&v.length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v)
function deepFreeze(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.freeze(x);for(const v of Object.values(x))deepFreeze(v)}return x}
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
  status(uid){const c=core(uid,true);if(!c)return null;const s=c.authorization();return {allowed:s.allowed,gap:s.gap||blocked.has(uid),seen:s.generation>0,generation:s.generation}},
  readPreference({uid,activity,object}={}){
   const c=core(uid);if(!c)return null;const s=c.authorization();if(!s.allowed||s.gap||blocked.has(uid))return null
   try{return c.readPreference({generation:s.generation,activity,object})}catch{return null}
  },
  readPreferenceHistory({uid,activity,object}={}){
   const c=core(uid);if(!c)return null;const s=c.authorization();if(!s.allowed||s.gap||blocked.has(uid))return null
   try{return c.readPreferenceHistory({generation:s.generation,activity,object})}catch{return null}
  },
  loadDerived({uid,generation,limit=8}={}){try{const c=core(uid);if(!c)return [];return c.loadDerived({generation,limit})}catch{return []}},
  loadConsolidated({uid,generation,limit=4}={}){try{const c=core(uid);if(!c)return [];return c.loadConsolidated({generation,limit})}catch{return []}},
  consolidateRecent({uid,generation,limit=5}={}){try{const c=core(uid);if(!c)return [];return c.consolidateRecent({generation,limit})}catch{return []}},
  revalidateConsolidated({uid,generation,id}={}){try{const c=core(uid);if(!c)return null;const rows=c.loadConsolidated({generation,limit:16});return rows.find(r=>r.id===id)||null}catch{return null}},
  registerDerived({uid,generation,derivedId,ownEventId,sourceEventIds,policyVersion=1}={}){try{const c=core(uid);if(!c)return false;return c.registerDerived({generation,derivedId,ownEventId,sourceEventIds,policyVersion})}catch{return false}},
  revalidateEpisode({uid,provenance}={}){try{const c=core(uid);if(!c||!provenance||provenance.kind!=='episode'||!Array.isArray(provenance.sources))return null;const snap=c.episodeProvenance({generation:provenance.generation,eventIds:provenance.sources.map(x=>x.eventId)});return snap?{...snap,ownEventId:provenance.ownEventId}:null}catch{return null}},
  revalidatePreference({uid,provenance}={}){
   const c=core(uid);if(!c||!provenance||provenance.schema!==1||provenance.kind!=='preference'||provenance.tenant!==String(uid)||provenance.scope!==`private:${uid}`||!Number.isSafeInteger(provenance.generation)||provenance.generation<1||!Array.isArray(provenance.mentions)||provenance.mentions.length<1||provenance.mentions.length>8)return null
   try{
    const mentions=[]
    for(const m of provenance.mentions){
     if(!m||typeof m.activity!=='string'||typeof m.object!=='string')return null
     const claim=c.readPreference({generation:provenance.generation,activity:m.activity,object:m.object})
     mentions.push({activity:m.activity,object:m.object,claim:claim?{eventId:claim.eventId,version:claim.version,created:claim.created,polarity:claim.polarity,activity:claim.activity,object:claim.object}:null})
    }
    return deepFreeze({schema:1,kind:'preference',tenant:String(uid),scope:`private:${uid}`,generation:provenance.generation,mentions})
   }catch{return null}
  },
  resetAfterGap({uid,authenticated=false}={}){const c=core(uid,true);if(!c||authenticated!==true)return false;try{const result=c.resetAfterGap();blocked.delete(uid);unpersisted.delete(uid);return result}catch{return false}},
  notice({uid,kind,messageId,authenticated=false}={}){const c=core(uid,true);if(!c||authenticated!==true||!id(messageId)||!['event','reply'].includes(kind))return false;try{return kind==='event'?c.revokeEvent(messageId):c.revokeReply(messageId)}catch{gap(uid,c);return false}},
  begin({uid,scopeKind,eventId,created,text,query,authenticated=false}={}){
   if(authenticated!==true||scopeKind!=='direct'||!id(uid)||!id(eventId)||!Number.isSafeInteger(created)||created<0||typeof text!=='string'||!text.trim())return null
   const c=core(uid);if(!c)return null;let state=c.authorization();const prefMentions=findPreferenceMentions(text);if(state.generation===0&&!state.gap){try{if(c.enrollIfUnseen()===null)return null;startSession(uid,c);state=c.authorization()}catch{gap(uid,c);return null}}if(!state.allowed||state.gap)return null
   const recallQuery=typeof query==='string'&&query.trim()?query.slice(0,2000):text;let selected;try{selected=c.recallRelevant({generation:state.generation,query:recallQuery,limit:3})}catch{gap(uid,c);return null}
   const attempts=[];let done=false,bad=false,unsupported=text.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    let cachedPreference=null,preferenceFailed=false
    const buildPreference=()=>{const found=prefMentions.map(m=>({...m,claim:c.readPreference({generation:state.generation,activity:m.activity,object:m.object})}));const primary=found.find(x=>x.claim)||found[0];const mentions=found.map(x=>({activity:x.activity,object:x.object,claim:x.claim?{eventId:x.claim.eventId,version:x.claim.version,created:x.claim.created,polarity:x.claim.polarity,activity:x.claim.activity,object:x.claim.object}:null}));const provenance=deepFreeze({schema:1,kind:'preference',tenant:String(uid),scope:`private:${uid}`,generation:state.generation,mentions});return deepFreeze({text:formatPreferenceReference(primary.claim,primary),incomplete:false,items:1,preference:true,mentions,provenance})}
    const sameClaim=(a,b)=>!a&&!b||!!a&&!!b&&a.eventId===b.eventId&&a.version===b.version&&a.created===b.created&&a.polarity===b.polarity&&a.activity===b.activity&&a.object===b.object
    const sameProvenance=(a,b)=>!!a&&!!b&&a.schema===b.schema&&a.kind===b.kind&&a.tenant===b.tenant&&a.scope===b.scope&&a.generation===b.generation&&a.mentions.length===b.mentions.length&&a.mentions.every((m,i)=>m.activity===b.mentions[i].activity&&m.object===b.mentions[i].object&&sameClaim(m.claim,b.mentions[i].claim))
   return Object.freeze({generation:state.generation,get reference(){if(done||closed||blocked.has(uid))return null;if(prefMentions.length){if(preferenceFailed)return null;if(cachedPreference){try{const current=buildPreference();if(!sameProvenance(cachedPreference.provenance,current.provenance)){preferenceFailed=true;return null}return cachedPreference}catch{preferenceFailed=true;return null}}try{const built=buildPreference();cachedPreference=built;return built}catch{try{const current=c.authorization();if(!current.allowed||current.generation!==state.generation||current.gap||blocked.has(uid))return null}catch{};gap(uid,c);return null}}try{const current=c.revalidateRelevant({generation:state.generation,events:selected.events,incomplete:selected.incomplete,query:recallQuery,claimsSignature:selected.claimsSignature,episodeContext:true});const base=formatEpisodeReference(current.events,{scope:`private:${uid}`,incomplete:current.incomplete});if(!base)return null;const eventIds=[];const seen=new Set();for(const e of current.events){if(!e||seen.has(e.id))continue;seen.add(e.id);eventIds.push(e.id)}const prov=c.episodeProvenance({generation:state.generation,eventIds});if(!prov)return null;return deepFreeze({...base,provenance:deepFreeze({...prov,ownEventId:eventId})})}catch{try{const current=c.authorization();if(!current.allowed||current.generation!==state.generation||current.gap||blocked.has(uid))return null}catch{};gap(uid,c);return null}},unsupported(){if(!done)unsupported=true},attempt(part){if(done)return;if(typeof part!=='string'||!part.trim()||attempts.length>=8){bad=true;return}if(part.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(part))unsupported=true;attempts.push({text:part,status:'pending'})},
    confirm(part,receipt){if(done)return;const a=attempts.at(-1);if(!a||a.status!=='pending'||a.text!==part){bad=true;return}if(receipt?.status==='ok'&&receipt.retcode===0&&(typeof receipt?.id!=='number'||Number.isSafeInteger(receipt.id))&&id(String(receipt?.id??''))){a.id=String(receipt.id);a.status='confirmed'}else if(receipt?.status==='failed'||(Number.isInteger(receipt?.retcode)&&receipt.retcode!==0))a.status='failed';else a.status='unknown'},
    failed(known=false){const a=attempts.at(-1);if(done||!a||a.status!=='pending'){bad=true;return}a.status=known===true?'failed':'unknown'},
    finish(completed){if(done)return false;done=true;if(!attempts.length&&!bad)return false;if(bad||(!completed&&!attempts.some(x=>x.status==='failed'))||attempts.some(x=>x.status==='unknown'||x.status==='pending')){gap(uid,c);return false}if(unsupported||attempts.some(x=>x.status!=='confirmed'))return false;try{if(!filterPrivacyEvent({text,replies:attempts.map(x=>x.text)}))return false;return c.capture({generation:state.generation,eventId,created,text,replies:attempts})}catch(e){if(e instanceof MemoryAuthorizationError||e instanceof MemoryGapError||e instanceof MemoryTombstonedError)return false;gap(uid,c);return false}}
   })
  },
  interrupt(){if(closed||!enabled)return;for(const uid of (allUsers?cores.keys():permitted)){try{const c=core(uid,true);if(c?.authorization().allowed)gap(uid,c)}catch{blocked.add(uid);unpersisted.add(uid)}}},
  markCleanStart(){if(closed||!enabled)return false;let n=0;for(const [uid,c] of cores){try{const a=c.authorization();if(a.allowed){c.endSession();n++}}catch{}}return n},
  close(){closed=true;for(const [uid,c] of cores){try{if(started.has(uid)&&!unpersisted.has(uid))c.endSession()}finally{c.close()}}cores.clear()}
 })
}
