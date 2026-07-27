import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeCalls } from "./pi-ai-compat-shim.mjs";
import tokenomy from "../.pi/extensions/tokenomy/index.ts";
import { TOKENOMY_CONFIG_SCHEMA } from "../.pi/extensions/tokenomy/lib/config-schema.ts";

const PACKAGE_VERSION = JSON.parse(readFileSync("package.json", "utf8"))
  .version;

const MODELS = [
  { provider: "openai-codex", id: "gpt-5.4" },
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.5" },
  { provider: "openai-codex", id: "gpt-5.6-sol" },
  { provider: "openai-codex", id: "gpt-5.6-terra" },
  { provider: "openai-codex", id: "gpt-5.6-luna" },
];

test("package manifest declares Tokenomy as an installable Pi extension", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));

  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions, [
    ".pi/extensions/tokenomy/index.ts",
  ]);
  assert.equal(manifest.scripts["test:live"], "node scripts/live-evaluation.mjs");
  assert.equal(
    manifest.scripts["test:economic"],
    "node scripts/economic-evaluation.mjs",
  );
  assert.equal(
    manifest.scripts["test:catalog"],
    "node --experimental-strip-types scripts/catalog-check.mjs",
  );
  assert.equal(manifest.scripts["test:package"], "node scripts/package-smoke.mjs");
  assert.ok(manifest.files.includes(".pi/extensions/tokenomy"));
  assert.ok(manifest.files.includes(".pi/tokenomy.schema.json"));
});

test("live evaluation stays explicitly opt-in", () => {
  const script = readFileSync("scripts/live-evaluation.mjs", "utf8");
  const workflow = readFileSync(
    ".github/workflows/live-evaluation.yml",
    "utf8",
  );
  assert.match(script, /TOKENOMY_LIVE_EVAL !== "1"/);
  assert.match(script, /tokenomy-live-evidence\.json/);
  assert.match(workflow, /runs-on: self-hosted/);
  assert.match(workflow, /workflow_dispatch/);
});

test("publish workflow verifies npm before creating tag and release", () => {
  const workflow = readFileSync(
    ".github/workflows/npm-publish.yml",
    "utf8",
  );
  const verify = workflow.indexOf("Verify package is available from npm");
  const tag = workflow.indexOf("Create and push release tag");
  const release = workflow.indexOf("Create or update GitHub Release");
  assert.ok(verify > 0 && tag > verify && release > tag);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /git tag -a "\$tag"/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /for attempt in 1 2 3 4 5 6/);
  assert.match(workflow, /prerelease_args\+=\(--prerelease\)/);
  assert.doesNotMatch(workflow, /Sync default npm dist tag/);
});

test("economic evaluation is paired, fixed-baseline, and explicitly opt-in", () => {
  const script = readFileSync("scripts/economic-evaluation.mjs", "utf8");
  assert.match(script, /TOKENOMY_ECON_EVAL !== "1"/);
  assert.match(script, /paired fresh-workspace, counterbalanced-order, repeated/);
  assert.match(script, /TOKENOMY_ECON_BASELINE_MODEL/);
  assert.match(script, /TOKENOMY_ECON_REPEATS/);
  assert.match(script, /TOKENOMY_ECON_MANIFEST/);
  assert.match(script, /qualityGatePassed/);
});

test("CI tests the packed package on Linux, macOS, and Windows", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const packageSmoke = readFileSync("scripts/package-smoke.mjs", "utf8");
  assert.match(workflow, /ubuntu-latest, macos-latest, windows-latest/);
  assert.match(workflow, /npm run test:package/);
  assert.match(packageSmoke, /process\.platform === "win32" \? "npm\.cmd" : "npm"/);
});

function modelLabel(model) {
  return `${model.provider}/${model.id}`;
}

function createProjectConfig(overrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "tokenomy-test-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const config = {
    enabled: true,
    provider: "openai-codex",
    models: {
      classifier: ["gpt-5.4-mini"],
      simple: ["gpt-5.4-mini"],
      medium: ["gpt-5.4", "gpt-5.4-mini"],
      complex: ["gpt-5.5", "gpt-5.4"],
    },
    classifier: {
      enabled: true,
      onlyWhenAmbiguous: true,
      maxPromptChars: 4000,
      maxEstimatedClassifierTokens: 1400,
      minConfidence: 0.95,
    },
    ui: {
      status: true,
      notifyDecisions: true,
    },
    ...overrides,
  };
  writeFileSync(
    join(cwd, ".pi/tokenomy.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
  return cwd;
}

function createHarness(cwd, options = {}) {
  const handlers = new Map();
  const commands = new Map();
  const flags = new Map();
  const selectedModels = [];
  const thinkingLevels = [];
  const notifications = [];
  const statuses = new Map();
  const compactions = [];
  const confirmations = [];
  const models = options.models ?? MODELS;
  let currentThinking = options.initialThinking ?? "high";

  const ctx = {
    cwd,
    model: options.initialModel,
    thinkingLevel: currentThinking,
    signal: new AbortController().signal,
    hasUI: true,
    getContextUsage: () =>
      options.contextUsage ?? {
        tokens: options.contextTokens ?? 12_000,
        contextWindow: 200_000,
        percent: ((options.contextTokens ?? 12_000) / 200_000) * 100,
      },
    isIdle: () => options.isIdle ?? true,
    compact(compactOptions) {
      compactions.push(compactOptions);
      compactOptions?.onComplete?.({});
    },
    modelRegistry: {
      find(provider, id) {
        return models.find(
          (model) => model.provider === provider && model.id === id,
        );
      },
      getAvailable() {
        return models;
      },
      async getApiKeyAndHeaders() {
        return options.classifierAuth ?? { ok: false };
      },
    },
    ui: {
      setStatus(key, value) {
        statuses.set(key, value);
      },
      notify(message, type) {
        notifications.push({ message, type });
      },
      async confirm(title, message) {
        confirmations.push({ title, message });
        return options.confirmBudget ?? true;
      },
    },
  };

  let activeTools = [];
  const pi = {
    registerFlag(name, options) {
      flags.set(name, options.default);
    },
    getFlag(name) {
      return flags.get(name);
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    async setModel(model) {
      ctx.model = model;
      selectedModels.push(modelLabel(model));
      return true;
    },
    setThinkingLevel(level) {
      currentThinking = level;
      ctx.thinkingLevel = level;
      thinkingLevels.push(level);
    },
    getThinkingLevel() {
      return currentThinking;
    },
    getAllTools() {
      return [
        "read",
        "grep",
        "find",
        "ls",
        "edit",
        "write",
        "bash",
      ].map((name) => ({ name }));
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(next) {
      activeTools = next;
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };

  tokenomy(pi);

  return {
    ctx,
    commands,
    handlers,
    notifications,
    selectedModels,
    statuses,
    thinkingLevels,
    compactions,
    confirmations,
  };
}

async function startSession(harness) {
  await harness.handlers.get("session_start")({}, harness.ctx);
}

async function routePrompt(harness, prompt) {
  return harness.handlers.get("before_agent_start")(
    {
      prompt,
      systemPrompt: "Base system prompt.",
    },
    harness.ctx,
  );
}

async function finishAgent(harness, event = {}) {
  await harness.handlers.get("agent_end")?.(event, harness.ctx);
  return harness.handlers.get("agent_settled")?.(
    { type: "agent_settled" },
    harness.ctx,
  );
}

function assistantMessage(model, usage = {}) {
  return {
    role: "assistant",
    model,
    content: [{ type: "text", text: "done" }],
    stopReason: "stop",
    usage: {
      input: 1_000,
      output: 200,
      cacheRead: 3_000,
      cacheWrite: 0,
      reasoning: 50,
      totalTokens: 4_200,
      cost: {
        input: 0.01,
        output: 0.02,
        cacheRead: 0.003,
        cacheWrite: 0,
        total: 0.033,
      },
      ...usage,
    },
  };
}

function inputPrompt(harness, text) {
  return harness.handlers.get("input")(
    {
      text,
      source: "user",
    },
    harness.ctx,
  );
}

async function runTokenomyCommand(harness, args) {
  return harness.commands.get("tokenomy").handler(args, harness.ctx);
}

function readDebugEntries(cwd) {
  const dir = join(cwd, ".pi/tokenomy-cache/debug");
  const file = readdirSync(dir).find((name) => name.endsWith(".jsonl"));
  assert.ok(file, "expected a debug trace JSONL file");
  const raw = readFileSync(join(dir, file), "utf8").trim();
  return raw.split("\n").map((line) => JSON.parse(line));
}

test("starts on the configured complex baseline model", async () => {
  const harness = createHarness(createProjectConfig());

  await startSession(harness);

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.statuses.has("tokenomy"), false);
});

test("does not override a user-selected model at session start", async () => {
  const harness = createHarness(createProjectConfig(), {
    initialModel: MODELS[0],
  });

  await startSession(harness);

  assert.equal(harness.ctx.model.id, "gpt-5.4");
  assert.equal(harness.selectedModels.length, 0);
  await runTokenomyCommand(harness, "status");
  assert.match(
    harness.notifications.at(-1).message,
    /Baseline model: openai-codex\/gpt-5\.4/,
  );
});

test("registers the current Pi lifecycle events", () => {
  const harness = createHarness(createProjectConfig());

  assert.equal(harness.handlers.has("agent_end"), true);
  assert.equal(harness.handlers.has("agent_settled"), true);
  assert.equal(harness.handlers.has("after_agent_end"), false);
  assert.equal(harness.handlers.has("after_agent_finish"), false);
  assert.equal(harness.handlers.has("after_agent_complete"), false);
});

test("switches down for simple prompts and back up for complex prompts", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    [
      "Please respond with a concise overview of Tokenomy routing behavior for",
      "a teammate who wants a quick orientation. Keep it practical and avoid",
      "deep implementation details. Mention that it chooses model tiers based",
      "on prompt complexity and confidence without inspecting files or editing",
      "anything. Use plain language and keep the answer short.",
    ].join(" "),
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via local -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );

  await routePrompt(
    harness,
    "Refactor the architecture to improve security and performance, implement tests, debug any failing behavior, and patch the extension.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.thinkingLevels.at(-1), "medium");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via local -> openai-codex\/gpt-5\.5, thinking:medium/,
  );
});

test("restores the pre-route model and thinking after the agent settles", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, "What time is it?");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  await harness.handlers.get("agent_end")(
    {
      type: "agent_end",
      messages: [assistantMessage("gpt-5.4-mini")],
    },
    harness.ctx,
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  await harness.handlers.get("agent_settled")(
    { type: "agent_settled" },
    harness.ctx,
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.thinkingLevels.at(-1), "high");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy restored model -> openai-codex\/gpt-5\.5, thinking -> high/,
  );

  await harness.handlers.get("agent_settled")(
    { type: "agent_settled" },
    harness.ctx,
  );
  assert.equal(
    harness.selectedModels.filter((model) => model === "openai-codex/gpt-5.5")
      .length,
    2,
  );
});

test("does not restore the model when disabled or when the selected model changed", async () => {
  const disabledHarness = createHarness(
    createProjectConfig({ routing: { restoreModelAfterPrompt: false } }),
  );
  await startSession(disabledHarness);
  await routePrompt(disabledHarness, "What time is it?");
  await finishAgent(disabledHarness);
  assert.equal(disabledHarness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");

  const changedHarness = createHarness(createProjectConfig());
  await startSession(changedHarness);
  await routePrompt(changedHarness, "What time is it?");
  changedHarness.ctx.model = { provider: "openai-codex", id: "gpt-5.4" };
  await finishAgent(changedHarness);

  assert.equal(changedHarness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
});

test("routes multi-action prompts to complex and records prompt shape", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    "Please inspect the repo, fix failing tests, and update the docs.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via local -> openai-codex\/gpt-5\.5, thinking:medium/,
  );

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].promptShape.kind, "action");
  assert.equal(history.entries[0].promptShape.multiStep, true);
  assert.ok(history.entries[0].promptShape.actionCount >= 3);

  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.promptShapes.action, 1);
  assert.equal(rollups.lifetime.multiStepPrompts, 1);

  await runTokenomyCommand(harness, "explain");
  assert.match(harness.notifications.at(-1).message, /Prompt shape: action/);
});

test("uses the cheapest fallback model when confidence is below threshold", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, "Help with the project.");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via fallback -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );

  const stats = JSON.parse(
    readFileSync(join(harness.ctx.cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.routedPrompts, 1);
  assert.equal(stats.sessionsStarted, 1);
});

test("records prompt-safe routing history", async () => {
  const prompt = "Help with the project and do not store this exact prompt.";
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, prompt);
  await finishAgent(harness, {
    type: "agent_end",
    messages: [
      assistantMessage("gpt-5.4-mini", {
        input: 900,
        cacheRead: 3_600,
        output: 180,
        reasoning: 40,
        totalTokens: 4_680,
      }),
    ],
  });

  const historyPath = join(
    harness.ctx.cwd,
    ".pi/tokenomy-cache/routing-history.json",
  );
  const historyText = readFileSync(historyPath, "utf8");
  const history = JSON.parse(historyText);
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].tier, "simple");
  assert.equal(history.entries[0].source, "fallback");
  assert.match(history.entries[0].intent, /^(answer|read)$/);
  assert.equal(history.entries[0].promptChars, prompt.length);
  assert.equal(typeof history.entries[0].promptHash, "string");
  assert.equal(history.entries[0].promptHash.length, 24);
  assert.equal(history.entries[0].promptCompressionEnabled, true);
  assert.doesNotMatch(historyText, /do not store this exact prompt/);

  await runTokenomyCommand(harness, "history");
  assert.match(harness.notifications.at(-1).message, /Tokenomy routing history/);
  assert.match(harness.notifications.at(-1).message, /simple\/fallback/);

  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  assert.equal(rollups.lifetime.prompts, 1);
  assert.equal(rollups.daily[today].prompts, 1);
  assert.equal(rollups.monthly[month].prompts, 1);
  assert.equal(rollups.version, 3);
  assert.equal(rollups.lifetime.turnsMeasured, 1);
  assert.equal(rollups.lifetime.turnsUsageUnavailable, 0);
  assert.equal(rollups.lifetime.inputTokens, 900);
  assert.equal(rollups.lifetime.cacheReadTokens, 3600);
  assert.equal(rollups.lifetime.outputTokens, 180);
  assert.equal(rollups.lifetime.reasoningTokens, 40);
  assert.equal(rollups.lifetime.totalTokens, 4680);
  assert.equal(rollups.lifetime.estimatedPlanCredits, 0.043965);
  assert.equal(rollups.lifetime.estimatedTokensSaved, 0);
  assert.equal(rollups.lifetime.tiers.simple, 1);
  assert.equal(rollups.lifetime.sources.fallback, 1);
  assert.equal(rollups.lifetime.promptShapes.action, 1);
  assert.equal(rollups.lifetime.actionCounts["0"], 1);
  assert.equal(rollups.lifetime.models["openai-codex/gpt-5.4-mini"], 1);

  await runTokenomyCommand(harness, "report 30d");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy telemetry report \(last 30 days\)/,
  );
  assert.match(harness.notifications.at(-1).message, /Prompts routed: 1/);
  assert.match(
    harness.notifications.at(-1).message,
    /Usage coverage: 1 measured, 0 unavailable/,
  );
  assert.match(harness.notifications.at(-1).message, /Input cache-read ratio: 80\.0%/);
  assert.match(harness.notifications.at(-1).message, /Estimated plan credits:/);
  assert.match(harness.notifications.at(-1).message, /Tiers: simple:1/);
  assert.match(harness.notifications.at(-1).message, /Prompt shapes: action:1/);

  await runTokenomyCommand(harness, "export-history");
  assert.match(
    harness.notifications.at(-1).message,
    /routing-history\.json/,
  );

  await runTokenomyCommand(harness, "reset-history");
  assert.equal(
    harness.notifications.at(-1).message,
    "Tokenomy routing history reset",
  );
  const resetHistory = JSON.parse(readFileSync(historyPath, "utf8"));
  assert.equal(resetHistory.entries.length, 0);
});

test("marks a settled turn unavailable when Pi provides no usage", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  await routePrompt(harness, "What time is it?");
  await finishAgent(harness, { type: "agent_end", messages: [] });

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].usageStatus, "unavailable");
  assert.equal(rollups.lifetime.turnsMeasured, 0);
  assert.equal(rollups.lifetime.turnsUsageUnavailable, 1);
});

test("routes supported Ukrainian prompts locally", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  const startupModelCount = harness.selectedModels.length;
  const startupStatus = harness.statuses.get("tokenomy");

  inputPrompt(harness, "будь ласка зроби аудит проекту");
  const result = await routePrompt(harness, "будь ласка зроби аудит проекту");

  assert.ok(result?.systemPrompt.includes("Tokenomy token discipline"));
  assert.ok(harness.selectedModels.length >= startupModelCount);
  assert.ok(harness.thinkingLevels.length > 0);
  assert.match(harness.notifications.at(-1).message, /Tokenomy:/);
  assert.equal(harness.statuses.get("tokenomy"), startupStatus);
  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].language, "uk");
});

test("still bypasses unsupported scripts transparently", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  const startupModelCount = harness.selectedModels.length;
  const result = await routePrompt(harness, "このプロジェクトを監査してください");
  assert.equal(result, undefined);
  assert.equal(harness.selectedModels.length, startupModelCount);
  assert.equal(
    existsSync(join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json")),
    false,
  );
});

test("routes English instructions that contain non-English payload text", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    "Please translate this text and keep the meaning: будь ласка зроби аудит проекту",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.match(harness.notifications.at(-1).message, /Tokenomy:/);
});

test("learns package commands and injects relevant memory when opted in", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: true,
      inject: true,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 30,
      minContextTokensForInjection: 20_000,
    },
  });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: "tokenomy-memory-fixture",
        type: "module",
        scripts: {
          test: "node --test",
          "json:check": "node -e 'JSON.parse(\"{}\")'",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  const result = await routePrompt(
    harness,
    "Run tests for this project. SECRET_MEMORY_TEST_MARKER must not be stored.",
  );

  assert.match(result.systemPrompt, /Tokenomy project memory is advisory/);
  assert.match(result.systemPrompt, /Test command is npm test/);
  assert.match(result.systemPrompt, /Package name is tokenomy-memory-fixture/);
  assert.match(
    result.systemPrompt,
    /The current user prompt overrides it/,
  );

  const memoryText = readFileSync(
    join(cwd, ".pi/tokenomy-cache/project-memory.json"),
    "utf8",
  );
  assert.match(memoryText, /Test command is npm test/);
  assert.doesNotMatch(memoryText, /SECRET_MEMORY_TEST_MARKER/);

  const stats = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.memoryInjections, 1);

  const history = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-cache/routing-history.json"), "utf8"),
  );
  assert.equal(history.entries[0].memoryInjected, true);
  assert.equal(history.entries[0].memoryReason, "project-context");
  assert.ok(history.entries[0].memoryFactsUsed >= 2);
  assert.ok(history.entries[0].memoryEstimatedTokensSaved > 0);

  await runTokenomyCommand(harness, "history");
  assert.match(harness.notifications.at(-1).message, /memory:project-context/);

  await runTokenomyCommand(harness, "memory show");
  assert.match(harness.notifications.at(-1).message, /Test command is npm test/);

  await runTokenomyCommand(harness, "memory clear");
  assert.equal(harness.notifications.at(-1).message, "Tokenomy project memory cleared");
  const clearedMemory = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-cache/project-memory.json"), "utf8"),
  );
  assert.equal(clearedMemory.facts.length, 0);
});

test("injects release workflow memory for vague release prompts", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: true,
      inject: true,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 30,
      minContextTokensForInjection: 20_000,
    },
  });
  mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
  writeFileSync(
    join(cwd, ".github/workflows/npm-publish.yml"),
    "name: NPM Publish\n",
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  const result = await routePrompt(harness, "release it");

  assert.match(result.systemPrompt, /Tokenomy project memory is advisory/);
  assert.match(
    result.systemPrompt,
    /Merging to main can trigger the npm publish GitHub Actions workflow/,
  );

  const history = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-cache/routing-history.json"), "utf8"),
  );
  assert.equal(history.entries[0].memoryInjected, true);
  assert.equal(history.entries[0].memoryReason, "release-workflow");
});

test("does not inject memory for simple shell prompts", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: true,
      inject: true,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 30,
      minContextTokensForInjection: 0,
    },
  });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "tokenomy-memory-fixture", scripts: { test: "node --test" } })}\n`,
    "utf8",
  );
  const harness = createHarness(cwd, { contextTokens: 90_000 });
  await startSession(harness);

  const result = await routePrompt(harness, "ls -l");

  assert.doesNotMatch(result.systemPrompt, /Tokenomy project memory is advisory/);
  const history = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-cache/routing-history.json"), "utf8"),
  );
  assert.equal(history.entries[0].memoryInjected, false);
});

test("can disable memory learning and injection", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: false,
      inject: true,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 30,
      minContextTokensForInjection: 0,
    },
  });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "disabled-memory", scripts: { test: "node --test" } })}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  const result = await routePrompt(harness, "Run tests for this project.");

  assert.doesNotMatch(result.systemPrompt, /Tokenomy project memory is advisory/);
  assert.equal(
    existsSync(join(cwd, ".pi/tokenomy-cache/project-memory.json")),
    false,
  );
});

test("can learn memory while injection is disabled", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: true,
      inject: false,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 30,
      minContextTokensForInjection: 0,
    },
  });
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ name: "learn-only-memory", scripts: { test: "node --test" } })}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  const result = await routePrompt(harness, "Run tests for this project.");

  assert.doesNotMatch(result.systemPrompt, /Tokenomy project memory is advisory/);
  const memoryText = readFileSync(
    join(cwd, ".pi/tokenomy-cache/project-memory.json"),
    "utf8",
  );
  assert.match(memoryText, /learn-only-memory/);
});

test("skips stale memory facts during injection", async () => {
  const cwd = createProjectConfig({
    memory: {
      enabled: true,
      inject: true,
      maxFacts: 80,
      maxInjectedChars: 1200,
      maxFactChars: 240,
      staleAfterDays: 1,
      minContextTokensForInjection: 0,
    },
  });
  const oldDate = "2020-01-01T00:00:00.000Z";
  mkdirSync(join(cwd, ".pi/tokenomy-cache"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi/tokenomy-cache/project-memory.json"),
    `${JSON.stringify(
      {
        version: 1,
        project: "stale-memory",
        updatedAt: oldDate,
        facts: [
          {
            id: "stale-fact",
            text: "Test command is npm test.",
            kind: "command",
            source: "package",
            confidence: "high",
            createdAt: oldDate,
            updatedAt: oldDate,
            uses: 0,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  const result = await routePrompt(harness, "Run tests for this project.");

  assert.doesNotMatch(result.systemPrompt, /Tokenomy project memory is advisory/);
  await runTokenomyCommand(harness, "memory status");
  assert.match(harness.notifications.at(-1).message, /stale:1/);
});

test("keeps simple shell listing prompts on the cheap model in large contexts", async () => {
  const harness = createHarness(createProjectConfig(), {
    contextTokens: 90_000,
  });
  await startSession(harness);

  await routePrompt(harness, "ls -l");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via fallback -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );
});

test("keeps trivial answer prompts on the cheap model in large contexts", async () => {
  const harness = createHarness(createProjectConfig(), {
    contextTokens: 90_000,
  });
  await startSession(harness);

  for (const prompt of ["how time is it?", "what time is it?", "thanks"]) {
    await routePrompt(harness, prompt);

    assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
    assert.equal(harness.thinkingLevels.at(-1), "minimal");
    assert.match(
      harness.notifications.at(-1).message,
      /Tokenomy: simple via local -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
    );
  }
});

test("keeps single-command local info questions on the cheap model", async () => {
  const harness = createHarness(createProjectConfig(), {
    contextTokens: 90_000,
  });
  await startSession(harness);

  for (const prompt of [
    "what is my current directory?",
    "what node version is installed?",
    "check disk usage",
  ]) {
    await routePrompt(harness, prompt);

    assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
    assert.equal(harness.thinkingLevels.at(-1), "minimal");
    assert.match(
      harness.notifications.at(-1).message,
      /Tokenomy: simple via local -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
    );
  }
});

test("does not apply trivial answer routing to project questions", async () => {
  const harness = createHarness(createProjectConfig(), {
    contextTokens: 90_000,
  });
  await startSession(harness);

  await routePrompt(harness, "what time did tests fail in the log?");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4");
  assert.equal(harness.thinkingLevels.at(-1), "low");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: medium via fallback -> openai-codex\/gpt-5\.4, thinking:low/,
  );
});

test("routes short config audit prompts to medium instead of mini", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    "Please do a final scan nvim and tmux config to ensure it is optimal, dead-code-free and up-to-date",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4");
  assert.equal(harness.thinkingLevels.at(-1), "low");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: medium via local -> openai-codex\/gpt-5\.4, thinking:low/,
  );
});

test("routes short quality audit prompts to medium", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    "Audit dotfiles for unused config and stale settings.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4");
  assert.equal(harness.thinkingLevels.at(-1), "low");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: medium via local -> openai-codex\/gpt-5\.4, thinking:low/,
  );
});

test("routes broad review prompts to the complex model", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  for (const prompt of [
    "please do an audit",
    "please review",
    "please refactor",
    "review the codebase",
  ]) {
    await routePrompt(harness, prompt);

    assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
    assert.equal(harness.thinkingLevels.at(-1), "medium");
    assert.match(
      harness.notifications.at(-1).message,
      /Tokenomy: complex via local -> openai-codex\/gpt-5\.5, thinking:medium/,
    );
  }
});

test("routes state-changing local workflows to medium locally", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, "commit & push");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4");
  assert.equal(harness.thinkingLevels.at(-1), "low");
  assert.equal(harness.statuses.has("tokenomy"), false);
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: medium via local -> openai-codex\/gpt-5\.4, thinking:low/,
  );
});

test("preserves prior route context for short continuation prompts", async () => {
  const harness = createHarness(createProjectConfig(), {
    contextTokens: 130_000,
  });
  await startSession(harness);

  await routePrompt(harness, "works, please commit/push");
  await routePrompt(harness, "continue");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.thinkingLevels.at(-1), "medium");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via local -> openai-codex\/gpt-5\.5, thinking:medium/,
  );
  await runTokenomyCommand(harness, "explain");
  assert.match(harness.notifications.at(-1).message, /contextual-continuation/);
  assert.match(harness.notifications.at(-1).message, /previous-tier:complex/);
});

test("does not write a Tokenomy footer or disturb other plugin status entries", async () => {
  const harness = createHarness(createProjectConfig());
  harness.statuses.set(
    "headroom",
    "Headroom medium:fallback/94% saved:1300 lifetime:22350",
  );
  await startSession(harness);

  await routePrompt(harness, "commit & push");

  assert.equal(
    harness.statuses.get("headroom"),
    "Headroom medium:fallback/94% saved:1300 lifetime:22350",
  );
  assert.equal(harness.statuses.has("tokenomy"), false);
});

test("keeps read-only git inspection prompts cheap", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, "git status");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via fallback -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );
});

test("routes medium coding work to the configured medium model", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(
    harness,
    "Add a focused unit test for this helper and update the implementation if needed.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4");
  assert.equal(harness.thinkingLevels.at(-1), "low");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: medium via fallback -> openai-codex\/gpt-5\.4, thinking:low/,
  );
});

test("uses adaptive complex fallback for risky low-confidence classifier results", async () => {
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"simple","confidence":0.51,"reason":"unsure"}';
  const harness = createHarness(createProjectConfig(), {
    classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
  });
  await startSession(harness);

  await routePrompt(
    harness,
    "Please handle the production release carefully.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.thinkingLevels.at(-1), "medium");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via fallback -> openai-codex\/gpt-5\.5, thinking:medium/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("reuses cached classifier decisions", async () => {
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"complex","confidence":0.97,"reason":"risky design"}';
  const harness = createHarness(createProjectConfig(), {
    classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
  });
  await startSession(harness);
  const prompt =
    "Please analyze this project context and decide the best routing approach for future provider support. Keep the answer practical and account for confidence, prompt size, and model availability.";

  await routePrompt(harness, prompt);
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"simple","confidence":0.99,"reason":"changed"}';
  await routePrompt(harness, prompt);

  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via classifier-cache -> openai-codex\/gpt-5\.5, thinking:medium/,
  );

  const stats = JSON.parse(
    readFileSync(join(harness.ctx.cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.classifierCacheHits, 1);

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("ignores corrupted classifier cache and still routes", async () => {
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"complex","confidence":0.97,"reason":"risky design"}';
  const cwd = createProjectConfig();
  mkdirSync(join(cwd, ".pi/tokenomy-cache"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi/tokenomy-cache/classifier-cache.json"),
    "{bad json",
    "utf8",
  );
  const harness = createHarness(cwd, {
    classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
  });
  await startSession(harness);

  await routePrompt(
    harness,
    "Please analyze this project context and decide the best routing approach for future provider support. Keep the answer practical and account for confidence, prompt size, and model availability.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via classifier -> openai-codex\/gpt-5\.5, thinking:medium/,
  );
  await finishAgent(harness, {
    type: "agent_end",
    messages: [assistantMessage("gpt-5.5")],
  });
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.classifierInputTokens, 320);
  assert.equal(rollups.lifetime.classifierOutputTokens, 24);
  assert.equal(rollups.lifetime.classifierTotalTokens, 344);
  assert.equal(rollups.lifetime.classifierEstimatedPlanCredits, 0.008712);

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("injects a compact project digest for large contexts", async () => {
  const cwd = createProjectConfig({
    distillation: {
      enabled: true,
      minContextTokens: 80_000,
      repeatPromptThreshold: 3,
      maxDigestChars: 1200,
    },
  });
  mkdirSync(join(cwd, ".pi/tokenomy-cache"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi/tokenomy-cache/project-digest.json"),
    JSON.stringify(
      {
        project: "tokenomy-test",
        updatedAt: new Date().toISOString(),
        promptsSeen: 3,
        intentCounts: { read: 3 },
        lastIntent: "read",
        lastTier: "simple",
        lastModel: "openai-codex/gpt-5.4-mini",
        lastSignals: ["intent:read", "risk:low"],
      },
      null,
      2,
    ),
    "utf8",
  );
  const harness = createHarness(cwd, { contextTokens: 90_000 });
  await startSession(harness);

  const result = await routePrompt(harness, "Summarize this project structure.");

  assert.match(result.systemPrompt, /Tokenomy compact project digest is active/);
  assert.match(result.systemPrompt, /Intent counts: read:3/);

  const stats = JSON.parse(
    readFileSync(join(harness.ctx.cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.projectDigestUses, 1);
});

test("creates the project .pi directory before saving stats", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "tokenomy-no-pi-"));
  const harness = createHarness(cwd);

  await startSession(harness);
  await routePrompt(harness, "Help with the project.");

  const statsFile = join(cwd, ".pi/tokenomy-stats.json");
  assert.equal(existsSync(statsFile), true);

  const stats = JSON.parse(readFileSync(statsFile, "utf8"));
  assert.equal(stats.routedPrompts, 1);
  assert.equal(stats.sessionsStarted, 1);
  assert.equal(
    harness.notifications.some(({ message }) =>
      message.includes("stats warning"),
    ),
    false,
  );
});

test("accepts a high-confidence classifier decision", async () => {
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"complex","confidence":0.97,"reason":"risky design"}';
  const harness = createHarness(createProjectConfig(), {
    classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
  });
  await startSession(harness);

  await routePrompt(
    harness,
    "Please analyze this project context and decide the best routing approach for future provider support. Keep the answer practical and account for confidence, prompt size, and model availability.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.thinkingLevels.at(-1), "medium");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: complex via classifier -> openai-codex\/gpt-5\.5, thinking:medium/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("simplifies large prompts before classifier calls", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"medium","confidence":1,"reason":"test failure"}';
  const longLog = [
    "Please inspect this failing test output and choose the best routing tier.",
    ...Array.from(
      { length: 180 },
      (_, index) =>
        `noise line ${index} in order to inspect the application implementation documentation due to the fact that configuration may change`,
    ),
    "FAIL tests/tokenomy.integration.test.mjs:42 expected cheap route",
    "Error: expected openai-codex/gpt-5.4-mini but received gpt-5.4",
    "at tests/tokenomy.integration.test.mjs:42:10",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(harness, longLog);

  assert.equal(completeCalls.length, 1);
  const request = completeCalls[0][1];
  const classifierPrompt = request.messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: yes\/\d+ tokens/);
  assert.match(classifierPrompt, /\[DECODE\]/);
  assert.match(classifierPrompt, /P1=/);
  assert.match(
    classifierPrompt,
    /FAIL tests\/tokenomy\.integration\.test\.mjs:42/,
  );
  assert.ok(classifierPrompt.length < longLog.length);

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("preserves routing-critical prompt meaning through simplification and compression", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"complex","confidence":1,"reason":"critical regression"}';
  const longPrompt = [
    "Fix the payment retry regression without changing the public checkout API.",
    "Keep backwards compatibility for src/payments/retry.ts and add regression coverage.",
    ...Array.from(
      { length: 210 },
      (_, index) =>
        `noise line ${index} in order to inspect the application implementation documentation due to the fact that configuration may change`,
    ),
    "FAIL tests/payments/retry.integration.test.ts:88 retry preserves idempotency key",
    "Error: expected checkout request to reuse idempotency key payment_retry_123",
    "Actual: request created duplicate charge for customer cus_tokenomy_test",
    "Do not delete existing retry backoff behavior.",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(harness, longPrompt);

  const request = completeCalls[0][1];
  const classifierPrompt = request.messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: yes\/\d+ tokens/);
  assert.match(classifierPrompt, /payment retry regression/);
  assert.match(classifierPrompt, /without changing the public checkout API/);
  assert.match(classifierPrompt, /src\/payments\/retry\.ts/);
  assert.match(
    classifierPrompt,
    /FAIL tests\/payments\/retry\.integration\.test\.ts:88/,
  );
  assert.match(classifierPrompt, /idempotency key payment_retry_123/);
  assert.match(classifierPrompt, /duplicate charge/);
  assert.match(classifierPrompt, /Do not delete existing retry backoff behavior/);

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("does not rewrite the agent-facing prompt when simplifying classifier input", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"medium","confidence":1,"reason":"large prompt"}';
  const protectedInstruction =
    "FINAL_AGENT_PROMPT_MUST_REMAIN_EXACT: preserve this literal instruction for the selected model.";
  const longPrompt = [
    protectedInstruction,
    ...Array.from(
      { length: 190 },
      (_, index) =>
        `noise line ${index} in order to inspect the application implementation documentation due to the fact that configuration may change`,
    ),
    "FAIL tests/tokenomy.integration.test.mjs:314 preserve original prompt",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  const result = await routePrompt(harness, longPrompt);

  assert.equal(completeCalls.length, 1);
  const classifierPrompt = completeCalls[0][1].messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: yes\/\d+ tokens/);
  assert.equal("prompt" in result, false);
  assert.doesNotMatch(result.systemPrompt, /FINAL_AGENT_PROMPT_MUST_REMAIN_EXACT/);
  assert.match(
    result.systemPrompt,
    /Tokenomy token discipline is active/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("rejects compression when protected signal lines would be rewritten", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"medium","confidence":1,"reason":"protected constraint"}';
  const protectedConstraint =
    "Do not change checkout retries due to the fact that merchants depend on exact behavior.";
  const longPrompt = [
    "Inspect this failing payment output and choose the best routing tier.",
    ...Array.from(
      { length: 190 },
      (_, index) =>
        `noise line ${index} in order to inspect the application implementation documentation due to the fact that configuration may change`,
    ),
    protectedConstraint,
    "FAIL tests/payments/retry.integration.test.ts:91 protected retry behavior",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(harness, longPrompt);

  const classifierPrompt = completeCalls[0][1].messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: no/);
  assert.doesNotMatch(classifierPrompt, /\[DECODE\]/);
  assert.match(classifierPrompt, new RegExp(protectedConstraint));

  const stats = JSON.parse(
    readFileSync(join(harness.ctx.cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.compressionGuardRejections, 1);

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].classifierPromptCompressed, false);
  assert.equal(history.entries[0].classifierPromptCompressionGuarded, true);
  assert.equal(
    history.entries[0].classifierPromptCompressionGuardMissingLines,
    1,
  );
  assert.ok(
    history.entries[0].classifierPromptCompressionTokensSaved > 0,
  );

  await runTokenomyCommand(harness, "history");
  assert.match(harness.notifications.at(-1).message, /guard:rejected\/1/);

  await runTokenomyCommand(harness, "status");
  assert.match(
    harness.notifications.at(-1).message,
    /Compression guard rejections lifetime: 1/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("skips classifier prompt compression when savings are too small", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"medium","confidence":1,"reason":"test failure"}';
  const longLog = [
    "Analyze this output and choose the best routing tier.",
    ...Array.from({ length: 220 }, (_, index) => `x${index} y${index} z${index}`),
    "FAIL tests/tokenomy.integration.test.mjs:42 expected cheap route",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
      promptSimplification: {
        enabled: true,
        compressionEnabled: true,
        minCompressionSavingsTokens: 1000,
        maxClassifierPromptChars: 1600,
        maxLineChars: 240,
        headLines: 16,
        tailLines: 16,
        preserveSignalLines: 40,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(harness, longLog);

  const request = completeCalls[0][1];
  const classifierPrompt = request.messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: no/);

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("disables classifier prompt compression when configured off", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"medium","confidence":1,"reason":"test failure"}';
  const longLog = [
    "Please inspect this failing test output in order to choose the best routing tier.",
    ...Array.from(
      { length: 180 },
      (_, index) =>
        `noise line ${index} in order to inspect the application implementation documentation due to the fact that configuration may change`,
    ),
    "FAIL tests/tokenomy.integration.test.mjs:42 expected cheap route",
  ].join("\n");
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: false,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1,
      },
      promptSimplification: {
        enabled: true,
        compressionEnabled: false,
        minCompressionSavingsTokens: 12,
        maxClassifierPromptChars: 1600,
        maxLineChars: 240,
        headLines: 16,
        tailLines: 16,
        preserveSignalLines: 40,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(harness, longLog);

  const request = completeCalls[0][1];
  const classifierPrompt = request.messages[0].content[0].text;
  assert.match(classifierPrompt, /Prompt simplified: yes/);
  assert.match(classifierPrompt, /Prompt compressed: no/);
  assert.doesNotMatch(classifierPrompt, /\[DECODE\]/);
  assert.match(
    classifierPrompt,
    /FAIL tests\/tokenomy\.integration\.test\.mjs:42/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("rejects a low-confidence classifier decision and falls back", async () => {
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"tier":"complex","confidence":0.71,"reason":"unsure"}';
  const harness = createHarness(createProjectConfig(), {
    classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
  });
  await startSession(harness);

  await routePrompt(
    harness,
    "Please analyze this project context and decide the best routing approach for future provider support. Keep the answer practical and account for confidence, prompt size, and model availability.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via fallback -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("falls back when the selected tier model is unavailable", async () => {
  const harness = createHarness(createProjectConfig(), {
    models: [{ provider: "openai-codex", id: "gpt-5.4-mini" }],
  });
  await startSession(harness);

  await routePrompt(
    harness,
    "Refactor the architecture to improve security and performance, implement tests, debug failures, and patch the extension.",
  );

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(harness.thinkingLevels.at(-1), "minimal");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy: simple via fallback -> openai-codex\/gpt-5\.4-mini, thinking:minimal/,
  );
});

test("warns about invalid config values", async () => {
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: true,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        minConfidence: 1.5,
      },
    }),
  );

  await startSession(harness);

  assert.match(
    harness.notifications.at(-1).message,
    /classifier\.minConfidence must be at most 1/,
  );
});

test("explains the last decision and resets stats", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  await routePrompt(harness, "Help with the project.");

  await runTokenomyCommand(harness, "explain");
  assert.match(harness.notifications.at(-1).message, /Tier: simple/);
  assert.match(harness.notifications.at(-1).message, /Source: fallback/);

  await runTokenomyCommand(harness, "reset-stats");
  assert.equal(harness.notifications.at(-1).message, "Tokenomy stats reset");

  const stats = JSON.parse(
    readFileSync(join(harness.ctx.cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  assert.equal(stats.lifetimeEstimatedTokensSaved, 0);
  assert.equal(stats.routedPrompts, 0);
  assert.equal(stats.sessionsStarted, 0);

  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.prompts, 0);
  assert.deepEqual(rollups.daily, {});
  assert.deepEqual(rollups.monthly, {});
});

test("shows the package version in status output", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await runTokenomyCommand(harness, "status");

  assert.equal(harness.statuses.has("tokenomy"), false);
  assert.match(harness.notifications.at(-1).message, /Tokenomy: enabled/);
  assert.match(
    harness.notifications.at(-1).message,
    new RegExp(`Version: ${PACKAGE_VERSION}`),
  );
});

test("keeps debug trace disabled by default", async () => {
  const cwd = createProjectConfig();
  const harness = createHarness(cwd);
  await startSession(harness);

  await routePrompt(harness, "What time is it?");

  assert.equal(existsSync(join(cwd, ".pi/tokenomy-cache/debug")), false);
  await runTokenomyCommand(harness, "status");
  assert.match(harness.notifications.at(-1).message, /Debug trace: disabled/);
});

test("writes opt-in debug trace entries with raw session data", async () => {
  const cwd = createProjectConfig({
    debug: {
      trace: true,
      redact: false,
    },
  });
  const harness = createHarness(cwd);
  await startSession(harness);

  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy debug trace is ENABLED/,
  );

  await routePrompt(
    harness,
    "Please explain Tokenomy debug trace marker raw-prompt-123 in one sentence.",
  );
  await finishAgent(harness, {
    type: "agent_end",
    messages: [
      {
        ...assistantMessage("gpt-5.4-mini"),
        content: [{ type: "text", text: "raw output marker 456" }],
      },
    ],
  });

  const entries = readDebugEntries(cwd);
  const eventNames = entries.map((entry) => entry.event);
  assert.ok(eventNames.includes("session.start"));
  assert.ok(eventNames.includes("prompt.received"));
  assert.ok(eventNames.includes("analysis.local"));
  assert.ok(eventNames.includes("route.selected"));
  assert.ok(eventNames.includes("system.additions"));
  assert.ok(eventNames.includes("agent.output"));
  assert.ok(entries.every((entry, index) => entry.seq === index + 1));
  assert.ok(entries.every((entry) => typeof entry.summary === "string"));

  const traceText = entries.map((entry) => JSON.stringify(entry)).join("\n");
  assert.match(traceText, /raw-prompt-123/);
  assert.match(traceText, /raw output marker 456/);

  const savedStats = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  const tracedStats = entries.find((entry) => entry.event === "telemetry.saved")
    .data.stats;
  assert.equal(tracedStats.updatedAt, savedStats.updatedAt);
});

test("can enable, inspect, and disable debug trace by command", async () => {
  const cwd = createProjectConfig({
    debug: {
      trace: false,
      redact: false,
    },
  });
  const harness = createHarness(cwd);
  await startSession(harness);

  await runTokenomyCommand(harness, "debug on");

  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy debug trace is ENABLED/,
  );
  let entries = readDebugEntries(cwd);
  const enabled = entries.find((entry) => entry.event === "debug.enabled");
  assert.equal(enabled.data.version, PACKAGE_VERSION);
  assert.equal(enabled.data.cwd, cwd);
  assert.equal(enabled.data.config.enabled, true);

  await routePrompt(harness, "What time is it? raw-command-debug-789");
  entries = readDebugEntries(cwd);
  assert.match(
    entries.map((entry) => JSON.stringify(entry)).join("\n"),
    /raw-command-debug-789/,
  );

  await runTokenomyCommand(harness, "debug path");
  assert.match(harness.notifications.at(-1).message, /debug trace: enabled/i);
  assert.match(harness.notifications.at(-1).message, /session-.*\.jsonl/);

  await runTokenomyCommand(harness, "debug off");
  assert.match(harness.notifications.at(-1).message, /debug trace disabled/i);
  entries = readDebugEntries(cwd);
  assert.equal(entries.at(-1).event, "debug.disabled");
});

test("adds command output condensation guidance to the system prompt", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  const result = await routePrompt(harness, "Help with the project.");

  assert.match(
    result.systemPrompt,
    /When command output is long, locally condense it before reasoning/,
  );
});

test("keeps default system-prompt additions stable across equivalent turns", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  const first = await routePrompt(harness, "What time is it?");
  await finishAgent(harness, {
    type: "agent_end",
    messages: [assistantMessage("gpt-5.4-mini")],
  });
  const second = await routePrompt(harness, "What time is it?");

  assert.equal(second.systemPrompt, first.systemPrompt);
  assert.doesNotMatch(second.systemPrompt, /saved tokens so far/i);
  assert.doesNotMatch(second.systemPrompt, /compact project digest is active/i);
});

test("toggles dry-run from the tokenomy command", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await runTokenomyCommand(harness, "dry-run on");
  assert.equal(harness.notifications.at(-1).message, "Tokenomy dry-run enabled");

  await runTokenomyCommand(harness, "dry-run");
  assert.equal(harness.notifications.at(-1).message, "Tokenomy dry-run: enabled");

  await runTokenomyCommand(harness, "dry-run off");
  assert.equal(harness.notifications.at(-1).message, "Tokenomy dry-run disabled");
});

test("supports save, balanced, and quality economy modes", async () => {
  const quality = createHarness(createProjectConfig({ mode: "quality" }));
  await startSession(quality);
  await routePrompt(quality, "Help with the project.");
  assert.equal(quality.selectedModels.at(-1), "openai-codex/gpt-5.4");

  const save = createHarness(createProjectConfig());
  await startSession(save);
  await runTokenomyCommand(save, "mode save");
  await routePrompt(save, "Help with the project.");
  assert.equal(save.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  assert.equal(save.notifications.at(-2).message, "Tokenomy economy mode: save");
});

test("skips live classification when its session budget is exhausted", async () => {
  const before = completeCalls.length;
  const harness = createHarness(
    createProjectConfig({
      classifier: {
        enabled: true,
        onlyWhenAmbiguous: true,
        maxPromptChars: 4000,
        maxEstimatedClassifierTokens: 1400,
        maxCallsPerSession: 0,
        minEstimatedNetCredits: 0,
        minConfidence: 0.95,
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);

  await routePrompt(
    harness,
    "Please analyze this project context and decide the best routing approach for future provider support. Keep the answer practical and account for confidence, prompt size, and model availability.",
  );

  assert.equal(completeCalls.length, before);
  await runTokenomyCommand(harness, "explain");
  assert.match(
    harness.notifications.at(-1).message,
    /classifier session budget exhausted/,
  );
});

test("uses project-configured plan credit rates", async () => {
  const harness = createHarness(
    createProjectConfig({
      planCredits: {
        enabled: true,
        rateCardVersion: "test-card",
        rates: {
          "gpt-5.4-mini": {
            input: 100,
            cacheRead: 10,
            output: 200,
          },
        },
      },
    }),
  );
  await startSession(harness);
  await routePrompt(harness, "What time is it?");
  await finishAgent(harness, {
    type: "agent_end",
    messages: [
      assistantMessage("gpt-5.4-mini", {
        input: 1_000,
        cacheRead: 2_000,
        output: 500,
        totalTokens: 3_500,
      }),
    ],
  });

  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.estimatedPlanCredits, 0.22);
  await runTokenomyCommand(harness, "report");
  assert.match(harness.notifications.at(-1).message, /rate card test-card/);
});

test("records completion proxy, tool errors, and retry runs", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  await routePrompt(harness, "Inspect the project and explain the result.");
  harness.handlers.get("tool_execution_end")(
    {
      type: "tool_execution_end",
      toolCallId: "one",
      toolName: "read",
      result: {},
      isError: false,
    },
    harness.ctx,
  );
  harness.handlers.get("tool_execution_end")(
    {
      type: "tool_execution_end",
      toolCallId: "two",
      toolName: "read",
      result: {},
      isError: true,
    },
    harness.ctx,
  );
  await harness.handlers.get("agent_end")(
    {
      type: "agent_end",
      messages: [
        { ...assistantMessage("gpt-5.4-mini"), stopReason: "toolUse" },
      ],
    },
    harness.ctx,
  );
  await harness.handlers.get("agent_end")(
    {
      type: "agent_end",
      messages: [assistantMessage("gpt-5.4-mini")],
    },
    harness.ctx,
  );
  await harness.handlers.get("agent_settled")(
    { type: "agent_settled" },
    harness.ctx,
  );

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].outcome, "completed");
  assert.equal(history.entries[0].toolCalls, 2);
  assert.equal(history.entries[0].toolErrors, 1);
  assert.equal(history.entries[0].retryRuns, 1);

  await runTokenomyCommand(harness, "report");
  assert.match(harness.notifications.at(-1).message, /1 completed/);
  assert.match(harness.notifications.at(-1).message, /2 calls, 1 errors/);
  assert.match(
    harness.notifications.at(-1).message,
    /not independently verified task success/,
  );
});

test("stores only recognized provider limit headers and reports their scope", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  harness.handlers.get("after_provider_response")(
    {
      type: "after_provider_response",
      status: 200,
      headers: {
        "x-ratelimit-remaining-requests": "42",
        "x-ratelimit-reset-requests": "30s",
        authorization: "secret",
        "set-cookie": "secret-cookie",
      },
    },
    harness.ctx,
  );

  const snapshotText = readFileSync(
    join(harness.ctx.cwd, ".pi/tokenomy-cache/account-limits.json"),
    "utf8",
  );
  assert.match(snapshotText, /x-ratelimit-remaining-requests/);
  assert.doesNotMatch(snapshotText, /authorization|set-cookie|secret/);

  await runTokenomyCommand(harness, "limits");
  assert.match(
    harness.notifications.at(-1).message,
    /not total ChatGPT\/Codex account usage/,
  );
});

test("auto-compacts high context with cooldown and records compactions", async () => {
  const harness = createHarness(
    createProjectConfig({
      contextEconomy: {
        autoCompact: true,
        compactAtPercent: 85,
        minTokens: 80_000,
        cooldownTurns: 2,
        customInstructions: "Preserve active work.",
      },
    }),
    {
      contextUsage: {
        tokens: 180_000,
        contextWindow: 200_000,
        percent: 90,
      },
    },
  );
  await startSession(harness);
  harness.handlers.get("turn_end")({ type: "turn_end" }, harness.ctx);

  assert.equal(harness.compactions.length, 1);
  assert.equal(
    harness.compactions[0].customInstructions,
    "Preserve active work.",
  );
  harness.handlers.get("session_compact")(
    {
      type: "session_compact",
      compactionEntry: {},
      fromExtension: true,
      reason: "threshold",
      willRetry: false,
    },
    harness.ctx,
  );
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.compactions, 1);
});

test("records explicit quality feedback and detects correction prompts", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  await routePrompt(harness, "Explain what this helper does.");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });

  await runTokenomyCommand(harness, "feedback success");
  inputPrompt(harness, "No, that's wrong. Please redo that.");

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].feedback, "success");
  assert.equal(history.entries[0].correctionDetected, true);
  assert.equal(rollups.lifetime.verifiedSuccessTurns, 1);
  assert.equal(rollups.lifetime.correctionsDetected, 1);
});

test("runs the independent quality evaluator only when opted in", async () => {
  completeCalls.length = 0;
  process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE =
    '{"score":0.92,"reason":"task completed correctly"}';
  const harness = createHarness(
    createProjectConfig({
      quality: {
        evaluatorEnabled: true,
        evaluatorModels: ["gpt-5.4-mini"],
      },
    }),
    {
      classifierAuth: { ok: true, apiKey: "test-key", headers: {}, env: {} },
    },
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });

  const history = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.equal(history.entries[0].evaluatorStatus, "measured");
  assert.equal(history.entries[0].evaluatorScore, 0.92);
  assert.equal(completeCalls.length, 1);
  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("loads a validated external rate card", async () => {
  const cwd = createProjectConfig();
  writeFileSync(
    join(cwd, ".pi/tokenomy-rate-card.json"),
    `${JSON.stringify({
      version: 1,
      effectiveAt: new Date().toISOString(),
      source: "test-fixture",
      rates: {
        "gpt-5.4-mini": { input: 100, cacheRead: 10, output: 200 },
      },
    })}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [
      assistantMessage("gpt-5.4-mini", {
        input: 1_000_000,
        output: 0,
        cacheRead: 0,
        totalTokens: 1_000_000,
      }),
    ],
  });
  const rollups = JSON.parse(
    readFileSync(
      join(cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.estimatedPlanCredits, 100);
  await runTokenomyCommand(harness, "report 7d");
  assert.match(harness.notifications.at(-1).message, /rate card external:/);
});

test("refreshes an external rate card from an explicit HTTPS endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        version: 1,
        effectiveAt: new Date().toISOString(),
        source: "https://rates.example.test/tokenomy.json",
        rates: {
          "gpt-5.4-mini": { input: 9, cacheRead: 1, output: 20 },
        },
      });
    },
  });
  try {
    const cwd = createProjectConfig({
      registry: {
        rateCardPath: ".pi/tokenomy-rate-card.json",
        rateCardUrl: "https://rates.example.test/tokenomy.json",
        refreshHours: 24,
        maxAgeDays: 30,
      },
    });
    const harness = createHarness(cwd);
    await startSession(harness);
    const card = JSON.parse(
      readFileSync(join(cwd, ".pi/tokenomy-rate-card.json"), "utf8"),
    );
    assert.equal(card.rates["gpt-5.4-mini"].input, 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shows account quota only from a validated adapter snapshot", async () => {
  const cwd = createProjectConfig();
  writeFileSync(
    join(cwd, ".pi/tokenomy-account-quota.json"),
    `${JSON.stringify({
      version: 1,
      scope: "account",
      source: "user",
      authoritative: false,
      updatedAt: new Date().toISOString(),
      windows: [
        {
          name: "ChatGPT Plus rolling window",
          used: 40,
          limit: 100,
          remaining: 60,
          unit: "percent",
        },
      ],
    })}\n`,
    "utf8",
  );
  const harness = createHarness(cwd);
  await startSession(harness);
  await runTokenomyCommand(harness, "quota");
  assert.match(harness.notifications.at(-1).message, /user-supplied via user/);
  assert.match(harness.notifications.at(-1).message, /remaining 60 percent/);
});

test("assigns deterministic mode experiments and records shadow tiers", async () => {
  const cwd = createProjectConfig({
    experiments: {
      enabled: true,
      sampleRate: 1,
      modes: ["save", "balanced", "quality"],
    },
  });
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(
    harness,
    "Please inspect this project question carefully and explain the likely issue.",
  );
  const history = JSON.parse(
    readFileSync(
      join(cwd, ".pi/tokenomy-cache/routing-history.json"),
      "utf8",
    ),
  );
  assert.match(history.entries[0].experimentCohort, /^mode:/);
  assert.deepEqual(Object.keys(history.entries[0].shadowTiers).sort(), [
    "balanced",
    "quality",
    "save",
  ]);
});

test("supports configured non-OpenAI providers", async () => {
  const models = [
    { provider: "anthropic", id: "claude-haiku" },
    { provider: "anthropic", id: "claude-sonnet" },
  ];
  const harness = createHarness(
    createProjectConfig({
      provider: "anthropic",
      providers: { allowed: ["anthropic"], autoDiscoverModels: false },
      models: {
        classifier: ["anthropic/claude-haiku"],
        simple: ["anthropic/claude-haiku"],
        medium: ["anthropic/claude-sonnet"],
        complex: ["anthropic/claude-sonnet"],
      },
    }),
    { models },
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  assert.equal(harness.selectedModels.at(-1), "anthropic/claude-haiku");
});

test("measures duplicate and oversized tool results and can truncate opt-in", async () => {
  const harness = createHarness(
    createProjectConfig({
      toolEconomy: {
        measureResults: true,
        truncateOversized: true,
        maxResultTokens: 100,
        preserveHeadChars: 120,
        preserveTailChars: 80,
      },
    }),
  );
  await startSession(harness);
  await routePrompt(harness, "Inspect the project logs.");
  const event = {
    toolName: "bash",
    input: { command: "npm test" },
    content: [{ type: "text", text: "long output ".repeat(500) }],
  };
  const first = harness.handlers.get("tool_result")(event, harness.ctx);
  harness.handlers.get("tool_result")(event, harness.ctx);
  assert.match(first.content[0].text, /oversized tool result truncated/);
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.duplicateToolCalls, 1);
  assert.equal(rollups.lifetime.oversizedToolResults, 2);
  assert.equal(rollups.lifetime.truncatedToolResults, 2);
  assert.ok(rollups.lifetime.toolOutputTokens > 100);
  assert.ok(rollups.lifetime.toolOutputTokensSaved > 100);
});

test("records measured compaction savings", async () => {
  const contextUsage = {
    tokens: 180_000,
    contextWindow: 200_000,
    percent: 90,
  };
  const harness = createHarness(createProjectConfig(), { contextUsage });
  await startSession(harness);
  contextUsage.tokens = 30_000;
  contextUsage.percent = 15;
  harness.handlers.get("session_compact")(
    {
      type: "session_compact",
      compactionEntry: { tokensBefore: 180_000 },
      fromExtension: false,
      reason: "manual",
      willRetry: false,
    },
    harness.ctx,
  );
  const rollups = JSON.parse(
    readFileSync(
      join(harness.ctx.cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
      "utf8",
    ),
  );
  assert.equal(rollups.lifetime.compactionTokensBefore, 180_000);
  assert.equal(rollups.lifetime.compactionTokensAfter, 30_000);
  assert.equal(rollups.lifetime.compactionTokensSaved, 150_000);
});

test("dashboard shows trends, mode comparisons, and budget alerts", async () => {
  const harness = createHarness(
    createProjectConfig({
      budgets: {
        sessionCredits: 0.01,
        dailyCredits: 0.01,
        warnAtPercent: 80,
      },
    }),
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });
  assert.ok(
    harness.notifications.some(({ message }) =>
      message.includes("budget alert"),
    ),
  );
  await runTokenomyCommand(harness, "dashboard");
  const dashboard = harness.notifications.at(-1).message;
  assert.match(dashboard, /7 days:/);
  assert.match(dashboard, /Mode comparison \(30 days\):/);
  assert.match(dashboard, /Account quota: unavailable/);
});

test("ships current GPT-5.6 defaults and a configuration schema", () => {
  const config = JSON.parse(readFileSync(".pi/tokenomy.json", "utf8"));
  const schema = JSON.parse(readFileSync(".pi/tokenomy.schema.json", "utf8"));

  assert.equal(config.models.medium[0], "gpt-5.6-terra");
  assert.equal(config.models.complex[0], "gpt-5.6-sol");
  assert.ok(config.models.simple.includes("gpt-5.6-luna"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.classifier.additionalProperties, false);
  assert.equal(schema.properties.memory.additionalProperties, false);
  assert.equal(
    schema.properties.planCredits.properties.rates.additionalProperties
      .additionalProperties,
    false,
  );
  assert.deepEqual(schema, TOKENOMY_CONFIG_SCHEMA);
  assert.deepEqual(schema.properties.budgets.properties.policy.enum, [
    "warn",
    "save",
    "ask",
  ]);
});

test("rejects schema-invalid enum and range overrides before routing", async () => {
  const harness = createHarness(
    createProjectConfig({
      mode: "turbo",
      budgets: {
        warnAtPercent: 0,
      },
    }),
  );
  await startSession(harness);
  await runTokenomyCommand(harness, "status");

  assert.match(
    harness.notifications.find(({ message }) => message.includes("config warnings"))
      .message,
    /mode must be one of save, balanced, quality/,
  );
  assert.match(harness.notifications.at(-1).message, /Economy mode: balanced/);
});

test("ignores unknown and malformed config values without crashing", async () => {
  const harness = createHarness(
    createProjectConfig({
      models: "not-an-object",
      mysterySetting: true,
    }),
  );

  await startSession(harness);

  const warning = harness.notifications.find(({ message }) =>
    message.includes("config warnings"),
  );
  assert.match(warning.message, /models has invalid type/);
  assert.match(warning.message, /mysterySetting is unknown and was ignored/);
});

test("doctor checks config, configured models, storage, schema, and rate card", async () => {
  const cwd = createProjectConfig();
  writeFileSync(
    join(cwd, ".pi/tokenomy.schema.json"),
    readFileSync(".pi/tokenomy.schema.json", "utf8"),
  );
  const harness = createHarness(cwd);
  await startSession(harness);

  await runTokenomyCommand(harness, "doctor");

  const report = harness.notifications.at(-1).message;
  assert.match(report, /Tokenomy doctor: healthy/);
  assert.match(report, /PASS configuration/);
  assert.match(report, /PASS models/);
  assert.match(report, /PASS storage/);
  assert.match(report, /PASS schema/);
  assert.match(report, /PASS rate card/);
});

test("save budget policy downshifts normal work after threshold", async () => {
  const harness = createHarness(
    createProjectConfig({
      budgets: {
        sessionCredits: 0.0001,
        dailyCredits: 0,
        warnAtPercent: 80,
        policy: "save",
      },
    }),
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });

  await routePrompt(
    harness,
    "Update the package configuration and verify the focused tests.",
  );
  await runTokenomyCommand(harness, "explain");

  assert.match(harness.notifications.at(-1).message, /budget policy save downshifted/);
  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
});

test("ask budget policy honors the user's per-turn choice", async () => {
  const harness = createHarness(
    createProjectConfig({
      budgets: {
        sessionCredits: 0.0001,
        dailyCredits: 0,
        warnAtPercent: 80,
        policy: "ask",
      },
    }),
    { confirmBudget: false },
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });

  await routePrompt(
    harness,
    "Update the package configuration and verify the focused tests.",
  );

  assert.equal(harness.confirmations.length, 1);
  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
});

test("budget policy never downshifts high-risk release work", async () => {
  const harness = createHarness(
    createProjectConfig({
      budgets: {
        sessionCredits: 0.0001,
        dailyCredits: 0,
        warnAtPercent: 80,
        policy: "save",
      },
    }),
  );
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");
  await finishAgent(harness, {
    messages: [assistantMessage("gpt-5.4-mini")],
  });

  await routePrompt(
    harness,
    "Publish the release to npm, create the git tag, and verify production.",
  );
  await runTokenomyCommand(harness, "explain");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.match(harness.notifications.at(-1).message, /Tier: complex/);
  assert.doesNotMatch(harness.notifications.at(-1).message, /budget policy/);
});

test("debug traces are redacted and private by default and can be purged", async () => {
  const cwd = createProjectConfig({
    debug: {
      trace: true,
      redact: true,
      retentionDays: 7,
    },
  });
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(harness, "secret-debug-marker-4242 explain this");

  const directory = join(cwd, ".pi/tokenomy-cache/debug");
  const name = readdirSync(directory).find((entry) => entry.endsWith(".jsonl"));
  const path = join(directory, name);
  assert.doesNotMatch(readFileSync(path, "utf8"), /secret-debug-marker-4242/);
  if (process.platform !== "win32") {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
  }

  await runTokenomyCommand(harness, "debug purge");
  assert.match(harness.notifications.at(-1).message, /removed 1 debug trace file/);
  assert.equal(readdirSync(directory).filter((entry) => entry.endsWith(".jsonl")).length, 0);
});

test("persistent state uses atomic writes without leftover temporary files", async () => {
  const cwd = createProjectConfig();
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 204 mean?");

  const cache = join(cwd, ".pi/tokenomy-cache");
  for (const name of readdirSync(cache)) {
    assert.doesNotMatch(name, /\.tmp-|\.lock$/);
    if (name.endsWith(".json")) {
      assert.doesNotThrow(() => JSON.parse(readFileSync(join(cache, name), "utf8")));
      if (process.platform !== "win32") {
        assert.equal(statSync(join(cache, name)).mode & 0o777, 0o600);
      }
    }
  }
});

test("transactional JSON updates preserve concurrent process increments", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "tokenomy-storage-race-"));
  const path = join(cwd, "counter.json");
  const runWorker = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--experimental-strip-types",
          "tests/storage-worker.mjs",
          path,
          "75",
        ],
        { cwd: process.cwd(), stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)),
      );
    });

  await Promise.all([runWorker(), runWorker(), runWorker(), runWorker()]);

  assert.equal(JSON.parse(readFileSync(path, "utf8")).count, 300);
  assert.equal(
    readdirSync(cwd).filter((name) => name.includes(".lock") || name.includes(".tmp-"))
      .length,
    0,
  );
});

test("data inventory and selective purge expose and control local state", async () => {
  const cwd = createProjectConfig({
    memory: { enabled: true, inject: false },
  });
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(harness, "Inspect package.json and explain the project.");

  await runTokenomyCommand(harness, "data");
  assert.match(harness.notifications.at(-1).message, /Tokenomy local data/);
  assert.match(harness.notifications.at(-1).message, /project-local; never uploaded/);
  assert.match(harness.notifications.at(-1).message, /routing history/);

  const telemetry = join(cwd, ".pi/tokenomy-cache/telemetry-rollups.json");
  const memory = join(cwd, ".pi/tokenomy-cache/project-memory.json");
  assert.ok(existsSync(telemetry));
  assert.ok(existsSync(memory));
  await runTokenomyCommand(harness, "data purge cache");
  assert.ok(existsSync(telemetry));
  assert.ok(existsSync(memory));

  await runTokenomyCommand(harness, "data purge all");
  assert.equal(harness.confirmations.length, 1);
  assert.equal(existsSync(join(cwd, ".pi/tokenomy-cache")), false);
  assert.ok(existsSync(join(cwd, ".pi/tokenomy.json")));
});

test("loads legacy stats and v2 rollups and migrates them without data loss", async () => {
  const cwd = createProjectConfig();
  mkdirSync(join(cwd, ".pi/tokenomy-cache"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi/tokenomy-stats.json"),
    JSON.stringify({
      lifetimeEstimatedTokensSaved: 120,
      routedPrompts: 7,
      sessionsStarted: 2,
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(
    join(cwd, ".pi/tokenomy-cache/telemetry-rollups.json"),
    JSON.stringify({
      version: 2,
      updatedAt: "2025-01-01T00:00:00.000Z",
      lifetime: { prompts: 4, totalTokens: 900 },
      daily: {},
      monthly: {},
    }),
  );
  const harness = createHarness(cwd);
  await startSession(harness);
  await routePrompt(harness, "What does HTTP 201 mean?");

  const stats = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-stats.json"), "utf8"),
  );
  const rollups = JSON.parse(
    readFileSync(join(cwd, ".pi/tokenomy-cache/telemetry-rollups.json"), "utf8"),
  );
  assert.equal(stats.lifetimeEstimatedTokensSaved, 120);
  assert.equal(stats.routedPrompts, 8);
  assert.equal(rollups.version, 3);
  assert.equal(rollups.lifetime.prompts, 5);
  assert.equal(rollups.lifetime.totalTokens, 900);
});
