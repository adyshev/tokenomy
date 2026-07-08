# Changelog

## Unreleased

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
