# Changelog

## Unreleased
- Added opt-in local debug session traces with `/tokenomy debug on`,
  `/tokenomy debug path`, `/tokenomy debug off`, and `debug.trace` config.
  Traces are JSONL files intended for diagnosing routing decisions and include
  a clear warning because they can contain raw session data.

## 0.1.21-beta - 2026-07-09
- Added default-on model restoration after each prompt so temporary routing
  choices do not leave Pi on the cheaper or stronger selected model.
- Added local prompt-shape analysis for question/action/mixed prompts,
  action-count signals, multi-step routing, and prompt-shape telemetry.
- Adopted `compromise` for local sentence, question, and verb analysis in the
  prompt-shape router.
- Replaced Tokenomy's local classifier-token estimate with
  `tokenshrink.countTokens()`.

## 0.1.20-beta - 2026-07-09
- Added durable local telemetry rollups with daily, monthly, and lifetime
  prompt-safe aggregates for estimated savings, route distribution, memory,
  compression, cache, fallback, and guard activity.
- Added `/tokenomy report`, period-specific report commands, and
  `/tokenomy export-report` for local evidence of Tokenomy efficiency over
  time.

## 0.1.19-beta - 2026-07-08
- Kept trivial general prompts and single-command local info questions such as
  `how time is it?` on the cheapest model even in large project contexts.

## 0.1.18-beta - 2026-07-08
- Removed Tokenomy's main Pi footer/status entry to avoid crowding or
  conflicting with other extension footers; `/tokenomy status`, notifications,
  history, and telemetry remain the stable visibility paths.

## 0.1.17-beta - 2026-07-08
- Made the Tokenomy status/footer text visibly labeled and refreshed by
  `/tokenomy status`.
- Routed broad review/refactor prompts such as `please do an audit`,
  `please review`, and `please refactor` to the complex tier instead of the
  cheapest mini model.
- Added transparent bypass for prompts written primarily outside English while
  still allowing English instructions that contain non-English payload text.

## 0.1.16-beta - 2026-07-08
- Added a compact Tokenomy status/footer formatter that shows tier, source,
  confidence, session savings, and lifetime savings without replacing other
  plugin status entries.
- Added local workflow routing for state-changing git/tool chains such as
  `commit & push`, while keeping read-only git inspection prompts cheap.

## 0.1.15-beta - 2026-07-08
- Fixed short config-audit prompts such as nvim/tmux final scans routing to
  the cheapest mini model.

## 0.1.14-beta - 2026-07-08
- Audited docs for npm install, compatibility, memory, compression, telemetry,
  and release guidance alignment.

## 0.1.13-beta - 2026-07-08
- Improved the npm/GitHub package description and README introduction to state
  Tokenomy's user-facing goal, default benefits, Plus/Pro Codex scope, local
  memory, compression, safety guards, and telemetry.

## 0.1.12-beta - 2026-07-08
- Added default-on local project memory with automatic safe fact discovery and advisory injection.
- Added `/tokenomy memory`, `/tokenomy memory show`, `/tokenomy memory refresh`, `/tokenomy memory clear`, `/tokenomy memory on`, and `/tokenomy memory off`.
- Added memory injection telemetry and tests for value, privacy, disabling, stale facts, and simple-prompt skips.

## 0.1.11-beta - 2026-07-08
- Added prompt-safe local routing telemetry with `/tokenomy history`, `/tokenomy export-history`, and `/tokenomy reset-history`.
- Added compression guard telemetry and lifetime stats for rejected classifier prompt compression.

## 0.1.10-beta - 2026-07-08
- Added local TokenShrink-based classifier prompt compression.
- Added `promptSimplification.compressionEnabled` to disable TokenShrink compression while keeping it enabled by default.
- Added local prompt simplification for large classifier prompts and long-output condensation guidance.
- Fixed simple shell/listing prompts such as `ls -l` routing to the medium tier in large contexts.

## 0.1.1-beta through 0.1.9-beta - 2026-07-07 to 2026-07-08
- Reduced duplicate stats writes during digest injection and added regression coverage for corrupted classifier cache handling.
- Added intent/risk-aware routing, classifier decision caching, adaptive fallback tiers, and compact project digest injection for large/repeated contexts.
- Changed the default medium model preference to `gpt-5.4` before `gpt-5.4-mini`.
- Added the installed Tokenomy package version to `/tokenomy status`.
- Synced npm's default `latest` dist-tag during publish so `pi install npm:tokenomy-pi` gets the current beta.
- Fixed stats persistence for globally installed Tokenomy in projects that do not already have a `.pi` directory.
- Public-readiness documentation pass.
- Added installation, configuration, security, contributing, and limitations docs.
- Expanded integration tests for classifier acceptance/rejection, missing model fallback, and invalid config warnings.
- Added `/tokenomy explain`, `/tokenomy reset-stats`, and `/tokenomy dry-run` commands.
- Added Pi package manifest support for `pi install`.
- Added GitHub Actions CI for JSON validation and integration tests.
- Added npm package metadata and automated npm publish workflow.
- Added manual npm publish workflow dispatch and graceful skip when `NPM_TOKEN` is not configured.
- Updated GitHub Actions to Node-24-compatible action versions and bumped beta package for npm publish flow testing.

## 0.1.0-beta - 2026-07-07
- Added config validation and warnings for invalid/empty model lists.
- Added optional dry-run/debug routing support.
- Made tool management opt-in by default for safer sharing.
- Added compatibility notes for public use.
