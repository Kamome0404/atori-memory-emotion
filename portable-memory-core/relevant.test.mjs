import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {performance} from 'node:perf_hooks'
import {createMemoryCore} from './core.mjs'
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atri-relevant-')),dbPath=path.join(dir,'m.sqlite')
const open=u=>createMemoryCore({dbPath,tenant:u,scope:`private:${u}`,scopeKind:'direct'})
let a,b
try{
 a=open('111111');b=open('222222');const ga=a.setAuthorization(true),gb=b.setAuthorization(true)
 const put=(c,g,id,at,text)=>c.capture({generation:g,eventId:id,created:at,text,replies:[{id:'reply-'+id,text:'知道了',status:'confirmed'}]})
 put(a,ga,'birthday',1,'我的生日在春天的某一天')
 put(b,gb,'other-birthday',2,'我的生日在另一个季节')
 for(let i=0;i<70;i++)put(a,ga,'e'+i,100+i,'今天天气真不错，聊点别的事情'+i)
 assert(!a.recall({generation:ga,limit:3}).some(e=>e.id==='birthday'))
 const found=a.recallRelevant({generation:ga,query:'你还记得我的生日吗'})
 assert(found.events.some(e=>e.id==='birthday'));assert(found.events.some(e=>e.id==='e69'));assert(!found.events.some(e=>e.id==='other-birthday'))
 assert(!b.recallRelevant({generation:gb,query:'我的生日'}).events.some(e=>e.id==='birthday'))
 const short=a.recallRelevant({generation:ga,query:'嗯'});assert.equal(short.events[0].id,'e69')
 const expanded=a.recallRelevant({generation:ga,query:'㍿'.repeat(100)});assert.equal(expanded.incomplete,true);assert.equal(a.authorization().gap,false)
 put(a,ga,'long',200,'很长的内容'.repeat(130)+'特别词句');assert.equal(a.recallRelevant({generation:ga,query:'特别词句'}).incomplete,true)
 a.revokeEvent('birthday');assert(!a.recallRelevant({generation:ga,query:'生日'}).events.some(e=>e.id==='birthday'))
 assert.throws(()=>a.recallRelevant({generation:ga+1,query:'生日'}),/authorization/)
 a.markGap();assert.throws(()=>a.recallRelevant({generation:ga,query:'生日'}),/gap/)
 console.log('relevant recall: old-event recovery, isolation, recent fallback, revocation and gap passed')
}finally{a?.close();b?.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
