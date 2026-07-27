import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

if (process.env.TOKENOMY_ECON_EVAL !== "1") {
  console.error(
    "Economic evaluation is opt-in. Re-run with TOKENOMY_ECON_EVAL=1 after signing in to Pi.",
  );
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const evidencePath =
  process.env.TOKENOMY_ECON_EVAL_OUTPUT ||
  join(mkdtempSync(join(tmpdir(), "tokenomy-economic-evidence-")), "evidence.json");
const pi = join(root, "node_modules/.bin/pi");
const extension = join(root, ".pi/extensions/tokenomy/index.ts");
const baselineModel =
  process.env.TOKENOMY_ECON_BASELINE_MODEL || "openai-codex/gpt-5.6-sol";

const rates = {
  "gpt-5.6-sol": { input: 125, cacheRead: 12.5, output: 750 },
  "gpt-5.6-terra": { input: 62.5, cacheRead: 6.25, output: 375 },
  "gpt-5.6-luna": { input: 25, cacheRead: 2.5, output: 150 },
  "gpt-5.5": { input: 125, cacheRead: 12.5, output: 750 },
  "gpt-5.4": { input: 62.5, cacheRead: 6.25, output: 375 },
  "gpt-5.4-mini": { input: 18.75, cacheRead: 1.875, output: 113 },
};

const sourceFixture = "export function sum(a, b) {\n  return a - b;\n}\n";
const testFixture =
  'import assert from "node:assert/strict";\nimport { sum } from "./sum.js";\nassert.equal(sum(2, 3), 5);\n';
const scenarios = [
  {
    id: "simple-answer",
    prompt: "Answer with only the number: what is 6 multiplied by 7?",
    verify: (workspace, stdout) => /\b42\b/.test(stdout),
  },
  {
    id: "focused-fix",
    prompt:
      "Fix sum.js so the existing test passes. Run the test and report the result concisely.",
    verify: (workspace) =>
      spawnSync(process.execPath, ["sum.test.js"], {
        cwd: workspace,
        encoding: "utf8",
      }).status === 0,
  },
  {
    id: "multi-step-quality",
    prompt:
      "Audit this tiny project, fix the sum implementation, add a negative-number assertion, run all tests, and summarize exactly what changed.",
    verify: (workspace) =>
      spawnSync(process.execPath, ["sum.test.js"], {
        cwd: workspace,
        encoding: "utf8",
      }).status === 0 &&
      /-\d/.test(readFileSync(join(workspace, "sum.test.js"), "utf8")),
  },
];

function seedWorkspace(label) {
  const workspace = mkdtempSync(join(tmpdir(), `tokenomy-economic-${label}-`));
  mkdirSync(join(workspace, ".pi"), { recursive: true });
  writeFileSync(join(workspace, "sum.js"), sourceFixture);
  writeFileSync(join(workspace, "sum.test.js"), testFixture);
  writeFileSync(
    join(workspace, "package.json"),
    '{"type":"module","scripts":{"test":"node sum.test.js"}}\n',
  );
  return workspace;
}

function assistantUsage(stdout) {
  const messages = new Map();
  for (const line of stdout.split("\n")) {
    try {
      const event = JSON.parse(line);
      const candidate =
        event?.message?.role === "assistant"
          ? event.message
          : event?.role === "assistant"
            ? event
            : undefined;
      if (candidate?.usage) {
        messages.set(JSON.stringify(candidate), candidate);
      }
    } catch {
      // Pi can interleave non-JSON diagnostics; ignore those lines.
    }
  }
  const total = {
    input: 0,
    cacheRead: 0,
    output: 0,
    totalTokens: 0,
    estimatedPlanCredits: 0,
  };
  for (const message of messages.values()) {
    const usage = message.usage;
    const model = String(message.model || baselineModel).split("/").at(-1);
    const rate = rates[model];
    total.input += usage.input || 0;
    total.cacheRead += usage.cacheRead || 0;
    total.output += usage.output || 0;
    total.totalTokens += usage.totalTokens || 0;
    if (rate) {
      total.estimatedPlanCredits +=
        ((usage.input || 0) * rate.input +
          (usage.cacheRead || 0) * rate.cacheRead +
          (usage.output || 0) * rate.output) /
        1_000_000;
    }
  }
  return total;
}

function runScenario(scenario, tokenomyEnabled) {
  const workspace = seedWorkspace(
    `${scenario.id}-${tokenomyEnabled ? "tokenomy" : "baseline"}`,
  );
  if (tokenomyEnabled) {
    writeFileSync(
      join(workspace, ".pi/tokenomy.json"),
      JSON.stringify({
        classifier: { enabled: false },
        routing: {
          restoreModelAfterPrompt: false,
          restoreThinkingAfterPrompt: false,
        },
      }),
    );
  }
  const args = [
    "--offline",
    "--approve",
    "--no-session",
    "--mode",
    "json",
    "--print",
    ...(tokenomyEnabled ? ["--extension", extension] : []),
    "--model",
    baselineModel,
    scenario.prompt,
  ];
  const run = spawnSync(pi, args, {
    cwd: workspace,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const rollupPath = join(
    workspace,
    ".pi/tokenomy-cache/telemetry-rollups.json",
  );
  const rollup = existsSync(rollupPath)
    ? JSON.parse(readFileSync(rollupPath, "utf8")).lifetime
    : undefined;
  const usage = rollup
    ? {
        input: rollup.inputTokens,
        cacheRead: rollup.cacheReadTokens,
        output: rollup.outputTokens,
        totalTokens: rollup.totalTokens,
        estimatedPlanCredits:
          rollup.estimatedPlanCredits +
          rollup.classifierEstimatedPlanCredits,
      }
    : assistantUsage(run.stdout);
  return {
    exitCode: run.status,
    verified: run.status === 0 && scenario.verify(workspace, run.stdout),
    usage,
    stdoutTail: run.stdout.slice(-2000),
    stderrTail: run.stderr.slice(-1000),
  };
}

const pairs = scenarios.map((scenario, index) => {
  // Counterbalance execution order so the second arm does not always receive
  // any provider-side prompt-cache advantage.
  const tokenomyFirst = index % 2 === 1;
  const first = runScenario(scenario, tokenomyFirst);
  const second = runScenario(scenario, !tokenomyFirst);
  const baseline = tokenomyFirst ? second : first;
  const tokenomy = tokenomyFirst ? first : second;
  return {
    id: scenario.id,
    order: tokenomyFirst ? ["tokenomy", "baseline"] : ["baseline", "tokenomy"],
    baseline,
    tokenomy,
    creditDelta:
      tokenomy.usage.estimatedPlanCredits -
      baseline.usage.estimatedPlanCredits,
    creditSavingPercent:
      baseline.usage.estimatedPlanCredits > 0
        ? ((baseline.usage.estimatedPlanCredits -
            tokenomy.usage.estimatedPlanCredits) /
            baseline.usage.estimatedPlanCredits) *
          100
        : null,
  };
});
const total = pairs.reduce(
  (sum, pair) => ({
    baselineCredits:
      sum.baselineCredits + pair.baseline.usage.estimatedPlanCredits,
    tokenomyCredits:
      sum.tokenomyCredits + pair.tokenomy.usage.estimatedPlanCredits,
  }),
  { baselineCredits: 0, tokenomyCredits: 0 },
);
const evidence = {
  version: 1,
  at: new Date().toISOString(),
  design:
    "paired fresh-workspace, counterbalanced-order comparison against one fixed model",
  baselineModel,
  pairs,
  total: {
    ...total,
    creditDelta: total.tokenomyCredits - total.baselineCredits,
    creditSavingPercent:
      total.baselineCredits > 0
        ? ((total.baselineCredits - total.tokenomyCredits) /
            total.baselineCredits) *
          100
        : null,
  },
};
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Tokenomy economic evidence: ${evidencePath}`);
for (const pair of pairs) {
  console.log(
    `${pair.id}: baseline=${pair.baseline.usage.estimatedPlanCredits.toFixed(4)} tokenomy=${pair.tokenomy.usage.estimatedPlanCredits.toFixed(4)} credits; quality ${pair.baseline.verified && pair.tokenomy.verified ? "verified" : "FAILED"}`,
  );
}
process.exit(
  pairs.every((pair) => pair.baseline.verified && pair.tokenomy.verified)
    ? 0
    : 1,
);
