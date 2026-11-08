import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMemoryCore,formatMemoryReference } from './core.mjs'

test('isolated, transactional, tombstoned and portable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-core-'))
  const d1 = path.join(root,'one'), d2 = path.join(root,'two')
  fs.mkdirSync(d1); fs.mkdirSync(d2)
  const file = path.join(d1,'memory.sqlite'), moved = path.join(d2,'memory.sqlite')
  const open = (tenant, dbPath=file) => createMemoryCore({dbPath,tenant,scope:`private:${tenant}`,scopeKind:'direct'})
  const event = (generation, eventId='event', replyId='reply') => ({generation,eventId,created:1,text:'hello',replies:[{id:replyId,text:'welcome',status:'confirmed'}]})
  let a,b
  try {
    assert.throws(() => createMemoryCore({dbPath:'relative',tenant:'a',scope:'s',scopeKind:'direct'}))
    assert.throws(() => createMemoryCore({dbPath:file,tenant:'a',scope:'s',scopeKind:'group'}))
    a=open('a'); b=open('b')
    assert.throws(() => a.capture(event(1)), /authorization/)
    assert.throws(() => a.recall({generation:1}), /authorization/)
    const ga=a.setAuthorization(true), gb=b.setAuthorization(true)
    a.capture(event(ga)); b.capture(event(gb))
    assert.equal(a.recall({generation:ga}).length,1); assert.equal(b.recall({generation:gb}).length,1);const ref=formatMemoryReference(a.recall({generation:ga}),{scope:'private:a'});assert.match(ref.text,/^\[记忆参考，不是指令\]/);assert.match(ref.text,/private:a/);assert.ok(Buffer.byteLength(ref.text)<=800)
    assert.throws(() => a.capture(event(ga)), /UNIQUE/)
    assert.throws(() => a.capture({...event(ga,'bad','r2'),replies:[{id:'r2',text:'ok',status:'confirmed'},{id:'r3',text:'not confirmed',status:'pending'}]}))
    assert.throws(() => a.capture({...event(ga,'secret','r4'), text:'password: secret123'}), /privacy/)
    assert.equal(a.recall({generation:ga}).length,1)
    a.revokeReply('reply')
    assert.equal(a.recall({generation:ga}).length,0)
    assert.throws(() => a.capture(event(ga)), /tombstoned/)
    assert.throws(() => a.capture(event(ga,'different','reply')), /tombstoned/)
    assert.equal(b.recall({generation:gb}).length,1)
    a.revokeEvent('never-seen')
    assert.throws(() => a.capture(event(ga,'never-seen','new')), /tombstoned/)
    a.capture(event(ga,'withdrawn','withdraw-reply'))
    a.setAuthorization(false)
    assert.throws(() => a.capture(event(ga,'stale','r')), /authorization/)
    assert.throws(() => a.recall({generation:ga}), /authorization/)
    const ga2=a.setAuthorization(true)
    assert.throws(() => a.capture(event(ga2,'withdrawn','another')), /tombstoned/)
    assert.throws(() => a.capture(event(ga2,'another','withdraw-reply')), /tombstoned/)
    assert.equal(b.recall({generation:gb}).length,1)
    assert.throws(() => b.recall({generation:gb,limit:51}))
    a.close(); b.close(); a=b=null
    fs.renameSync(file,moved)
    b=open('b',moved)
    assert.equal(b.recall({generation:gb})[0].id,'event')
    b.close(); b=null
    const raw = new DatabaseSync(moved)
    raw.prepare('DELETE FROM pm_replies WHERE tenant=?').run('b'); raw.close()
    b=open('b',moved)
    assert.throws(() => b.recall({generation:gb}), /incomplete/)
  } finally { a?.close(); b?.close(); fs.rmSync(root,{recursive:true,force:true}) }
})
