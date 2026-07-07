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
    "medium": ["gpt-5.4-mini", "gpt-5.4"],
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
Otherwise Tokenomy falls back to the cheapest available configured model.

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
