/**
 * 最小读人层 v1（revision 3）。
 *
 * 只判断“用户这次明确说了要怎么听”，不做情绪猜测、不判亲疏、不做隐含意图。
 * 三种结果：
 *   catch - 先接住，不抢建议
 *   reply - 直接给答案/办法
 *   none  - 没有明确信号，prompt 必须一字不改
 *
 * revision 3 修正：
 *   - “我不要结论，我要办法”这类转折句不再两头落空
 *   - “别给我个方案”不再反转成 reply
 *   - “你听着，别插嘴”仍算 catch
 *   - 只在否定从句内阻断 reply，不跨逗号误伤后半句
 */

const CATCH_PATTERNS = [
  /(?:先|你)?听我(?:把话)?(?:说|讲)(?:完)?/,
  /(?:先|你)?先?别(?:急着)?(?:给建议|讲道理|分析|解决|安慰|给方案|给办法|给结论|下结论)/,
  /(?:别|不要|不用)(?:再)?(?:给我)?(?:个|一个)?(?:说|讲|提)?(?:建议|办法|方案|讲道理|分析|安慰|结论)(?:了)?/,
  /(?:我)?(?:就|只|先)?想(?:先)?(?:说说|讲两句|发泄|吐槽|被听见)/,
  /^(?:你)?(?:就)?听着(?:就行|就好|吧)?[。！!]?$/,
  /^(?:你)?(?:就)?听着[，,]\s*(?:别|不要)/,
  /(?:先)?陪我(?:一会儿|一下|待会儿)/,
  /(?:别|不要)(?:教我|指导我)(?:怎么|如何)?做/,
  /(?:我)?不想听(?:建议|道理|分析)/,
  /让我(?:把话)?(?:说|讲)完/,
]

const REPLY_PATTERNS = [
  /^(?:你|请|那就|那|直接|马上|立刻)(?:直接|马上|立刻)?(?:说|给|告诉|回答)(?:我)?(?:怎么办|怎么解决|答案|结论|办法|方案|步骤)/,
  /^(?:你)?(?:直接|马上|立刻)(?:回答|说)(?:[，,].*)?$/,
  /^(?:给|告诉|说)(?:我)?(?:一个|个)(?:可执行|具体|明确)?(?:的)?(?:方案|办法|步骤|结论|答案)/,
  /^(?:说|讲)(?:重点|结论|结果)/,
  /^(?:具体|到底|那)?(?:怎么|如何)(?:解决|处理|做|弄)/,
  /^(?:别|不要)(?:解释|绕|废话)(?:了)?[，,]\s*(?:给|告诉|说)(?:我)?(?:办法|方案|步骤|结论|答案)/,
  /^(?:我)?(?:要|想要)(?:一个|个)?(?:可执行|具体|明确)?(?:的)?(?:方案|办法|步骤)/,
  // A clause starting after a comma is a new request; the negative clause before
  // it must not steal it (“我不要结论，我要办法”).
  /(?:^|[，,。；;]\s*)(?:我)?(?:要|想要)(?:一个|个)?(?:可执行|具体|明确)?(?:的)?(?:方案|办法|步骤)/,
  /(?:^|[，,。；;]\s*)(?:给|告诉|说)(?:我)?(?:结论|办法|方案|步骤|答案)/,
  // “别安慰，给个办法”: catch and reply coexist; explicit method request wins
  // unless it sits inside the negative clause.
  /(?:给|告诉|说)(?:我)?(?:一个|个)(?:可执行|具体|明确)?(?:的)?(?:方案|办法|步骤|结论)/,
]

function findFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (match) return { text: match[0], index: match.index }
  }
  return null
}

/** Text before the last clause separator, up to `index`. */
function clausePrefix(text, index) {
  const before = text.slice(0, index)
  const seps = ['，', ',', '。', '；', ';', '！', '!', '？', '?', '\n']
  let cut = -1
  for (const sep of seps) cut = Math.max(cut, before.lastIndexOf(sep))
  return before.slice(cut + 1)
}

/** A negative request immediately before this match, e.g. “先别给方案”. */
function negativeBefore(text, index) {
  const prefix = clausePrefix(text, index)
  return /(?:先别|不要|不用|别)(?:再|急着)?(?:给我)?(?:个|一个)?(?:给|讲|说|列)?$/.test(prefix)
}

/**
 * @param {string} text 用户这一轮的原始文本
 * @returns {{mode: 'catch'|'reply'|'none', matched: string, reason: string}}
 */
export function readRequest(text) {
  const value = String(text ?? '').trim()
  if (!value) return { mode: 'none', matched: '', reason: 'empty' }

  const catchHit = findFirst(value, CATCH_PATTERNS)
  const replyHit = findFirst(value, REPLY_PATTERNS)

  // A reply in a new clause may override an earlier catch (“别安慰，给个办法”).
  // But a reply inside the negative clause is suppressed (“先别给方案”).
  if (replyHit && !negativeBefore(value, replyHit.index)) {
    return { mode: 'reply', matched: replyHit.text, reason: 'explicit-reply' }
  }

  if (catchHit) return { mode: 'catch', matched: catchHit.text, reason: 'explicit-catch' }

  return { mode: 'none', matched: '', reason: 'no-explicit-signal' }
}

/**
 * 三行封顶的 prompt 增量。none 返回空字符串，调用方不得把空串拼进 system。
 * @param {{mode: string}} result
 */
export function buildReaderPrompt(result) {
  if (result?.mode === 'catch') {
    return '## 这一轮先接住\n'
      + '他现在要的是被听见，不是方案。\n'
      + '不要用“嗯”当万能开头；先接住他刚说的具体词，不主动给建议、不列步骤，也不要演共情。'
  }
  if (result?.mode === 'reply') {
    return '## 这一轮直接答\n'
      + '他现在要的是答案，不是铺垫。\n'
      + '先给结论或可执行办法，再补一句原因；不要先绕一圈。'
  }
  return ''
}

export const READER_CASES = Object.freeze({
  catch: [
    '你先听我说，别急着给建议',
    '别给建议，我就想说说',
    '你先别讲道理',
    '听我说完',
    '你就听着，别安慰我',
    '不用给我办法，我发泄一下',
    '先别分析，陪我一会儿',
    '我不想听建议',
    '你先别急着解决',
    '别教我怎么做',
    '先别给方案',
    '让我把话说完',
    '我想先说说',
    '你先听我讲',
    '先别给结论，我再想想',
    '你听着，别插嘴',
    '别给我个方案',
    '别再说方案了',
  ],
  reply: [
    '直接说怎么办',
    '给我一个方案',
    '说重点，怎么解决',
    '直接回答，别绕',
    '告诉我步骤',
    '给个结论',
    '你直接说结论',
    '别解释了，给办法',
    '具体怎么做',
    '我要一个可执行方案',
    '别安慰，给个办法',
    '直接告诉我答案',
    '我不要结论，我要办法',
    '不要给结论，给办法',
  ],
  none: [
    '今天好累',
    '在吗',
    '我有点难受',
    '刚才那件事还没完',
    '你觉得呢',
    '我在听着，你继续',
    '这首歌听着真舒服',
    '他直接说了不用我管',
    '先别急，我自己想想',
    '这个方案听着还行',
  ],
})
