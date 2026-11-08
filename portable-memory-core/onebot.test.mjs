import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createOneBotMemory} from './onebot.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'onebot-memory-')),selfId='333333333',users=['111111111','222222222'];let mem
const msg=(u,n,text)=>({post_type:'message',message_type:'private',self_id:selfId,user_id:u,sender:{user_id:u},message_id:n,time:1700000000,message:[{type:'text',data:{text}}]})
const receipt=id=>({status:'ok',retcode:0,data:{message_id:id}})
try{
 mem=createOneBotMemory({dbPath:path.join(root,'memory.sqlite'),selfId,users:['*'],enabled:true})
 const automatic='345678';const first=mem.begin(msg(automatic,101,'第一次正常聊天'));assert.ok(first);assert.equal(first.generation,1);first.attempt('你好');first.confirm('你好',receipt(102));assert.equal(first.finish(true),true);const again=mem.begin(msg(automatic,103,'继续聊天'));assert.match(again.take().text,/第一次正常聊天/);again.finish(true);assert.equal(mem.command(msg(automatic,104,'撤回事件记忆同意')).ok,true);assert.equal(mem.begin(msg(automatic,105,'后来再聊')),null)
 for(const u of users){assert.equal(mem.command(msg(u,1,'同意事件记忆')).type,'need-disclosure');assert.equal(mem.command(msg(u,2,'开启事件记忆')).type,'disclose');assert.equal(mem.disclosureDelivered(u,receipt(3)),true);assert.equal(mem.command(msg(u,4,'同意事件记忆')).ok,true)}
 for(const u of users){const turn=mem.begin(msg(u,5,`我的测试 ${u}`));assert.ok(turn);turn.attempt('收到');turn.confirm('收到',receipt(6));assert.equal(turn.finish(true),true)}
 assert.equal(mem.notice({post_type:'notice',notice_type:'friend_recall',self_id:selfId,user_id:selfId,target_id:users[1],message_id:6}),true);const check=mem.begin(msg(users[1],30,'检查回复撤回'));assert.ok(check);assert.equal(check.take(),null);check.finish(true)
 const a=mem.begin(msg(users[0],7,'继续聊'));assert.match(a.take().text,/111111111/);assert.doesNotMatch(a.take().text,/222222222/);a.attempt('答复');a.confirm('答复',receipt(8));assert.equal(a.finish(true),true)
 assert.equal(mem.notice({post_type:'notice',notice_type:'friend_recall',self_id:selfId,user_id:users[0],message_id:5}),true)
 assert.equal(mem.command(msg(users[0],9,'撤回事件记忆同意')).ok,true);assert.equal(mem.begin(msg(users[0],10,'还有吗')),null);assert.ok(mem.begin(msg(users[1],10,'还有吗')))
 const textWithSticker=mem.begin(msg(users[1],88,'今天聊了一个好消息'));textWithSticker.attempt('我替你开心');textWithSticker.confirm('我替你开心',receipt(89));assert.equal(textWithSticker.finish(true),true)
 const mixed=mem.begin(msg(users[1],90,'带表情的正常对话'));mixed.unsupported();mixed.attempt('普通回复');mixed.confirm('普通回复',receipt(91));assert.equal(mixed.finish(true),false);const afterMixed=mem.begin(msg(users[1],92,'继续正常聊天'));assert.ok(afterMixed);afterMixed.finish(true)
 const unicode=mem.begin(msg(users[1],93,'㍿'.repeat(100)));assert.ok(unicode);unicode.attempt('收到');unicode.confirm('收到',receipt(94));assert.equal(unicode.finish(true),true);const afterUnicode=mem.begin(msg(users[1],95,'后来继续聊'));assert.ok(afterUnicode);afterUnicode.finish(true)
 assert.equal(mem.begin({...msg(users[1],11,'群聊'),message_type:'group',group_id:1}),null)
 mem.interrupt();assert.equal(mem.begin(msg(users[1],12,'重连')),null);mem.close();mem=null;mem=createOneBotMemory({dbPath:path.join(root,'memory.sqlite'),selfId,users:['*'],enabled:true});assert.equal(mem.begin(msg(users[1],13,'再次重连')),null);assert.match(mem.command(msg(users[1],14,'事件记忆状态')).text,/暂停/);assert.equal(mem.command(msg(users[1],15,'确认清空并重启事件记忆')).ok,true);const restarted=mem.begin(msg(users[1],16,'重新开始'));assert.ok(restarted);assert.equal(restarted.generation,2);assert.equal(restarted.take(),null);restarted.attempt('收到');restarted.confirm('收到',receipt(17));assert.equal(restarted.finish(true),true);assert.equal(mem.begin(msg(users[0],18,'另一人仍未授权')),null)
 console.log('OneBot adapter disclosure, two users, receipt and withdrawal passed')
}finally{mem?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
