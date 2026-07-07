import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import tokenomy from "../.pi/extensions/tokenomy/index.ts";

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
      medium: ["gpt-5.4-mini", "gpt-5.4"],
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

async function runTokenomyCommand(harness, args) {
  return harness.commands.get("tokenomy").handler(args, harness.ctx);
}

test("starts on the configured complex baseline model", async () => {
  const harness = createHarness(createProjectConfig());

  await startSession(harness);

  assert.equal(harness.selectedModels.at(-1), "openai-codex/gpt-5.5");
  assert.equal(harness.statuses.get("tokenomy"), "tokenomy:on");
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
