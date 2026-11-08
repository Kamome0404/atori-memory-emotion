import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createMemoryCore} from './core.mjs'

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gap-resume-'))
const db=path.join(dir,'db.sqlite')
const c=createMemoryCore({dbPath:db,tenant:'111111111',scope:'private:111111111',scopeKind:'direct'})
try{
 const g=c.enrollIfUnseen()
 c.capture({generation:g,eventId:'e1',text:'我喜欢海边',created:1,replies:[{id:'r1',text:'收到',status:'confirmed'}]})
 c.markGap()
 assert.equal(c.authorization().gap,true)
 const r=c.resumeAfterGap({reason:'reviewed gap',evidence:'test evidence',now:123})
 assert.equal(r.generation,2)
 assert.equal(r.events,1)
 assert.equal(c.authorization().gap,false)
 assert.equal(c.authorization().allowed,true)
 assert.ok(c.recall({generation:2,limit:10}).some(e=>e.id==='e1'),'event must survive resume')
 const dbx=new DatabaseSync(db,{readOnly:true})
 const row=dbx.prepare("SELECT * FROM pm_gap_resolutions WHERE tenant='111111111'").get()
 assert.equal(row.generation,2); assert.equal(row.reason,'reviewed gap')
 dbx.close()
 assert.throws(()=>c.resumeAfterGap({reason:'again'}),/no gap/)
 console.log('gap resume passed')
}finally{c.close();fs.rmSync(dir,{recursive:true,force:true})}
