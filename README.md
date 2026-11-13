# atori-memory-emotion

Four small, dependency-free Node.js modules for a long-lived companion character:

1. **Portable event memory** — private-scope conversation memory with confirmation, retrieval, retraction, tombstones, gap fencing, and resumable gaps.
2. **Minimal emotion state** — a non-scripted state layer with inertia, uncertainty, residue, attention, and a relevance gate.
3. **Conservative read-person layer** — three explicit modes (`catch`, `reply`, `none`) for the narrow case where a person asks to be heard, asks for an answer, or gives no explicit signal.
4. **Audited preference layer** — one registry for write/read/question terms, multi-object mention parsing, stale-positive filtering, and a send-time reference check.

This is not a chatbot, a model, a UI, or a hosted service. It does not call a network API. You bring your own model, transport, consent flow, and storage policy.

**Status: experimental.** The tests are the contract. Read the limits before using it with real people.

---

## Requirements

- Node.js **22.13+** with `node:sqlite`
- No npm dependencies
- Windows tested; other platforms not yet verified

```bash
node --version
npm test
```

---

## Why these four modules exist

Most “memory” and “emotion” add-ons are either:

- a vector store with no retraction semantics, or
- a scripted set of labels such as “angry / happy / sad”.

This package takes a narrower approach:

### Memory

```
capture only confirmed exchanges
retrieve bounded references, not a global transcript
retract by event or reply id
keep tombstones so deleted content does not silently return
fence unresolved delivery gaps
resume a gap without erasing the old events
```

### Emotion

```
state is a stance, not a line of dialogue
transitions are a graph, not a fixed sequence
hold / soft events do not force a jump
uncertainty and residue are allowed
attention is a hint, not a script
```

### Preference

- Only explicit self-reported claims; no inference from behavior or mood.
- The object registry is intentionally finite. Unknown nouns fail closed.
- A negative claim suppresses the old positive. It does not rewrite stored evidence.
- `REGISTRY_VERSION` is not the claim extractor version.
- Untracked free-text summaries cannot be guaranteed clean; callers should remove blocks they cannot trace.

### Reader

```
catch: the person explicitly asks to be heard first
reply: the person explicitly asks for an answer
none: no explicit signal; leave the caller's prompt unchanged
```

The reader stores no text and calls no model. It is intentionally narrow: ambiguity is `none`, not a guess.

### Preference

```
explicit self-reported claim
audited object registry
find all mentions, inject at most one
remove stale positive clauses
send-time reference check
```

It never infers a preference from behavior, mood, or a third-party statement.

The emotion module stores **no raw chat text**. It stores a short mood, a few labels, event IDs, and a stance.

---

## Package layout

```text
portable-memory-core/   memory core, adapter, OneBot bridge and tests
emotion/                minimal emotion state, impact classifier, shadow recorder
reader/                 explicit-signal read-person classifier and prompt increment
preference/             preference policy and send-time reference check
test/                   memory, emotion, preference, and reader tests
examples/               runnable examples with dummy data
docs/                   design notes
scripts/test.mjs        cross-platform test runner
```

---

## Quick start: memory

```js
import { createMemoryCore } from './portable-memory-core/core.mjs'

const memory = createMemoryCore({
  dbPath: '/absolute/path/memory.sqlite',
  tenant: 'alice',
  scope: 'private:alice',
  scopeKind: 'direct',
})

const generation = memory.setAuthorization(true)
memory.capture({
  generation,
  eventId: 'e1',
  created: Date.now(),
  text: 'I like jasmine tea.',
  replies: [{ id: 'r1', text: 'Noted.', status: 'confirmed' }],
})

const events = memory.recall({ generation, limit: 10 })
memory.revokeReply('r1')   // deletes the event; retains tombstones
memory.close()
```

The OneBot bridge is separate:

```js
import { createOneBotMemory } from './portable-memory-core/onebot.mjs'
```

`createOneBotMemory` can enroll an unseen private user automatically. **Automatic enrollment is not informed consent.** The host must own the disclosure, consent, revocation, and data-retention flow.

---

## Quick start: emotion

```js
import { createEmotionState } from './emotion/emotion-state.mjs'

const emotion = createEmotionState({
  filePath: '/absolute/path/owner.json',
  ownerUid: '123456789',
})

emotion.observe({
  eventId: 'e1',
  confirmed: true,
  impact: 'hurt',
  intensity: 'normal',
  mood: '有点在意，但不想闹',
  labels: ['在意', '嘴硬'],
})

console.log(emotion.snapshot().stance)
console.log(emotion.promptBlock())
emotion.retract({ eventId: 'e1' })
```

`emotion-state-shadow.mjs` is an optional recorder. It classifies an exchange **after** delivery and updates state without changing the reply. It is disabled by default.

The classifier is deliberately small and imperfect. `emotion-impact.mjs` exposes a prompt builder and a tolerant parser; it does not call a model itself.

---

## Quick start: reader

```js
import { readRequest, buildReaderPrompt } from './reader/reader.mjs'

const mode = readRequest('先听我说，别急着给建议')
// { mode: 'catch', matched: '先听我说', ... }

const increment = buildReaderPrompt(mode)
// '' for none; at most three lines for catch/reply
```

The caller decides where to inject the increment. `none` returns an empty string, so no prompt change is required.

---

## Quick start: preference

```js
import { findPreferenceMentions } from './portable-memory-core/preference-context.mjs'
import { createPreferenceTurn } from './preference/preference-policy.mjs'
import { referenceStillCurrent } from './preference/memory-reference.mjs'

const mentions = findPreferenceMentions('我想喝咖啡还是茶？')
const turn = createPreferenceTurn({ mentions, claim: null })
const safeBlock = turn.sanitizeBlock('## old\n我喜欢喝咖啡。')
const current = referenceStillCurrent({ used: true, turn: null })
```

---

## Run the examples

```bash
node examples/memory-quickstart.mjs
node examples/emotion-quickstart.mjs
```

Both examples use a temporary directory and dummy identities.

---

## Tests

```bash
npm test
```

The suite includes:

```
memory isolation, recall, retraction, tombstones, gap resume
OneBot receipt and withdrawal handling
episode reference windows
emotion transitions, hold/soft inertia
uncertainty, residue, attention
salience-gated attention
episode state (open / resolved / reopened)
active-episode reuse
self-reported preference read model (latest wins, corrections, ambiguity)
reader catch / reply / none regression cases
```

The tests use temporary databases and dummy users only.

---

## Safety and honest limits

### Memory

- It stores private conversation text by design. Encrypt the database and backups if your threat model needs it.
- It cannot prevent a caller with filesystem or management access from bypassing controls.
- The privacy filter is heuristic.
- Tombstones persist indefinitely. Secure deletion of SQLite pages, WAL, backups, and already-delivered model text is **not** provided.
- Group conversations are not supported.
- The OneBot adapter accepts only private text messages and authenticates the transport; it does not establish consent.

### Emotion

- It cannot establish sentience, feelings, or subjective experience.
- The classifier can be wrong. `uncertain` and human review are intentional.
- Injection is a hint. Do not let a state block override current facts or safety.
- It does not learn or train itself.

### Preference

- Only explicit self-reported claims; no inference from behavior or mood.
- The object registry is intentionally finite. Unknown nouns fail closed.
- A negative claim suppresses the old positive. It does not rewrite stored evidence.
- `REGISTRY_VERSION` is not the claim extractor version.
- Untracked free-text summaries cannot be guaranteed clean; callers should remove blocks they cannot trace.

### Reader

- It only reads explicit phrases. It cannot infer intent from silence, mood, or context.
- `none` is the correct result for ambiguity; do not treat it as a failure.
- It does not store conversation text.
- The caller remains responsible for scope: owner/friend private chat, or group messages explicitly addressed to the character.

### Both

- Not production-hardened.
- No encryption, retention expiry, UI, hosting, or multi-tenant service.
- Do not deploy to real users without an independent consent and privacy review.

---

## Design notes

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/EMOTION.md](docs/EMOTION.md)
- [docs/READER.md](docs/READER.md)
- [docs/PREFERENCE.md](docs/PREFERENCE.md)
- [docs/SECURITY.md](docs/SECURITY.md)

---

## License

MIT. See [LICENSE](LICENSE).
