# Changelog

## 0.1.1 — packaging only (no behaviour change)

- Renamed the package to `atori-memory-emotion` everywhere (the archive was
  previously named `atri-*`).
- Stripped UTF-8 BOM from `.gitignore` and four source files. The BOM silently
  broke the first `.gitignore` pattern (`node_modules/`).
- `scripts/test.mjs` now preflights `node:sqlite` and prints the
  `--experimental-sqlite` hint (exit code 2) instead of failing mid-run.
- README documents the Node 22.13–23.3 flag requirement and states that the
  bundled examples/localised strings are Chinese.
- `SECURITY.md` gained a private vulnerability-reporting section.
- `docs/SECURITY.md` is now a pointer to the root policy instead of a copy.
- Added `author`, `keywords`, and an `examples` npm script.

**Before publishing:** fill in `repository`, `homepage` and `bugs` in
`package.json`, and decide the licence holder name in `LICENSE`
(currently "Atori Project contributors").

## 0.1.0 — first public candidate

- Portable event memory: confirmed capture, bounded retrieval, retraction,
  tombstones, delivery-gap fencing, gap resume/reset.
- Minimal emotion state: inertia, uncertainty, residue, attention, relevance.
- 15 test suites via `node scripts/test.mjs`; two runnable examples.
