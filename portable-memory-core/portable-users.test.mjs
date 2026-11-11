import assert from 'node:assert/strict'
import {normalizePortableUsers} from './onebot.mjs'

assert.deepEqual(normalizePortableUsers('111111111,222222222',{owners:['999999999'],ownerShadow:true}),['111111111','222222222','999999999'])
assert.deepEqual(normalizePortableUsers('*',{owners:['999999999'],ownerShadow:true}),['*'],'wildcard must not become [*, owner]')
assert.deepEqual(normalizePortableUsers('111111111',{owners:['999999999'],ownerShadow:false}),['111111111'])
assert.deepEqual(normalizePortableUsers('',{owners:['999999999'],ownerShadow:true}),['999999999'])
assert.throws(()=>normalizePortableUsers('',{owners:['999999999'],ownerShadow:false}),/invalid memory users/)
assert.throws(()=>normalizePortableUsers('bad',{owners:[],ownerShadow:true}),/invalid memory users/)
console.log('portable users passed')
