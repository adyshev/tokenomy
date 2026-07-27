# Security

Tokenomy is a local Pi extension. It does not intentionally collect, transmit,
or store API keys.

## Stored Data

Tokenomy may create `.pi/tokenomy-stats.json` and `.pi/tokenomy-cache/` in
projects where it runs. The stats file stores local routing counters and a
deprecated pre-v2 savings field:

- legacy lifetime model-rank savings proxy
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
size, context bucket, selected tier/source/model, confidence, signals, usage
status, provider-reported token/cost totals, and estimated plan credits. For
live classifier calls, it also includes classifier usage and compression guard
status/counts, but not the protected signal-line text. It does not store raw
prompt text or model responses. It can also store language/mode labels,
experiment cohorts, user feedback, correction flags, evaluator scores, and
aggregate tool-result sizes. It never stores raw tool arguments or results.

Telemetry rollups are stored in `.pi/tokenomy-cache/telemetry-rollups.json`.
They aggregate daily, monthly, and lifetime counters such as input/cached/output
tokens, optional reasoning, request counts, cost, plan-credit estimates,
measured/unavailable coverage, route distribution, classifier overhead,
adaptive fallbacks, prompt shape, completion stop-reason categories, tool
call/error counts, retry runs, compactions, verified-feedback counts, evaluator
score totals, tool-output sizes, duplicate-call counts, truncation counts, and
removed-token counts, plus measured compaction token deltas.
Rollups do not store raw prompt text, prompt hashes, tool arguments/results,
model responses, API keys, or auth headers.

When the provider exposes recognized rate-limit or usage response headers,
Tokenomy stores the latest sanitized subset in
`.pi/tokenomy-cache/account-limits.json`. The allowlist excludes authorization,
cookies, and unrelated headers; values containing line breaks are rejected and
stored values are length-limited. This snapshot is provider/process scoped, not
an account-wide ledger.

Tokenomy does not store raw prompt text, model responses, API keys, or auth
headers during normal operation.

External rate cards and account-quota snapshots must use project-relative
paths. Tokenomy rejects absolute paths and paths that escape the project root.
Account quota files are supplied by the user or a companion/Enterprise adapter;
they should contain counters only, never cookies, OAuth tokens, or API keys.
An explicitly configured `registry.rateCardUrl` performs an HTTPS GET during
session startup only when the current card is stale by `refreshHours`. The
response is size-limited and schema-validated before it replaces the local
rate-card file.

If `debug.trace` is explicitly enabled, Tokenomy writes a local JSONL debug
trace under `.pi/tokenomy-cache/debug/session-*.jsonl`. Payload fields are
redacted by default. Setting `debug.redact` to `false` may record raw prompts,
model/tool outputs, classifier prompts/responses, memory context, compression
data, routing decisions, and internal errors. Trace files use mode `0600` and
cache directories use `0700` where POSIX permissions are supported. Old traces
expire after `debug.retentionDays`; `/tokenomy debug purge` removes them now.

JSON state files use a per-file lock and atomic rename so a crash cannot leave
a partially written document. Stale locks are recovered. Statistics, routing
history, and telemetry rollups perform their full read-modify-write transaction
under that lock, so concurrent Pi processes preserve independent increments and
entries. Replaceable caches, memory, and digest snapshots remain atomic
last-completed writes.

`/tokenomy data` inventories project-local state. Selective purge commands
remove cache, telemetry, memory, or debug data without configuration; purging
all data requires confirmation when UI is available.

Prompt-shape analysis uses the local `compromise` NLP library. It does not send
prompt text to an external service.

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

If `quality.evaluatorEnabled` is explicitly enabled, Tokenomy sends a bounded
copy of the current task and assistant output to the configured evaluator
model. This does not persist the raw content in normal telemetry, but it is an
additional authenticated model call and consumes quota.

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
