# Preference layer

A conservative, audited layer for a person's explicitly self-reported preferences.

## Modules

```
portable-memory-core/preference-registry.mjs
portable-memory-core/preference-context.mjs
preference/preference-policy.mjs
preference/memory-reference.mjs
```

## Registry

One source of truth for allowed objects:

```
喝  heat/cold/warm/sugar-free x coffee/milk/tea/juice/cocoa + base objects
吃  heat/cold/sweet/plain x noodles/cake/chocolate/rice + base objects
听  classical/pop/light/pure + music
看  sci-fi/comedy/animation + movie; animation; book
```

`REGISTRY_VERSION` tracks the registry, independently from claim extractor versioning.

## Context

`findPreferenceMentions(text)` only accepts:

```
self-referential: starts with 我
question/choice: ? / 吗 / 呢 / 什么 / 哪个 / 还是 / 要不要
a known object with a valid prefix and follow boundary
```

It returns all non-overlapping mentions in text order. `findPreferenceMention()` returns the first one for compatibility.

## Policy

`createPreferenceTurn({ mentions, claim })` removes stale positive clauses from prompt blocks and message history:

```
object-specific, not whole-line
nearest predicate pairing
object-first and predicate-first negation
unrelated facts preserved
compound lookalikes do not match
```

It does not modify the current user message or original stored evidence.

## Reference

`referenceStillCurrent()` is the send-time check for an injected memory reference. A changed, revoked, or missing reference fails closed.

## Limits

- Explicit self-reported claims only; no model or vector inference.
- No group profile, personality inference, decay, or automatic merge.
- Host-specific prompt assembly and conversation history are not included.
- No guarantee that an untracked free-text summary is fully clean; callers should conservatively remove blocks they cannot trace.
