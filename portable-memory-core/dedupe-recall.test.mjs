import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createMemoryCore} from './core.mjs'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dedupe-recall-'))
const db=path.join(dir,'db.sqlite')
const core=createMemoryCore({dbPath:db,tenant:'111111111',scope:'private:111111111',scopeKind:'direct'})
const g=core.enrollIfUnseen()
const put=(id,text,created)=>core.capture({generation:g,eventId:id,text,created,replies:[{id:'r'+id,text:'收到',status:'confirmed'}]})
try{
  // 重复问句必须折叠，来源事件不能被挤掉。
  put('q1','我蓝色杯子放哪来着了',1)
  put('source','我蓝色杯子放窗台上了，等会拿',2)
  put('q2','我蓝色杯子放哪来着了',3)
  let r=core.recallRelevant({generation:g,query:'我蓝色杯子放哪了',limit:3})
  let ids=r.events.map(e=>e.id)
  assert.equal(r.events.filter(e=>e.text==='我蓝色杯子放哪来着了').length,1,'重复问句只保留一次')
  assert.ok(ids.includes('source'),'来源事件不能被重复问句挤掉')

  // 带“记得/哪”的普通陈述不能被误当问句折叠。
  put('s1','我记得我们去过那里',10)
  put('s2','我记得我们去过那里',11)
  r=core.recallRelevant({generation:g,query:'那里',limit:5})
  assert.equal(r.events.filter(e=>e.text==='我记得我们去过那里').length,2,'普通陈述不能折叠')

  // “哪里都可以”不是问句。
  put('w1','哪里都可以',20)
  put('w2','哪里都可以',21)
  r=core.recallRelevant({generation:g,query:'哪里',limit:5})
  assert.equal(r.events.filter(e=>e.text==='哪里都可以').length,2,'非问句的“哪里”不能折叠')

  // 长文本只比较完整文本，前缀相同但结尾不同不能折叠。
  const prefix='蓝色杯子放在窗台上，'+'记'.repeat(600)
  put('l1',prefix+'左边',30)
  put('l2',prefix+'右边',31)
  r=core.recallRelevant({generation:g,query:'蓝色杯子',limit:5})
  assert.equal(r.events.filter(e=>e.id==='l1'||e.id==='l2').length,2,'长文本结尾不同不能折叠')
  console.log('dedupe recall passed')
}finally{core.close();fs.rmSync(dir,{recursive:true,force:true})}
