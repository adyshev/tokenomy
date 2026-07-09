# Security

Tokenomy is a local Pi extension. It does not intentionally collect, transmit,
or store API keys.

## Stored Data

Tokenomy may create `.pi/tokenomy-stats.json` and `.pi/tokenomy-cache/` in
projects where it runs. The stats file stores local estimated usage counters:

- lifetime estimated tokens saved
- routed prompt count
- Tokenomy session count
- classifier cache hit count
- project digest use count
- memory injection count
- adaptive fallback count
- compression guard rejection count
- per-intent route counters
- last update timestamp

The classifier cache stores routing decisions keyed by a normalized prompt hash,
context bucket, intent, and risk. The project digest stores compact routing
metadata such as intent counts and the last selected tier/model.

Routing telemetry, when enabled, stores recent decision metadata in
`.pi/tokenomy-cache/routing-history.json`. It includes prompt hashes, prompt
size, context bucket, selected tier/source/model, confidence, signals, and
estimated token savings. For live classifier calls, it also includes
compression guard status and counts, but not the protected signal line text. It
does not store raw prompt text or model responses.

Telemetry rollups are stored in `.pi/tokenomy-cache/telemetry-rollups.json`.
They aggregate daily, monthly, and lifetime counters such as estimated baseline
cost units, estimated routed cost units, estimated savings, route distribution,
classifier cache hits, memory savings estimates, compression savings estimates,
adaptive fallbacks, and compression guard rejections. Rollups do not store raw
prompt text, prompt hashes, model responses, API keys, or auth headers.

Tokenomy does not store raw prompt text, model responses, API keys, or auth
headers.

Project memory, when enabled, stores short durable facts in
`.pi/tokenomy-cache/project-memory.json`. Examples include package name, npm
script commands, known implementation file paths, and CI/release workflow
hints. Tokenomy does not store raw prompts or model responses in project
memory. Memory injection is advisory and explicitly lower priority than the
current user prompt.

## Model Calls

The local heuristic uses no model tokens. If the classifier is enabled,
Tokenomy may send an ambiguous prompt excerpt to the configured classifier model
through Pi's authenticated provider.

For large prompts, Tokenomy can simplify the classifier excerpt locally before
the classifier call. This reduces prompt size but may still include relevant
error lines, file paths, and counts from the user's prompt.

TokenShrink prompt compression runs locally through the `tokenshrink` SDK and
does not call external APIs. It is applied only to classifier excerpts, not to
the original agent prompt. It is enabled by default and can be disabled with
`promptSimplification.compressionEnabled: false`.

Set this to disable classifier calls:

```json
{
  "classifier": {
    "enabled": false
  }
}
```

## Tool Management

Tool management is disabled by default:

```json
{
  "tools": {
    "manage": false
  }
}
```

If enabled, Tokenomy can change Pi's active tools for a prompt. Review the
configured `readOnlyTools` and `writeTools` before enabling this in shared or
sensitive projects.

## Reporting Issues

For now, report security issues privately to the repository owner before public
disclosure. Include:

- Tokenomy version or commit
- Pi version
- affected config
- reproduction steps
- whether prompt text, files, or credentials may have been exposed
