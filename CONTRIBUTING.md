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

GitHub Actions runs JSON validation and `npm test` on every push and pull
request targeting `main`.

## NPM Releases

NPM publishing is automated after changes merge to `main`.

Repository setup required:

1. Create an npm automation token with publish access for `tokenomy-pi`.
2. Add it to GitHub repository secrets as `NPM_TOKEN`.
3. Bump `version` in `package.json` in a PR.
4. Merge the PR to `main`.

The `NPM Publish` workflow checks whether `package.json`'s version already
exists on npm. If it does not exist, it publishes the package. Prerelease
versions such as `0.1.0-beta` are published with the `beta` dist-tag; stable
versions are published with `latest`.

If `NPM_TOKEN` is missing, the workflow exits successfully with a warning so
normal CI stays green. After adding the secret, rerun the workflow manually:

```bash
gh workflow run "NPM Publish" --repo adyshev/tokenomy
```

Manual publish fallback:

```bash
npm login
npm publish --access public --tag beta
```

The test loader shims Pi imports, so CI does not need a real Pi install.

Check that the repository is installable as a Pi package from a local checkout:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
pi install -l /path/to/tokenomy
pi list
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
