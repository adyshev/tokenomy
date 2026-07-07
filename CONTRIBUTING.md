# Contributing

Tokenomy is currently in beta. Contributions should keep the project focused on
safe, predictable routing for Pi users on ChatGPT Plus/Pro Codex.

## Development Setup

Requirements:

- Node.js 22.19 or newer
- Pi installed locally
- `@earendil-works/pi-coding-agent` available through the Pi install

Run tests:

```bash
npm test
```

The tests use Node's built-in test runner and a mocked Pi runtime. They do not
make real model calls.

If Pi is installed somewhere other than the default locations, set:

```bash
PI_CODING_AGENT_PACKAGE_DIR=/path/to/@earendil-works/pi-coding-agent npm test
```

## Change Guidelines

- Keep public defaults conservative.
- Do not enable write-capable tool management by default.
- Do not store prompt text or model responses in stats files.
- Add or update tests for routing behavior changes.
- Keep model IDs configurable; do not assume every user has the same Codex
  model list.
- Prefer explicit warnings over silent fallback when config is invalid.

## Test Coverage Expectations

Routing changes should cover at least:

- simple prompt downshift
- complex prompt upshift
- low-confidence fallback
- classifier accepted and rejected decisions
- missing configured model fallback
- invalid config warnings

## Release Checklist

Before tagging a release:

- `npm test` passes
- `pi --offline --approve --no-session --list-models openai-codex` loads the extension
- README install instructions still match Pi behavior
- `CHANGELOG.md` has a dated version entry
- compatibility notes mention any Pi API assumptions
