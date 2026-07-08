import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { complete, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { compress as shrinkPrompt } from "tokenshrink";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";

type Tier = "simple" | "medium" | "complex";
type ToolProfile = "none" | "read" | "write";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type PromptIntent =
  | "answer"
  | "shell_simple"
  | "read"
  | "single_edit"
  | "multi_edit"
  | "debug"
  | "architecture"
  | "local_workflow"
  | "release";
type RiskLevel = "low" | "medium" | "high";

type ModelSpec = string;

interface TokenomyConfig {
  enabled: boolean;
  provider: string;
  models: {
    classifier: ModelSpec[];
    simple: ModelSpec[];
    medium: ModelSpec[];
    complex: ModelSpec[];
  };
  thinking: Record<Tier, ThinkingLevel>;
  classifier: {
    enabled: boolean;
    onlyWhenAmbiguous: boolean;
    maxPromptChars: number;
    maxEstimatedClassifierTokens: number;
    minConfidence: number;
  };
  cache: {
    enabled: boolean;
    classifierTtlMs: number;
    maxClassifierEntries: number;
    projectDigest: boolean;
  };
  telemetry: {
    enabled: boolean;
    maxEntries: number;
  };
  memory: {
    enabled: boolean;
    inject: boolean;
    maxFacts: number;
    maxInjectedChars: number;
    maxFactChars: number;
    staleAfterDays: number;
    minContextTokensForInjection: number;
  };
  distillation: {
    enabled: boolean;
    minContextTokens: number;
    repeatPromptThreshold: number;
    maxDigestChars: number;
  };
  adaptive: {
    enabled: boolean;
    mediumFallbackMinRisk: RiskLevel;
    complexFallbackIntents: PromptIntent[];
  };
  thresholds: {
    largeContextTokens: number;
    hugeContextTokens: number;
    longPromptChars: number;
    veryLongPromptChars: number;
  };
  tools: {
    manage: boolean;
    preserveCustomTools: boolean;
    readOnlyTools: string[];
    writeTools: string[];
  };
  debug: {
    dryRun: boolean;
    verbose: boolean;
  };
  promptDiscipline: {
    enabled: boolean;
    maxAnswerBulletsSimple: number;
  };
  promptSimplification: {
    enabled: boolean;
    compressionEnabled: boolean;
    minCompressionSavingsTokens: number;
    maxClassifierPromptChars: number;
    maxLineChars: number;
    headLines: number;
    tailLines: number;
    preserveSignalLines: number;
  };
  ui: {
    status: boolean;
    notifyDecisions: boolean;
  };
}

interface LocalAnalysis {
  tier: Tier;
  intent: PromptIntent;
  risk: RiskLevel;
  toolProfile: ToolProfile;
  ambiguous: boolean;
  confidence: number;
  score: number;
  signals: string[];
  estimatedClassifierTokens: number;
}

interface RouterDecision {
  tier: Tier;
  source: "local" | "classifier" | "classifier-cache" | "fallback";
  toolProfile: ToolProfile;
  intent: PromptIntent;
  risk: RiskLevel;
  reason: string;
  confidence?: number;
  signals: string[];
  model?: string;
  thinking: ThinkingLevel;
}

interface TokenomyStats {
  lifetimeEstimatedTokensSaved: number;
  routedPrompts: number;
  sessionsStarted: number;
  classifierCacheHits: number;
  projectDigestUses: number;
  memoryInjections: number;
  adaptiveFallbacks: number;
  compressionGuardRejections: number;
  intents: Record<
    string,
    {
      routedPrompts: number;
      fallbackPrompts: number;
      complexPrompts: number;
      cacheHits: number;
    }
  >;
  updatedAt: string;
}

interface ClassifierResult {
  tier: Tier;
  confidence: number;
  reason: string;
}

interface ClassifierCacheEntry extends ClassifierResult {
  key: string;
  intent: PromptIntent;
  risk: RiskLevel;
  contextBucket: string;
  createdAt: number;
  lastUsedAt: number;
  hits: number;
}

interface ClassifierCache {
  entries: ClassifierCacheEntry[];
}

interface ProjectDigest {
  project: string;
  updatedAt: string;
  promptsSeen: number;
  intentCounts: Record<string, number>;
  lastIntent?: PromptIntent;
  lastTier?: Tier;
  lastModel?: string;
  lastSignals?: string[];
}

interface RoutingHistoryEntry {
  id: string;
  at: string;
  promptHash: string;
  promptChars: number;
  contextBucket: string;
  imageCount: number;
  intent: PromptIntent;
  risk: RiskLevel;
  toolProfile: ToolProfile;
  tier: Tier;
  source: RouterDecision["source"];
  confidence?: number;
  model?: string;
  thinking: ThinkingLevel;
  signals: string[];
  estimatedClassifierTokens: number;
  estimatedTokensSaved: number;
  sessionEstimatedTokensSaved: number;
  promptSimplificationEnabled: boolean;
  promptCompressionEnabled: boolean;
  classifierPromptCompressed?: boolean;
  classifierPromptCompressionGuarded?: boolean;
  classifierPromptCompressionGuardMissingLines?: number;
  classifierPromptCompressionTokensSaved?: number;
  memoryInjected?: boolean;
  memoryInjectedChars?: number;
  memoryReason?: string;
  memoryFactsUsed?: number;
  memoryEstimatedTokensSaved?: number;
}

interface RoutingHistory {
  entries: RoutingHistoryEntry[];
}

interface ClassifierPromptTelemetry {
  attempted: boolean;
  accepted: boolean;
  guarded: boolean;
  guardMissingLines: number;
  tokensSaved: number;
  requiredLines: number;
}

type MemoryFactSource = "observed" | "config" | "package" | "workflow";
type MemoryFactKind =
  | "package"
  | "command"
  | "file"
  | "workflow"
  | "preference"
  | "project";

interface ProjectMemoryFact {
  id: string;
  text: string;
  kind: MemoryFactKind;
  source: MemoryFactSource;
  confidence: "high" | "medium";
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  uses: number;
}

interface ProjectMemory {
  version: number;
  project: string;
  updatedAt: string;
  facts: ProjectMemoryFact[];
}

interface MemoryInjection {
  text: string;
  reason: string;
  factsUsed: number;
  chars: number;
  estimatedTokensSaved: number;
}

const BUILTIN_TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]);

const DEFAULT_CONFIG: TokenomyConfig = {
  enabled: true,
  provider: "openai-codex",
  models: {
    classifier: ["gpt-5.4-mini"],
    simple: ["gpt-5.4-mini", "gpt-5.4"],
    medium: ["gpt-5.4", "gpt-5.4-mini"],
    complex: ["gpt-5.5", "gpt-5.4"],
  },
  thinking: {
    simple: "minimal",
    medium: "low",
    complex: "medium",
  },
  classifier: {
    enabled: true,
    onlyWhenAmbiguous: true,
    maxPromptChars: 4000,
    maxEstimatedClassifierTokens: 1400,
    minConfidence: 0.95,
  },
  cache: {
    enabled: true,
    classifierTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxClassifierEntries: 200,
    projectDigest: true,
  },
  telemetry: {
    enabled: true,
    maxEntries: 200,
  },
  memory: {
    enabled: true,
    inject: true,
    maxFacts: 80,
    maxInjectedChars: 1200,
    maxFactChars: 240,
    staleAfterDays: 30,
    minContextTokensForInjection: 20_000,
  },
  distillation: {
    enabled: true,
    minContextTokens: 80_000,
    repeatPromptThreshold: 3,
    maxDigestChars: 1200,
  },
  adaptive: {
    enabled: true,
    mediumFallbackMinRisk: "medium",
    complexFallbackIntents: ["architecture", "release"],
  },
  thresholds: {
    largeContextTokens: 80_000,
    hugeContextTokens: 120_000,
    longPromptChars: 900,
    veryLongPromptChars: 2200,
  },
  tools: {
    manage: false,
    preserveCustomTools: true,
    readOnlyTools: ["read", "grep", "find", "ls"],
    writeTools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
  },
  debug: {
    dryRun: false,
    verbose: false,
  },
  promptDiscipline: {
    enabled: true,
    maxAnswerBulletsSimple: 5,
  },
  promptSimplification: {
    enabled: true,
    compressionEnabled: true,
    minCompressionSavingsTokens: 12,
    maxClassifierPromptChars: 1600,
    maxLineChars: 240,
    headLines: 16,
    tailLines: 16,
    preserveSignalLines: 40,
  },
  ui: {
    status: true,
    notifyDecisions: true,
  },
};

const EMPTY_STATS: TokenomyStats = {
  lifetimeEstimatedTokensSaved: 0,
  routedPrompts: 0,
  sessionsStarted: 0,
  classifierCacheHits: 0,
  projectDigestUses: 0,
  memoryInjections: 0,
  adaptiveFallbacks: 0,
  compressionGuardRejections: 0,
  intents: {},
  updatedAt: "",
};

function emptyStats(): TokenomyStats {
  return { ...EMPTY_STATS, intents: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function packageVersion(): string {
  try {
    const parsed = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    return isObject(parsed) && typeof parsed.version === "string"
      ? parsed.version
      : "unknown";
  } catch {
    return "unknown";
  }
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) {
    return (override === undefined ? base : override) as T;
  }

  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = output[key];
    output[key] =
      isObject(existing) && isObject(value)
        ? deepMerge(existing, value)
        : value;
  }
  return output as T;
}

function loadJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

function statsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "tokenomy-stats.json");
}

function cacheDir(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "tokenomy-cache");
}

function classifierCachePath(cwd: string): string {
  return join(cacheDir(cwd), "classifier-cache.json");
}

function projectDigestPath(cwd: string): string {
  return join(cacheDir(cwd), "project-digest.json");
}

function routingHistoryPath(cwd: string): string {
  return join(cacheDir(cwd), "routing-history.json");
}

function projectMemoryPath(cwd: string): string {
  return join(cacheDir(cwd), "project-memory.json");
}

function safeInt(value: unknown): number {
  return typeof value === "number" ? Math.max(0, Math.round(value)) : 0;
}

function loadStats(cwd: string): TokenomyStats {
  const parsed = loadJson(statsPath(cwd));
  if (!isObject(parsed)) return emptyStats();
  const intents: TokenomyStats["intents"] = {};
  if (isObject(parsed.intents)) {
    for (const [intent, value] of Object.entries(parsed.intents)) {
      if (!isObject(value)) continue;
      intents[intent] = {
        routedPrompts: safeInt(value.routedPrompts),
        fallbackPrompts: safeInt(value.fallbackPrompts),
        complexPrompts: safeInt(value.complexPrompts),
        cacheHits: safeInt(value.cacheHits),
      };
    }
  }
  return {
    lifetimeEstimatedTokensSaved:
      typeof parsed.lifetimeEstimatedTokensSaved === "number"
        ? Math.max(0, Math.round(parsed.lifetimeEstimatedTokensSaved))
        : 0,
    routedPrompts: safeInt(parsed.routedPrompts),
    sessionsStarted: safeInt(parsed.sessionsStarted),
    classifierCacheHits: safeInt(parsed.classifierCacheHits),
    projectDigestUses: safeInt(parsed.projectDigestUses),
    memoryInjections: safeInt(parsed.memoryInjections),
    adaptiveFallbacks: safeInt(parsed.adaptiveFallbacks),
    compressionGuardRejections: safeInt(parsed.compressionGuardRejections),
    intents,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
  };
}

function saveStats(cwd: string, stats: TokenomyStats): void {
  const next = {
    ...stats,
    updatedAt: new Date().toISOString(),
  };
  const path = statsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function loadRoutingHistory(cwd: string): RoutingHistory {
  const parsed = loadJson(routingHistoryPath(cwd));
  if (!isObject(parsed) || !Array.isArray(parsed.entries)) {
    return { entries: [] };
  }
  return {
    entries: parsed.entries
      .filter(
        (entry) =>
          isObject(entry) &&
          typeof entry.id === "string" &&
          typeof entry.at === "string" &&
          typeof entry.promptHash === "string" &&
          typeof entry.promptChars === "number" &&
          typeof entry.contextBucket === "string" &&
          typeof entry.imageCount === "number" &&
          typeof entry.intent === "string" &&
          typeof entry.risk === "string" &&
          typeof entry.toolProfile === "string" &&
          (entry.tier === "simple" ||
            entry.tier === "medium" ||
            entry.tier === "complex") &&
          (entry.source === "local" ||
            entry.source === "classifier" ||
            entry.source === "classifier-cache" ||
            entry.source === "fallback") &&
          typeof entry.thinking === "string" &&
          Array.isArray(entry.signals) &&
          typeof entry.estimatedClassifierTokens === "number" &&
          typeof entry.estimatedTokensSaved === "number" &&
          typeof entry.sessionEstimatedTokensSaved === "number" &&
          typeof entry.promptSimplificationEnabled === "boolean" &&
          typeof entry.promptCompressionEnabled === "boolean",
      )
      .map((entry) => entry as RoutingHistoryEntry),
  };
}

function saveRoutingHistory(
  cwd: string,
  history: RoutingHistory,
  config: TokenomyConfig,
): void {
  const path = routingHistoryPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const entries = history.entries.slice(0, config.telemetry.maxEntries);
  writeFileSync(path, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

function loadProjectMemory(cwd: string): ProjectMemory {
  const parsed = loadJson(projectMemoryPath(cwd));
  if (!isObject(parsed) || !Array.isArray(parsed.facts)) {
    return {
      version: 1,
      project: basename(cwd),
      updatedAt: "",
      facts: [],
    };
  }
  return {
    version: typeof parsed.version === "number" ? parsed.version : 1,
    project: typeof parsed.project === "string" ? parsed.project : basename(cwd),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    facts: parsed.facts.filter(
      (fact): fact is ProjectMemoryFact =>
        isObject(fact) &&
        typeof fact.id === "string" &&
        typeof fact.text === "string" &&
        typeof fact.kind === "string" &&
        typeof fact.source === "string" &&
        (fact.confidence === "high" || fact.confidence === "medium") &&
        typeof fact.createdAt === "string" &&
        typeof fact.updatedAt === "string" &&
        typeof fact.uses === "number",
    ),
  };
}

function saveProjectMemory(cwd: string, memory: ProjectMemory): void {
  const path = projectMemoryPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

function safeLoadProjectMemory(cwd: string): ProjectMemory | undefined {
  try {
    return loadProjectMemory(cwd);
  } catch {
    return undefined;
  }
}

function memoryFactId(kind: MemoryFactKind, text: string): string {
  return hashText(`${kind}\n${text.toLowerCase().trim()}`);
}

function truncateFact(text: string, config: TokenomyConfig): string {
  return text.replace(/\s+/g, " ").trim().slice(0, config.memory.maxFactChars);
}

function upsertMemoryFacts(
  memory: ProjectMemory,
  facts: Array<{
    text: string;
    kind: MemoryFactKind;
    source: MemoryFactSource;
    confidence: "high" | "medium";
  }>,
  config: TokenomyConfig,
): ProjectMemory {
  const now = new Date().toISOString();
  const byId = new Map(memory.facts.map((fact) => [fact.id, fact]));
  for (const fact of facts) {
    const text = truncateFact(fact.text, config);
    if (!text) continue;
    const id = memoryFactId(fact.kind, text);
    const existing = byId.get(id);
    byId.set(id, {
      id,
      text,
      kind: fact.kind,
      source: fact.source,
      confidence: fact.confidence,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existing?.lastUsedAt,
      uses: existing?.uses ?? 0,
    });
  }
  return {
    ...memory,
    updatedAt: now,
    facts: [...byId.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, config.memory.maxFacts),
  };
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function contextBucket(contextTokens: number | undefined): string {
  if (contextTokens === undefined) return "unknown";
  if (contextTokens < 20_000) return "small";
  if (contextTokens < 80_000) return "medium";
  if (contextTokens < 120_000) return "large";
  return "huge";
}

function normalizedPrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 4000);
}

function classifierCacheKey(
  prompt: string,
  contextTokens: number | undefined,
  analysis: LocalAnalysis,
  config: TokenomyConfig,
): string {
  // Hash the normalized prompt so project-local cache files never store raw
  // prompt text while still reusing equivalent classifier decisions.
  return hashText(
    [
      normalizedPrompt(prompt),
      contextBucket(contextTokens),
      analysis.intent,
      analysis.risk,
      analysis.toolProfile,
      String(config.classifier.minConfidence),
    ].join("\n"),
  );
}

function loadClassifierCache(cwd: string): ClassifierCache {
  const parsed = loadJson(classifierCachePath(cwd));
  if (!isObject(parsed) || !Array.isArray(parsed.entries)) {
    return { entries: [] };
  }
  return {
    entries: parsed.entries.filter(
      (entry): entry is ClassifierCacheEntry =>
        isObject(entry) &&
        typeof entry.key === "string" &&
        (entry.tier === "simple" ||
          entry.tier === "medium" ||
          entry.tier === "complex") &&
        typeof entry.confidence === "number" &&
        typeof entry.reason === "string" &&
        typeof entry.intent === "string" &&
        typeof entry.risk === "string" &&
        typeof entry.contextBucket === "string" &&
        typeof entry.createdAt === "number" &&
        typeof entry.lastUsedAt === "number" &&
        typeof entry.hits === "number",
    ),
  };
}

function saveClassifierCache(
  cwd: string,
  cache: ClassifierCache,
  config: TokenomyConfig,
): void {
  const path = classifierCachePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const entries = [...cache.entries]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, config.cache.maxClassifierEntries);
  writeFileSync(path, `${JSON.stringify({ entries }, null, 2)}\n`, "utf8");
}

function getClassifierCacheEntry(
  cwd: string,
  key: string,
  config: TokenomyConfig,
): ClassifierCacheEntry | undefined {
  if (!config.cache.enabled) return undefined;
  try {
    const now = Date.now();
    const cache = loadClassifierCache(cwd);
    const entry = cache.entries.find((item) => item.key === key);
    if (!entry || now - entry.createdAt > config.cache.classifierTtlMs) {
      return undefined;
    }
    entry.hits += 1;
    entry.lastUsedAt = now;
    saveClassifierCache(cwd, cache, config);
    return entry;
  } catch {
    return undefined;
  }
}

function putClassifierCacheEntry(
  cwd: string,
  key: string,
  result: ClassifierResult,
  contextTokens: number | undefined,
  analysis: LocalAnalysis,
  config: TokenomyConfig,
): void {
  if (!config.cache.enabled) return;
  try {
    const now = Date.now();
    const cache = loadClassifierCache(cwd);
    const next: ClassifierCacheEntry = {
      ...result,
      key,
      intent: analysis.intent,
      risk: analysis.risk,
      contextBucket: contextBucket(contextTokens),
      createdAt: now,
      lastUsedAt: now,
      hits: 0,
    };
    cache.entries = [
      next,
      ...cache.entries.filter((entry) => entry.key !== key),
    ];
    saveClassifierCache(cwd, cache, config);
  } catch {
    // Routing must not fail or upshift just because the local cache is invalid.
  }
}

function loadObjectFile(path: string): Record<string, unknown> | undefined {
  try {
    const parsed = loadJson(path);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function packageScriptFact(
  scripts: Record<string, unknown>,
  name: string,
): string | undefined {
  const script = scripts[name];
  if (typeof script !== "string") return undefined;
  if (name === "test") return "Test command is npm test.";
  return `${name} command is npm run ${name}.`;
}

function discoverProjectMemoryFacts(
  cwd: string,
  analysis: LocalAnalysis | undefined,
  decision: RouterDecision | undefined,
  config: TokenomyConfig,
): Array<{
  text: string;
  kind: MemoryFactKind;
  source: MemoryFactSource;
  confidence: "high" | "medium";
}> {
  if (!config.memory.enabled) return [];
  const facts: Array<{
    text: string;
    kind: MemoryFactKind;
    source: MemoryFactSource;
    confidence: "high" | "medium";
  }> = [];
  const packageJson = loadObjectFile(join(cwd, "package.json"));
  if (packageJson) {
    if (typeof packageJson.name === "string") {
      facts.push({
        text: `Package name is ${packageJson.name}.`,
        kind: "package",
        source: "package",
        confidence: "high",
      });
    }
    if (packageJson.type === "module") {
      facts.push({
        text: "Project uses Node.js ES modules.",
        kind: "project",
        source: "package",
        confidence: "high",
      });
    }
    if (isObject(packageJson.scripts)) {
      const scripts = packageJson.scripts;
      const directScripts = [
        packageScriptFact(scripts, "test"),
        packageScriptFact(scripts, "build"),
        packageScriptFact(scripts, "lint"),
        packageScriptFact(scripts, "json:check"),
      ].filter((item): item is string => !!item);
      for (const text of directScripts) {
        facts.push({
          text,
          kind: "command",
          source: "package",
          confidence: "high",
        });
      }
    }
  }
  if (existsSync(join(cwd, ".pi/extensions/tokenomy/index.ts"))) {
    facts.push({
      text: "Main Tokenomy extension file is .pi/extensions/tokenomy/index.ts.",
      kind: "file",
      source: "observed",
      confidence: "high",
    });
  }
  if (existsSync(join(cwd, ".github/workflows/npm-publish.yml"))) {
    facts.push({
      text: "Merging to main can trigger the npm publish GitHub Actions workflow.",
      kind: "workflow",
      source: "workflow",
      confidence: "high",
    });
  }
  if (existsSync(join(cwd, ".github/workflows/ci.yml"))) {
    facts.push({
      text: "GitHub Actions CI validates changes on pull requests.",
      kind: "workflow",
      source: "workflow",
      confidence: "high",
    });
  }
  if (analysis?.intent === "release" || decision?.intent === "release") {
    facts.push({
      text: "Release work should go through a pull request before merging to main.",
      kind: "workflow",
      source: "observed",
      confidence: "medium",
    });
  }
  return facts;
}

function updateProjectMemory(
  cwd: string,
  analysis: LocalAnalysis | undefined,
  decision: RouterDecision | undefined,
  config: TokenomyConfig,
): ProjectMemory | undefined {
  if (!config.memory.enabled) return undefined;
  const memory = safeLoadProjectMemory(cwd) ?? {
    version: 1,
    project: basename(cwd),
    updatedAt: "",
    facts: [],
  };
  const facts = discoverProjectMemoryFacts(cwd, analysis, decision, config);
  const next = upsertMemoryFacts(memory, facts, config);
  saveProjectMemory(cwd, next);
  return next;
}

function loadProjectDigest(cwd: string): ProjectDigest | undefined {
  const parsed = loadJson(projectDigestPath(cwd));
  if (!isObject(parsed)) return undefined;
  return {
    project: typeof parsed.project === "string" ? parsed.project : basename(cwd),
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    promptsSeen: safeInt(parsed.promptsSeen),
    intentCounts: isObject(parsed.intentCounts)
      ? Object.fromEntries(
          Object.entries(parsed.intentCounts).map(([key, value]) => [
            key,
            safeInt(value),
          ]),
        )
      : {},
    lastIntent:
      typeof parsed.lastIntent === "string"
        ? (parsed.lastIntent as PromptIntent)
        : undefined,
    lastTier:
      parsed.lastTier === "simple" ||
      parsed.lastTier === "medium" ||
      parsed.lastTier === "complex"
        ? parsed.lastTier
        : undefined,
    lastModel: typeof parsed.lastModel === "string" ? parsed.lastModel : undefined,
    lastSignals: Array.isArray(parsed.lastSignals)
      ? parsed.lastSignals.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function safeLoadProjectDigest(cwd: string): ProjectDigest | undefined {
  try {
    return loadProjectDigest(cwd);
  } catch {
    return undefined;
  }
}

function saveProjectDigest(cwd: string, digest: ProjectDigest): void {
  const path = projectDigestPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(digest, null, 2)}\n`, "utf8");
}

function updateProjectDigest(
  cwd: string,
  analysis: LocalAnalysis,
  decision: RouterDecision,
  config: TokenomyConfig,
): void {
  if (!config.cache.projectDigest) return;
  const digest = loadProjectDigest(cwd) ?? {
    project: basename(cwd),
    updatedAt: "",
    promptsSeen: 0,
    intentCounts: {},
  };
  digest.promptsSeen += 1;
  digest.intentCounts[analysis.intent] =
    (digest.intentCounts[analysis.intent] ?? 0) + 1;
  digest.lastIntent = analysis.intent;
  digest.lastTier = decision.tier;
  digest.lastModel = decision.model;
  digest.lastSignals = analysis.signals.slice(-8);
  digest.updatedAt = new Date().toISOString();
  saveProjectDigest(cwd, digest);
}

function validateConfig(config: TokenomyConfig): string[] {
  const warnings: string[] = [];
  const modelGroups: Array<[string, ModelSpec[]]> = [
    ["classifier", config.models.classifier],
    ["simple", config.models.simple],
    ["medium", config.models.medium],
    ["complex", config.models.complex],
  ];
  for (const [name, models] of modelGroups) {
    if (!Array.isArray(models) || models.length === 0) {
      warnings.push(`models.${name} is empty`);
    }
    for (const spec of models ?? []) {
      if (typeof spec !== "string" || !spec.trim()) {
        warnings.push(`models.${name} contains an invalid model entry`);
      }
    }
  }
  if (config.tools.manage && config.tools.readOnlyTools.length === 0) {
    warnings.push("tools.readOnlyTools is empty");
  }
  if (config.tools.manage && config.tools.writeTools.length === 0) {
    warnings.push("tools.writeTools is empty");
  }
  if (
    typeof config.classifier.minConfidence !== "number" ||
    config.classifier.minConfidence < 0 ||
    config.classifier.minConfidence > 1
  ) {
    warnings.push("classifier.minConfidence must be a number from 0 to 1");
  }
  if (
    typeof config.cache.classifierTtlMs !== "number" ||
    config.cache.classifierTtlMs < 0
  ) {
    warnings.push("cache.classifierTtlMs must be a non-negative number");
  }
  if (
    typeof config.cache.maxClassifierEntries !== "number" ||
    config.cache.maxClassifierEntries < 1
  ) {
    warnings.push("cache.maxClassifierEntries must be at least 1");
  }
  if (typeof config.telemetry.enabled !== "boolean") {
    warnings.push("telemetry.enabled must be a boolean");
  }
  if (
    typeof config.telemetry.maxEntries !== "number" ||
    config.telemetry.maxEntries < 1
  ) {
    warnings.push("telemetry.maxEntries must be at least 1");
  }
  if (typeof config.memory.enabled !== "boolean") {
    warnings.push("memory.enabled must be a boolean");
  }
  if (typeof config.memory.inject !== "boolean") {
    warnings.push("memory.inject must be a boolean");
  }
  if (typeof config.memory.maxFacts !== "number" || config.memory.maxFacts < 1) {
    warnings.push("memory.maxFacts must be at least 1");
  }
  if (
    typeof config.memory.maxInjectedChars !== "number" ||
    config.memory.maxInjectedChars < 200
  ) {
    warnings.push("memory.maxInjectedChars must be at least 200");
  }
  if (
    typeof config.memory.maxFactChars !== "number" ||
    config.memory.maxFactChars < 40
  ) {
    warnings.push("memory.maxFactChars must be at least 40");
  }
  if (
    typeof config.memory.staleAfterDays !== "number" ||
    config.memory.staleAfterDays < 1
  ) {
    warnings.push("memory.staleAfterDays must be at least 1");
  }
  if (
    typeof config.memory.minContextTokensForInjection !== "number" ||
    config.memory.minContextTokensForInjection < 0
  ) {
    warnings.push("memory.minContextTokensForInjection must be non-negative");
  }
  if (
    typeof config.distillation.minContextTokens !== "number" ||
    config.distillation.minContextTokens < 0
  ) {
    warnings.push("distillation.minContextTokens must be a non-negative number");
  }
  if (
    typeof config.distillation.repeatPromptThreshold !== "number" ||
    config.distillation.repeatPromptThreshold < 1
  ) {
    warnings.push("distillation.repeatPromptThreshold must be at least 1");
  }
  if (
    typeof config.distillation.maxDigestChars !== "number" ||
    config.distillation.maxDigestChars < 200
  ) {
    warnings.push("distillation.maxDigestChars must be at least 200");
  }
  if (
    typeof config.promptSimplification.maxClassifierPromptChars !== "number" ||
    config.promptSimplification.maxClassifierPromptChars < 400
  ) {
    warnings.push(
      "promptSimplification.maxClassifierPromptChars must be at least 400",
    );
  }
  if (
    typeof config.promptSimplification.maxLineChars !== "number" ||
    config.promptSimplification.maxLineChars < 80
  ) {
    warnings.push("promptSimplification.maxLineChars must be at least 80");
  }
  if (
    typeof config.promptSimplification.compressionEnabled !== "boolean"
  ) {
    warnings.push("promptSimplification.compressionEnabled must be a boolean");
  }
  if (
    typeof config.promptSimplification.minCompressionSavingsTokens !==
      "number" ||
    config.promptSimplification.minCompressionSavingsTokens < 0
  ) {
    warnings.push(
      "promptSimplification.minCompressionSavingsTokens must be a non-negative number",
    );
  }
  return warnings;
}

function loadConfig(cwd: string): { config: TokenomyConfig; warnings: string[] } {
  const globalPath = join(getAgentDir(), "tokenomy.json");
  const projectPath = join(cwd, CONFIG_DIR_NAME, "tokenomy.json");
  let config = DEFAULT_CONFIG;
  const warnings: string[] = [];

  for (const path of [globalPath, projectPath]) {
    try {
      const parsed = loadJson(path);
      if (parsed !== undefined) config = deepMerge(config, parsed);
    } catch (error) {
      warnings.push(
        `failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  warnings.push(...validateConfig(config));
  return { config, warnings };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, Math.max(0, maxChars - 24))} ... [truncated line]`;
}

function hasAny(lower: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(lower));
}

function isSignalLine(line: string): boolean {
  return hasAny(line.toLowerCase(), [
    /\b(error|fail|failed|failure|exception|traceback|stack trace|warning|warn|fatal|panic|assert|expected|actual)\b/,
    /\b(test|spec|suite|passed|skipped|todo|duration|exit code)\b/,
    /\b(do not|don't|without|preserve|keep|must|never|backwards? compatibility)\b/,
    /(^|\s)(src|lib|app|test|tests|packages|\.pi|\.github|scripts)\/[\w./-]+(:\d+)?/,
    /\b[a-z0-9_.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|rb|java|kt|yml|yaml|toml|lock)(:\d+)?\b/,
  ]);
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function missingRequiredLines(text: string, requiredLines: string[]): string[] {
  return requiredLines.filter((line) => !text.includes(line));
}

function fitClassifierText(
  text: string,
  requiredLines: string[],
  maxChars: number,
): string {
  const sliced = text.slice(0, maxChars);
  const missing = missingRequiredLines(sliced, requiredLines);
  if (!missing.length) return sliced;

  const preserved = [
    "[Tokenomy preserved signal lines]",
    ...requiredLines,
    "",
    "[Tokenomy classifier excerpt]",
  ].join("\n");
  if (preserved.length >= maxChars) return preserved.slice(0, maxChars);

  const remainingLines = sliced
    .split(/\r?\n/)
    .filter((line) => !requiredLines.includes(line));
  const combined = `${preserved}\n${remainingLines.join("\n")}`;
  return combined.slice(0, maxChars);
}

function compressPromptText(
  text: string,
  config: TokenomyConfig,
  requiredLines: string[] = [],
): {
  text: string;
  compressed: boolean;
  telemetry: ClassifierPromptTelemetry;
} {
  const disabledTelemetry: ClassifierPromptTelemetry = {
    attempted: false,
    accepted: false,
    guarded: false,
    guardMissingLines: 0,
    tokensSaved: 0,
    requiredLines: requiredLines.length,
  };
  if (!config.promptSimplification.compressionEnabled) {
    return { text, compressed: false, telemetry: disabledTelemetry };
  }

  try {
    const result = shrinkPrompt(text, { domain: "auto" });
    const tokensSaved =
      typeof result.stats?.tokensSaved === "number"
        ? result.stats.tokensSaved
        : 0;
    const baseTelemetry: ClassifierPromptTelemetry = {
      attempted: true,
      accepted: false,
      guarded: false,
      guardMissingLines: 0,
      tokensSaved,
      requiredLines: requiredLines.length,
    };
    if (
      tokensSaved < config.promptSimplification.minCompressionSavingsTokens ||
      !result.compressed ||
      result.compressed === text
    ) {
      return { text, compressed: false, telemetry: baseTelemetry };
    }
    const missing = missingRequiredLines(result.compressed, requiredLines);
    if (missing.length) {
      return {
        text,
        compressed: false,
        telemetry: {
          ...baseTelemetry,
          guarded: true,
          guardMissingLines: missing.length,
        },
      };
    }
    return {
      text: result.compressed,
      compressed: true,
      telemetry: { ...baseTelemetry, accepted: true },
    };
  } catch {
    // Compression is an optimization. Routing must continue with the raw text.
    return {
      text,
      compressed: false,
      telemetry: { ...disabledTelemetry, attempted: true },
    };
  }
}

function simplifyPromptForClassifier(
  prompt: string,
  config: TokenomyConfig,
): {
  text: string;
  simplified: boolean;
  compressed: boolean;
  tokensSaved: number;
  telemetry: ClassifierPromptTelemetry;
} {
  if (!config.promptSimplification.enabled) {
    const text = prompt.slice(0, config.classifier.maxPromptChars);
    const requiredLines = uniqueLines(
      text.split(/\r?\n/).map((line) => line.trimEnd()).filter(isSignalLine),
    );
    const compressed = compressPromptText(text, config, requiredLines);
    return {
      text: compressed.text,
      compressed: compressed.compressed,
      tokensSaved: compressed.telemetry.accepted
        ? compressed.telemetry.tokensSaved
        : 0,
      telemetry: compressed.telemetry,
      simplified: false,
    };
  }
  if (prompt.length <= config.promptSimplification.maxClassifierPromptChars) {
    const requiredLines = uniqueLines(
      prompt.split(/\r?\n/).map((line) => line.trimEnd()).filter(isSignalLine),
    );
    const compressed = compressPromptText(prompt, config, requiredLines);
    return {
      text: compressed.text,
      compressed: compressed.compressed,
      tokensSaved: compressed.telemetry.accepted
        ? compressed.telemetry.tokensSaved
        : 0,
      telemetry: compressed.telemetry,
      simplified: false,
    };
  }

  const lines = prompt
    .split(/\r?\n/)
    .map((line) =>
      truncateLine(line.trimEnd(), config.promptSimplification.maxLineChars),
    );
  const head = lines.slice(0, config.promptSimplification.headLines);
  const tail = lines.slice(-config.promptSimplification.tailLines);
  const signal = uniqueLines(lines.filter(isSignalLine)).slice(
    0,
    config.promptSimplification.preserveSignalLines,
  );
  const simplified = [
    "[Tokenomy simplified prompt for routing/classification]",
    `Original chars: ${prompt.length}`,
    "",
    "Signal lines:",
    ...(signal.length ? signal : ["none"]),
    "",
    "Head:",
    ...head,
    "",
    "Tail:",
    ...tail,
  ].join("\n");

  const compressed = compressPromptText(simplified, config, signal);

  return {
    text: fitClassifierText(
      compressed.text,
      signal,
      config.promptSimplification.maxClassifierPromptChars,
    ),
    simplified: true,
    compressed: compressed.compressed,
    tokensSaved: compressed.telemetry.accepted
      ? compressed.telemetry.tokensSaved
      : 0,
    telemetry: compressed.telemetry,
  };
}

function isLocalWorkflowPrompt(lower: string): boolean {
  return hasAny(lower, [
    /\b(commit|push|commit\s*&\s*push|commit\s+and\s+push|stage changes?|staging|amend commit|create commit)\b/,
    /\b(git\s+)?(rebase|merge|cherry-pick|stash|pull|push tags?)\b/,
    /\b(resolve conflicts?|tag release|create tag|push tag)\b/,
  ]);
}

function classifyIntent(lower: string, toolProfile: ToolProfile): PromptIntent {
  if (
    hasAny(lower.trim(), [
      /^(ls|pwd|tree|find|grep|rg|cat|head|tail|wc|du|df)(\s|$)/,
    ])
  ) {
    return "shell_simple";
  }
  if (
    hasAny(lower, [
      /\b(release|publish|npm|github actions?|workflow|ci|tag|dist-tag|version bump|merge pr|pull request)\b/,
    ])
  ) {
    return "release";
  }
  if (
    hasAny(lower, [
      /\b(architecture|architectural|redesign|security|auth|authorization|migration|migrate|performance|concurrency|transaction)\b/,
    ])
  ) {
    return "architecture";
  }
  if (
    hasAny(lower, [
      /\b(debug|bug|regression|failing|failure|error|exception|traceback|stack trace)\b/,
    ])
  ) {
    return "debug";
  }
  if (
    hasAny(lower, [
      /\b(refactor|rewrite|across files|multiple files|integration tests?|end-to-end|e2e)\b/,
    ])
  ) {
    return "multi_edit";
  }
  if (isLocalWorkflowPrompt(lower)) return "local_workflow";
  if (toolProfile === "write") return "single_edit";
  if (toolProfile === "read") return "read";
  return "answer";
}

function riskForIntent(
  intent: PromptIntent,
  toolProfile: ToolProfile,
  contextTokens: number | undefined,
): RiskLevel {
  if (intent === "shell_simple") return "low";
  if (intent === "architecture" || intent === "release") return "high";
  if (intent === "local_workflow") return "medium";
  if (intent === "debug" || intent === "multi_edit") return "medium";
  if (toolProfile === "write") return "medium";
  if ((contextTokens ?? 0) >= 80_000) return "medium";
  return "low";
}

function analyzePrompt(
  prompt: string,
  contextTokens: number | undefined,
  imageCount: number,
  config: TokenomyConfig,
): LocalAnalysis {
  const lower = prompt.toLowerCase();
  const signals: string[] = [];
  let score = 0;

  const add = (amount: number, signal: string) => {
    score += amount;
    signals.push(signal);
  };

  if (prompt.length < 260) add(-2, "short-prompt");
  if (prompt.length < 90) add(-1, "very-short-prompt");
  if (prompt.length >= config.thresholds.longPromptChars) add(1, "long-prompt");
  if (prompt.length >= config.thresholds.veryLongPromptChars)
    add(2, "very-long-prompt");

  if ((contextTokens ?? 0) >= config.thresholds.largeContextTokens)
    add(2, "large-context");
  if ((contextTokens ?? 0) >= config.thresholds.hugeContextTokens)
    add(2, "huge-context");
  if (imageCount > 0) add(1, "images");

  if (
    hasAny(lower, [
      /\b(fix|debug|bug|regression|failing|failure|error|exception|traceback|stack trace)\b/,
    ])
  ) {
    add(2, "debug-risk");
  }
  if (
    hasAny(lower, [
      /\b(refactor|architecture|architectural|migrate|migration|redesign|security|performance|optimi[sz]e|concurrency|race|deadlock|transaction|auth|authorization)\b/,
    ])
  ) {
    add(3, "high-risk-domain");
  }
  const auditReview = hasAny(lower, [
    /\b(final\s+scan|scan|audit|review|inspect)\b/,
  ]);
  const broadReviewCandidate = hasAny(lower, [
    /\b(full|complete|comprehensive|global|deep)\s+(audit|review|scan|inspect|refactor)\b/,
    /\b(do|run|perform)\s+an?\s+(audit|review|scan|inspection|refactor)\b/,
    /^\s*(please\s+)?(do|run|perform)?\s*(an?\s+)?(audit|review|scan|inspect|refactor)\s*[.!?]*\s*$/,
    /\b(audit|review|scan|inspect|refactor)\s+(the\s+)?(repo|repository|project|codebase)\b/,
  ]);
  const qualityReview = hasAny(lower, [
    /\b(optimal|optimi[sz]ed?|dead[- ]code[- ]free|dead code|up[- ]to[- ]date|outdated|unused|stale|cleanup|clean up)\b/,
  ]);
  const configTarget = hasAny(lower, [
    /\b(nvim|neovim|vim|tmux|dotfiles?|shell config|zsh|bashrc|config(?:uration)?s?)\b/,
  ]);
  const broadReview = broadReviewCandidate && !(qualityReview || configTarget);
  if (auditReview && (qualityReview || configTarget)) {
    add(4, "config-audit");
  }
  if (broadReview) {
    add(7, "broad-review");
  }
  if (
    hasAny(lower, [
      /\b(implement|add|change|modify|edit|rewrite|tests?|unit test|integration test|feature|endpoint|api)\b/,
    ])
  ) {
    add(2, "code-change");
  }
  const localWorkflow = isLocalWorkflowPrompt(lower);
  if (localWorkflow) {
    add(5, "local-workflow");
  }
  if (hasAny(lower, [/\b(plan|design|investigate|analy[sz]e|review|audit|scan)\b/])) {
    add(1, "analysis-needed");
  }
  if (
    hasAny(lower, [
      /\b(explain|what is|how do i|summari[sz]e|translate|format)\b/,
    ]) &&
    prompt.length < 900
  ) {
    add(-1, "answer-oriented");
  }

  let toolProfile: ToolProfile = "none";
  if (
    hasAny(lower, [
      /\b(repo|repository|project|codebase|files?|classes?|functions?|where is|inspect|scan|audit|read|grep|search|find|summari[sz]e this (repo|repository|project|codebase))\b/,
    ])
  ) {
    toolProfile = "read";
  }
  if (
    hasAny(lower, [
      /\b(fix|implement|add|change|modify|edit|write|create|delete|remove|refactor|migrate|update|patch|test)\b/,
    ]) ||
    localWorkflow
  ) {
    toolProfile = "write";
  }

  const intent = classifyIntent(lower, toolProfile);
  const risk = riskForIntent(intent, toolProfile, contextTokens);
  signals.push(`intent:${intent}`, `risk:${risk}`);

  let tier: Tier = score >= 4 ? "complex" : score >= 1 ? "medium" : "simple";
  if (intent === "shell_simple") tier = "simple";
  else if (intent === "release" || intent === "architecture") tier = "complex";
  else if (
    tier === "simple" &&
    (intent === "debug" ||
      intent === "multi_edit" ||
      intent === "single_edit" ||
      intent === "local_workflow")
  ) {
    tier = "medium";
  }
  const confidence =
    tier === "simple"
      ? Math.max(0.5, Math.min(0.99, 0.96 - Math.abs(score) * 0.02))
      : tier === "medium"
        ? Math.max(0.5, Math.min(0.99, 0.93 + Math.min(score, 3) * 0.01))
        : Math.max(0.5, Math.min(0.99, 0.9 + Math.min(score, 6) * 0.015));
  const ambiguous = confidence < 0.96;
  const estimatedClassifierTokens =
    estimateTokens(prompt.slice(0, config.classifier.maxPromptChars)) + 220;

  return {
    tier,
    intent,
    risk,
    toolProfile,
    ambiguous,
    confidence,
    score,
    signals,
    estimatedClassifierTokens,
  };
}

function parseModelSpec(
  spec: string,
  defaultProvider: string,
): { provider: string; id: string } {
  const slash = spec.indexOf("/");
  if (slash > 0) {
    return { provider: spec.slice(0, slash), id: spec.slice(slash + 1) };
  }
  return { provider: defaultProvider, id: spec };
}

function findFirstModel(
  ctx: ExtensionContext,
  specs: ModelSpec[],
  defaultProvider: string,
): Model<Api> | undefined {
  for (const spec of specs) {
    const { provider, id } = parseModelSpec(spec, defaultProvider);
    const model = ctx.modelRegistry.find(provider, id);
    if (model) return model;
  }
  return undefined;
}

function modelFamilyRank(id: string): number {
  const lower = id.toLowerCase();
  if (lower.includes("mini") || lower.includes("small")) return 2;
  if (lower.includes("gpt-5.5") || lower.includes("opus") || lower.includes("pro"))
    return 5;
  if (lower.includes("gpt-5.4") || lower.includes("sonnet") || lower.includes("medium"))
    return 4;
  return 3;
}

function findBestConfiguredFallbackModel(
  ctx: ExtensionContext,
  config: TokenomyConfig,
): Model<Api> | undefined {
  const allSpecs = [
    ...config.models.classifier,
    ...config.models.simple,
    ...config.models.medium,
    ...config.models.complex,
  ];
  const candidates = allSpecs
    .map((spec, index) => {
      const model = findFirstModel(ctx, [spec], config.provider);
      return model ? { model, index } : undefined;
    })
    .filter((item): item is { model: Model<Api>; index: number } => !!item)
    .sort((a, b) => {
      const rankDiff = modelFamilyRank(a.model.id) - modelFamilyRank(b.model.id);
      return rankDiff !== 0 ? rankDiff : a.index - b.index;
    });
  return candidates[0]?.model;
}

function findStartupModel(
  ctx: ExtensionContext,
  config: TokenomyConfig,
): Model<Api> | undefined {
  return (
    findFirstModel(ctx, config.models.complex, config.provider) ??
    findFirstModel(ctx, config.models.medium, config.provider) ??
    findBestConfiguredFallbackModel(ctx, config)
  );
}

function modelLabel(model: Model<Api> | undefined): string | undefined {
  return model ? `${model.provider}/${model.id}` : undefined;
}

function getText(message: { content?: unknown }): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isObject(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function buildClassifierPrompt(
  prompt: string,
  contextTokens: number | undefined,
  analysis: LocalAnalysis,
  config: TokenomyConfig,
): {
  text: string;
  simplified: boolean;
  compressed: boolean;
  telemetry: ClassifierPromptTelemetry;
} {
  const classifierPrompt = simplifyPromptForClassifier(prompt, config);
  const text = [
    "You are a token-economy router for a coding agent.",
    "Goal: minimize TOTAL token usage while preserving high-quality output.",
    "Prefer the cheapest tier that can solve correctly. Use complex only when a cheaper tier is likely to cause retries, excessive tool loops, or bad edits.",
    'Return ONLY minified JSON: {"tier":"simple|medium|complex","confidence":0.0-1.0,"reason":"max 8 words"}',
    "",
    `Local heuristic tier: ${analysis.tier}`,
    `Local intent: ${analysis.intent}`,
    `Local risk: ${analysis.risk}`,
    `Local score: ${analysis.score}`,
    `Local signals: ${analysis.signals.join(",") || "none"}`,
    `Current context tokens: ${contextTokens ?? "unknown"}`,
    `Prompt chars: ${prompt.length}`,
    `Prompt simplified: ${classifierPrompt.simplified ? "yes" : "no"}`,
    `Prompt compressed: ${classifierPrompt.compressed ? `yes/${classifierPrompt.tokensSaved} tokens` : "no"}`,
    "",
    "User prompt:",
    classifierPrompt.text,
  ].join("\n");
  return {
    text,
    simplified: classifierPrompt.simplified,
    compressed: classifierPrompt.compressed,
    telemetry: classifierPrompt.telemetry,
  };
}

function parseClassifierResponse(
  text: string,
): ClassifierResult | undefined {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text.trim();
  try {
    const parsed = JSON.parse(jsonText) as {
      tier?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };
    if (
      parsed.tier !== "simple" &&
      parsed.tier !== "medium" &&
      parsed.tier !== "complex"
    )
      return undefined;
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    return {
      tier: parsed.tier,
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason : "classifier",
    };
  } catch {
    const lower = text.toLowerCase();
    const tier = lower.includes("complex")
      ? "complex"
      : lower.includes("medium")
        ? "medium"
        : lower.includes("simple")
          ? "simple"
          : undefined;
    return tier
      ? { tier, confidence: 0.5, reason: "text fallback" }
      : undefined;
  }
}

async function classifyWithCheapModel(
  prompt: string,
  contextTokens: number | undefined,
  analysis: LocalAnalysis,
  config: TokenomyConfig,
  ctx: ExtensionContext,
): Promise<
  | {
      result: ClassifierResult | undefined;
      promptTelemetry: ClassifierPromptTelemetry;
    }
  | undefined
> {
  const classifier = findFirstModel(
    ctx,
    config.models.classifier,
    config.provider,
  );
  if (!classifier) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(classifier);
  if (!auth.ok || !auth.apiKey) return undefined;
  const classifierPrompt = buildClassifierPrompt(
    prompt,
    contextTokens,
    analysis,
    config,
  );

  const response = await complete(
    classifier,
    {
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: classifierPrompt.text,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      reasoningEffort: "minimal",
      maxTokens: 80,
      temperature: 0,
      signal: ctx.signal,
    },
  );

  const text = response.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
  return {
    result: parseClassifierResponse(text),
    promptTelemetry: classifierPrompt.telemetry,
  };
}

function riskAtLeast(risk: RiskLevel, minimum: RiskLevel): boolean {
  const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[risk] >= rank[minimum];
}

function fallbackTierFor(
  analysis: LocalAnalysis,
  config: TokenomyConfig,
  stats: TokenomyStats,
): Tier {
  if (!config.adaptive.enabled) return "simple";
  // Low-risk uncertainty stays cheap; risky uncertainty moves up because a bad
  // cheap attempt can cost more total tokens through retries and corrections.
  if (config.adaptive.complexFallbackIntents.includes(analysis.intent)) {
    return "complex";
  }
  if (riskAtLeast(analysis.risk, config.adaptive.mediumFallbackMinRisk)) {
    return "medium";
  }
  const history = stats.intents[analysis.intent];
  if (history && history.fallbackPrompts >= 2 && analysis.risk !== "low") {
    return "medium";
  }
  return "simple";
}

function findFallbackModelForTier(
  ctx: ExtensionContext,
  config: TokenomyConfig,
  tier: Tier,
): Model<Api> | undefined {
  if (tier === "simple") return findBestConfiguredFallbackModel(ctx, config);
  return (
    findFirstModel(ctx, config.models[tier], config.provider) ??
    findBestConfiguredFallbackModel(ctx, config)
  );
}

function updateIntentStats(
  stats: TokenomyStats,
  analysis: LocalAnalysis,
  decision: RouterDecision,
): void {
  const current = stats.intents[analysis.intent] ?? {
    routedPrompts: 0,
    fallbackPrompts: 0,
    complexPrompts: 0,
    cacheHits: 0,
  };
  current.routedPrompts += 1;
  if (decision.source === "fallback") current.fallbackPrompts += 1;
  if (decision.tier === "complex") current.complexPrompts += 1;
  if (decision.source === "classifier-cache") current.cacheHits += 1;
  stats.intents[analysis.intent] = current;
}

function recordRoutingHistory(
  cwd: string,
  prompt: string,
  contextTokens: number | undefined,
  imageCount: number,
  analysis: LocalAnalysis,
  decision: RouterDecision,
  promptSavings: number,
  sessionEstimatedTokensSaved: number,
  classifierPromptTelemetry: ClassifierPromptTelemetry | undefined,
  memoryInjection: MemoryInjection | undefined,
  config: TokenomyConfig,
): void {
  if (!config.telemetry.enabled) return;
  const history = loadRoutingHistory(cwd);
  const entry: RoutingHistoryEntry = {
    id: hashText(`${Date.now()}\n${normalizedPrompt(prompt)}\n${decision.tier}`),
    at: new Date().toISOString(),
    promptHash: hashText(normalizedPrompt(prompt)),
    promptChars: prompt.length,
    contextBucket: contextBucket(contextTokens),
    imageCount,
    intent: analysis.intent,
    risk: analysis.risk,
    toolProfile: analysis.toolProfile,
    tier: decision.tier,
    source: decision.source,
    confidence: decision.confidence,
    model: decision.model,
    thinking: decision.thinking,
    signals: analysis.signals.slice(0, 12),
    estimatedClassifierTokens: analysis.estimatedClassifierTokens,
    estimatedTokensSaved: promptSavings,
    sessionEstimatedTokensSaved,
    promptSimplificationEnabled: config.promptSimplification.enabled,
    promptCompressionEnabled: config.promptSimplification.compressionEnabled,
    classifierPromptCompressed: classifierPromptTelemetry?.accepted,
    classifierPromptCompressionGuarded: classifierPromptTelemetry?.guarded,
    classifierPromptCompressionGuardMissingLines:
      classifierPromptTelemetry?.guardMissingLines,
    classifierPromptCompressionTokensSaved:
      classifierPromptTelemetry?.tokensSaved,
    memoryInjected: !!memoryInjection,
    memoryInjectedChars: memoryInjection?.chars,
    memoryReason: memoryInjection?.reason,
    memoryFactsUsed: memoryInjection?.factsUsed,
    memoryEstimatedTokensSaved: memoryInjection?.estimatedTokensSaved,
  };
  saveRoutingHistory(cwd, { entries: [entry, ...history.entries] }, config);
}

function shouldUseProjectDigest(
  digest: ProjectDigest | undefined,
  analysis: LocalAnalysis,
  contextTokens: number | undefined,
  config: TokenomyConfig,
): boolean {
  if (!config.distillation.enabled || !digest) return false;
  if ((contextTokens ?? 0) >= config.distillation.minContextTokens) return true;
  return (
    (digest.intentCounts[analysis.intent] ?? 0) >=
    config.distillation.repeatPromptThreshold
  );
}

function factIsStale(fact: ProjectMemoryFact, config: TokenomyConfig): boolean {
  const staleMs = config.memory.staleAfterDays * 24 * 60 * 60 * 1000;
  return Date.now() - Date.parse(fact.updatedAt) > staleMs;
}

function factRelevance(fact: ProjectMemoryFact, analysis: LocalAnalysis): number {
  if (analysis.intent === "shell_simple") return 0;
  if (analysis.intent === "release" && fact.kind === "workflow") return 4;
  if (analysis.intent === "debug" && fact.kind === "command") return 3;
  if (
    (analysis.intent === "single_edit" ||
      analysis.intent === "multi_edit" ||
      analysis.intent === "architecture") &&
    fact.kind === "file"
  )
    return 3;
  if (fact.kind === "package" || fact.kind === "project") return 2;
  if (analysis.toolProfile !== "none" && fact.kind === "command") return 2;
  return 1;
}

function shouldInjectMemory(
  memory: ProjectMemory | undefined,
  prompt: string,
  analysis: LocalAnalysis,
  contextTokens: number | undefined,
  config: TokenomyConfig,
): boolean {
  if (!config.memory.enabled || !config.memory.inject || !memory?.facts.length)
    return false;
  if (analysis.intent === "shell_simple") return false;
  if ((contextTokens ?? 0) >= config.memory.minContextTokensForInjection)
    return true;
  if (
    analysis.intent === "release" ||
    analysis.intent === "debug" ||
    analysis.intent === "multi_edit" ||
    analysis.intent === "single_edit"
  )
    return true;
  if (prompt.trim().length < 160 && analysis.toolProfile !== "none") return true;
  return false;
}

function buildMemoryInjection(
  memory: ProjectMemory | undefined,
  prompt: string,
  analysis: LocalAnalysis,
  contextTokens: number | undefined,
  config: TokenomyConfig,
): MemoryInjection | undefined {
  if (!shouldInjectMemory(memory, prompt, analysis, contextTokens, config)) {
    return undefined;
  }
  const facts = memory!.facts
    .filter((fact) => !factIsStale(fact, config))
    .map((fact) => ({ fact, score: factRelevance(fact, analysis) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.fact.updatedAt.localeCompare(a.fact.updatedAt))
    .map(({ fact }) => fact);
  if (!facts.length) return undefined;

  const reason =
    analysis.intent === "release"
      ? "release-workflow"
      : analysis.intent === "debug"
        ? "debug-commands"
        : (contextTokens ?? 0) >= config.memory.minContextTokensForInjection
          ? "large-context"
          : "project-context";
  const lines = [
    "Tokenomy project memory is advisory. The current user prompt overrides it.",
    "Use this memory only when relevant to avoid repeated discovery and unnecessary tool calls.",
    `Project: ${memory!.project}`,
    "Facts:",
  ];
  for (const fact of facts) {
    const next = `- ${fact.text}`;
    if (lines.join("\n").length + next.length + 1 > config.memory.maxInjectedChars)
      break;
    lines.push(next);
  }
  if (lines.length <= 4) return undefined;
  const text = lines.join("\n");
  return {
    text,
    reason,
    factsUsed: lines.length - 4,
    chars: text.length,
    estimatedTokensSaved: Math.max(20, (lines.length - 4) * 25),
  };
}

function markMemoryFactsUsed(
  cwd: string,
  memory: ProjectMemory | undefined,
  injection: MemoryInjection | undefined,
): void {
  if (!memory || !injection) return;
  const now = new Date().toISOString();
  const usedTexts = new Set(
    injection.text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2)),
  );
  const next: ProjectMemory = {
    ...memory,
    updatedAt: now,
    facts: memory.facts.map((fact) =>
      usedTexts.has(fact.text)
        ? { ...fact, lastUsedAt: now, uses: fact.uses + 1 }
        : fact,
    ),
  };
  saveProjectMemory(cwd, next);
}

function buildProjectDigestPrompt(
  digest: ProjectDigest,
  config: TokenomyConfig,
): string {
  // Keep the digest metadata-only. It compresses routing history without
  // persisting or reinjecting raw prompts, model responses, or file contents.
  const lines = [
    "Tokenomy compact project digest is active.",
    `Project: ${digest.project}`,
    `Prompts seen: ${digest.promptsSeen}`,
    `Intent counts: ${Object.entries(digest.intentCounts)
      .map(([intent, count]) => `${intent}:${count}`)
      .join(", ") || "none"}`,
    `Last route: ${digest.lastIntent ?? "unknown"} -> ${digest.lastTier ?? "unknown"} (${digest.lastModel ?? "unknown"})`,
    `Last signals: ${digest.lastSignals?.join(", ") || "none"}`,
    "Use this digest to avoid repeated broad context restatement; verify with tools only when needed.",
  ];
  return lines.join("\n").slice(0, config.distillation.maxDigestChars);
}

function shouldUseClassifier(
  analysis: LocalAnalysis,
  prompt: string,
  config: TokenomyConfig,
): boolean {
  if (!config.classifier.enabled) return false;
  if (analysis.confidence >= config.classifier.minConfidence) return false;
  if (config.classifier.onlyWhenAmbiguous && !analysis.ambiguous) return false;
  if (
    analysis.estimatedClassifierTokens >
    config.classifier.maxEstimatedClassifierTokens
  )
    return false;
  if (prompt.trim().length < 120) return false;
  return true;
}

function targetToolsFor(
  profile: ToolProfile,
  config: TokenomyConfig,
): string[] {
  if (profile === "none") return [];
  if (profile === "read") return config.tools.readOnlyTools;
  return config.tools.writeTools;
}

function applyToolPolicy(
  profile: ToolProfile,
  config: TokenomyConfig,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): void {
  if (!config.enabled || !config.tools.manage) return;
  if (config.debug.dryRun) {
    if (config.ui.notifyDecisions && ctx.hasUI) {
      ctx.ui.notify(`Tokenomy dry-run: would set tools:${profile}`, "info");
    }
    return;
  }

  const allTools = new Set(pi.getAllTools().map((tool) => tool.name));
  const active = pi.getActiveTools();
  const customTools = config.tools.preserveCustomTools
    ? active.filter((name) => !BUILTIN_TOOL_NAMES.has(name))
    : [];
  const target = targetToolsFor(profile, config).filter((name) =>
    allTools.has(name),
  );
  const next = [...new Set([...target, ...customTools])];

  if (
    active.length === next.length &&
    active.every((name) => next.includes(name))
  )
    return;
  pi.setActiveTools(next);

  if (config.ui.status && ctx.hasUI) {
    ctx.ui.setStatus("tokenomy-tools", `tools:${profile}`);
  }
}

function buildTokenDiscipline(
  decision: RouterDecision,
  contextTokens: number | undefined,
  config: TokenomyConfig,
  savedTokens?: number,
): string {
  if (!config.promptDiscipline.enabled) return "";

  const common = [
    `Tokenomy token discipline is active${savedTokens === undefined ? "." : `; estimated saved tokens so far: ${savedTokens}.`}`,
    "Optimize for the fewest total tokens that still produce a high-quality result.",
    "Avoid verbose preambles, repeated summaries, and unnecessary tool calls.",
    "When tools are needed, batch related inspection and read only targeted files/sections.",
  ];

  if (decision.tier === "simple") {
    common.push(
      `Answer directly. Prefer at most ${config.promptDiscipline.maxAnswerBulletsSimple} bullets unless more are necessary for correctness.`,
    );
  }
  if (decision.tier === "complex") {
    common.push(
      "Do not under-solve: spend enough reasoning to avoid retries, but keep visible output concise.",
    );
  }
  if ((contextTokens ?? 0) >= config.thresholds.largeContextTokens) {
    common.push(
      "Context is large: rely on the most relevant recent facts and avoid re-reading broad context unless necessary.",
    );
  }
  if (config.promptSimplification.enabled) {
    common.push(
      "When command output is long, locally condense it before reasoning: preserve errors, failed tests, file paths, counts, and the first/last relevant lines; avoid repeating full logs unless requested.",
    );
  }

  return common.join("\n");
}

function formatRoutingHistoryEntry(entry: RoutingHistoryEntry): string {
  const confidence =
    entry.confidence === undefined
      ? "n/a"
      : `${Math.round(entry.confidence * 100)}%`;
  const compression = entry.promptCompressionEnabled ? "compression:on" : "compression:off";
  const guard =
    entry.classifierPromptCompressionGuarded === true
      ? `guard:rejected/${entry.classifierPromptCompressionGuardMissingLines ?? 0}`
      : entry.classifierPromptCompressed === true
        ? `compressed:${entry.classifierPromptCompressionTokensSaved ?? 0}`
        : entry.classifierPromptCompressed === false
          ? "compressed:no"
          : "classifier-prompt:n/a";
  const memory = entry.memoryInjected
    ? `memory:${entry.memoryReason ?? "injected"} facts:${entry.memoryFactsUsed ?? 0} chars:${entry.memoryInjectedChars ?? 0}`
    : "memory:no";
  return [
    entry.at,
    `${entry.tier}/${entry.source}`,
    entry.model ?? "model:unknown",
    `thinking:${entry.thinking}`,
    `intent:${entry.intent}`,
    `risk:${entry.risk}`,
    `confidence:${confidence}`,
    `ctx:${entry.contextBucket}`,
    `saved:${entry.estimatedTokensSaved}`,
    `prompt:${entry.promptHash}`,
    compression,
    guard,
    memory,
  ].join(" | ");
}

function formatTokenomyFooter(
  enabled: boolean,
  decision: RouterDecision | undefined,
  sessionSaved: number,
  stats: TokenomyStats,
): string {
  if (!enabled) {
    return `Tokenomy off saved:${sessionSaved} lifetime:${stats.lifetimeEstimatedTokensSaved}`;
  }
  if (!decision) {
    return `Tokenomy on saved:${sessionSaved} lifetime:${stats.lifetimeEstimatedTokensSaved}`;
  }
  const confidence =
    decision.confidence === undefined
      ? ""
      : `/${Math.round(decision.confidence * 100)}%`;
  return `Tokenomy ${decision.tier}:${decision.source}${confidence} saved:${sessionSaved} lifetime:${stats.lifetimeEstimatedTokensSaved}`;
}

function refreshTokenomyFooter(
  ctx: ExtensionContext,
  config: TokenomyConfig,
  decision: RouterDecision | undefined,
  sessionSaved: number,
  stats: TokenomyStats,
): void {
  if (!config.ui.status || !ctx.hasUI) return;
  ctx.ui.setStatus(
    "tokenomy",
    formatTokenomyFooter(config.enabled, decision, sessionSaved, stats),
  );
}

function memorySummary(memory: ProjectMemory | undefined, config: TokenomyConfig): string {
  const facts = memory?.facts ?? [];
  const stale = facts.filter((fact) => factIsStale(fact, config)).length;
  return `Memory: ${config.memory.enabled ? "enabled" : "disabled"}, inject:${config.memory.inject ? "on" : "off"}, facts:${facts.length}, stale:${stale}`;
}

function formatMemoryFact(fact: ProjectMemoryFact): string {
  return `${fact.id} | ${fact.kind}/${fact.source}/${fact.confidence} | uses:${fact.uses} | ${fact.text}`;
}

export default function tokenomy(pi: ExtensionAPI) {
  let config = DEFAULT_CONFIG;
  let lastDecision: RouterDecision | undefined;
  let configWarnings: string[] = [];
  let baselineModel: string | undefined;
  let estimatedTokensSaved = 0;
  let stats: TokenomyStats = emptyStats();
  let statsWarning: string | undefined;
  let statsSessionRecorded = false;

  pi.registerFlag("tokenomy-off", {
    description: "Disable the Tokenomy token-saving router for this run",
    type: "boolean",
    default: false,
  });

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadConfig(ctx.cwd);
    config = loaded.config;
    configWarnings = loaded.warnings;
    if (pi.getFlag("tokenomy-off")) config = { ...config, enabled: false };
    baselineModel = modelLabel(ctx.model);
    statsWarning = undefined;
    try {
      stats = loadStats(ctx.cwd);
      statsSessionRecorded = false;
    } catch (error) {
      stats = emptyStats();
      statsSessionRecorded = false;
      statsWarning = `failed to load Tokenomy stats: ${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      updateProjectMemory(ctx.cwd, undefined, undefined, config);
    } catch (error) {
      statsWarning = `failed to load Tokenomy memory: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (config.enabled) {
      const startupModel = findStartupModel(ctx, config);
      if (startupModel && !config.debug.dryRun) {
        await pi.setModel(startupModel);
        baselineModel = modelLabel(startupModel);
      }
    }
    estimatedTokensSaved = 0;
    refreshTokenomyFooter(ctx, config, lastDecision, estimatedTokensSaved, stats);
    if (configWarnings.length && ctx.hasUI) {
      ctx.ui.notify(`Tokenomy config warnings:\n- ${configWarnings.join("\n- ")}`, "warning");
    }
    if (statsWarning && ctx.hasUI) {
      ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
    }
  });

  pi.on("input", (event, ctx) => {
    if (!config.enabled || event.source === "extension")
      return { action: "continue" as const };
    const usage = ctx.getContextUsage();
    const imageCount = event.images?.length ?? 0;
    const analysis = analyzePrompt(
      event.text,
      usage?.tokens,
      imageCount,
      config,
    );
    applyToolPolicy(analysis.toolProfile, config, pi, ctx);
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!config.enabled) return;

    const usage = ctx.getContextUsage();
    const contextTokens = usage?.tokens;
    const imageCount = event.images?.length ?? 0;
    const analysis = analyzePrompt(
      event.prompt,
      contextTokens,
      imageCount,
      config,
    );
    let tier = analysis.tier;
    let source: RouterDecision["source"] = "local";
    let reason = analysis.signals.join(",") || "local heuristic";
    let confidence: number | undefined;
    let classifierPromptTelemetry: ClassifierPromptTelemetry | undefined;
    const heuristicUncertain =
      analysis.confidence < config.classifier.minConfidence;
    const classifierKey = classifierCacheKey(
      event.prompt,
      contextTokens,
      analysis,
      config,
    );

    if (shouldUseClassifier(analysis, event.prompt, config)) {
      try {
        const cached = getClassifierCacheEntry(ctx.cwd, classifierKey, config);
        const liveClassification = cached
          ? undefined
          : await classifyWithCheapModel(
            event.prompt,
            contextTokens,
            analysis,
            config,
            ctx,
          );
        classifierPromptTelemetry = liveClassification?.promptTelemetry;
        const classified = cached ?? liveClassification?.result;
        if (!cached && classified) {
          putClassifierCacheEntry(
            ctx.cwd,
            classifierKey,
            classified,
            contextTokens,
            analysis,
            config,
          );
        }
        if (
          classified &&
          classified.confidence >= config.classifier.minConfidence
        ) {
          tier = classified.tier;
          source = cached ? "classifier-cache" : "classifier";
          reason = cached ? `cached ${classified.reason}` : classified.reason;
          confidence = classified.confidence;
          if (cached) stats.classifierCacheHits += 1;
        } else {
          source = "fallback";
          reason = classified
            ? `classifier confidence ${Math.round(classified.confidence * 100)}% below ${Math.round(config.classifier.minConfidence * 100)}%`
            : "classifier unavailable";
          confidence = classified?.confidence;
        }
      } catch (error) {
        source = "fallback";
        reason = `classifier failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else if (heuristicUncertain) {
      source = "fallback";
      reason = `heuristic confidence ${Math.round(analysis.confidence * 100)}% below ${Math.round(config.classifier.minConfidence * 100)}%`;
      confidence = analysis.confidence;
    }

    let target: Model<Api> | undefined;
    if (source === "fallback") {
      const fallbackTier = fallbackTierFor(analysis, config, stats);
      if (fallbackTier !== "simple") stats.adaptiveFallbacks += 1;
      tier = fallbackTier;
      target = findFallbackModelForTier(ctx, config, fallbackTier);
      reason =
        fallbackTier === "simple"
          ? reason
          : `${reason}; adaptive ${analysis.risk}-risk fallback to ${fallbackTier}`;
    } else {
      target = findFirstModel(ctx, config.models[tier], config.provider);
    }
    if (!target) {
      target = findBestConfiguredFallbackModel(ctx, config);
      if (target) {
        source = "fallback";
        reason = `configured ${tier} model unavailable; fallback to ${target.id}`;
        tier = "simple";
      }
    }
    const thinking = config.thinking[tier];
    if (config.debug.dryRun) {
      source = "fallback";
      reason = `dry-run: would select ${target ? modelLabel(target) ?? target.id : "none"}`;
    }
    const decisionConfidence = confidence ?? analysis.confidence;
    const decision: RouterDecision = {
      tier,
      source,
      toolProfile: analysis.toolProfile,
      intent: analysis.intent,
      risk: analysis.risk,
      reason,
      confidence: decisionConfidence,
      signals: analysis.signals,
      model: modelLabel(target),
      thinking,
    };

    if (target && !config.debug.dryRun) {
      const alreadySelected =
        ctx.model?.provider === target.provider && ctx.model?.id === target.id;
      if (!alreadySelected) {
        const ok = await pi.setModel(target);
        if (!ok && ctx.hasUI) {
          ctx.ui.notify(
            `Tokenomy: no auth for ${target.provider}/${target.id}`,
            "warning",
          );
        }
      }
    } else if (!target && ctx.hasUI) {
      ctx.ui.notify(
        `Tokenomy: no configured model found for ${tier}`,
        "warning",
      );
    }

    if (!config.debug.dryRun) pi.setThinkingLevel(thinking);
    lastDecision = decision;

    const baselineScore = baselineModel
      ? modelFamilyRank(baselineModel.split("/").pop() ?? baselineModel)
      : 0;
    const targetScore = target ? modelFamilyRank(target.id) : baselineScore;
    const promptSavings =
      Math.max(0, baselineScore - targetScore) *
      Math.ceil((contextTokens ?? event.prompt.length) / 4000) *
      50;
    estimatedTokensSaved += promptSavings;
    const memory = safeLoadProjectMemory(ctx.cwd);
    const memoryInjection = buildMemoryInjection(
      memory,
      event.prompt,
      analysis,
      contextTokens,
      config,
    );
    const digest = safeLoadProjectDigest(ctx.cwd);
    const digestPrompt = shouldUseProjectDigest(
      digest,
      analysis,
      contextTokens,
      config,
    )
      ? buildProjectDigestPrompt(digest!, config)
      : "";
    if (!config.debug.dryRun) {
      if (!statsSessionRecorded) {
        stats.sessionsStarted += 1;
        statsSessionRecorded = true;
      }
      stats.lifetimeEstimatedTokensSaved += promptSavings;
      stats.routedPrompts += 1;
      if (digestPrompt) stats.projectDigestUses += 1;
      if (memoryInjection) {
        stats.memoryInjections += 1;
      }
      if (classifierPromptTelemetry?.guarded) {
        stats.compressionGuardRejections += 1;
      }
      updateIntentStats(stats, analysis, decision);
      try {
        saveStats(ctx.cwd, stats);
        recordRoutingHistory(
          ctx.cwd,
          event.prompt,
          contextTokens,
          imageCount,
          analysis,
          decision,
          promptSavings,
          estimatedTokensSaved,
          classifierPromptTelemetry,
          memoryInjection,
          config,
        );
        markMemoryFactsUsed(ctx.cwd, memory, memoryInjection);
        statsWarning = undefined;
      } catch (error) {
        statsWarning = `failed to save Tokenomy stats/history: ${error instanceof Error ? error.message : String(error)}`;
        if (ctx.hasUI) {
          ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
        }
      }
    }
    refreshTokenomyFooter(ctx, config, decision, estimatedTokensSaved, stats);
    if (config.ui.notifyDecisions && ctx.hasUI) {
      ctx.ui.notify(
        `Tokenomy: ${tier} via ${source} -> ${decision.model ?? "current model"}, thinking:${thinking}`,
        "info",
      );
    }

    if (!config.debug.dryRun) {
      try {
        updateProjectDigest(ctx.cwd, analysis, decision, config);
        updateProjectMemory(ctx.cwd, analysis, decision, config);
      } catch (error) {
        statsWarning = `failed to save Tokenomy project metadata: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const discipline = buildTokenDiscipline(
      decision,
      contextTokens,
      config,
      estimatedTokensSaved,
    );
    const additions = [digestPrompt, memoryInjection?.text, discipline].filter(Boolean);
    if (!additions.length) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}`,
    };
  });

  pi.registerCommand("tokenomy", {
    description:
      "Show or change Tokenomy token-router status: /tokenomy [on|off|reload|status|explain|history|memory|export-history|reset-history|reset-stats|dry-run on|dry-run off]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "on") {
        config.enabled = true;
        refreshTokenomyFooter(ctx, config, lastDecision, estimatedTokensSaved, stats);
        ctx.ui.notify("Tokenomy enabled", "info");
        return;
      }
      if (action === "off") {
        config.enabled = false;
        refreshTokenomyFooter(ctx, config, lastDecision, estimatedTokensSaved, stats);
        ctx.ui.notify("Tokenomy disabled", "info");
        return;
      }
      if (action === "dry-run on") {
        config.debug.dryRun = true;
        ctx.ui.notify("Tokenomy dry-run enabled", "info");
        return;
      }
      if (action === "dry-run off") {
        config.debug.dryRun = false;
        ctx.ui.notify("Tokenomy dry-run disabled", "info");
        return;
      }
      if (action === "dry-run") {
        ctx.ui.notify(
          `Tokenomy dry-run: ${config.debug.dryRun ? "enabled" : "disabled"}`,
          "info",
        );
        return;
      }
      if (action === "reset-stats") {
        stats = emptyStats();
        statsSessionRecorded = false;
        estimatedTokensSaved = 0;
        try {
          saveStats(ctx.cwd, stats);
          statsWarning = undefined;
          ctx.ui.notify("Tokenomy stats reset", "info");
        } catch (error) {
          statsWarning = `failed to reset Tokenomy stats: ${error instanceof Error ? error.message : String(error)}`;
          ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
        }
        return;
      }
      if (action === "history") {
        try {
          const history = loadRoutingHistory(ctx.cwd);
          if (!history.entries.length) {
            ctx.ui.notify("Tokenomy routing history is empty", "info");
            return;
          }
          const lines = [
            `Tokenomy routing history (${history.entries.length} entries, newest first):`,
            ...history.entries.slice(0, 10).map(formatRoutingHistoryEntry),
          ];
          ctx.ui.notify(lines.join("\n"), "info");
        } catch (error) {
          ctx.ui.notify(
            `Tokenomy history warning: failed to load routing history: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
        return;
      }
      if (action === "export-history") {
        ctx.ui.notify(
          `Tokenomy routing history file: ${routingHistoryPath(ctx.cwd)}`,
          "info",
        );
        return;
      }
      if (action === "reset-history") {
        try {
          saveRoutingHistory(ctx.cwd, { entries: [] }, config);
          ctx.ui.notify("Tokenomy routing history reset", "info");
        } catch (error) {
          ctx.ui.notify(
            `Tokenomy history warning: failed to reset routing history: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
        return;
      }
      if (action === "memory" || action === "memory status") {
        const memory = safeLoadProjectMemory(ctx.cwd);
        ctx.ui.notify(
          [
            memorySummary(memory, config),
            `Memory file: ${projectMemoryPath(ctx.cwd)}`,
          ].join("\n"),
          "info",
        );
        return;
      }
      if (action === "memory show") {
        const memory = safeLoadProjectMemory(ctx.cwd);
        const facts = memory?.facts ?? [];
        ctx.ui.notify(
          facts.length
            ? [
                memorySummary(memory, config),
                ...facts.slice(0, 30).map(formatMemoryFact),
              ].join("\n")
            : "Tokenomy project memory is empty",
          "info",
        );
        return;
      }
      if (action === "memory refresh") {
        try {
          const memory = updateProjectMemory(ctx.cwd, undefined, undefined, config);
          ctx.ui.notify(memorySummary(memory, config), "info");
        } catch (error) {
          ctx.ui.notify(
            `Tokenomy memory warning: failed to refresh project memory: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
        return;
      }
      if (action === "memory clear") {
        try {
          saveProjectMemory(ctx.cwd, {
            version: 1,
            project: basename(ctx.cwd),
            updatedAt: new Date().toISOString(),
            facts: [],
          });
          ctx.ui.notify("Tokenomy project memory cleared", "info");
        } catch (error) {
          ctx.ui.notify(
            `Tokenomy memory warning: failed to clear project memory: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
        }
        return;
      }
      if (action === "memory on") {
        config.memory.enabled = true;
        config.memory.inject = true;
        ctx.ui.notify("Tokenomy project memory enabled", "info");
        return;
      }
      if (action === "memory off") {
        config.memory.enabled = false;
        ctx.ui.notify("Tokenomy project memory disabled", "info");
        return;
      }
      if (action === "explain") {
        if (!lastDecision) {
          ctx.ui.notify("Tokenomy has not made a routing decision yet", "info");
          return;
        }
        const lines = [
          `Tier: ${lastDecision.tier}`,
          `Source: ${lastDecision.source}`,
          `Model: ${lastDecision.model ?? "none"}`,
          `Thinking: ${lastDecision.thinking}`,
          `Intent: ${lastDecision.intent}`,
          `Risk: ${lastDecision.risk}`,
          `Tool profile: ${lastDecision.toolProfile}`,
          `Confidence: ${lastDecision.confidence === undefined ? "n/a" : `${Math.round(lastDecision.confidence * 100)}%`}`,
          `Reason: ${lastDecision.reason}`,
          `Signals: ${lastDecision.signals.join(", ") || "none"}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (action === "reload") {
        const loaded = loadConfig(ctx.cwd);
        config = loaded.config;
        configWarnings = loaded.warnings;
        refreshTokenomyFooter(ctx, config, lastDecision, estimatedTokensSaved, stats);
        ctx.ui.notify(
          configWarnings.length
            ? `Tokenomy config reloaded with warnings:\n- ${configWarnings.join("\n- ")}`
            : "Tokenomy config reloaded",
          configWarnings.length ? "warning" : "info",
        );
        return;
      }

      const lines = [
        `Tokenomy: ${config.enabled ? "enabled" : "disabled"}`,
        `Version: ${packageVersion()}`,
        `Provider: ${config.provider}`,
        `Classifier: ${config.classifier.enabled ? "enabled" : "disabled"} (${config.classifier.onlyWhenAmbiguous ? "ambiguous only" : "all eligible"})`,
        `Telemetry: ${config.telemetry.enabled ? "enabled" : "disabled"} (${config.telemetry.maxEntries} max entries)`,
        memorySummary(safeLoadProjectMemory(ctx.cwd), config),
        `Prompt simplification: ${config.promptSimplification.enabled ? "enabled" : "disabled"}`,
        `Prompt compression: ${config.promptSimplification.compressionEnabled ? "enabled" : "disabled"}`,
        `Tool management: ${config.tools.manage ? "enabled" : "disabled"}`,
        `Last decision: ${lastDecision ? `${lastDecision.tier} via ${lastDecision.source}, model=${lastDecision.model ?? "none"}, thinking=${lastDecision.thinking}, reason=${lastDecision.reason}` : "none"}`,
        `Estimated tokens saved this session: ${estimatedTokensSaved}`,
        `Estimated tokens saved lifetime: ${stats.lifetimeEstimatedTokensSaved}`,
        `Routed prompts lifetime: ${stats.routedPrompts}`,
        `Tokenomy sessions lifetime: ${stats.sessionsStarted}`,
        `Classifier cache hits lifetime: ${stats.classifierCacheHits}`,
        `Project digest uses lifetime: ${stats.projectDigestUses}`,
        `Memory injections lifetime: ${stats.memoryInjections}`,
        `Adaptive fallbacks lifetime: ${stats.adaptiveFallbacks}`,
        `Compression guard rejections lifetime: ${stats.compressionGuardRejections}`,
        `Baseline model: ${baselineModel ?? "unknown"}`,
        `Cache directory: ${cacheDir(ctx.cwd)}`,
        `Stats file: ${statsPath(ctx.cwd)}`,
        `Routing history file: ${routingHistoryPath(ctx.cwd)}`,
        `Memory file: ${projectMemoryPath(ctx.cwd)}`,
        ...(statsWarning ? [`Stats warning: ${statsWarning}`] : []),
        `Config files: ${join(getAgentDir(), "tokenomy.json")} and ${join(ctx.cwd, CONFIG_DIR_NAME, "tokenomy.json")}`,
      ];
      refreshTokenomyFooter(ctx, config, lastDecision, estimatedTokensSaved, stats);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
