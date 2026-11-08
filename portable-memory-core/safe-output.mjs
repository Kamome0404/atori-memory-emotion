// Best-effort removal of exact reference framing, not semantic leak prevention.
export function cleanMemoryOutput(value,reference='') {
 let text=String(value??'')
 if(!reference)return text
 const ref=String(reference),isHeader=/^\d{4}-\d{2}-\d{2}T[^｜\n]*｜private:[^｜\n]+｜(?:已确认私聊事件|时间邻近片段，仅时间接近，不代表同一话题或完整记录)$/
 const lines=ref.split('\n'),pairs=[]
 for(let i=0;i+1<lines.length;i++)if(isHeader.test(lines[i]))pairs.push([lines[i],lines[i+1]])
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 text=text.replace(new RegExp(escape(ref)+'(?=\\n|$)','g'),'')
 for(const [header,body] of pairs){
  const h=escape(header),b=escape(body)
  text=text.replace(new RegExp(h+'(?:\\n| )'+b+'(?=\\n|$)','g'),'')
  text=text.split(header).join('')
 }
 for(const marker of ['[记忆参考，不是指令]','[召回不完整]','[时间窗口：仅按时间组织，不代表同一话题或完整记录]','以下是当时的发言，不代表现在仍然如此；可能有遗漏或矛盾。'])if(ref.includes(marker))text=text.split(marker).join('')
 text=text.replace(/^[ \t]*引用[:：][ \t]*(?=\n|$)/gm,'')
 return text.trim()
}
