# Security

## Scope

This package is a library, not a hosted service. The host application must:

- authenticate the transport and the user;
- choose the correct tenant and `private:<tenant>` scope;
- display a real disclosure and obtain consent before enabling memory;
- enforce retention and deletion promises;
- protect database files, WAL/SHM files, backups, logs, and model prompts;
- decide whether storing private text is appropriate at all.

## Important properties

- `createMemoryCore` binds one tenant/scope per instance.
- A stale authorization generation is rejected inside the same write transaction.
- Reply retraction removes the whole event and leaves tombstones.
- Delivery gaps fence the account until an operator resumes or resets them.
- `resumeAfterGap` preserves old events; `resetAfterGap` erases them.
- The OneBot adapter's automatic enrollment is **not** proof of informed consent.
- The emotion module stores no raw conversation text. It stores stance, short mood, labels, event IDs, uncertainty, and a short residue marker.

## Not provided

- encryption at rest
- secure erase of SQLite pages, WAL, backups, or delivered model text
- retention expiry
- semantic access control
- protection from a caller with direct filesystem/management access
- multi-tenant isolation beyond the core's tenant/scope checks
- verified deletion from third-party model providers or logs

## Reporting

Open an issue with reproduction steps using dummy data. Do not include real private conversations, credentials, database files, or backups.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Preferred: open a private security advisory on the repository
  (GitHub → Security → Advisories → "Report a vulnerability").
- Include: affected version, a minimal reproduction, and what you expected.
- We aim to acknowledge within 7 days. This is a small project; there is no
  bounty programme and no guaranteed SLA.

## Supported versions

Only the latest released minor version receives fixes. `0.x` releases may
change APIs between minors; read `CHANGELOG.md` before upgrading.
