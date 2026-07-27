# Compatibility Notes

Tokenomy currently targets a narrow environment by design.

## Supported

- Pi packages `@earendil-works/pi-ai` and
  `@earendil-works/pi-coding-agent` version `0.82.x` (typechecked against
  `0.82.1`)
- `pi install npm:tokenomy-pi@beta` for the current prerelease
- `pi install https://github.com/adyshev/tokenomy`
- Node.js 22.19 or newer
- ChatGPT Plus Codex authenticated in Pi (live-tested)
- Pi `openai-codex` provider
- Tokenomy is a Pi extension; native OpenAI Codex CLI hooks are not supported
- Linux, macOS, and Windows packed-install smoke tests
- Provider-qualified custom tier lists for other Pi providers as an
  experimental, unvalidated configuration surface
- Default model IDs:
  - `gpt-5.6-sol`
  - `gpt-5.6-terra`
  - `gpt-5.6-luna`
  - `gpt-5.4-mini`
  - `gpt-5.4`
  - `gpt-5.5`

The authenticated catalog snapshot also tracks `gpt-5.3-codex-spark`, but it is
not a default tier because Tokenomy has no verified bundled plan-credit rate for
it.

## Unsupported or Unvalidated

- ChatGPT Pro is untested and unsupported. No compatibility claim is made.
- Native OpenAI Codex CLI integration is a separate future project.
- Non-Codex providers have no shipped presets, rate cards, or live evaluation.

## Assumptions

- Tokenomy expects `@earendil-works/pi-coding-agent` extension APIs.
- Model IDs must exist in the selected provider registry.
- `pi.setModel()` and `pi.setThinkingLevel()` are available.
- `pi.getThinkingLevel()` is available.
- Pi emits `agent_end` with assistant-message usage and `agent_settled` after
  retries/continuations have finished.
- Pi emits `tool_result` when tool-output measurement or opt-in truncation is
  used.
- `ctx.getContextUsage()` may return token usage, but Tokenomy tolerates it
  being unavailable.

## Config Portability

If your model names differ from the defaults, update `.pi/tokenomy.json` after
running:

```bash
pi --list-models openai-codex
```

Tool management is opt-in by default. Enable it only if you want Tokenomy to
change active tools.

## Not Yet Supported

- Non-Codex provider presets
- automatic install/update across multiple projects
- automatic personal ChatGPT/Codex quota retrieval (validated user/companion
  snapshots are supported)
- account-wide causal savings claims; the paired benchmark provides
  task-level evidence against a fixed baseline, not universal performance

## Telemetry Compatibility

Telemetry rollup schema version 3 is backward-loading: v2 route and rollup files
continue to load. Old savings/cost-unit fields remain legacy proxies. New turns
use exact provider-reported usage, explicit unavailable status, quality
evidence, experiment labels, and measured tool/compaction counters.

CI preserves legacy stats and v2 rollups in upgrade fixtures, validates their
migration to the current schema, typechecks and tests against Pi 0.82.1 plus
the latest 0.82.x patch, and tests packed installation on Linux, macOS, and
Windows. New Pi minor lines require an explicit compatibility update.
