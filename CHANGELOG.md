# Changelog

## 0.10.0 - 2026-11-19

- Add `hippocampus/memory-state-contract.mjs`: pure 30/180-day state overlay, owner-confirmed weight, pinned/uncertain/invalidated handling.
- Add `hippocampus/memory-time-cue.mjs`: explicit Shanghai-day cue parsing only.
- Add `hippocampus/hippocampus-scene-index.mjs`: owner-scoped scene-index head, staging, source validation, atomic publish/reconcile, read-only probe, and forget filtering.
- Add `hippocampus/memory-timeline-view.mjs` and `memory-timeline-sources.mjs`: bounded read-only timeline projection and source adapters.
- Add `hippocampus/forget-closure.mjs`: advisory forget list, normalized QQ inbound ids, source/conv cleanup helpers, autobio invalidation.
- Update `hippocampus/hippocampus-sqlite.mjs` with the memory-state event cursors and state overlay.
- Add smoke tests; package remains dependency-free.
- No host data, paths, credentials, logs, persona or conversation exports are included.

## 0.9.0 - 2026-11-15

- Add `autobio/`: review-gated candidates, strict scope/digest review, source revocation, send-time revalidation, and an optional unique-match auto-recall selector.
- Add `hippocampus/`: owner-consented confirmed text/voice shadow, durable process nonce, reply tombstones, ambiguity-safe retract, worker queue and a read-only memory viewer.
- Add module tests and documentation; package now exposes autobio/hippocampus entry points.
- No host data, config, credentials, logs or conversation exports are included.
- 162 tests pass.

## 0.8.0 - 2026-11-15

- Add confirmed-exchange projection for downstream memory consumers.
- Add owner-authorized `resumeAfterGap` to the adapter/OneBot bridge; preserves events and records the gap resolution.
- Expose revocation notifications through `onRevoked`; callers can invalidate dependent derived references.
- Add full approved-candidate reads and revoked-source handling in runtime integrations.
- Add single-job cancellation and stricter delivery validation to the proactive runtime.
- Keep all four modules dependency-free; 109 tests pass.

## 0.7.1 - 2026-11-13

- Normalize UID at the adapter boundary; numeric and string UIDs now revalidate identically.
- Add runtime factories for proactive reminders and consolidation loading/scheduling.
- Explicit agreed reminders are not blocked by self-initiated quota/cooldown; quiet hours still apply.
- Keep core SQL, provenance and revocation semantics unchanged.
- 109 tests pass.

## 0.7.0 - 2026-11-13

- Add excerpt-backed memory consolidation with source event digests.
- Store fixed-template summary content; arbitrary free prose is refused.
- Exclude preference and protected boundary sources from consolidation.
- Delete summaries when any source event/reply is revoked.
- Load summaries only in private scope; validate content/source digests at send time.
- Add adapter/core integration tests; 97 tests pass.

## 0.6.1 - 2026-11-13

- Add episode provenance with own event and source digests; send-time structural validation.
- Add episode source revalidation and preference/episode kind dispatch.
- Add derived tombstones so a deleted derived reply cannot be rebound to another source.
- Disable ordinary history fallback when derived history was injected without a current episode.
- Harden preference taint checks for replies and mixed clauses.
- 88 tests pass.

## 0.6.0 - 2026-11-13

- Add persistent derived episode history with own/source event digests.
- Revoking a source event, own event, or reply deletes the entire derived record.
- Reject preference-tainted user text, source text, and replies.
- Reject rebinding the same derived id to a different source snapshot.
- Keep current preference claims separate from historical/derived continuity.
- 87 tests pass.

## 0.5.0 - 2026-11-13

- Add frozen provenance snapshots and send-time structural revalidation for preference references.
- Add object-level preference fences; revoking a correction cannot revive an older opposite claim.
- Clear current preference claims on new transport session / `resumeAfterGap`; keep events.
- Archive historical claims separately for "以前说过" soft context; never treat them as current.
- Add broad preference-query gating and dual-polarity Stage I filtering.
- Add provenance/history/revocation tests; 79 tests pass.

## 0.4.0 - 2026-11-13

- Add one audited preference registry shared by claim extraction and context lookup.
- Add `REGISTRY_VERSION`; claim extractor version remains independent.
- Add multi-object mention parsing with text-order and boundary rules.
- Add stale-positive clause filtering with object/predicate pairing and negation handling.
- Add send-time reference validation (`referenceStillCurrent`).
- Add compose-shaped tests for final-message filtering.
- Expand tests to 65.
- Do not include host-specific chat orchestration, persona files, credentials, or conversation data.

## 0.3.0 - 2026-11-13

- Add `memory.readPreference({ generation, activity, object })`: a read-only, exact self-reported preference lookup.
- Latest `created` wins; a same-timestamp positive/negative pair returns `null` instead of silently picking a side.
- Old claims remain as history; no schema migration, deletion, decay, or automatic merge.
- Add `reader/`: explicit `catch` / `reply` / `none` classification and a bounded prompt increment.
- Add regression tests for preference read/correction/ambiguity and reader signal routing.
- Add `docs/READER.md` and integration limits.
- Do not include host-specific chat orchestration, persona files, credentials, or conversation data.

## 0.2.0 - 2026-11-11

- Add `episodeState: open | resolved | reopened | uncertain` to the classifier.
- `resolved` closes only the matching episode; `reopened` allows attention again.
- Pass active episode names into the classifier so repair/recurrence can reuse the same label.
- Keep soft play/soothe/neutral from becoming an attention reminder.
- Add regression tests for interleaved episodes, repair, reopening, and active-label reuse.
- 16 test files pass on the isolated fixture.
