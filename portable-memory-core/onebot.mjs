// OneBot-specific adapter; the caller supplies events only from its trusted socket.
import {createMemoryAdapter} from './adapter.mjs'
export const DISCLOSURE='事件记忆会保存你和我的部分私聊及已确认的回复，用于以后参考；不会用于群聊。你可以随时发送“撤回事件记忆同意”停止并删除这些事件。若同意，请回复“同意事件记忆”。'
export function normalizePortableUsers(raw,{owners=[],ownerShadow=false}={}){
 const users=String(raw||'').split(',').map(x=>x.trim()).filter(Boolean)
 if(ownerShadow&&!(users.length===1&&users[0]==='*'))for(const owner of owners.map(String))if(!users.includes(owner))users.push(owner)
 if(!users.length||!(users.length===1&&users[0]==='*')&&users.some(x=>!/^\d{5,20}$/.test(x)))throw Error('invalid memory users')
 return users
}
export function createOneBotMemory({dbPath,selfId,users,enabled=false,clock=()=>Date.now()}={}){
 if(typeof selfId!=='string'||!Array.isArray(users)||typeof clock!=='function')throw Error('invalid OneBot configuration')
 const service=createMemoryAdapter({dbPath,users,enabled}),pending=new Map(),members=new Set(users),allUsers=users.length===1&&users[0]==='*'
 const member=uid=>uid!==selfId&&/^\d{5,20}$/.test(uid)&&(allUsers||members.has(uid))
 const validMid=x=>(typeof x==='string'||(typeof x==='number'&&Number.isSafeInteger(x)))&&/^\-?[1-9]\d{0,18}$/.test(String(x))
 function privateIdentity(e){if(e?.post_type!=='message'||e.message_type!=='private'||e.group_id!=null||String(e.self_id)!==selfId||!member(String(e.user_id))||String(e.sender?.user_id)!==String(e.user_id)||!validMid(e.message_id)||!Array.isArray(e.message)||!e.message.length||e.message.some(p=>p?.type!=='text'||typeof p?.data?.text!=='string'))return null;return String(e.user_id)}
 function textOf(e){return e.message.map(x=>x.data.text).join('')}
 return Object.freeze({
  command(event){const uid=privateIdentity(event);if(!uid)return null;const text=textOf(event).trim(),now=clock();if(text==='开启事件记忆'){pending.delete(uid);return {uid,type:'disclose',text:DISCLOSURE}}
   if(text==='事件记忆状态'){const s=service.status(uid);return {uid,type:'status',text:!s?'事件记忆暂不可用。':s.gap?'事件记忆因断线或异常暂停。发送“确认清空并重启事件记忆”会删除这套系统里你的旧事件，再从空白重新开始。':s.allowed?'你的事件记忆已开启。':'你的事件记忆未开启；发送“开启事件记忆”可了解说明。'}}
   if(text==='确认清空并重启事件记忆'){const ok=!!service.resetAfterGap({uid,authenticated:true});return {uid,type:'reset',ok}}
   if(text==='撤回事件记忆同意'){pending.delete(uid);return {uid,type:'withdraw',ok:!!service.consent({uid,action:'withdraw',authenticated:true})}}
   if(text==='同意事件记忆'){const expires=pending.get(uid);pending.delete(uid);if(!expires||expires<now)return {uid,type:'need-disclosure'};return {uid,type:'grant',ok:!!service.consent({uid,action:'grant',authenticated:true,disclosed:true})}}
   return null
  },
  disclosureDelivered(uid,receipt){if(!member(uid)||receipt?.status!=='ok'||receipt?.retcode!==0||!validMid(receipt?.data?.message_id))return false;pending.set(uid,clock()+600000);return true},
  begin(event){const uid=privateIdentity(event);if(!uid||!Number.isSafeInteger(event.time)||event.time<1)return null;const text=textOf(event),query=typeof event.queryText==='string'&&event.queryText.trim()?event.queryText:text;const turn=service.begin({uid,scopeKind:'direct',eventId:String(event.message_id),created:event.time*1000,text,query,authenticated:true});if(!turn)return null;return Object.freeze({generation:turn.generation,take:()=>turn.reference,attempt:turn.attempt,confirm(text,r){turn.confirm(text,{status:r?.status,retcode:r?.retcode,id:r?.data?.message_id})},failed:turn.failed,unsupported:turn.unsupported,finish:turn.finish})},
  notice(e){if(e?.post_type!=='notice'||e.notice_type!=='friend_recall'||e.group_id!=null||String(e.self_id)!==selfId||!validMid(e.message_id))return false;let uid,kind;if(member(String(e.user_id))){uid=String(e.user_id);kind='event'}else if(String(e.user_id)===selfId&&member(String(e.target_id))){uid=String(e.target_id);kind='reply'}else return false;return service.notice({uid,kind,messageId:String(e.message_id),authenticated:true})},
  interrupt(){pending.clear();service.interrupt()},
  close(){pending.clear();service.close()}
 })
}
