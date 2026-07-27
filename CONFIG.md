# Configuration Reference

Tokenomy reads config from two places and merges them in order:

1. Global Pi agent config: `~/.pi/agent/tokenomy.json`
2. Project config: `.pi/tokenomy.json`

Project config wins over global config.

The bundled `.pi/tokenomy.schema.json` can be associated with either file in
an editor. At runtime, malformed values keep the last valid/default value, and
unknown keys are ignored with a warning. Run `/tokenomy doctor` after changes.

## Top-Level Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables Tokenomy routing. |
| `mode` | `save`, `balanced`, or `quality` | `balanced` | Controls uncertain-prompt fallback: prioritize lower spend, the default risk balance, or stronger quality protection. |
| `provider` | string | `openai-codex` | Provider used for model IDs that do not include a provider prefix. |

## Models

```json
{
  "models": {
    "classifier": ["gpt-5.4-mini"],
    "simple": ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4"],
    "medium": ["gpt-5.6-terra", "gpt-5.4", "gpt-5.4-mini"],
    "complex": ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra"]
  }
}
```

Each list is ordered by preference. Tokenomy chooses the first available model
from the selected tier. Model IDs can be plain IDs such as `gpt-5.4-mini` or
provider-qualified IDs such as `openai-codex/gpt-5.4-mini`.

### Providers and live catalog

```json
{
  "providers": {
    "allowed": ["openai-codex"],
    "autoDiscoverModels": false
  }
}
```

`allowed` is a security/cost boundary: configured or discovered models outside
the list are ignored. Add providers such as `anthropic` only when the tier
lists contain suitable provider-qualified IDs. `autoDiscoverModels` lets
Tokenomy use Pi's live available-model catalog when configured tier models are
missing; it is off by default because catalog cost metadata and model
capability ordering vary by provider.

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

Supported values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and
`max`.

## Classifier

```json
{
  "classifier": {
    "enabled": true,
    "onlyWhenAmbiguous": true,
    "maxPromptChars": 4000,
    "maxEstimatedClassifierTokens": 1400,
    "maxCallsPerSession": 12,
    "minEstimatedNetCredits": 0.01,
    "minConfidence": 0.95
  }
}
```

The classifier is optional and uses the cheapest configured classifier model.
Its result is accepted only when confidence is at least `minConfidence`.
Accepted decisions are cached when `cache.enabled` is true. Otherwise Tokenomy
uses risk-aware fallback: low-risk uncertainty goes cheap, medium-risk work goes
to the medium tier, and configured high-risk intents go to the complex tier.
Before a live classifier call, Tokenomy estimates the classifier's own plan
credits and a conservative routing benefit. It skips the call when the expected
net benefit is below `minEstimatedNetCredits` or the session reaches
`maxCallsPerSession`. Cached decisions remain available without consuming the
live-call budget.

## Quality Evidence

```json
{
  "quality": {
    "correctionDetection": true,
    "evaluatorEnabled": false,
    "evaluatorModels": ["gpt-5.4-mini"],
    "evaluatorMaxPromptChars": 4000,
    "evaluatorMaxOutputChars": 6000,
    "minEvaluatorScore": 0.8
  }
}
```

Use `/tokenomy feedback success`, `/tokenomy feedback partial`, or
`/tokenomy feedback failure` after a completed turn. Correction detection
marks the preceding turn when a later user prompt contains a supported
correction phrase. The independent evaluator is opt-in because it sends a
bounded copy of the task and output through an additional authenticated model
call. Its score is evidence, not ground truth.

## Mode Experiments

```json
{
  "experiments": {
    "enabled": false,
    "sampleRate": 1,
    "modes": ["save", "balanced", "quality"]
  }
}
```

When enabled, normalized prompts are deterministically assigned to an economy
mode. The same prompt stays in the same cohort. Tokenomy also records the tier
each other mode would have chosen during risk-aware fallback, without making
extra model calls. `/tokenomy dashboard` compares prompts, completed turns,
verified successes, and estimated credits by mode.

## Plan Credits

```json
{
  "planCredits": {
    "enabled": true,
    "rateCardVersion": "2026-07-27",
    "rates": {
      "gpt-5.4-mini": {
        "input": 18.75,
        "cacheRead": 1.875,
        "output": 113
      }
    }
  }
}
```

Rates are estimated plan credits per one million tokens. The bundled table is a
versioned snapshot; override it when OpenAI changes the rate card or when using
different model IDs. Set `enabled` to `false` to retain measured tokens without
calculating plan credits or classifier break-even estimates.

For automated rate updates, write a validated project-local file:

```json
{
  "version": 1,
  "effectiveAt": "2026-07-27T00:00:00Z",
  "source": "https://example.invalid/provider-rate-card",
  "rates": {
    "gpt-5.4-mini": {
      "input": 18.75,
      "cacheRead": 1.875,
      "output": 113
    }
  }
}
```

The location and staleness warning are configured with:

```json
{
  "registry": {
    "rateCardPath": ".pi/tokenomy-rate-card.json",
    "rateCardUrl": "",
    "refreshHours": 24,
    "maxAgeDays": 30
  }
}
```

The file path must stay inside the project. Valid external entries override
bundled/configured rates by model ID and the report labels the external
effective date. Set `rateCardUrl` to an explicit HTTPS JSON endpoint to refresh
the file automatically when its `effectiveAt` is older than `refreshHours`.
Downloads are bounded to 256 KB, validated before replacing the local file, and
time out after ten seconds. An empty URL (the default) disables networking.

## Account Quota Adapter

Personal ChatGPT Plus usage totals are not exposed through a public account
quota API available to Tokenomy. `/tokenomy quota` therefore reads only an
explicit adapter snapshot and otherwise says `unavailable`.

```json
{
  "version": 1,
  "scope": "account",
  "source": "user",
  "authoritative": false,
  "updatedAt": "2026-07-27T12:00:00Z",
  "note": "Copied from the Codex usage dashboard",
  "windows": [
    {
      "name": "rolling window",
      "used": 40,
      "limit": 100,
      "remaining": 60,
      "unit": "percent",
      "resetsAt": "2026-07-27T15:00:00Z"
    }
  ]
}
```

Supported sources are `user`, `companion`, and `enterprise-analytics`.
Supported units are `credits`, `percent`, `requests`, and `tokens`.

```json
{
  "quota": {
    "accountSnapshotPath": ".pi/tokenomy-account-quota.json",
    "staleAfterMinutes": 60
  }
}
```

Do not put credentials or cookies in this file.

## Credit Budgets and Alerts

```json
{
  "budgets": {
    "sessionCredits": 0,
    "dailyCredits": 0,
    "warnAtPercent": 80,
    "policy": "warn",
    "reserveCredits": 0,
    "maxDownshiftTiers": 1,
    "tierSessionCredits": {
      "simple": 0,
      "medium": 0,
      "complex": 0
    }
  }
}
```

Zero disables that budget. `policy` controls later non-high-risk turns:
`warn` leaves routing unchanged, `save` downshifts one tier, and `ask` asks
before keeping the recommended tier (and downshifts when declined or when no
UI is available). High-risk work is never budget-downshifted. Plan-credit
conversion remains an estimate. `reserveCredits` keeps part of both session and
daily limits unspent for later work. `maxDownshiftTiers` is `1` or `2`.
`tierSessionCredits` optionally caps spend by routed tier. The dashboard uses
the recent observed average to estimate how many spendable turns remain.

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

## Telemetry

```json
{
  "telemetry": {
    "enabled": true,
    "maxEntries": 200,
    "rollupRetentionDays": 400
  }
}
```

Telemetry stores recent routing decisions in
`.pi/tokenomy-cache/routing-history.json`. Entries are newest-first and capped
by `maxEntries`. They include prompt hashes, prompt size, context bucket,
intent, risk, selected tier/source/model, confidence, signals, and estimated
classifier size. Once Pi emits `agent_end`, the same entry is updated with
provider-reported input, cached-input, cache-write, output, reasoning, total
tokens, request count, Pi-reported cost, usage status, and estimated plan
credits. Live classifier calls also record whether classifier prompt
compression was accepted or rejected by the semantic guard, how many protected
signal lines triggered the guard, and the attempted compression savings. They
do not store raw prompt text or model responses.

Durable telemetry rollups use schema version 3 and are stored in
`.pi/tokenomy-cache/telemetry-rollups.json`. Rollups are aggregated by day,
month, and lifetime, so Tokenomy can report usage even after recent history
entries are capped. They include measured token categories, cache inputs,
request counts, measured/unavailable coverage, Pi-reported cost, estimated
ChatGPT plan credits, classifier overhead, tier/source/intent/model
distribution, adaptive fallbacks, prompt-shape distribution, action-count
distribution, multi-step prompt counts, completion proxies, tool calls/errors,
retry runs, feedback/correction/evaluator evidence, mode/language/cohort
distribution, tool-output size/duplicate/truncation/saved-token counters, measured
compaction before/after/saved tokens, and compression guard rejections.
`rollupRetentionDays` controls daily rollup retention and defaults to 400 days;
monthly and lifetime rollups are retained.

`/tokenomy dashboard` summarizes today, recent 7-day changes, a 30-day quality
and savings view, configured budgets, account-quota adapter status, and
per-mode comparisons.

Use `/tokenomy data` to list all local state paths, sizes, and modification
times. `/tokenomy data purge cache|telemetry|memory|debug|all` selectively
removes data while preserving `.pi/tokenomy.json`; `all` requires confirmation
when UI is available.

The default plan-credit estimate uses the OpenAI Codex rate card snapshot dated
`2026-07-27`. Token counts are measured; the conversion is explicitly an
estimate because the rate card can change. Completion means Pi ended the turn
with `stop` or `length`; it is a cost-per-completed-turn proxy, not an
independent quality judgment. Reports cover only the current Pi project, not
account-wide ChatGPT/Codex usage. Historical non-zero
`estimatedTokensSaved`, `baselineCostUnits`, and `actualCostUnits` values are
loaded for compatibility but labeled as pre-v2 model-rank proxies.

When the provider exposes recognized response headers, Tokenomy stores the
latest rate-limit snapshot in `.pi/tokenomy-cache/account-limits.json`.
`/tokenomy limits` displays it with explicit project/process scope. Auth,
cookies, and unrelated response headers are not stored.

## Context Economy

```json
{
  "contextEconomy": {
    "autoCompact": false,
    "compactAtPercent": 85,
    "minTokens": 80000,
    "cooldownTurns": 8,
    "customInstructions": "Preserve the active task, decisions, modified files, validation results, blockers, and exact next steps. Drop repeated logs and superseded exploration."
  }
}
```

Use `/tokenomy compact` for an immediate, task-preserving compaction. Automatic
compaction is opt-in; when enabled, it runs only above both the percentage and
token thresholds, while Pi is idle, and after the configured cooldown.

## Tool Result Economy

```json
{
  "toolEconomy": {
    "measureResults": true,
    "truncateOversized": false,
    "maxResultTokens": 6000,
    "preserveHeadChars": 12000,
    "preserveTailChars": 6000
  }
}
```

Measurement stores only aggregate character/token counts, removed-token counts,
and duplicate tool call fingerprints. Raw arguments and results are not persisted. Truncation is
opt-in and applies only when a text result exceeds `maxResultTokens`; configured
head and tail regions plus an explicit marker are kept.

## Languages

```json
{
  "languages": {
    "enabled": ["en", "uk", "ru", "es", "fr", "de", "pt"]
  }
}
```

The local dictionaries cover common coding-agent actions in English,
Ukrainian, Russian, Spanish, French, German, and Portuguese. Remove a language
to make Tokenomy bypass it. Unknown scripts are always bypassed.

## Routing

```json
{
  "routing": {
    "restoreModelAfterPrompt": true,
    "restoreThinkingAfterPrompt": true
  }
}
```

`restoreModelAfterPrompt` restores the model that was selected before Tokenomy
routed a prompt. Tokenomy only restores when the current model still matches
the model Tokenomy selected for that prompt; if something else changed the model
during execution, Tokenomy leaves it alone. This is enabled by default so
temporary downshifts to cheaper models do not leak into the next prompt.

`restoreThinkingAfterPrompt` applies the same guarded restoration to the
thinking level. Restoration happens on Pi's `agent_settled` event, after
automatic retries, queued continuations, and compaction recovery have finished.
Tokenomy does not override an already selected model at session startup.

Prompt-shape routing uses the local `compromise` NLP library for sentence,
question, and verb detection. It does not call an external API or store raw
prompt text.

## Project Memory

```json
{
  "memory": {
    "enabled": true,
    "inject": false,
    "maxFacts": 80,
    "maxInjectedChars": 1200,
    "maxFactChars": 240,
    "staleAfterDays": 30,
    "minContextTokensForInjection": 20000
  }
}
```

Project memory stores short durable facts in
`.pi/tokenomy-cache/project-memory.json`. It is local, human-readable, and
enabled by default. Tokenomy learns safe facts automatically from project
metadata and observed routing context, such as package name, npm scripts,
important Tokenomy files, CI/publish workflows, and release workflow hints.

Memory learning is enabled by default, but `inject` defaults to `false` to keep
the system-prompt prefix stable for provider caching. When `inject` is true,
Tokenomy adds a compact advisory memory block to the
system prompt only when it is likely to save repeated discovery or tool calls.
Simple shell prompts such as `ls -l` do not receive memory. Stale facts older
than `staleAfterDays` are skipped. Memory never rewrites the user prompt, and
the injected block says that the current user prompt overrides memory.

## Distillation

```json
{
  "distillation": {
    "enabled": false,
    "minContextTokens": 80000,
    "repeatPromptThreshold": 3,
    "maxDigestChars": 1200
  }
}
```

This controls compact project digest injection. It defaults to `false` because
the digest changes between turns and may reduce exact-prefix cache reuse. When
enabled, Tokenomy injects it when context is large or the same intent has
repeated enough times.

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

`status` controls optional auxiliary Pi status entries, such as tool-policy
status when tool management is explicitly enabled. Tokenomy does not write a
main footer/status entry by default because shared footer space can conflict
with other extensions. Use `/tokenomy status` and `/tokenomy history` for stable
Tokenomy telemetry.

## Debug

```json
{
  "debug": {
    "dryRun": false,
    "trace": false,
    "verbose": false,
    "retentionDays": 7,
    "redact": true
  }
}
```

`dryRun` reports what Tokenomy would do without changing the model, thinking
level, or active tools.

`trace` writes a local JSONL debug session trace under
`.pi/tokenomy-cache/debug/session-*.jsonl`. It is disabled by default.
`redact: true` replaces prompt/output/memory payloads with length markers;
setting it to `false` enables raw diagnostic capture. Files use private
permissions where supported and expire after `retentionDays`. Use
`/tokenomy debug purge` to remove all project traces.

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
    "compressionEnabled": true,
    "minCompressionSavingsTokens": 12,
    "maxClassifierPromptChars": 1600,
    "maxLineChars": 240,
    "headLines": 16,
    "tailLines": 16,
    "preserveSignalLines": 40
  }
}
```

When `enabled` is true, Tokenomy locally simplifies large prompts before sending
them to the cheap classifier model. The original prompt still goes to the
selected agent model; simplification is only for routing/classification. It
preserves head and tail context plus signal lines containing errors, failures,
test names, file paths, and counts. Tokenomy also adds system guidance asking
the agent to condense long command output before reasoning.

When `compressionEnabled` is true, Tokenomy uses the local `tokenshrink` SDK for
token-aware compression of classifier excerpts. It keeps the compressed prompt
only if TokenShrink reports at least `minCompressionSavingsTokens` saved tokens.
Set `compressionEnabled` to `false` to keep structural simplification but skip
TokenShrink compression.
