# Autobio memory

A review-gated layer for "approved references from the past". It is deliberately not an automatic
transcript: a candidate must be reviewed by an owner, carries a content digest, and is filtered by
scope and authorization generation.

## Modules

```text
autobio/contracts.mjs      candidate shape and validation
autobio/policy.mjs         review, source, receipt and claim rules
autobio/store.mjs          SQLite candidates, sources and delivery observations
autobio/runtime.mjs        observe/submit/review/list/select/invalidate
autobio/integration.mjs    matching, formatting, source-revocation handler
autobio/auto-recall.mjs    optional unique-match selector; caller decides to enable it
autobio/link.mjs           thin host adapter
autobio/factory.mjs        config/feature factory used by the host
```

## Rules

- Candidate text is normalized and bounded; content is hashed with SHA-256.
- Pending candidates never enter a prompt.
- `review()` requires an authorized reviewer, the candidate's scope, and the expected digest.
- Approved references are bound to a generation; a gap resume can invalidate old approvals.
- A source revocation invalidates the affected scope; callers should also re-check before sending.
- Receipts must be real, numeric OneBot message IDs. `media:`, `self:` and `synthetic:` IDs are
  ineligible.
- `observeDelivery` is evidence, not a guarantee that the model used the reference naturally.

## Auto recall caveat

`selectAutoRecall()` returns a candidate only when exactly one approved candidate has a meaningful
token overlap and no explicit memory question is being answered elsewhere. It is a selector, not a
permission system. The host must keep it behind an owner switch, re-check approval/generation at
send time, and never use a pending or uncertain candidate.

## Not included

No transcript store, no model call, no network, no consent UI, no automatic sending. The host owns
those policies.
