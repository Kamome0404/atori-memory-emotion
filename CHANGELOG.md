# Changelog

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
