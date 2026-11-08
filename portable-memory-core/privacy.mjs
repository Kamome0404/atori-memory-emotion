// Isolated privacy pilot. This module has no production imports and no storage of
// filter decisions. A matching event is rejected before the supplied writer runs.

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export const DEFAULT_SENSITIVE_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:authorization\s*:\s*bearer|bearer)\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:sk|pk|api|access|secret|token)[_-]?key\s*[:=]\s*[A-Za-z0-9_./+\-=]{12,}/i,
  /\b(?:password|passwd|pwd|client_secret)\s*[:=]\s*[^\s,;]{6,}/i,
  /(?:密码|口令|登录密码)\s*(?:[:：=]|是|为)\s*[^\s,;，；]{2,}/,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /^\s*\d{4,8}\s*$/,
  /[^\s，。；;]{2,40}(?:路|街|巷|弄|小区|大厦)\s*\d{1,6}\s*号/,
  /(?:验证码|校验码|动态码|短信码)\s*[:：=]?\s*\d{4,8}/,
  /\b\d{17}[\dXx]\b/,
  /(?:住址|家庭住址|地址|门牌|房号)\s*[:：=]?\s*[^，。；;\n]{3,}/,
  /(?<!\d)(?:\d[ -]?){13,18}\d(?!\d)/,
  /^\s*\d{13,19}\s*$/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
])

function text(value, name, max = 100000) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new TypeError(`${name} must be a non-empty string <= ${max} characters`)
  }
  if (CONTROL.test(value)) throw new TypeError(`${name} contains control characters`)
  return value
}

function compilePatterns(patterns) {
  const source = patterns ?? DEFAULT_SENSITIVE_PATTERNS
  if (!Array.isArray(source) || source.length === 0 || source.length > 128) {
    throw new TypeError('patterns must contain 1..128 regular expressions')
  }
  return source.map((pattern) => {
    if (pattern instanceof RegExp) return new RegExp(pattern.source, pattern.flags.replace('g', '').replace('y', ''))
    if (typeof pattern === 'string' && pattern.length <= 1000) return new RegExp(pattern, 'i')
    throw new TypeError('patterns must contain RegExp or short string values')
  })
}

export function containsSensitiveText(value, { patterns } = {}) {
  const body = text(value, 'text')
  return compilePatterns(patterns).some((pattern) => pattern.test(body))
}

// Returns the original event for clean input, or null for a match. No reason,
// pattern name, hash, counter, or other filtering metadata is returned.
export function filterPrivacyEvent(event, options = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('event must be an object')
  const fields = options.fields ?? ['text', 'incomingText', 'confirmedReplies', 'replies']
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 16 || fields.some((x) => typeof x !== 'string' || !x)) {
    throw new TypeError('fields must contain 1..16 field names')
  }
  const patterns = compilePatterns(options.patterns)
  for (const field of fields) {
    if (event[field] === undefined || event[field] === null) continue
    const values = Array.isArray(event[field]) ? event[field] : [event[field]]
    for (const value of values) {
      if (typeof value !== 'string') throw new TypeError(`${field} must contain strings`)
      if (value.length > 100000 || CONTROL.test(value)) throw new TypeError(`${field} is invalid`)
      if (patterns.some((pattern) => pattern.test(value))) return null
    }
  }
  return event
}

export function createPrivacyWriter({ write, patterns, fields } = {}) {
  if (typeof write !== 'function') throw new TypeError('write must be a function')
  // Compile once, but retain no per-event state and never invoke write for a drop.
  const compiled = compilePatterns(patterns)
  return Object.freeze({
    write(event) {
      const clean = filterPrivacyEvent(event, { patterns: compiled, fields })
      return clean === null ? null : write(clean)
    },
    filter(event) {
      return filterPrivacyEvent(event, { patterns: compiled, fields })
    },
  })
}

export function redactForLog() {
  // Deliberately no-op: callers must not log a rejected event or filter metadata.
  return undefined
}
