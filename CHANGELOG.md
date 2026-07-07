# Changelog

## Unreleased
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
