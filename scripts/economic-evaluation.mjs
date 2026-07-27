import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { compareArms, trendAgainst } from "./evaluation-core.mjs";
import { scenariosForProfile } from "./evaluation-scenarios.mjs";

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
const profile = process.env.TOKENOMY_ECON_PROFILE || "smoke";
const repeats = Math.max(
  1,
  Number.parseInt(
    process.env.TOKENOMY_ECON_REPEATS || (profile === "full" ? "3" : "1"),
    10,
  ),
);
const requestedArms = (
  process.env.TOKENOMY_ECON_ARMS || "baseline,router"
)
  .split(",")
  .map((arm) => arm.trim())
  .filter(Boolean);
const arms = [...new Set(["baseline", ...requestedArms])];
const maxQualityDrop = Number.parseFloat(
  process.env.TOKENOMY_ECON_MAX_QUALITY_DROP || "0",
);

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

function loadScenarios() {
  const manifestPath = process.env.TOKENOMY_ECON_MANIFEST;
  if (!manifestPath) return scenariosForProfile(profile);
  const parsed = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("TOKENOMY_ECON_MANIFEST must contain a non-empty JSON array");
  }
  return parsed;
}

function seedWorkspace(scenario, label) {
  const workspace = mkdtempSync(join(tmpdir(), `tokenomy-economic-${label}-`));
  if (scenario.fixturePath) {
    cpSync(resolve(scenario.fixturePath), workspace, { recursive: true });
  } else if (scenario.fixture === "sum") {
    writeFileSync(join(workspace, "sum.js"), sourceFixture);
    writeFileSync(join(workspace, "sum.test.js"), testFixture);
    writeFileSync(
      join(workspace, "package.json"),
      '{"type":"module","scripts":{"test":"node sum.test.js"}}\n',
    );
  }
  mkdirSync(join(workspace, ".pi"), { recursive: true });
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
      if (candidate?.usage) messages.set(JSON.stringify(candidate), candidate);
    } catch {
      // Pi can interleave non-JSON diagnostics.
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

function safeFixturePath(workspace, path) {
  const target = resolve(workspace, path);
  if (isAbsolute(path) || relative(workspace, target).startsWith("..")) {
    throw new Error(`verification path escapes fixture: ${path}`);
  }
  return target;
}

function verifyScenario(scenario, workspace, stdout) {
  const verify = scenario.verify || {};
  if (verify.stdoutRegex && !new RegExp(verify.stdoutRegex, "m").test(stdout)) {
    return false;
  }
  if (verify.command) {
    const [command, ...args] = verify.command;
    if (
      spawnSync(command, args, { cwd: workspace, encoding: "utf8" }).status !==
      0
    ) {
      return false;
    }
  }
  if (verify.fileRegex) {
    const path = safeFixturePath(workspace, verify.fileRegex.path);
    if (
      !existsSync(path) ||
      !new RegExp(verify.fileRegex.pattern, "m").test(
        readFileSync(path, "utf8"),
      )
    ) {
      return false;
    }
  }
  return true;
}

function armConfig(arm) {
  if (arm === "router") return { classifier: { enabled: false } };
  if (arm === "full") return { classifier: { enabled: true } };
  if (arm !== "baseline") throw new Error(`unknown evaluation arm: ${arm}`);
  return undefined;
}

function runScenario(scenario, arm, repeat) {
  const workspace = seedWorkspace(scenario, `${scenario.id}-${arm}-${repeat}`);
  const override = armConfig(arm);
  if (override) {
    writeFileSync(
      join(workspace, ".pi/tokenomy.json"),
      JSON.stringify({
        ...override,
        routing: {
          restoreModelAfterPrompt: false,
          restoreThinkingAfterPrompt: false,
        },
      }),
    );
  }
  const run = spawnSync(
    pi,
    [
      "--offline",
      "--approve",
      "--no-session",
      "--mode",
      "json",
      "--print",
      ...(override ? ["--extension", extension] : []),
      "--model",
      baselineModel,
      scenario.prompt,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const rollupPath = join(workspace, ".pi/tokenomy-cache/telemetry-rollups.json");
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
    scenario: scenario.id,
    arm,
    repeat,
    exitCode: run.status,
    verified:
      run.status === 0 && verifyScenario(scenario, workspace, run.stdout),
    usage,
    stdoutTail: run.stdout.slice(-2000),
    stderrTail: run.stderr.slice(-1000),
  };
}

const scenarios = loadScenarios();
const runs = [];
for (let repeat = 1; repeat <= repeats; repeat += 1) {
  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex];
    const order = [...arms];
    if ((scenarioIndex + repeat) % 2 === 0) order.reverse();
    for (const arm of order) runs.push(runScenario(scenario, arm, repeat));
  }
}

const baselineRuns = runs.filter((run) => run.arm === "baseline");
const comparisons = Object.fromEntries(
  arms
    .filter((arm) => arm !== "baseline")
    .map((arm) => [
      arm,
      compareArms(
        baselineRuns,
        runs.filter((run) => run.arm === arm),
        maxQualityDrop,
      ),
    ]),
);
const evidence = {
  version: 2,
  at: new Date().toISOString(),
  design:
    "paired fresh-workspace, counterbalanced-order, repeated comparison against one fixed model",
  baselineModel,
  profile,
  repeats,
  scenarioCount: scenarios.length,
  arms,
  maxQualityDrop,
  runs,
  comparisons,
};
const previousPath = process.env.TOKENOMY_ECON_PREVIOUS;
if (previousPath) {
  evidence.trend = trendAgainst(
    JSON.parse(readFileSync(resolve(previousPath), "utf8")),
    evidence,
  );
}
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Tokenomy economic evidence: ${evidencePath}`);
for (const [arm, comparison] of Object.entries(comparisons)) {
  console.log(
    `${arm}: quality delta=${(comparison.qualityDelta * 100).toFixed(1)}pp, savings=${comparison.creditSavingPercent?.toFixed(1) ?? "n/a"}%, gate=${comparison.qualityGatePassed ? "PASS" : "FAIL"}`,
  );
}
process.exit(
  Object.values(comparisons).every(
    (comparison) => comparison.qualityGatePassed,
  )
    ? 0
    : 1,
);
