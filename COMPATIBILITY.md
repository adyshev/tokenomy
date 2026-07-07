# Compatibility Notes

Tokenomy currently targets a narrow environment by design.

## Supported

- Pi with project-local extension support
- Node.js 22.19 or newer
- ChatGPT Plus/Pro Codex authenticated in Pi
- Pi `openai-codex` provider
- Default model IDs:
  - `gpt-5.4-mini`
  - `gpt-5.4`
  - `gpt-5.5`

## Assumptions

- Tokenomy expects `@earendil-works/pi-coding-agent` extension APIs.
- Model IDs must exist in the selected provider registry.
- `pi.setModel()` and `pi.setThinkingLevel()` are available.
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
- npm package installation
- automatic install/update across multiple projects
- exact provider billing/token accounting
