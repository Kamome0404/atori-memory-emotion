# Reader layer

The reader layer is a small, explicit-signal classifier. It does **not** infer intent from silence, mood, or conversational context.

## Three modes

```
catch  the person explicitly asks to be heard first
reply  the person explicitly asks for an answer or conclusion
none   no explicit signal
```

Examples:

```
先听我说，别急着给建议     -> catch
别安慰，给个办法           -> reply
今天好累                   -> none
我在听着，你继续           -> none
```

## Prompt increment

`buildReaderPrompt(mode)` returns:

- `''` for `none`
- at most three lines for `catch` / `reply`

`none` is the safe default. The caller may leave its prompt unchanged.

## Integration boundary

The package only classifies and formats. The caller decides:

- which conversations are eligible
- whether the person is the owner or a friend
- whether a group message is explicitly addressed to the character
- where the increment is inserted
- whether the turn is an evaluation/diagnostic run

## Limits

- Explicit phrases only; no weak inference.
- Ambiguity returns `none`.
- No text storage, no network calls, no model calls.
- The prompt increment is a hint, not a script.
- It cannot establish sentience or subjective experience.
