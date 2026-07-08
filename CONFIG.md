# Configuration Reference

Tokenomy reads config from two places and merges them in order:

1. Global Pi agent config: `~/.pi/agent/tokenomy.json`
2. Project config: `.pi/tokenomy.json`

Project config wins over global config.

## Top-Level Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables Tokenomy routing. |
| `provider` | string | `openai-codex` | Provider used for model IDs that do not include a provider prefix. |

## Models

```json
{
  "models": {
    "classifier": ["gpt-5.4-mini"],
    "simple": ["gpt-5.4-mini"],
    "medium": ["gpt-5.4", "gpt-5.4-mini"],
    "complex": ["gpt-5.5", "gpt-5.4"]
  }
}
```

Each list is ordered by preference. Tokenomy chooses the first available model
from the selected tier. Model IDs can be plain IDs such as `gpt-5.4-mini` or
provider-qualified IDs such as `openai-codex/gpt-5.4-mini`.

## Thinking

```json
{
  "thinking": {
    "simple": "minimal",
    "medium": "low",
    "complex": "medium"
  }
}
```

Supported values are `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

## Classifier

```json
{
  "classifier": {
    "enabled": true,
    "onlyWhenAmbiguous": true,
    "maxPromptChars": 4000,
    "maxEstimatedClassifierTokens": 1400,
    "minConfidence": 0.95
  }
}
```

The classifier is optional and uses the cheapest configured classifier model.
Its result is accepted only when confidence is at least `minConfidence`.
Accepted decisions are cached when `cache.enabled` is true. Otherwise Tokenomy
uses risk-aware fallback: low-risk uncertainty goes cheap, medium-risk work goes
to the medium tier, and configured high-risk intents go to the complex tier.

## Cache

```json
{
  "cache": {
    "enabled": true,
    "classifierTtlMs": 604800000,
    "maxClassifierEntries": 200,
    "projectDigest": true
  }
}
```

Classifier cache entries are stored in `.pi/tokenomy-cache/classifier-cache.json`.
Project digest metadata is stored in `.pi/tokenomy-cache/project-digest.json`.
Neither cache stores model responses, API keys, or auth headers.

## Distillation

```json
{
  "distillation": {
    "enabled": true,
    "minContextTokens": 80000,
    "repeatPromptThreshold": 3,
    "maxDigestChars": 1200
  }
}
```

This controls compact project digest injection. Tokenomy injects the digest when
context is large or when the same intent has repeated enough times.

## Adaptive Routing

```json
{
  "adaptive": {
    "enabled": true,
    "mediumFallbackMinRisk": "medium",
    "complexFallbackIntents": ["architecture", "release"]
  }
}
```

Adaptive fallback prevents risky uncertain prompts from always dropping to the
cheapest model. It also tracks per-intent route counters in
`.pi/tokenomy-stats.json` for future tuning.

## Thresholds

```json
{
  "thresholds": {
    "largeContextTokens": 80000,
    "hugeContextTokens": 120000,
    "longPromptChars": 900,
    "veryLongPromptChars": 2200
  }
}
```

These values influence the local heuristic. Large prompts and contexts increase
the chance of routing to a stronger tier.

## Tools

```json
{
  "tools": {
    "manage": false,
    "preserveCustomTools": true,
    "readOnlyTools": ["read", "grep", "find", "ls"],
    "writeTools": ["read", "grep", "find", "ls", "edit", "write", "bash"]
  }
}
```

Tool management is disabled by default for safer public use. If enabled,
Tokenomy can switch active built-in tools based on whether a prompt appears to
need no tools, read-only tools, or write-capable tools.

## UI

```json
{
  "ui": {
    "status": true,
    "notifyDecisions": true
  }
}
```

`notifyDecisions` shows a notification after each routing decision. Set it to
`false` if the notifications are too noisy.

## Debug

```json
{
  "debug": {
    "dryRun": false,
    "verbose": false
  }
}
```

`dryRun` reports what Tokenomy would do without changing the model, thinking
level, or active tools.

## Prompt Discipline

```json
{
  "promptDiscipline": {
    "enabled": true,
    "maxAnswerBulletsSimple": 5
  }
}
```

When enabled, Tokenomy appends short system guidance to reduce unnecessary
tokens and tool calls.

## Prompt Simplification

```json
{
  "promptSimplification": {
    "enabled": true,
    "minCompressionSavingsTokens": 12,
    "maxClassifierPromptChars": 1600,
    "maxLineChars": 240,
    "headLines": 16,
    "tailLines": 16,
    "preserveSignalLines": 40
  }
}
```

When enabled, Tokenomy locally simplifies large prompts before sending them to
the cheap classifier model. The original prompt still goes to the selected agent
model; simplification is only for routing/classification. It preserves head and
tail context plus signal lines containing errors, failures, test names, file
paths, and counts. Tokenomy also adds system guidance asking the agent to
condense long command output before reasoning.

Tokenomy uses the local `tokenshrink` SDK for token-aware compression. It keeps
the compressed prompt only if TokenShrink reports at least
`minCompressionSavingsTokens` saved tokens.
