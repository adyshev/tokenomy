# Standard Usage Scenario

This guide follows a typical ChatGPT Plus user from installation through daily
work. Tokenomy is a Pi extension, so run these steps in Pi rather than the
native OpenAI Codex CLI.

## 1. Install and sign in

Install the normal supported npm package:

```bash
pi install npm:tokenomy-pi
```

Use `pi install -l npm:tokenomy-pi` instead when Tokenomy should be registered
only for the current project. The package scope does not change generated-data
scope: routing history, memory, and reports remain local to each project.
Project config is local too; an optional global config can provide shared
defaults.

Start Pi from the project you want to work on:

```bash
cd /path/to/project
pi
```

If needed, run `/login` and select Pi's `openai-codex` provider with the
ChatGPT Plus account. Then verify the setup:

```text
/tokenomy doctor
/tokenomy status
```

`doctor` checks configuration, configured model availability, private local
storage, the bundled schema, and rate-card freshness. Resolve its warnings
before relying on automatic routing.

## 2. Start with balanced routing

No project config is required. The default `balanced` mode uses local prompt
signals first and calls the inexpensive classifier only for eligible ambiguous
prompts when its estimated benefit exceeds its cost.

A normal mixed session might contain:

```text
Explain what this function returns.
Fix the failing validation test in src/config.ts.
Audit the release workflow, implement the required fixes, run the full checks,
and prepare the release notes.
```

Tokenomy should generally reserve:

- the simple tier for explanations, trivial commands, and low-risk reads;
- the medium tier for focused edits, local workflows, and debugging;
- the complex tier for broad, multi-step, architecture, security, and release
  work.

These are policies, not guarantees. The notification after each decision shows
the selected tier, model, source, and thinking level. Inspect the latest
decision when the route surprises you:

```text
/tokenomy explain
```

Use `/tokenomy history` to compare up to ten recent routes. Tokenomy restores
the model and thinking level that were active before each fully settled prompt,
so a temporary downshift does not silently become the next prompt's baseline.

## 3. Correct the quality record

After a completed turn, attach your own result assessment:

```text
/tokenomy feedback success
/tokenomy feedback partial
/tokenomy feedback failure
```

Use one rating, not all three, for the latest routed turn. This makes the local
quality statistics more meaningful than completion status alone. Tokenomy may
also detect a later correction prompt, but that signal is only a proxy.

If repeated work is being under-routed, switch to quality mode for the rest of
the session:

```text
/tokenomy mode quality
```

If the routes are reliably conservative and plan capacity is the priority, try:

```text
/tokenomy mode save
```

Return to the default with `/tokenomy mode balanced`. Mode commands affect only
the current Pi process. To make a choice persistent, add `"mode": "quality"`
(or another mode) to `.pi/tokenomy.json`.

## 4. Review usage and evidence

After several turns, inspect the project-local evidence:

```text
/tokenomy dashboard
/tokenomy report 7d
/tokenomy report 30d
```

The dashboard combines measured provider usage, estimated plan credits,
quality feedback, tier spend, tool-result measurements, compaction savings, and
budget status. `/tokenomy report month` and `/tokenomy report lifetime` provide
other periods.

Interpret the numbers carefully:

- provider-reported tokens are measured when Pi exposes usable turn data;
- plan credits are estimates from the versioned local rate card;
- unavailable usage stays marked unavailable instead of being guessed;
- reports cover Tokenomy turns in this project, not the whole ChatGPT account;
- `/tokenomy limits` shows only recognized provider headers visible to Pi;
- `/tokenomy quota` needs an explicit local adapter snapshot because Tokenomy
  cannot retrieve personal Plus account totals from a public API.

Use `/tokenomy export-history` or `/tokenomy export-report` to locate the JSON
evidence files for your own analysis.

## 5. Add a budget after observing normal use

Budgets are disabled by default. First observe a few ordinary sessions, then
choose limits that match the credit scale shown by your dashboard. For example:

```json
{
  "budgets": {
    "sessionCredits": 10,
    "warnAtPercent": 80,
    "policy": "save",
    "reserveCredits": 2,
    "maxDownshiftTiers": 1
  }
}
```

Save this as `.pi/tokenomy.json`, then run:

```text
/tokenomy reload
/tokenomy doctor
```

Here, two estimated credits remain reserved and later non-high-risk turns may
downshift by one tier after the spendable budget is reached. High-risk work is
never budget-downshifted. Use `policy: "warn"` to receive warnings without
changing routing, or `policy: "ask"` to confirm stronger routing interactively.

These limits manage Tokenomy's project-local estimate; they cannot enforce or
extend the provider's account-wide Plus quota.

## 6. Use memory and compaction deliberately

Tokenomy learns safe project facts by default, but does not inject them into
the prompt by default so provider prefix caching stays stable. Inspect what it
has learned:

```text
/tokenomy memory show
```

For a long-running project where repeated discovery is expensive, enable
learning and injection for the current process:

```text
/tokenomy memory on
```

To persist that choice, configure:

```json
{
  "memory": {
    "enabled": true,
    "inject": true
  }
}
```

Memory is advisory and the current user prompt always wins. Use
`/tokenomy memory refresh` after major project changes or
`/tokenomy memory clear` when facts are no longer trustworthy.

For a long conversation whose context is becoming expensive, trigger
task-preserving compaction manually:

```text
/tokenomy compact
```

Automatic compaction and oversized tool-result truncation remain off by default
because both can remove useful context. Enable them only after reading
`CONFIG.md` and `LIMITATIONS.md`.

## 7. Inspect or remove local data

Tokenomy's normal telemetry is prompt-safe and does not store raw prompts,
model responses, credentials, or raw tool results. See every local state path:

```text
/tokenomy data
```

Selective purge preserves `.pi/tokenomy.json`:

```text
/tokenomy data purge cache
/tokenomy data purge telemetry
/tokenomy data purge memory
/tokenomy data purge debug
```

`/tokenomy data purge all` removes all generated Tokenomy state after
confirmation while preserving configuration. Debug tracing is a separate
opt-in diagnostic feature; its payloads are redacted by default.

## 8. Update

Update installed Pi extensions through the same normal channel:

```bash
pi update --extensions
```

Run `/tokenomy doctor` after an update. Pinned git installs do not move until
you explicitly install a newer tag or commit.

For every option and its exact default, see `CONFIG.md`. For supported runtime
versions and known caveats, see `COMPATIBILITY.md` and `LIMITATIONS.md`.
