import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {formatEpisodeReference} from './episode-reference.mjs'
import {createMemoryAdapter} from './adapter.mjs'
import {cleanMemoryOutput} from './safe-output.mjs'
const scope='private:111111', ev=(id,created,text,extra={})=>({id,created,text,...extra})
const sample=[ev('a',1000,'  原文 精确  '),ev('b',2000,'相邻但不同话题'),ev('c',400000,'另一窗口')]
const rendered=formatEpisodeReference(sample,{scope});assert.equal((rendered.text.match(/\[时间窗口：/g)||[]).length,2);assert(rendered.text.includes('\n原文 精确'));assert(rendered.text.includes('1970-01-01T00:00:01.000Z｜private:111111'));assert.match(rendered.text,/不代表同一话题/);assert.equal(cleanMemoryOutput(rendered.text+'\n答复',rendered.text),'答复')
for(let cap=128;cap<=8192;cap+=23){const r=formatEpisodeReference([ev('a',0,'甲'.repeat(200)),ev('b',1,'短句'),ev('c',2,'末尾')],{scope,maxBytes:cap});if(r){assert(Buffer.byteLength(r.text)<=cap);assert(r.text.includes('甲'.repeat(200))||r.incomplete);if(r.items<3)assert(r.incomplete)}}
const orphan=formatEpisodeReference([ev('a',0,'太'.repeat(1000)),ev('b',1,'不能出现',{nearby:true,nearbyOf:'a'}),ev('c',2,'可出现')],{scope});assert(!orphan.text.includes('不能出现'));assert(orphan.text.includes('太'));assert(orphan.incomplete)
const control=formatEpisodeReference([ev('a',0,'不\n可改写'),ev('b',1,'原样')],{scope});assert(control.text.includes('不 可改写'));assert(control.incomplete)
const root=fs.mkdtempSync(path.join(os.tmpdir(),'pm-episode-window-')),adapter=createMemoryAdapter({dbPath:path.join(root,'synthetic.sqlite'),users:['*'],enabled:true})
try{
 const begin=(uid,eventId,created,text)=>adapter.begin({uid,scopeKind:'direct',eventId,created,text,authenticated:true}),put=(uid,id,t,text)=>{const turn=begin(uid,id,t,text);assert(turn);turn.attempt('确认');turn.confirm('确认',{status:'ok',retcode:0,id:'r'+id});assert(turn.finish(true))}
 put('111111','a',1000,'我的生日是秋天');put('111111','b',31000,'窗外阳光灿烂');put('111111','n1',40000,'短片段一');put('111111','n2',50000,'短片段二');put('111111','c',1000000,'今天散步');put('222222','x',2000,'秘密其他租户')
 const held=begin('111111','query',1001000,'我的生日是什么');let ref=held.reference;assert(ref?.text.includes('我的生日是秋天'));assert(ref.text.includes('窗外阳光灿烂'));assert(ref.items>3);assert(ref.text.includes('短片段一')||ref.text.includes('短片段二'));assert(!ref.text.includes('秘密其他租户'));assert.match(ref.text,/\[时间窗口/)
 assert(adapter.notice({uid:'111111',kind:'reply',messageId:'rb',authenticated:true}));ref=held.reference;assert(!ref?.text.includes('窗外阳光灿烂'));assert(ref?.text.includes('我的生日是秋天'))
 put('111111','d',32000,'另一个近邻');const held2=begin('111111','query2',1002000,'我的生日是什么');assert(held2.reference?.text.includes('另一个近邻'));assert(adapter.notice({uid:'111111',kind:'event',messageId:'a',authenticated:true}));ref=held2.reference;assert(!ref?.text.includes('我的生日是秋天'));assert(!ref?.text.includes('另一个近邻'))
 const gap=begin('111111','gapquery',1003000,'今天散步');assert(gap.reference);adapter.interrupt();assert.equal(gap.reference,null);assert.equal(begin('111111','later',1004000,'继续'),null)
 console.log('episode windows: revalidated-only selection, time/source/literal text, isolation, neighbor and anchor revocation, gap, strict byte budgets passed')
}finally{adapter.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
