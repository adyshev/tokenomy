# Tokenomy Pi Extension

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

## Usage

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
```

`/tokenomy status` shows the current routing state, last decision, and estimated tokens saved vs not using Tokenomy.

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
simple or uncertain enough to use fallback.

For simple prompts it prefers the cheapest/fastest configured Codex model, minimal thinking, concise answers, and no tools when tools are unnecessary.

For complex/high-risk prompts it may choose a stronger model because a weak model can waste more tokens through failed attempts, excessive tool loops, or corrections.

## How routing works

Tokenomy runs before each agent turn and makes a routing decision from local
signals first. That local pass does not spend model tokens. It looks at prompt
length, context size, images, and task language such as `explain`, `review`,
`debug`, `implement`, `refactor`, `security`, or `performance`.

The local heuristic assigns:

- a tier: `simple`, `medium`, or `complex`
- a tool profile: `none`, `read`, or `write`
- a confidence score
- a list of signals that explain the decision

If the prompt is simple and the heuristic is confident enough, Tokenomy routes
directly to the simple tier. If the prompt looks risky or likely to need edits,
multi-step reasoning, broad code inspection, or careful design work, it routes
to a stronger tier.

For ambiguous prompts, Tokenomy can ask the cheapest configured classifier model
for a tiny JSON decision. The classifier is only accepted when its confidence is
at least `classifier.minConfidence`, which is `0.95` by default. If classifier
confidence is below that threshold, classifier output is unavailable, or the
local heuristic is below the same confidence threshold, Tokenomy uses fallback:
the cheapest available configured model.

This fallback policy is deliberate. When Tokenomy cannot confidently justify a
more expensive model, it prefers not to spend extra tokens. Stronger models are
used when the prompt clearly needs them or when a high-confidence classifier
decision selects them.

Tokenomy also adjusts thinking level by tier:

- `simple`: minimal thinking
- `medium`: low thinking
- `complex`: medium thinking

The status bar and decision notifications show the selected tier, source,
model, thinking level, and estimated token savings. `/tokenomy status` also
shows lifetime estimated savings stored locally in `.pi/tokenomy-stats.json`.

## Configuration

Edit `.pi/tokenomy.json`.

Safer defaults for sharing:
- `tools.manage` is `false` unless you opt in
- `debug.dryRun` lets you see routing without changing model/tool state

Default Codex model preferences are:

- classifier/simple: `openai-codex/gpt-5.4-mini`
- medium: `openai-codex/gpt-5.4-mini`
- complex: `openai-codex/gpt-5.5`

If you want the fallback selection to be smarter than string sorting, Tokenomy uses explicit model-family ranking rather than relying on IDs.

If your available model list differs, run:

```bash
pi --list-models | grep openai-codex
```

Then update `.pi/tokenomy.json`.

For public sharing, review `COMPATIBILITY.md` and `CHANGELOG.md`.

## Tests

Run the integration tests with:

```bash
npm test
```

The tests use Node's built-in test runner and a mocked Pi runtime. They verify
that Tokenomy starts on the configured complex baseline model, downshifts for a
simple prompt, upshifts again for a complex prompt, and uses the cheapest
fallback model when confidence is below the configured threshold.
