# Evaluation

Tokenomy separates three kinds of evidence:

1. mocked integration tests for deterministic routing and storage behavior;
2. signed-in end-to-end tasks for real Pi/model compatibility;
3. a paired economic benchmark against one fixed model.

Normal CI never consumes ChatGPT quota. The signed-in suites are explicit,
manual runs.

The economic runner has two profiles:

- `smoke`: five deterministic cases, one repeat by default;
- `full`: 30 cases across simple answers, focused fixes, and multi-step quality,
  three repeats by default.

Every candidate arm must meet the configured quality non-inferiority margin
against the fixed baseline before savings are accepted. The default margin is
zero. Evidence includes Wilson 95% confidence intervals, classifier-inclusive
and classifier-disabled arms, all individual runs, and optional changes from a
previous evidence file.

## Recorded Plus evidence: 0.2.0-beta.1

Date: 2026-07-27

Pi API/runtime line: 0.82.1

Subscription tested: ChatGPT Plus

Fixed comparison model: `openai-codex/gpt-5.6-sol`

This section records a specific historical run; it is not a certification of
every later patch, model-catalog change, or user workload.

The live suite passed its simple-answer, focused-fix, and multi-step-quality
checks. Tokenomy routed those tasks to Mini, Terra, and Sol respectively, and
Pi reported usable token data for all three turns.

The paired benchmark then ran each task in a fresh workspace in two arms:

- fixed baseline: GPT-5.6 Sol with no Tokenomy extension;
- Tokenomy: the same prompt and fixture, with the classifier disabled so the
  routing decision itself added no model call.

Execution order was counterbalanced across scenarios. Both arms had to pass the
same deterministic task check before their usage was accepted.

| Scenario | Order | Fixed Sol credits | Tokenomy credits | Estimated credit change | Both verified |
| --- | --- | ---: | ---: | ---: | --- |
| Simple answer | baseline → Tokenomy | 0.1431 | 0.0247 | −82.7% | yes |
| Focused fix | Tokenomy → baseline | 1.0759 | 0.2927 | −72.8% | yes |
| Multi-step quality | baseline → Tokenomy | 1.3085 | 1.2093 | −7.6% | yes |
| **Total** | counterbalanced | **2.5275** | **1.5268** | **−39.6%** | **yes** |

Credits are calculated from Pi-reported input, cached-input, and output tokens
using OpenAI's 2026-07-27 token-based Codex rate card. The current rates list
Sol at 125/12.5/750 credits per million input/cached/output tokens, Terra at
62.5/6.25/375, Luna at 25/2.5/150, and Mini at
18.75/1.875/113. See the
[official Codex rate card](https://help.openai.com/en/articles/20001106-codex-rate-card).

## Interpretation

This run supports a narrow claim: on these three verified tasks, against a
fixed Sol baseline, Tokenomy used 39.6% fewer estimated plan credits in total.
It does **not** prove the same saving for other repositories, prompt mixes,
session histories, cache states, model updates, or subscriptions. The sample is
small (`n=3`), model outputs are stochastic, and provider-side caching is not
fully controllable from Pi.

Token totals and plan credits are different measures. A cheaper model can
produce more tokens while consuming fewer plan credits. Tokenomy therefore
reports both raw provider usage and the versioned credit conversion instead of
calling every reduction “tokens saved.”

## Reproduce

After signing in to Pi with ChatGPT Plus:

```bash
TOKENOMY_LIVE_EVAL=1 npm run test:live
TOKENOMY_ECON_EVAL=1 npm run test:economic
```

Choose explicit output paths to retain machine-readable evidence:

```bash
TOKENOMY_LIVE_EVAL=1 \
TOKENOMY_LIVE_EVAL_OUTPUT=/tmp/tokenomy-live.json \
npm run test:live

TOKENOMY_ECON_EVAL=1 \
TOKENOMY_ECON_EVAL_OUTPUT=/tmp/tokenomy-economic.json \
npm run test:economic
```

Run the repeated corpus, including classifier cost:

```bash
TOKENOMY_ECON_EVAL=1 \
TOKENOMY_ECON_PROFILE=full \
TOKENOMY_ECON_ARMS=baseline,router,full \
TOKENOMY_ECON_EVAL_OUTPUT=/tmp/tokenomy-economic-full.json \
npm run test:economic
```

`TOKENOMY_ECON_REPEATS` overrides repeats.
`TOKENOMY_ECON_MAX_QUALITY_DROP` sets the permitted success-rate delta (for
example `0.02`); keep it zero for deterministic fixtures.
`TOKENOMY_ECON_PREVIOUS` adds trend deltas against earlier version-2 evidence.
`TOKENOMY_ECON_MANIFEST` accepts a JSON array of scenarios with `id`, `prompt`,
optional `fixturePath`, and `verify.stdoutRegex`, `verify.command`, or
`verify.fileRegex`. This allows the same gate to run on representative real
repositories without committing them to Tokenomy.

Repeated full-profile and representative real-project runs remain required
before removing the beta label.
