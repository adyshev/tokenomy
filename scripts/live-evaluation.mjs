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
import { fileURLToPath } from "node:url";

if (process.env.TOKENOMY_LIVE_EVAL !== "1") {
  console.error(
    "Live evaluation is opt-in. Re-run with TOKENOMY_LIVE_EVAL=1 after signing in to Pi.",
  );
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace =
  process.env.TOKENOMY_LIVE_EVAL_DIR ||
  mkdtempSync(join(tmpdir(), "tokenomy-live-eval-"));
const model = process.env.TOKENOMY_LIVE_MODEL || "openai-codex/gpt-5.5";
const pi = resolve(root, "node_modules/.bin/pi");
const extension = resolve(root, ".pi/extensions/tokenomy/index.ts");

mkdirSync(join(workspace, ".pi"), { recursive: true });
writeFileSync(
  join(workspace, ".pi/tokenomy.json"),
  `${JSON.stringify(
    {
      telemetry: { enabled: true, maxEntries: 200 },
      routing: {
        restoreModelAfterPrompt: false,
        restoreThinkingAfterPrompt: false,
      },
      quality: {
        evaluatorEnabled: process.env.TOKENOMY_LIVE_EVALUATOR === "1",
      },
    },
    null,
    2,
  )}\n`,
);

const fixture = `export function sum(a, b) {
  return a - b;
}
`;
const testFixture = `import assert from "node:assert/strict";
import { sum } from "./sum.js";
assert.equal(sum(2, 3), 5);
`;
writeFileSync(join(workspace, "sum.js"), fixture);
writeFileSync(join(workspace, "sum.test.js"), testFixture);
writeFileSync(
  join(workspace, "package.json"),
  `${JSON.stringify(
    {
      type: "module",
      scripts: { test: "node sum.test.js" },
    },
    null,
    2,
  )}\n`,
);

const scenarios = [
  {
    id: "simple-answer",
    prompt: "Answer with only the number: what is 6 multiplied by 7?",
    verify: (result) => /\b42\b/.test(result.stdout),
  },
  {
    id: "focused-fix",
    prompt:
      "Fix sum.js so the existing test passes. Run the test and report the result concisely.",
    before: () => writeFileSync(join(workspace, "sum.js"), fixture),
    verify: () =>
      spawnSync(process.execPath, ["sum.test.js"], {
        cwd: workspace,
        encoding: "utf8",
      }).status === 0,
  },
  {
    id: "multi-step-quality",
    prompt:
      "Audit this tiny project, fix the sum implementation, add a negative-number assertion, run all tests, and summarize exactly what changed.",
    before: () => {
      writeFileSync(join(workspace, "sum.js"), fixture);
      writeFileSync(join(workspace, "sum.test.js"), testFixture);
    },
    verify: () => {
      const test = spawnSync(process.execPath, ["sum.test.js"], {
        cwd: workspace,
        encoding: "utf8",
      });
      return (
        test.status === 0 &&
        /-\d/.test(readFileSync(join(workspace, "sum.test.js"), "utf8"))
      );
    },
  },
];

const results = [];
for (const scenario of scenarios) {
  scenario.before?.();
  const run = spawnSync(
    pi,
    [
      "--offline",
      "--approve",
      "--no-session",
      "--mode",
      "json",
      "--print",
      "--extension",
      extension,
      "--model",
      model,
      scenario.prompt,
    ],
    {
      cwd: workspace,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const result = {
    id: scenario.id,
    exitCode: run.status,
    verified: run.status === 0 && scenario.verify(run),
    stdout: run.stdout.slice(-4000),
    stderr: run.stderr.slice(-2000),
  };
  results.push(result);
  if (!result.verified) break;
}

const historyPath = join(
  workspace,
  ".pi/tokenomy-cache/routing-history.json",
);
const rollupPath = join(
  workspace,
  ".pi/tokenomy-cache/telemetry-rollups.json",
);
const evidence = {
  version: 1,
  at: new Date().toISOString(),
  workspace,
  model,
  results,
  routingHistory: existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf8"))
    : undefined,
  rollups: existsSync(rollupPath)
    ? JSON.parse(readFileSync(rollupPath, "utf8"))
    : undefined,
};
const evidencePath =
  process.env.TOKENOMY_LIVE_EVAL_OUTPUT ||
  join(workspace, "tokenomy-live-evidence.json");
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Tokenomy live evidence: ${evidencePath}`);
console.log(
  results
    .map(
      (result) =>
        `${result.id}: ${result.verified ? "verified" : "failed"} (exit ${result.exitCode})`,
    )
    .join("\n"),
);
process.exit(results.every((result) => result.verified) ? 0 : 1);
