// Small classifier prompt for the minimal emotion shadow. It classifies the
// *effect on Atori*, not who is right or what the user "really" feels.
import { IMPACTS, INTENSITIES } from './emotion-state.mjs'

const FORBIDDEN = new Set(['爱', '依赖', '占有', '忠诚', '服从', '好感', '亲密值'])
const clean = (x, max) => String(x || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function buildImpactPrompt({ userText = '', replyText = '' } = {}) {
  return [
    '你是角色的情绪观察器。只判断这句话让她自己处在什么姿态，不判断谁对谁错。',
    '输出严格 JSON，不要解释，不要 Markdown：',
    '{"impact":"neutral|soothe|play|worry|hurt|repair|boundary","focus":"self|other|unknown","intensity":"soft|normal|strong","salience":"low|medium|high","uncertain":true|false,"mood":"一句不超过40字的心情","labels":["最多3个短标签"]}',
    '规则：',
    'impact 是“她自己当下的姿态”，不是“用户此刻是什么情绪”。',
    'boundary 只用于她拒绝、坚持不同意、明确划界。单纯接受、给对方空间、说“你忙你的”不算 boundary。',
    'soothe 只用于她明确安慰、哄、让对方放心：例如对方刚受伤、刚道歉、刚不安之后。普通关心、提醒、安排作息不算 soothe。',
    '对方说“累/难受/不开心/担心”时，如果她在关心，impact 用 worry，不要用 soothe。',
    '普通寒暄、问她在做什么、说自己要睡了、说晚安，impact 用 neutral，不要硬套 soothe。',
    '如果她在安抚或让对方放心，即使嘴硬，impact 用 soothe，不要用 play。',
    '只有双方在互相逗、没有安抚意图，才用 play。',
    '如果她承认吃醋、担心、被冷落、被否定，impact 用 worry 或 hurt，不要用 play。',
    'focus=self 表示这句主要关于她自己的感受/边界；focus=other 表示她主要在担心/照顾用户。',
    'intensity：soft=普通玩笑、轻微在意、可以一笑而过；normal=明确划界、明确被刺到、明确吃醋/担心/拒绝；strong=反复越界、身份否定、连续伤害。',
    'salience：low=普通寒暄/安排/闲聊；medium=有情绪但轻、可以自然带过；high=这一轮需要她注意对方的边界、受伤、不确定或修复。',
    '只要涉及她自己的边界、被否定、被比较、被要求排他、明确吃醋，intensity 至少 normal，不要因为语气轻就判 soft。',
    '例子：',
    '她拒绝探私事 -> boundary/normal/self',
    '她说“你忙你的，我不催” -> soothe/soft/other',
    '她说“心里咯噔一下” -> worry/normal/self',
    '她说“才没有不高兴，就是想戳你一下” -> soothe/normal/other',
    '对方说“今天好累” 她回“早点躺下/忙什么了” -> worry/normal/other',
    '对方问“你在做什么” 她回自己的事 -> neutral/soft/self',
    '对方说“准备睡了/晚安” -> neutral/soft/other',
    '拿不准时 impact=neutral，intensity=soft，uncertain=true。',
    '不要输出“爱/依赖/占有/忠诚/服从/好感/亲密值”这类关系词。',
    'mood 用她自己的口吻，不要写“用户让我”。',
    `用户：${clean(userText, 1200)}`,
    `角色刚才的回复：${clean(replyText, 1200)}`,
  ].join('\n')
}

export function parseImpact(raw) {
  let text = String(raw || '').trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { impact: 'neutral', focus: 'unknown', salience: 'low', intensity: 'soft', uncertain: true, mood: '', labels: [] }
  let data
  try { data = JSON.parse(text.slice(start, end + 1)) } catch {
    return { impact: 'neutral', focus: 'unknown', salience: 'low', intensity: 'soft', uncertain: true, mood: '', labels: [] }
  }
  const impact = IMPACTS.includes(data.impact) ? data.impact : 'neutral'
  const focus = ['self', 'other'].includes(data.focus) ? data.focus : 'unknown'
  const salience = ['low', 'medium', 'high'].includes(data.salience) ? data.salience : 'low'
  const intensity = INTENSITIES.includes(data.intensity) ? data.intensity : 'normal'
  const uncertain = typeof data.uncertain === 'boolean' ? data.uncertain : true
  const mood = clean(data.mood, 120)
  const labels = (Array.isArray(data.labels) ? data.labels : [])
    .filter(x => typeof x === 'string' && /^[\u4e00-\u9fa5]{1,8}$/.test(x) && !FORBIDDEN.has(x))
    .slice(0, 3)
  return { impact, focus, salience, intensity, uncertain, mood, labels }
}

export function createImpactClassifier({ ask, timeoutMs = 15000 } = {}) {
  if (typeof ask !== 'function') throw new TypeError('ask function required')
  async function classify({ userText = '', replyText = '' } = {}) {
    const prompt = buildImpactPrompt({ userText, replyText })
    let timer
    try {
      const raw = await Promise.race([
        ask(prompt),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('classifier_timeout')), timeoutMs) }),
      ])
      return parseImpact(raw)
    } finally { clearTimeout(timer) }
  }
  return Object.freeze({ classify, buildPrompt: buildImpactPrompt })
}
