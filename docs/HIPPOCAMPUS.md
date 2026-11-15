# Hippocampus shadow

A local, owner-scoped memory shadow for confirmed text/voice exchanges. It records only after an
explicit consent record and a real OneBot receipt. It does not recall into a prompt by itself.

## Modules

```text
hippocampus/hippocampus-sqlite.mjs       versioned SQLite schema, consent, capture, retract
hippocampus/hippocampus-shadow.mjs       lazy worker-backed shadow + durable consent binding
hippocampus/hippocampus-worker-queue.mjs bounded worker queue (unknown is terminal until re-consent)
hippocampus/hippocampus-worker.mjs       SQLite worker
hippocampus/hippocampus-memory-view.mjs owner-only read model over events/replies/refs
```

## Consent

- Scope is fixed to the owner's private scope by the host.
- A process nonce is persisted beside the DB (`*.run-nonce`) so a restart keeps consent valid.
- Unknown worker results set `blocked`; a new **committed** consent is required before another write.
- Revocation/retraction is timestamped; tombstones survive deletion.

## Capture and retraction

- Capture requires a confirmed receipt for every delivered part.
- Reply-level retraction deletes only the matching reply/ref and writes a reply tombstone.
- A missing reply ID also writes a tombstone, so a later capture cannot resurrect it.
- If one reply ID is shared by multiple events, a retract without `eventId` returns `ambiguous`
  instead of deleting all matches.
- Event-level retraction is privacy-first: it deletes the event, replies, refs and reviews and keeps
  a tombstone.

## Read model

`readHippocampusMemory()` opens the DB read-only and reads events, replies and refs in one transaction
so callers do not see a half-retracted snapshot. It is a viewer, not an automatic recall injector.

## Limits

No active recall, no prompt injection, no automatic QQ recall sync, no server or network. The host
owns those boundaries.
