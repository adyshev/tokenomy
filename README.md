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
- Uses a confidence threshold before trusting classifier decisions.
- Falls back conservatively when routing confidence is too low.
- Learns local project memory such as package names, test commands, important
  files, and release workflow hints.
- Injects compact advisory memory only when it is likely to save repeated
  discovery.
- Simplifies and compresses large classifier prompts so routing itself stays
  cheap.
- Rejects compression when protected signal lines would be rewritten or dropped.
- Tracks local telemetry for routing decisions, estimated savings, memory use,
  and compression guard activity.

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
/tokenomy reload
/tokenomy explain
/tokenomy history
/tokenomy memory
/tokenomy memory show
/tokenomy memory refresh
/tokenomy memory clear
/tokenomy memory on
/tokenomy memory off
/tokenomy export-history
/tokenomy reset-history
/tokenomy reset-stats
/tokenomy dry-run on
/tokenomy dry-run off
```

`/tokenomy status` shows the current routing state, last decision, and estimated tokens saved vs not using Tokenomy.
`/tokenomy explain` shows the signals and reason for the last routing decision.
`/tokenomy history` shows recent prompt-safe routing telemetry.
`/tokenomy memory` shows local project memory status.
`/tokenomy memory show` shows stored project facts.
`/tokenomy export-history` shows the local routing history file path.
`/tokenomy reset-stats` clears local lifetime counters.
`/tokenomy reset-history` clears local routing history.

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

On startup, Tokenomy selects the configured complex baseline model first
(`gpt-5.5` by default), then reroutes down to cheaper models when the prompt is
simple or low-risk enough to use fallback.

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
- a confidence score
- a list of signals that explain the decision

If the prompt is simple and the heuristic is confident enough, Tokenomy routes
directly to the simple tier. If the prompt looks risky or likely to need edits,
multi-step reasoning, broad code inspection, or careful design work, it routes
to a stronger tier.

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

For large or repeated project contexts, Tokenomy can also inject a compact
project digest from `.pi/tokenomy-cache/project-digest.json`. The digest stores
routing metadata such as intent counts and last route, not prompt text or model
responses.

Tokenomy also keeps local per-project memory in
`.pi/tokenomy-cache/project-memory.json`. Memory is enabled and injected by
default. It stores short durable project facts such as package name, test
commands, important implementation files, and release workflow hints. Memory is
advisory: the current user prompt always overrides it. Tokenomy injects memory
only when it is likely to save repeated discovery, for example release/debug
work, vague project prompts, or large contexts. It does not store raw prompts or
model responses.

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

The status/footer entry and decision notifications show the selected tier,
source, model, thinking level, and estimated token savings. Tokenomy writes its
own `tokenomy` status entry, so it can appear alongside footer entries from
other plugins instead of replacing them. The compact entry is labeled, for
example `Tokenomy medium:local/96% saved:1300 lifetime:22350`. `/tokenomy
status` also shows lifetime estimated savings stored locally in
`.pi/tokenomy-stats.json`.
Recent routing decisions are stored locally in
`.pi/tokenomy-cache/routing-history.json` when telemetry is enabled. Telemetry
stores prompt hashes, routing metadata, compression guard status, and estimated
savings, not raw prompt text.

## Configuration

Edit `.pi/tokenomy.json`. See `CONFIG.md` for every option.

Safer defaults for sharing:
- `tools.manage` is `false` unless you opt in
- `debug.dryRun` lets you see routing without changing model/tool state
- `promptSimplification.enabled` reduces classifier prompt size for large logs
- `promptSimplification.compressionEnabled` controls local `tokenshrink`
  compression and defaults to `true`
- `memory.enabled` and `memory.inject` control local project memory and both
  default to `true`

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
that Tokenomy starts on the configured complex baseline model, downshifts for a
simple prompt, upshifts again for a complex prompt, uses risk-aware fallback,
reuses classifier cache entries, injects compact project digests for large
contexts, learns local project memory, records telemetry, and rejects unsafe
classifier prompt compression.
