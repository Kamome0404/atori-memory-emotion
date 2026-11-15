import test from 'node:test'
import assert from 'node:assert/strict'
import { selectAutoRecall } from '../autobio/auto-recall.mjs'

const c1 = { id: 'c1', status: 'approved', uncertain: 0, text: '我最喜欢的是海边的废墟' }
const c2 = { id: 'c2', status: 'approved', uncertain: 0, text: '我昨天去看了海边的废墟' }

test('auto recall requires unique meaningful match', () => {
  assert.equal(selectAutoRecall({ text: '今天又想起海边的废墟了', approved: [c1] }).id, 'c1')
  assert.equal(selectAutoRecall({ text: '今天天气不错', approved: [c1] }), null)
  assert.equal(selectAutoRecall({ text: '海边的废墟', approved: [c1, c2] }), null)
  assert.equal(selectAutoRecall({ text: '海边的废墟', approved: [{ ...c1, status: 'pending' }] }), null)
})

test('negative emotion prefix does not match another emotion memory', () => {
  const sad = { id: 'sad', status: 'approved', uncertain: 0, text: '我现在很难过' }
  assert.equal(selectAutoRecall({ text: '我现在很开心', approved: [sad] }), null)
})

test('generic remember token alone does not match', () => {
  const c = { id: 'x', status: 'approved', uncertain: 0, text: '你还记得海边的约定吗' }
  assert.equal(selectAutoRecall({ text: '我还记得那个', approved: [c] }), null)
})
