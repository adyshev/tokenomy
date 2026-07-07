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
- adaptive fallback count
- per-intent route counters
- last update timestamp

The classifier cache stores routing decisions keyed by a normalized prompt hash,
context bucket, intent, and risk. The project digest stores compact routing
metadata such as intent counts and the last selected tier/model.

Tokenomy does not store raw prompt text, model responses, API keys, or auth
headers.

## Model Calls

The local heuristic uses no model tokens. If the classifier is enabled,
Tokenomy may send an ambiguous prompt excerpt to the configured classifier model
through Pi's authenticated provider.

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
