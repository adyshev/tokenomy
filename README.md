# Tokenomy Pi Extension

Tokenomy is a token-economy layer for Pi users working with Codex on the
ChatGPT Plus/Pro plan. It is designed to reduce total token spend during normal
project work without forcing you to manually choose a model for every prompt.

The product goal is:

> Spend fewer tokens while preserving the original prompt intent and the quality
> of the final answer.

After installation, Tokenomy runs automatically before each agent turn. It
classifies the prompt, chooses the cheapest Codex model tier that should still
solve the task, and upshifts when the work looks risky, broad, or release-like.
It also uses local project memory, classifier prompt simplification,
TokenShrink compression, safety guards, and routing telemetry to reduce repeated
context cost without rewriting the final user prompt.

Tokenomy is useful when the same project contains mixed work:

- quick questions and explanations
- cheap shell commands like `ls -l`
- targeted reads and small edits
- debugging and test failures
- larger refactors or architecture work
- release, version, and npm/GitHub Actions flows

Instead of sending all of that to the strongest available model, Tokenomy keeps
easy work cheap and reserves stronger models for prompts where a weak attempt is
likely to cost more through retries, excessive tool calls, or incorrect edits.

## What Tokenomy Does By Default

- Routes simple and low-risk prompts to cheaper Codex models.
- Upshifts complex, risky, debug, architecture, and release prompts.
- Detects prompt shape locally with `compromise`, including
  question/action/mixed prompts and concrete multi-step action requests.
- Preserves the user's startup model, then restores both the pre-route model
  and thinking level after each fully settled prompt.
- Uses a confidence threshold before trusting classifier decisions.
- Applies a per-session classifier budget and a conservative break-even check,
  so routing does not spend more estimated credits than it can plausibly save.
- Offers `save`, `balanced`, and `quality` economy modes.
- Falls back conservatively when routing confidence is too low.
- Learns local project memory such as package names, test commands, important
  files, and release workflow hints.
- Keeps memory injection and routing-digest injection opt-in so the default
  system-prompt prefix stays cache-friendly.
- Simplifies and compresses large classifier prompts so routing itself stays
  cheap.
- Rejects compression when protected signal lines would be rewritten or dropped.
- Measures provider-reported input, cached-input, cache-write, output,
  reasoning, total-token, request, and cost usage after each turn.
- Builds daily, monthly, and lifetime telemetry rollups with explicit
  measured/unavailable coverage, configurable plan-credit estimates,
  completion/tool-error proxies, and compaction counts.
- Shows recognized provider limit headers when available, with explicit
  project/process scope.
- Supports manual task-preserving compaction and opt-in threshold compaction.

Tokenomy does not rewrite the final prompt sent to the selected agent model.
Memory and compression are routing/context optimizations only, and the current
user prompt always overrides remembered project facts.

## Current Scope

Tokenomy is currently focused on one well-defined setup:

- Pi users authenticated with ChatGPT Plus/Pro Codex access.
- The `openai-codex` model family exposed by Pi.
- Project-local routing through `.pi/extensions/tokenomy/index.ts`.
- Local-only memory, cache, telemetry, and compression. No external database or
  external memory API is used.
- English-language routing instructions. Prompts written primarily in other
  languages bypass Tokenomy routing for that turn.

Tokenomy is still beta software. It is ready for private dogfooding and early
adopter use, but it is not yet a universal model router for every provider,
model catalog, or coding-agent runtime. Other providers and Codex-native
adapters can be added later; the current defaults are intentionally optimized
for Codex models available to Plus/Pro users through Pi.

## Files

- `.pi/extensions/tokenomy/index.ts` — Pi extension implementation
- `.pi/tokenomy.json` — project configuration
- `INSTALL.md` — install and update instructions
- `CONFIG.md` — full configuration reference
- `LIMITATIONS.md` — known limitations and beta caveats
- `SECURITY.md` — security and stored-data notes
- `CONTRIBUTING.md` — development and release checklist

## Usage

See `INSTALL.md` for full setup steps. The short version is:

```bash
pi install npm:tokenomy-pi
```

For project-local install:

```bash
pi install -l npm:tokenomy-pi
```

Then authenticate Codex in Pi and start Pi from the target project.

Start Pi in this directory:

```bash
pi
```

Make sure ChatGPT Plus/Pro Codex is authenticated:

```text
/login
```

Then select the ChatGPT Plus/Pro Codex provider.

Useful commands inside Pi:

```text
/tokenomy
/tokenomy off
/tokenomy on
/tokenomy mode save
/tokenomy mode balanced
/tokenomy mode quality
/tokenomy reload
/tokenomy explain
/tokenomy history
/tokenomy report
/tokenomy report 7d
/tokenomy report 30d
/tokenomy report month
/tokenomy report lifetime
/tokenomy limits
/tokenomy compact
/tokenomy memory
/tokenomy memory show
/tokenomy memory refresh
/tokenomy memory clear
/tokenomy memory on
/tokenomy memory off
/tokenomy export-history
/tokenomy export-report
/tokenomy reset-history
/tokenomy reset-stats
/tokenomy dry-run on
/tokenomy dry-run off
/tokenomy debug on
/tokenomy debug path
/tokenomy debug off
```

`/tokenomy status` shows the current routing state, last decision, accounting
mode, and the plan rate-card version.
`/tokenomy explain` shows the signals and reason for the last routing decision.
`/tokenomy history` shows recent prompt-safe routing telemetry.
`/tokenomy report` shows a 30-day local telemetry report with measured token
usage, cache-read ratio, estimated plan credits, completion/tool-error proxies,
route distribution, and fallback/guard counts.
Use `/tokenomy report 7d`, `/tokenomy report 30d`, `/tokenomy report month`, or `/tokenomy report lifetime` for specific periods.
`/tokenomy limits` shows the latest recognized provider limit headers when Pi
can see them; it is not an account-wide quota report.
`/tokenomy compact` triggers task-preserving context compaction.
`/tokenomy memory` shows local project memory status.
`/tokenomy memory show` shows stored project facts.
`/tokenomy export-history` shows the local routing history file path.
`/tokenomy export-report` shows the local telemetry rollup file path.
`/tokenomy reset-stats` clears local lifetime counters.
`/tokenomy reset-history` clears local routing history.
`/tokenomy debug on` starts an opt-in raw local JSONL trace for debugging
Tokenomy decisions, and `/tokenomy debug off` stops it.

Routing decision notifications are enabled by default so you can see when
Tokenomy switches models. To disable them, set `ui.notifyDecisions` to `false`
in `.pi/tokenomy.json`.

You can also disable it for one run:

```bash
pi --tokenomy-off
```

## What it optimizes

Tokenomy considers total token usage, not just model cost:

- prompt/context size
- hidden thinking level
- output verbosity
- unnecessary tool schemas
- unnecessary tool calls
- retry risk from underpowered routing

On startup, Tokenomy preserves the model already selected by the user. It
selects the configured complex model only when Pi starts without any current
model. Each turn records the pre-route model as its baseline without claiming
that a different model would necessarily have consumed the same tokens.

For simple prompts it prefers the cheapest/fastest configured Codex model, minimal thinking, concise answers, and no tools when tools are unnecessary.

For complex/high-risk prompts it may choose a stronger model because a weak model can waste more tokens through failed attempts, excessive tool loops, or corrections.

## How routing works

Tokenomy runs before each agent turn and makes a routing decision from local
signals first. That local pass does not spend model tokens. It looks at prompt
length, context size, images, and task language such as `explain`, `review`,
`debug`, `implement`, `refactor`, `security`, or `performance`.

The local heuristic assigns:

- a tier: `simple`, `medium`, or `complex`
- an intent such as `answer`, `shell_simple`, `read`, `single_edit`,
  `multi_edit`, `debug`, `architecture`, `local_workflow`, or `release`
- a risk level: `low`, `medium`, or `high`
- a tool profile: `none`, `read`, or `write`
- a prompt shape: `question`, `action`, or `mixed`, plus action count and
  multi-step signal
- a confidence score
- a list of signals that explain the decision

If the prompt is simple and the heuristic is confident enough, Tokenomy routes
directly to the simple tier. If the prompt looks risky or likely to need edits,
multi-step reasoning, broad code inspection, or careful design work, it routes
to a stronger tier.

Short follow-up prompts such as `continue`, `go on`, or `proceed` inherit the
previous routing context in the current session, so Tokenomy does not downshift
in the middle of an ongoing complex task.

Broad review prompts such as `please do an audit`, `please review`, or
`please refactor` are treated as deep project work and route to the complex
tier. Targeted audits, such as focused config or dotfiles checks, can still
route to the medium tier when the scope is narrower.

Tokenomy also analyzes prompt shape locally without a model call. It uses the
`compromise` NLP library for sentence, question, and verb detection, then
applies Tokenomy's coding-agent action filters. Simple questions can stay cheap,
but explicit multi-step requests or prompts with several concrete actions route
to the complex tier because a weak first attempt is likely to cost more through
retries. Focused single edits and local workflows can still route to the medium
tier.

Trivial general prompts such as `what time is it?`, `how time is it?`,
`thanks`, or local info questions answerable with one read-only command stay on
the cheapest model even when the current project context is large. The trivial
path is not used when the prompt mentions project files, logs, tests, code, or
tool work.

Tokenomy currently supports English routing instructions only. If a prompt is
primarily written in another language, Tokenomy bypasses routing transparently
and leaves the current Pi model/tool state unchanged. English instructions may
still include non-English text as payload, such as text to translate or a code
comment to preserve.

For ambiguous prompts, Tokenomy can ask the cheapest configured classifier model
for a tiny JSON decision. The classifier is only accepted when its confidence is
at least `classifier.minConfidence`, which is `0.95` by default. Accepted
classifier decisions are cached locally by normalized prompt, context bucket,
intent, and risk so repeated routing questions do not keep spending classifier
tokens.

If classifier confidence is below that threshold, classifier output is
unavailable, or the local heuristic is below the same confidence threshold,
Tokenomy uses fallback. Fallback is risk-aware:

- low-risk uncertainty falls back to the cheapest configured available model
- medium-risk write/debug work falls back to the medium tier
- high-risk architecture/release work falls back to the complex tier

This policy keeps cheap fallback for basic uncertainty while avoiding expensive
retries on risky prompts.

When explicitly enabled, Tokenomy can inject a compact digest for large or
repeated project contexts from `.pi/tokenomy-cache/project-digest.json`. The digest stores
routing metadata such as intent counts and last route, not prompt text or model
responses. Digest injection defaults to off because its changing content can
reduce exact-prefix prompt-cache reuse.

Tokenomy also keeps local per-project memory in
`.pi/tokenomy-cache/project-memory.json`. Memory learning is enabled, while
prompt injection defaults to off. It stores short durable project facts such as
package names, test commands, important implementation files, and release
workflow hints. Memory is
advisory: the current user prompt always overrides it. Tokenomy injects memory
only after `memory.inject` is enabled and the turn is likely to save repeated
discovery. It does not store raw prompts or model responses.

For large prompts that need classifier help, Tokenomy locally simplifies the
classifier prompt first. It keeps head/tail context and signal lines such as
errors, failed tests, file paths, and counts. The original user prompt is still
sent to the selected agent model.

Tokenomy also applies local TokenShrink compression to classifier prompts. It
keeps the compressed version only when TokenShrink reports enough saved tokens,
so compression should not increase routing cost. TokenShrink compression is
enabled by default and can be disabled with
`promptSimplification.compressionEnabled: false`.

Tokenomy also adjusts thinking level by tier:

- `simple`: minimal thinking
- `medium`: low thinking
- `complex`: medium thinking

After `agent_settled`, Tokenomy restores the model and thinking level selected
before routing. Each value is restored only if it still matches the value
Tokenomy selected; explicit changes made during execution are preserved.

Decision notifications show the selected tier, source, model, and thinking
level. Tokenomy does not write a main Pi footer/status
entry because Pi renders plugin footers in shared terminal space and long
entries can crowd other extensions. Use `/tokenomy status` for the current
routing state and accounting contract. Legacy pre-v2 proxy counters remain in
`.pi/tokenomy-stats.json`.
Recent routing decisions are stored locally in
`.pi/tokenomy-cache/routing-history.json` when telemetry is enabled. Telemetry
stores prompt hashes, routing metadata, compression guard status, measured
usage, and estimated plan credits—not raw prompt text.
Longer-term telemetry is stored in
`.pi/tokenomy-cache/telemetry-rollups.json` as daily, monthly, and lifetime
prompt-safe aggregates. Rollups include exact provider-reported token
categories, cache-read ratio inputs, request counts, Pi-reported cost,
rate-card-based plan-credit estimates, classifier overhead, route distribution,
adaptive fallbacks, prompt shape, and compression guard rejections. Historical
non-zero `estimatedTokensSaved`/cost-unit fields are labeled as pre-v2 model-rank
proxies and are never presented as tokens or credits.

Reports cover only this Pi project. They do not claim to represent total
account-wide ChatGPT or Codex usage.

## Configuration

Edit `.pi/tokenomy.json`. See `CONFIG.md` for every option.

Safer defaults for sharing:
- `tools.manage` is `false` unless you opt in
- `debug.dryRun` lets you see routing without changing model/tool state
- `debug.trace` is disabled by default because it records raw session data for
  debugging
- `promptSimplification.enabled` reduces classifier prompt size for large logs
- `promptSimplification.compressionEnabled` controls local `tokenshrink`
  compression and defaults to `true`
- `memory.enabled` defaults to `true`; `memory.inject` defaults to `false` for
  prompt-cache stability
- `distillation.enabled` defaults to `false` for the same reason

Default Codex model preferences are:

- classifier/simple: `openai-codex/gpt-5.4-mini`
- medium: `openai-codex/gpt-5.4`
- complex: `openai-codex/gpt-5.5`

If you want the fallback selection to be smarter than string sorting, Tokenomy uses explicit model-family ranking rather than relying on IDs.

If your available model list differs, run:

```bash
pi --list-models openai-codex
```

Then update `.pi/tokenomy.json`.

## Debug Trace

For difficult routing issues, Tokenomy can write a local session trace that is
optimized for debugging routing decisions and feature interactions:

```bash
/tokenomy debug on
/tokenomy debug path
/tokenomy debug off
```

The trace is stored as JSONL in `.pi/tokenomy-cache/debug/session-*.jsonl` and
includes ordered events with short summaries plus structured data for input
analysis, classifier prompts/results, routing, memory, telemetry, model
restoration, captured agent outputs, and the active session/config snapshot.

This is intentionally off by default. When enabled, Tokenomy shows a warning
because the trace may include raw prompts, model/tool outputs exposed to
Tokenomy, classifier prompts and responses, memory context, compression data,
routing decisions, and internal errors. Normal telemetry remains prompt-safe;
debug trace is the explicit opt-in path for full local visibility.

Before public sharing, review `COMPATIBILITY.md`, `LIMITATIONS.md`, and
`CHANGELOG.md`.

Future direction: Tokenomy may add an optional local side-LLM path, such as
Ollama or another local model, for heavier prompt compression and prompt
complexity determination. The current release keeps compression deterministic
and local through TokenShrink.

## Tests

Run the integration tests with:

```bash
npm test
```

The tests use Node's built-in test runner and a mocked Pi runtime. They verify
startup model preservation, current Pi lifecycle events, model/thinking
restoration after settle, exact usage aggregation, plan-credit conversion,
explicit unavailable status, stable default system additions, model routing,
classifier caching, opt-in memory/digest injection, and classifier-compression
guards.
