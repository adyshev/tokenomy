# Compatibility Notes

Tokenomy currently targets a narrow environment by design.

## Supported

- Pi packages `@earendil-works/pi-ai` and
  `@earendil-works/pi-coding-agent` version `0.82.x` (typechecked against
  `0.82.1`)
- `pi install npm:tokenomy-pi`
- `pi install https://github.com/adyshev/tokenomy`
- Node.js 22.19 or newer
- ChatGPT Plus Codex authenticated in Pi (live-tested)
- Pi `openai-codex` provider
- Provider-qualified custom tier lists for other Pi providers
- Default model IDs:
  - `gpt-5.4-mini`
  - `gpt-5.4`
  - `gpt-5.5`

## Expected Compatible, Not Yet Validated

- ChatGPT Pro with Codex authentication. OpenAI uses the same Codex provider
  and token-based rate card for Plus and Pro, but Tokenomy has not yet run its
  live evaluation suite on a Pro account. Pro compatibility is best-effort
  until that validation is complete.

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
- causal savings claims without a sufficiently controlled experiment

## Telemetry Compatibility

Telemetry rollup schema version 3 is backward-loading: v2 route and rollup files
continue to load. Old savings/cost-unit fields remain legacy proxies. New turns
use exact provider-reported usage, explicit unavailable status, quality
evidence, experiment labels, and measured tool/compaction counters.
