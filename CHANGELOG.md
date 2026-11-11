# Changelog

## 0.2.0 - 2026-11-11

- Add `episodeState: open | resolved | reopened | uncertain` to the classifier.
- `resolved` closes only the matching episode; `reopened` allows attention again.
- Pass active episode names into the classifier so repair/recurrence can reuse the same label.
- Keep soft play/soothe/neutral from becoming an attention reminder.
- Add regression tests for interleaved episodes, repair, reopening, and active-label reuse.
- 16 test files pass on the isolated fixture.
