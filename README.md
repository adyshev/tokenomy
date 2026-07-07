# Tokenomy Pi Extension

Status: beta. Tokenomy is suitable for private testing and early adopters, but
it is not yet a general-purpose model router.

Tokenomy is a project-local Pi extension for Codex users on the ChatGPT Plus
plan. At this stage it is intentionally scoped to the `openai-codex` models
available through Pi when a Plus/Pro Codex account is authenticated.

Its primary goal is:

> Minimize total token usage while preserving high-quality output.

Tokenomy routes each prompt to the cheapest model tier that should still handle
the work well. Simple prompts go to the cheapest configured Codex model, complex
or risky prompts move up to a stronger model, and uncertain prompts fall back to
the cheapest model unless Tokenomy reaches the configured confidence threshold.

## Current Scope

Tokenomy is built for:

- Pi users running the ChatGPT Plus/Pro Codex provider
- the `openai-codex` model family exposed by Pi
- local project routing through `.pi/extensions/tokenomy/index.ts`

It is not currently a general-purpose router for every provider or every model
catalog. Other providers can be added later, but the defaults, model ranking,
and configuration in this repo assume Codex models available to Plus/Pro users.

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
pi install https://github.com/adyshev/tokenomy
```

For project-local install:

```bash
pi install -l https://github.com/adyshev/tokenomy
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
/tokenomy reset-stats
/tokenomy dry-run on
/tokenomy dry-run off
```

`/tokenomy status` shows the current routing state, last decision, and estimated tokens saved vs not using Tokenomy.
`/tokenomy explain` shows the signals and reason for the last routing decision.
`/tokenomy reset-stats` clears local lifetime counters.

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
- an intent such as `answer`, `read`, `single_edit`, `multi_edit`, `debug`, `architecture`, or `release`
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

Tokenomy also adjusts thinking level by tier:

- `simple`: minimal thinking
- `medium`: low thinking
- `complex`: medium thinking

The status bar and decision notifications show the selected tier, source,
model, thinking level, and estimated token savings. `/tokenomy status` also
shows lifetime estimated savings stored locally in `.pi/tokenomy-stats.json`.

## Configuration

Edit `.pi/tokenomy.json`. See `CONFIG.md` for every option.

Safer defaults for sharing:
- `tools.manage` is `false` unless you opt in
- `debug.dryRun` lets you see routing without changing model/tool state

Default Codex model preferences are:

- classifier/simple: `openai-codex/gpt-5.4-mini`
- medium: `openai-codex/gpt-5.4`
- complex: `openai-codex/gpt-5.5`

If you want the fallback selection to be smarter than string sorting, Tokenomy uses explicit model-family ranking rather than relying on IDs.

If your available model list differs, run:

```bash
pi --list-models | grep openai-codex
```

Then update `.pi/tokenomy.json`.

Before public sharing, review `COMPATIBILITY.md`, `LIMITATIONS.md`, and
`CHANGELOG.md`.

## Tests

Run the integration tests with:

```bash
npm test
```

The tests use Node's built-in test runner and a mocked Pi runtime. They verify
that Tokenomy starts on the configured complex baseline model, downshifts for a
simple prompt, upshifts again for a complex prompt, uses risk-aware fallback,
reuses classifier cache entries, and injects compact project digests for large
contexts.
