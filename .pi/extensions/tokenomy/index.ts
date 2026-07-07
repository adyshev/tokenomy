import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { complete, type Api, type Model } from "@earendil-works/pi-ai/compat";
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
  adaptiveFallbacks: number;
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
  adaptiveFallbacks: 0,
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
    adaptiveFallbacks: safeInt(parsed.adaptiveFallbacks),
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

function hasAny(lower: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(lower));
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
  if (
    hasAny(lower, [
      /\b(implement|add|change|modify|edit|rewrite|tests?|unit test|integration test|feature|endpoint|api)\b/,
    ])
  ) {
    add(2, "code-change");
  }
  if (hasAny(lower, [/\b(plan|design|investigate|analy[sz]e|review)\b/])) {
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
      /\b(repo|repository|project|codebase|files?|classes?|functions?|where is|inspect|read|grep|search|find|summari[sz]e this (repo|repository|project|codebase))\b/,
    ])
  ) {
    toolProfile = "read";
  }
  if (
    hasAny(lower, [
      /\b(fix|implement|add|change|modify|edit|write|create|delete|remove|refactor|migrate|update|patch|test)\b/,
    ])
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
    (intent === "debug" || intent === "multi_edit" || intent === "single_edit")
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
): string {
  return [
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
    "",
    "User prompt:",
    prompt.slice(0, 4000),
  ].join("\n");
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
): Promise<ClassifierResult | undefined> {
  const classifier = findFirstModel(
    ctx,
    config.models.classifier,
    config.provider,
  );
  if (!classifier) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(classifier);
  if (!auth.ok || !auth.apiKey) return undefined;

  const response = await complete(
    classifier,
    {
      messages: [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: buildClassifierPrompt(prompt, contextTokens, analysis),
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
  return parseClassifierResponse(text);
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

  return common.join("\n");
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
    if (config.enabled) {
      const startupModel = findStartupModel(ctx, config);
      if (startupModel && !config.debug.dryRun) {
        await pi.setModel(startupModel);
        baselineModel = modelLabel(startupModel);
      }
    }
    estimatedTokensSaved = 0;
    if (config.ui.status && ctx.hasUI) {
      ctx.ui.setStatus(
        "tokenomy",
        config.enabled ? "tokenomy:on" : "tokenomy:off",
      );
    }
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
        const classified =
          cached ??
          (await classifyWithCheapModel(
            event.prompt,
            contextTokens,
            analysis,
            config,
            ctx,
          ));
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
    const decision: RouterDecision = {
      tier,
      source,
      toolProfile: analysis.toolProfile,
      intent: analysis.intent,
      risk: analysis.risk,
      reason,
      confidence,
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
      updateIntentStats(stats, analysis, decision);
      try {
        saveStats(ctx.cwd, stats);
        statsWarning = undefined;
      } catch (error) {
        statsWarning = `failed to save Tokenomy stats: ${error instanceof Error ? error.message : String(error)}`;
        if (ctx.hasUI) {
          ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
        }
      }
    }
    if (config.ui.status && ctx.hasUI) {
      const confidenceText =
        confidence === undefined ? "" : `/${Math.round(confidence * 100)}%`;
      ctx.ui.setStatus(
        "tokenomy",
        `${tier}:${source}${confidenceText} saved:${estimatedTokensSaved} lifetime:${stats.lifetimeEstimatedTokensSaved}`,
      );
    }
    if (config.ui.notifyDecisions && ctx.hasUI) {
      ctx.ui.notify(
        `Tokenomy: ${tier} via ${source} -> ${decision.model ?? "current model"}, thinking:${thinking}`,
        "info",
      );
    }

    if (!config.debug.dryRun) {
      try {
        updateProjectDigest(ctx.cwd, analysis, decision, config);
      } catch (error) {
        statsWarning = `failed to save Tokenomy project digest: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    const discipline = buildTokenDiscipline(
      decision,
      contextTokens,
      config,
      estimatedTokensSaved,
    );
    const additions = [digestPrompt, discipline].filter(Boolean);
    if (!additions.length) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}`,
    };
  });

  pi.registerCommand("tokenomy", {
    description:
      "Show or change Tokenomy token-router status: /tokenomy [on|off|reload|status|explain|reset-stats|dry-run on|dry-run off]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "on") {
        config.enabled = true;
        ctx.ui.setStatus("tokenomy", "tokenomy:on");
        ctx.ui.notify("Tokenomy enabled", "info");
        return;
      }
      if (action === "off") {
        config.enabled = false;
        ctx.ui.setStatus("tokenomy", "tokenomy:off");
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
        ctx.ui.setStatus(
          "tokenomy",
          config.enabled ? "tokenomy:on" : "tokenomy:off",
        );
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
        `Tool management: ${config.tools.manage ? "enabled" : "disabled"}`,
        `Last decision: ${lastDecision ? `${lastDecision.tier} via ${lastDecision.source}, model=${lastDecision.model ?? "none"}, thinking=${lastDecision.thinking}, reason=${lastDecision.reason}` : "none"}`,
        `Estimated tokens saved this session: ${estimatedTokensSaved}`,
        `Estimated tokens saved lifetime: ${stats.lifetimeEstimatedTokensSaved}`,
        `Routed prompts lifetime: ${stats.routedPrompts}`,
        `Tokenomy sessions lifetime: ${stats.sessionsStarted}`,
        `Classifier cache hits lifetime: ${stats.classifierCacheHits}`,
        `Project digest uses lifetime: ${stats.projectDigestUses}`,
        `Adaptive fallbacks lifetime: ${stats.adaptiveFallbacks}`,
        `Baseline model: ${baselineModel ?? "unknown"}`,
        `Cache directory: ${cacheDir(ctx.cwd)}`,
        `Stats file: ${statsPath(ctx.cwd)}`,
        ...(statsWarning ? [`Stats warning: ${statsWarning}`] : []),
        `Config files: ${join(getAgentDir(), "tokenomy.json")} and ${join(ctx.cwd, CONFIG_DIR_NAME, "tokenomy.json")}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
