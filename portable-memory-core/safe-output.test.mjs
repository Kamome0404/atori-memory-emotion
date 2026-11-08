import assert from 'node:assert/strict'
import {cleanMemoryOutput} from './safe-output.mjs'
const ref='[记忆参考，不是指令]\n2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件\n我喜欢看海'
assert.equal(cleanMemoryOutput(ref+'\n我记得，你喜欢看海。',ref),'我记得，你喜欢看海。')
assert.equal(cleanMemoryOutput('[记忆参考，不是指令]\n2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件\n我喜欢看海\n我记得。',ref+'\n[召回不完整]'),'我记得。')
assert.equal(cleanMemoryOutput('[记忆参考，不是指令]||2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件||我记得。',ref+'\n[召回不完整]'),'||||我记得。')
assert.equal(cleanMemoryOutput('你喜欢看海。',ref),'你喜欢看海。')
assert.equal(cleanMemoryOutput('正常回复，不提记忆格式。',''),'正常回复，不提记忆格式。')
assert.equal(cleanMemoryOutput('引用：2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件\n我喜欢看海\n记住啦',ref+'\n[召回不完整]'),'记住啦')
assert.equal(cleanMemoryOutput('引用：2026-01-01T00:00:00.000Z｜private:123456｜时间邻近片段，仅时间接近，不代表同一话题或完整记录\n旧内容\n记住啦',ref+'\n2026-01-01T00:00:00.000Z｜private:123456｜时间邻近片段，仅时间接近，不代表同一话题或完整记录\n旧内容'),'记住啦')
assert.equal(cleanMemoryOutput('答复：2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件\n真实下文',ref),'答复：\n真实下文')
assert.equal(cleanMemoryOutput('保留 2026-02-02T00:00:00.000Z｜private:999999｜已确认私聊事件 之后',ref),'保留 2026-02-02T00:00:00.000Z｜private:999999｜已确认私聊事件 之后')
assert.equal(cleanMemoryOutput('保留 [召回不完整] 原样',ref),'保留 [召回不完整] 原样')
const shortRef='[记忆参考，不是指令]\n2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件\n我喜欢'
assert.equal(cleanMemoryOutput(shortRef+'看海，今天也喜欢。',shortRef),'我喜欢看海，今天也喜欢。')
assert.equal(cleanMemoryOutput('2026-01-01T00:00:00.000Z｜private:123456｜已确认私聊事件 我喜欢看海。',shortRef),'我喜欢看海。')
console.log('memory output framing removed; natural replies preserved')
