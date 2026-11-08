import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createMemoryCore,formatMemoryReference} from './core.mjs'
import {createOneBotMemory} from './onebot.mjs'
import {cleanMemoryOutput} from './safe-output.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atri-episode-')),db=path.join(root,'events.sqlite'),open=u=>createMemoryCore({dbPath:db,tenant:u,scope:`private:${u}`,scopeKind:'direct'}),self='333333333';let a,b,service
try{
 a=open('111111');b=open('222222');const ga=a.setAuthorization(true),gb=b.setAuthorization(true),put=(c,g,id,time,text)=>c.capture({generation:g,eventId:id,created:time,text,replies:[{id:'r'+id,text:'收到',status:'confirmed'}]})
 put(a,ga,'100',1000,'你记得我的生日是什么时候吗');put(a,ga,'101',31000,'就是八月二十八号');put(a,ga,'102',1000000,'我们再聊一点别的');put(b,gb,'100',1000,'另外一个人的记录')
 const result=a.recallRelevant({generation:ga,query:'你记得生日吗'});assert.deepEqual(result.events.map(x=>x.id),['100','101','102']);assert.equal(result.events[1].nearby,true);assert.equal(result.events[1].nearbyOf,'100');assert(!b.recallRelevant({generation:gb,query:'生日'}).events.some(x=>x.text.includes('八月')))
 const controlled=formatMemoryReference([{created:0,text:'前\u0085后\u202e倒序'}],{scope:'private:111111'});assert.doesNotMatch(controlled.text,/[\u0085\u202e]/)
 const reference=formatMemoryReference(result.events,{scope:'private:111111'});assert.match(reference.text,/时间邻近片段，仅时间接近，不代表同一话题或完整记录/)
 const header=reference.text.split('\n').find(x=>x.includes('｜时间邻近片段'));assert(header);assert.equal(cleanMemoryOutput(header+'\n就是八月二十八号\n我记住啦',reference.text),'我记住啦')
 a.revokeEvent('100');const validated=a.revalidateRelevant({generation:ga,events:result.events});assert.deepEqual(validated.events.map(x=>x.id),['102']);assert.equal(validated.incomplete,true)
 a.close();b.close();a=b=null
 service=createOneBotMemory({dbPath:path.join(root,'adapter.sqlite'),selfId:self,users:['*'],enabled:true})
 const msg=(n,time,text)=>({post_type:'message',message_type:'private',self_id:self,user_id:'111111',sender:{user_id:'111111'},message_id:n,time,message:[{type:'text',data:{text}}]});const add=(n,time,text)=>{const t=service.begin(msg(n,time,text));assert(t);t.attempt('收到');t.confirm('收到',{status:'ok',retcode:0,data:{message_id:n+1000}});assert(t.finish(true))}
 add(11,100,'你记得我的生日是什么时候吗');add(12,130,'就是八月二十八号');add(13,1000,'再聊点别的');const turn=service.begin(msg(14,1010,'你记得生日吗'));assert.match(turn.take().text,/八月二十八/)
 const neighborTurn=service.begin(msg(140,1011,'你记得生日吗'));assert.match(neighborTurn.take().text,/八月二十八/);assert(service.notice({post_type:'notice',notice_type:'friend_recall',self_id:self,user_id:self,target_id:'111111',message_id:1012}));const afterNeighbor=neighborTurn.take();assert(!afterNeighbor?.text.includes('八月二十八'));assert(afterNeighbor?.text.includes('我的生日'));neighborTurn.finish(true)
 assert(service.notice({post_type:'notice',notice_type:'friend_recall',self_id:self,user_id:'111111',message_id:11}));const after=turn.take();assert(!after?.text.includes('八月二十八'));assert(!after?.text.includes('我的生日'));turn.attempt('好');turn.confirm('好',{status:'ok',retcode:0,data:{message_id:1014}});assert(turn.finish(true));assert(service.begin(msg(15,1020,'继续聊天')))
 const long=service.begin(msg(20,1030,'长'.repeat(10001)));assert(long);long.attempt('收到');long.confirm('收到',{status:'ok',retcode:0,data:{message_id:1020}});assert.equal(long.finish(true),false);assert(service.begin(msg(21,1040,'普通聊天')))
 const recalled=service.begin(msg(22,1050,'待撤回的消息'));assert(recalled);assert(service.notice({post_type:'notice',notice_type:'friend_recall',self_id:self,user_id:'111111',message_id:22}));recalled.attempt('收到');recalled.confirm('收到',{status:'ok',retcode:0,data:{message_id:1022}});assert.equal(recalled.finish(true),false);assert(service.begin(msg(23,1060,'撤回后继续')))
 const recalledReply=service.begin(msg(24,1070,'回复将被撤回'));assert(recalledReply);recalledReply.attempt('回复');recalledReply.confirm('回复',{status:'ok',retcode:0,data:{message_id:1024}});assert(service.notice({post_type:'notice',notice_type:'friend_recall',self_id:self,user_id:self,target_id:'111111',message_id:1024}));assert.equal(recalledReply.finish(true),false);assert(service.begin(msg(25,1080,'继续')))
 const pending=service.begin(msg(26,1090,'进行中的一条'));assert(pending);assert(service.command(msg(27,1091,'撤回事件记忆同意')).ok);pending.attempt('收到');pending.confirm('收到',{status:'ok',retcode:0,data:{message_id:1026}});assert.equal(pending.finish(true),false);assert.doesNotMatch(service.command(msg(28,1092,'事件记忆状态')).text,/暂停/);assert.equal(service.command(msg(29,1093,'开启事件记忆')).type,'disclose');assert(service.disclosureDelivered('111111',{status:'ok',retcode:0,data:{message_id:1029}}));assert(service.command(msg(30,1094,'同意事件记忆')).ok);assert(service.begin(msg(31,1095,'仍可继续')))
 console.log('nearby context, honest labels, account isolation, concurrent recall and consume-time revalidation passed')
}finally{service?.close();a?.close();b?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
