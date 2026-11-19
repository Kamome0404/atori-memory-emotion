# Memory state and scene index

`hippocampus/` now includes an optional read-only scene layer on top of the
confirmed-exchange store.

- `memory-state-contract.mjs`: pure 30/180-day projection; owner-confirmed
  events keep weight; archived/invalidated events are excluded by callers.
- `memory-time-cue.mjs`: parses only explicit day words; ambiguous phrases
  return `null`.
- `happocampus-scene-index.mjs`: scene head/staging under the existing `meta`
  namespace, source validation, atomic publish and reconcile. It does not
  create a new table and does not copy message text.
- `memory-timeline-view.mjs` / `memory-timeline-sources.mjs`: bounded,
  read-only timeline projection; no model and no writes.
- `forget-closure.mjs`: an advisory forget list and local cleanup helpers.
  Callers must still review scope and confirm destructive actions.

These modules are experimental. They assume a caller-owned SQLite database and
an owner-scoped source model. They do not provide a transport, model, UI, or
consent flow.
