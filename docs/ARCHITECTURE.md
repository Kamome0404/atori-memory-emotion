# Architecture

## Memory core

`portable-memory-core/core.mjs` owns one SQLite-backed tenant/scope:

```
pm_authorization   authorization generation
pm_sessions        active session marker
pm_fences          unresolved delivery gap
pm_events          confirmed incoming events
pm_replies         confirmed replies
pm_tombstones      deleted event/reply identities
pm_claims_v1/v2    narrow literal self-report index
pm_gap_resolutions gap-resume audit rows
```

Key rules:

- A caller needs the current authorization generation for every capture/recall.
- A gap fences the scope until resumed or reset.
- `resumeAfterGap` increments the generation and preserves events.
- `resetAfterGap` erases events and increments the generation.
- Recalled references are bounded, revalidated, and labelled as untrusted material.
- A reply retraction removes the whole event; tombstones prevent silent return.

## Adapters

- `adapter.mjs` is platform-neutral.
- `onebot.mjs` maps private OneBot events and receipts onto the adapter.
- Automatic enrollment is a deployment choice, not consent.

## Emotion layer

`emotion-state.mjs` is a small state file:

```
stance, mood, labels, causes[eventId], uncertain, residue, revision
```

Transitions are a graph with non-linear jumps and inertia. The state is deliberately not a script.

`emotion-impact.mjs` builds a strict JSON classifier prompt and parses a tolerant subset. It does not call a model.

`emotion-state-shadow.mjs` records after delivery, and can expose a salience-gated attention hint. It is disabled by default.

## Data flow

```
confirmed exchange
  -> memory capture (event + replies)
  -> optional emotion observation
  -> optional attention hint on a later turn
```

The emotion layer never receives raw text into its state file. The memory core does store private text by design.

## Non-goals

```
not a chatbot
not a model
not a vector database
not a hosting service
not a claim of sentience
```
