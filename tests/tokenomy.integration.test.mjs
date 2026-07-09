import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeCalls } from "./pi-ai-compat-shim.mjs";
import tokenomy from "../.pi/extensions/tokenomy/index.ts";

const PACKAGE_VERSION = JSON.parse(readFileSync("package.json", "utf8"))
  .version;

const MODELS = [
  { provider: "openai-codex", id: "gpt-5.4" },
  { provider: "openai-codex", id: "gpt-5.4-mini" },
  { provider: "openai-codex", id: "gpt-5.5" },
];

test("package manifest declares Tokenomy as an installable Pi extension", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));

  assert.ok(manifest.keywords.includes("pi-package"));
  assert.deepEqual(manifest.pi.extensions, [
    ".pi/extensions/tokenomy/index.ts",
  ]);
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
  const models = options.models ?? MODELS;

  const ctx = {
    cwd,
    model: undefined,
    signal: new AbortController().signal,
    hasUI: true,
    getContextUsage: () => ({ tokens: options.contextTokens ?? 12_000 }),
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
      thinkingLevels.push(level);
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

async function finishAgent(harness, eventName = "after_agent_end", event = {}) {
  return harness.handlers.get(eventName)?.(event, harness.ctx);
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

test("restores the pre-route model after a prompt finishes", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);

  await routePrompt(harness, "What time is it?");

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.4-mini");
  await finishAgent(harness);

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.match(
    harness.notifications.at(-1).message,
    /Tokenomy restored model -> openai-codex\/gpt-5\.5/,
  );

  await finishAgent(harness, "after_agent_finish");
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
  assert.ok(rollups.lifetime.baselineCostUnits > 0);
  assert.ok(rollups.lifetime.actualCostUnits > 0);
  assert.ok(rollups.lifetime.estimatedTokensSaved > 0);
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
    /Estimated savings: \d+ token-equivalent units \(\d+%\)/,
  );
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

test("bypasses non-English prompts transparently", async () => {
  const harness = createHarness(createProjectConfig());
  await startSession(harness);
  const startupModelCount = harness.selectedModels.length;
  const startupStatus = harness.statuses.get("tokenomy");

  inputPrompt(harness, "будь ласка зроби аудит проекту");
  const result = await routePrompt(harness, "будь ласка зроби аудит проекту");

  assert.equal(result, undefined);
  assert.equal(harness.selectedModels.length, startupModelCount);
  assert.equal(harness.thinkingLevels.length, 0);
  assert.equal(harness.notifications.length, 0);
  assert.equal(harness.statuses.get("tokenomy"), startupStatus);
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

test("learns package commands and injects relevant memory automatically", async () => {
  const cwd = createProjectConfig();
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
  const cwd = createProjectConfig();
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
  const cwd = createProjectConfig();
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

  delete process.env.TOKENOMY_TEST_CLASSIFIER_RESPONSE;
});

test("injects a compact project digest for large contexts", async () => {
  const cwd = createProjectConfig();
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
    /classifier\.minConfidence must be a number from 0 to 1/,
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
  await finishAgent(harness, "after_agent_end", {
    output: "raw output marker 456",
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
  const cwd = createProjectConfig();
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
