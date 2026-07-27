# Contributing

Tokenomy is currently in beta. Contributions should keep the project focused on
safe, predictable routing for Pi users on ChatGPT Plus Codex. Plus is the
project's live-tested and supported subscription target. ChatGPT Pro is
untested and unsupported until it receives its own compatibility evidence.

## Development Setup

Requirements:

- Node.js 22.19 or newer
- Pi installed locally
- `@earendil-works/pi-coding-agent` available through the Pi install

Install locked dependencies, typecheck against the supported Pi API, and run
tests:

```bash
npm ci
npm run typecheck
npm test
```

The tests use Node's built-in test runner and a mocked Pi runtime. They do not
make real model calls.

Signed-in live evaluation is deliberately separate because it consumes real
quota:

```bash
TOKENOMY_LIVE_EVAL=1 npm run test:live
TOKENOMY_ECON_EVAL=1 npm run test:economic
TOKENOMY_ECON_EVAL=1 TOKENOMY_ECON_PROFILE=full \
TOKENOMY_ECON_ARMS=baseline,router,full npm run test:economic
npm run test:catalog
```

Use `TOKENOMY_LIVE_EVALUATOR=1` only when the additional evaluator call is
intended. The manual `Live Tokenomy Evaluation` workflow requires a
self-hosted runner with an existing Pi sign-in.

GitHub Actions runs JSON/schema validation, strict typechecking, `npm test`, and
a packed-install smoke test on Linux, macOS, and Windows, plus a Pi compatibility
matrix against 0.82.1 and the latest 0.82.x patch, for every push and pull
request. An authenticated self-hosted schedule checks Plus model-catalog and
rate-card drift.

## Branch And PR Policy

All delivered features and fixes must be developed on a separate branch and
merged through a pull request. Do not commit directly to `main`, even for small
changes. Version bumps for releases should also happen in the release PR.

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
versions are published with `latest`. After npm confirms the exact version, the
workflow creates and pushes `v<version>` and creates or updates the matching
GitHub Release with matching channel semantics. Prereleases are marked as
prereleases. While the project has no stable release, a prerelease also moves
npm `latest` so pi.dev, `pi install npm:tokenomy-pi`, and normal package updates
resolve the current supported beta. Once `latest` points to a stable version,
future prereleases preserve that stable default and update only `beta`. Stable
versions always update `latest`.
Registry verification retries propagation before tagging. These steps are
idempotent for workflow reruns.

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
- Keep `README.md`, `INSTALL.md`, `CONFIG.md`, `COMPATIBILITY.md`,
  `LIMITATIONS.md`, `SECURITY.md`, and `CHANGELOG.md` aligned with behavior and
  design decisions.
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
- state-changing local workflow upshift
- read-only shell/git inspection staying cheap
- low-confidence fallback
- classifier accepted and rejected decisions
- missing configured model fallback
- invalid config warnings

## Release Checklist

Before tagging a release:

- `npm run typecheck` passes
- `npm test` passes
- `npm run test:package` passes
- optional signed-in `TOKENOMY_LIVE_EVAL=1 npm run test:live` evidence is
  reviewed for routing-policy changes
- `pi --offline --approve --no-session --list-models openai-codex` loads the extension
- README and INSTALL recommend the current install path
- CONFIG, SECURITY, COMPATIBILITY, and LIMITATIONS match the implemented defaults
- `CHANGELOG.md` has a dated version entry
- compatibility notes mention any Pi API assumptions
- npm publish automation will create the matching tag and GitHub Release; do
  not manually tag before the package version is verified on npm
