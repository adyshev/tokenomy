# Known Limitations

Tokenomy is beta software. It is useful today, but the routing policy is still
heuristic and should be treated as advisory rather than perfect.

## Codex-Only Defaults

The default config targets Pi's `openai-codex` provider and the Codex model IDs
available to ChatGPT Plus/Pro users. Other providers may work only after
customizing `.pi/tokenomy.json`.

## Heuristic Routing

The local router uses prompt length, context size, image count, and keyword
signals. It can misclassify prompts when words like `change`, `test`, `project`,
or `review` appear in casual language.

Classifier routing can improve ambiguous cases, but classifier output is only
accepted above the configured confidence threshold.

## English-Only Routing

Tokenomy currently routes English-language instructions only. Prompts written
primarily in other languages bypass Tokenomy for that turn so the extension does
not apply English keyword heuristics incorrectly. English instructions can still
contain non-English payload text, for example text to translate or comments to
preserve.

## Project Memory

Project memory is local and advisory. It can save repeated project discovery,
but stale or incomplete facts may be less useful than fresh inspection. The
current user prompt always overrides injected memory. If memory appears wrong,
inspect it with `/tokenomy memory show`, refresh it with `/tokenomy memory
refresh`, clear it with `/tokenomy memory clear`, or disable it with
`memory.enabled: false`.

## Classifier Prompt Compression

Prompt simplification and TokenShrink compression apply only to classifier
excerpts used for routing. They do not change the original prompt sent to the
selected agent model. Compression can still theoretically affect routing if the
classifier interprets the compacted excerpt differently, so it can be disabled
with `promptSimplification.compressionEnabled: false`.

## Estimated Savings

Token savings are estimates. Tokenomy does not read provider billing data or
exact hidden reasoning usage. The lifetime counter is useful for directionality,
not accounting.

## Model Availability

Model names can change. If Pi does not expose the default model IDs, update
`.pi/tokenomy.json` after checking:

```bash
pi --list-models openai-codex
```

## Installation Model

Tokenomy can be installed as a Pi package from npm or git. Project-specific
config still lives in `.pi/tokenomy.json`.

## Test Environment

Tests use a mocked Pi runtime and local Pi package resolution. They verify
routing logic, but they do not perform live model calls or end-to-end terminal
UI assertions.
