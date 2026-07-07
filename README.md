# Tokenomy Pi Extension

Tokenomy is a project-local Pi extension that routes each prompt with one primary goal:

> Minimize total token usage while preserving high-quality output.

It does this by combining zero-token local heuristics with optional cheap-model classification only for ambiguous prompts.

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
