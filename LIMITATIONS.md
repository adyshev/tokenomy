# Known Limitations

Tokenomy is beta software. It is useful today, but the routing policy is still
heuristic and should be treated as advisory rather than perfect.

## Codex-Focused Defaults

The default config targets Pi's `openai-codex` provider and the Codex model IDs
available to ChatGPT Plus/Pro users. Other providers require provider-qualified
model IDs and an explicit `providers.allowed` entry. Cost/credit comparisons
also require suitable rate-card entries.

## Heuristic Routing

The local router uses prompt length, context size, image count, and keyword
signals. It can misclassify prompts when words like `change`, `test`, `project`,
or `review` appear in casual language.

Classifier routing can improve ambiguous cases, but classifier output is only
accepted above the configured confidence threshold.

## Language Coverage

Tokenomy has local routing dictionaries for English, Ukrainian, Russian,
Spanish, French, German, and Portuguese. These dictionaries cover common
coding-agent intents, not every phrase or dialect. Unknown scripts bypass
routing so the extension does not apply unsupported keyword heuristics.

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

## Usage and Plan Credits

Tokenomy records provider-reported usage from Pi's `agent_end` messages:
input, cached input, cache writes, output, optional reasoning, total tokens,
requests, and Pi-reported cost. A settled turn with no usable provider data is
marked `unavailable` instead of being estimated from prompt characters.

The ChatGPT plan-credit conversion is still an estimate. It uses a versioned
local copy of the OpenAI Codex rate card or a validated project-local external
rate card, and may become stale when OpenAI changes plan pricing or model IDs. Reports
cover only Tokenomy turns in the current Pi project; they are not account-wide
quota or billing reports. `/tokenomy limits` can only show recognized response
headers exposed to this Pi process, so it may be unavailable or incomplete.
`/tokenomy quota` can display a user/companion/Enterprise Analytics snapshot,
but Tokenomy has no public API for personal ChatGPT Plus quota totals and never
manufactures missing limits.

Telemetry created before schema version 2 may contain model-rank-based
`estimatedTokensSaved` and cost-unit fields. These are retained for migration
but labeled as legacy proxies, never as measured tokens or credits.

## Quality Measurement

Tokenomy records completion proxies, explicit user feedback, correction
signals, and—when opted in—an independent model evaluator. Feedback is still
subjective, corrections can be missed, and model evaluation is not ground
truth. A/B cohorts are deterministic but observational unless prompts are
assigned in a controlled study, so causal savings claims require sufficient
sample size and comparable tasks.

## Context Compaction

Automatic compaction is disabled by default. Compaction saves future context
tokens but is lossy, so users should review the task-preservation instructions
before enabling `contextEconomy.autoCompact`.

Oversized tool-result truncation is also disabled by default. When enabled it
preserves configured head/tail regions, but relevant content can still exist in
the removed middle.

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

Normal tests use a mocked Pi runtime and local Pi package resolution. They verify
routing logic, current `agent_end`/`agent_settled` behavior, measured usage
aggregation, and state restoration. They do not perform live model calls,
personal account-limit integration, or terminal UI assertions. The separate
`TOKENOMY_LIVE_EVAL=1 npm run test:live` suite performs signed-in model calls
and consumes real quota; it is never run by normal CI.
