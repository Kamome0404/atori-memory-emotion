# Security

See the repository-level [SECURITY.md](../SECURITY.md).

The short version:

- Memory stores private text by design. Protect the database and backups.
- Consent, disclosure, retention and revocation belong to the host.
- Automatic OneBot enrollment is not consent.
- Tombstones and gap fencing are not encryption.
- The emotion layer stores no raw text, but its mood/labels are still private state.
- Do not include real conversations, credentials, or database files in bug reports.
