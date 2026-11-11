# Emotion model

## What it is

A small, inspectable state layer:

```
neutral, open, playful, guarded, hurt, quiet, repair
```

Transitions are legal jumps, not a required sequence. `hold` and `soft` preserve inertia. `uncertain` and `residue` allow a character to be unsure or to still be carrying the previous moment.

## What it is not

- not a claim of subjective experience
- not a fixed script
- not a classifier that is always right
- not an engagement or dependency optimizer

## Inputs

```js
observe({
  eventId,
  confirmed: true,
  impact,          // neutral | soothe | play | worry | hurt | repair | boundary
  intensity,       // soft | normal | strong
  mood,
  labels,
  preferredStance,
  uncertain,
  hold,
})
```

## Outputs

```
snapshot()
promptBlock()
attentionBlock()
nextAttentionBlock()
```

`episodeState` decides whether an episode is open, resolved, reopened, or uncertain.
`nextAttentionBlock` uses relevance gating:

```
neutral -> no hint
high salience -> one hint
medium salience + real stance change -> one hint
low salience -> no hint
pending hint is consumed after use
```

It is not a fixed cadence. A normal conversation can go many turns without a hint.

## Safety boundaries

- no every-turn mood broadcast
- no using silence or leaving as punishment
- no fabricated real-world experience
- no boundary override of safety or consent
