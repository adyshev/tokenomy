import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { complete, type Api, type Model } from "@earendil-works/pi-ai/compat";
import nlp from "compromise/three";
import { compress as shrinkPrompt, countTokens } from "tokenshrink";
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
    rollupRetentionDays: number;
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
  routing: {
    restoreModelAfterPrompt: boolean;
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
    trace: boolean;
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

type PromptShapeKind = "question" | "action" | "mixed";

interface PromptShape {
  kind: PromptShapeKind;
  actionCount: number;
  multiStep: boolean;
  signals: string[];
}

interface PendingModelRestore {
  restoreModel: Model<Api>;
  restoreLabel: string;
  selectedLabel: string;
}

interface DebugTrace {
  enabled: boolean;
  path: string;
  sessionId: string;
  seq: number;
}

interface LocalAnalysis {
  tier: Tier;
  intent: PromptIntent;
  risk: RiskLevel;
  toolProfile: ToolProfile;
  promptShape: PromptShape;
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
  promptShape: PromptShape;
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
  promptShape: PromptShape;
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

interface TelemetryRollupBucket {
  prompts: number;
  estimatedTokensSaved: number;
  baselineCostUnits: number;
  actualCostUnits: number;
  classifierTokens: number;
  memoryEstimatedTokensSaved: number;
  compressionTokensSaved: number;
  compressionGuardRejections: number;
  memoryInjections: number;
  adaptiveFallbacks: number;
  classifierCacheHits: number;
  multiStepPrompts: number;
  tiers: Record<string, number>;
  sources: Record<string, number>;
  intents: Record<string, number>;
  risks: Record<string, number>;
  promptShapes: Record<string, number>;
  actionCounts: Record<string, number>;
  models: Record<string, number>;
}

interface TelemetryRollups {
  version: 1;
  updatedAt: string;
  lifetime: TelemetryRollupBucket;
  daily: Record<string, TelemetryRollupBucket>;
  monthly: Record<string, TelemetryRollupBucket>;
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
    rollupRetentionDays: 400,
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
  routing: {
    restoreModelAfterPrompt: true,
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
    trace: false,
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

function debugSessionId(): string {
  return hashText(`${Date.now()}\n${Math.random()}`).slice(0, 8);
}

function debugTracePath(cwd: string, sessionId: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return join(debugTraceDir(cwd), `session-${stamp}-${sessionId}.jsonl`);
}

function sanitizeForTrace(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForTrace(item, depth + 1, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === "signal") {
        output[key] = "[AbortSignal]";
      } else {
        output[key] = sanitizeForTrace(item, depth + 1, seen);
      }
    }
    return output;
  }
  return String(value);
}

function startDebugTrace(cwd: string): DebugTrace {
  const sessionId = debugSessionId();
  const path = debugTracePath(cwd, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  return { enabled: true, path, sessionId, seq: 0 };
}

function traceEvent(
  trace: DebugTrace | undefined,
  event: string,
  summary: string,
  data: Record<string, unknown> = {},
): void {
  if (!trace?.enabled) return;
  try {
    const entry = {
      v: 1,
      seq: ++trace.seq,
      ts: new Date().toISOString(),
      event,
      summary,
      data: sanitizeForTrace(data),
    };
    appendFileSync(trace.path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Debug tracing must never break routing.
  }
}

function debugWarningMessage(path: string): string {
  return [
    "Tokenomy debug trace is ENABLED.",
    "Raw prompts, model/tool outputs exposed to Tokenomy, classifier prompts/results, memory context, compression data, routing decisions, and internal errors may be recorded locally.",
    `Trace file: ${path}`,
  ].join("\n");
}

function debugSessionSnapshot(
  ctx: ExtensionContext,
  config: TokenomyConfig,
  baselineModel: string | undefined,
  lastDecision: RouterDecision | undefined,
): Record<string, unknown> {
  return {
    version: packageVersion(),
    provider: config.provider,
    baselineModel,
    currentModel: modelLabel(ctx.model),
    cwd: ctx.cwd,
    rawCapture: true,
    warning: "Debug trace contains raw session data.",
    lastDecision,
    config: {
      enabled: config.enabled,
      models: config.models,
      classifier: config.classifier,
      telemetry: config.telemetry,
      memory: config.memory,
      adaptive: config.adaptive,
      routing: config.routing,
      debug: config.debug,
      promptSimplification: config.promptSimplification,
    },
  };
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

function telemetryRollupsPath(cwd: string): string {
  return join(cacheDir(cwd), "telemetry-rollups.json");
}

function debugTraceDir(cwd: string): string {
  return join(cacheDir(cwd), "debug");
}

function projectMemoryPath(cwd: string): string {
  return join(cacheDir(cwd), "project-memory.json");
}

function safeInt(value: unknown): number {
  return typeof value === "number" ? Math.max(0, Math.round(value)) : 0;
}

function loadPromptShape(value: unknown): PromptShape {
  if (!isObject(value)) {
    return { kind: "action", actionCount: 0, multiStep: false, signals: [] };
  }
  const kind =
    value.kind === "question" || value.kind === "action" || value.kind === "mixed"
      ? value.kind
      : "action";
  return {
    kind,
    actionCount: safeInt(value.actionCount),
    multiStep: value.multiStep === true,
    signals: Array.isArray(value.signals)
      ? value.signals.filter(
          (signal): signal is string => typeof signal === "string",
        )
      : [],
  };
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
  stats.updatedAt = new Date().toISOString();
  const path = statsPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
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
          (entry.promptShape === undefined || isObject(entry.promptShape)) &&
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
      .map((entry) => ({
        ...(entry as RoutingHistoryEntry),
        promptShape: loadPromptShape((entry as Record<string, unknown>).promptShape),
      })),
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

function emptyRollupBucket(): TelemetryRollupBucket {
  return {
    prompts: 0,
    estimatedTokensSaved: 0,
    baselineCostUnits: 0,
    actualCostUnits: 0,
    classifierTokens: 0,
    memoryEstimatedTokensSaved: 0,
    compressionTokensSaved: 0,
    compressionGuardRejections: 0,
    memoryInjections: 0,
    adaptiveFallbacks: 0,
    classifierCacheHits: 0,
    multiStepPrompts: 0,
    tiers: {},
    sources: {},
    intents: {},
    risks: {},
    promptShapes: {},
    actionCounts: {},
    models: {},
  };
}

function emptyRollups(): TelemetryRollups {
  return {
    version: 1,
    updatedAt: "",
    lifetime: emptyRollupBucket(),
    daily: {},
    monthly: {},
  };
}

function safeNumberMap(value: unknown): Record<string, number> {
  const output: Record<string, number> = {};
  if (!isObject(value)) return output;
  for (const [key, count] of Object.entries(value)) {
    output[key] = safeInt(count);
  }
  return output;
}

function loadRollupBucket(value: unknown): TelemetryRollupBucket {
  if (!isObject(value)) return emptyRollupBucket();
  return {
    prompts: safeInt(value.prompts),
    estimatedTokensSaved: safeInt(value.estimatedTokensSaved),
    baselineCostUnits: safeInt(value.baselineCostUnits),
    actualCostUnits: safeInt(value.actualCostUnits),
    classifierTokens: safeInt(value.classifierTokens),
    memoryEstimatedTokensSaved: safeInt(value.memoryEstimatedTokensSaved),
    compressionTokensSaved: safeInt(value.compressionTokensSaved),
    compressionGuardRejections: safeInt(value.compressionGuardRejections),
    memoryInjections: safeInt(value.memoryInjections),
    adaptiveFallbacks: safeInt(value.adaptiveFallbacks),
    classifierCacheHits: safeInt(value.classifierCacheHits),
    multiStepPrompts: safeInt(value.multiStepPrompts),
    tiers: safeNumberMap(value.tiers),
    sources: safeNumberMap(value.sources),
    intents: safeNumberMap(value.intents),
    risks: safeNumberMap(value.risks),
    promptShapes: safeNumberMap(value.promptShapes),
    actionCounts: safeNumberMap(value.actionCounts),
    models: safeNumberMap(value.models),
  };
}

function loadRollupBuckets(value: unknown): Record<string, TelemetryRollupBucket> {
  const output: Record<string, TelemetryRollupBucket> = {};
  if (!isObject(value)) return output;
  for (const [key, bucket] of Object.entries(value)) {
    output[key] = loadRollupBucket(bucket);
  }
  return output;
}

function loadTelemetryRollups(cwd: string): TelemetryRollups {
  const parsed = loadJson(telemetryRollupsPath(cwd));
  if (!isObject(parsed)) return emptyRollups();
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    lifetime: loadRollupBucket(parsed.lifetime),
    daily: loadRollupBuckets(parsed.daily),
    monthly: loadRollupBuckets(parsed.monthly),
  };
}

function saveTelemetryRollups(
  cwd: string,
  rollups: TelemetryRollups,
  config: TokenomyConfig,
): void {
  const path = telemetryRollupsPath(cwd);
  const now = new Date();
  const retentionDays =
    typeof config.telemetry.rollupRetentionDays === "number" &&
    config.telemetry.rollupRetentionDays >= 30
      ? config.telemetry.rollupRetentionDays
      : DEFAULT_CONFIG.telemetry.rollupRetentionDays;
  const cutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const daily = Object.fromEntries(
    Object.entries(rollups.daily)
      .filter(([day]) => day >= cutoff)
      .sort(([a], [b]) => b.localeCompare(a)),
  );
  const monthly = Object.fromEntries(
    Object.entries(rollups.monthly).sort(([a], [b]) => b.localeCompare(a)),
  );
  const next: TelemetryRollups = {
    version: 1,
    updatedAt: now.toISOString(),
    lifetime: rollups.lifetime,
    daily,
    monthly,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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
  if (typeof config.routing.restoreModelAfterPrompt !== "boolean") {
    warnings.push("routing.restoreModelAfterPrompt must be a boolean");
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
  if (
    typeof config.telemetry.rollupRetentionDays !== "number" ||
    config.telemetry.rollupRetentionDays < 30
  ) {
    warnings.push("telemetry.rollupRetentionDays must be at least 30");
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
  if (typeof config.debug.trace !== "boolean") {
    warnings.push("debug.trace must be a boolean");
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

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) return line;
  return `${line.slice(0, Math.max(0, maxChars - 24))} ... [truncated line]`;
}

function hasAny(lower: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(lower));
}

function shouldBypassForLanguage(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  const englishInstructionSignals = [
    /\b(please|help|can you|could you|would you|do|run|perform|review|audit|scan|inspect|refactor|fix|debug|explain|summari[sz]e|translate|keep|preserve|change|update|implement|read|check)\b/,
    /\b(this|the)\s+(text|comment|string|message|file|prompt|translation|output|error|log|code)\b/,
  ];
  if (hasAny(lower, englishInstructionSignals)) return false;

  const letters = Array.from(prompt.matchAll(/\p{L}/gu), (match) => match[0]);
  if (letters.length < 4) return false;

  const latinLetters = letters.filter((char) => /\p{Script=Latin}/u.test(char))
    .length;
  const nonLatinLetters = letters.length - latinLetters;
  if (nonLatinLetters === 0) return false;

  const codeOrPathSignals = [
    /[`{}[\]();=<>]/,
    /(^|\s)(\.?\/|~\/|src\/|lib\/|app\/|test\/|tests\/|\.pi\/|\.github\/)[\w./-]+/,
    /\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|rb|java|kt|yml|yaml|toml|lock|lua|vim)\b/i,
  ];
  if (hasAny(prompt, codeOrPathSignals)) return false;

  return nonLatinLetters / letters.length >= 0.2;
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

function isTrivialAnswerPrompt(lower: string): boolean {
  const trimmed = lower.trim();
  if (
    hasAny(trimmed, [
      /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no)[.!?]*$/,
      /^(please\s+)?(what|which)\s+(time|date|day)\b/,
      /^(please\s+)?how\s+time\s+is\s+it\b/,
      /^(please\s+)?what\s+time\s+is\s+it\b/,
      /^(please\s+)?(what|which|show|check|tell me)\s+(is\s+)?(my\s+)?(current\s+)?(directory|cwd|user|username|shell|hostname|host|os|kernel|timezone|ip address|public ip|local ip)\b/,
      /^(please\s+)?(check|show|tell me)\s+(disk|memory|ram|cpu|system)\b/,
      /\b(node|npm|pnpm|yarn|python|python3|pip|git|gh|pi|cargo|rust|go|java|nvim|neovim|tmux)\s+(version|installed)\b/,
      /^(please\s+)?what\s+does\s+.+\s+mean[?!.]*$/,
    ])
  ) {
    return !hasAny(lower, [
      /\b(repo|repository|project|codebase|file|files|class|classes|function|functions|test|tests|log|logs|error|failure|stack trace)\b/,
      /\b(fix|debug|implement|change|modify|edit|write|create|delete|remove|refactor|audit|review|scan|inspect|commit|push)\b/,
      /(^|\s)(src|lib|app|test|tests|packages|\.pi|\.github|scripts)\//,
      /\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|py|rs|go|rb|java|kt|yml|yaml|toml|lock|lua|vim)\b/,
    ]);
  }
  return false;
}

const PROMPT_ACTION_VERBS = new Set([
  "add",
  "analyze",
  "audit",
  "bump",
  "change",
  "check",
  "commit",
  "configure",
  "create",
  "debug",
  "delete",
  "edit",
  "fix",
  "implement",
  "inspect",
  "install",
  "merge",
  "modify",
  "optimize",
  "patch",
  "publish",
  "push",
  "refactor",
  "release",
  "remove",
  "review",
  "rewrite",
  "run",
  "scan",
  "tag",
  "update",
  "verify",
  "write",
]);

const ACTION_VERB_ALIASES: Record<string, string> = {
  analyse: "analyze",
  analysed: "analyze",
  analyses: "analyze",
  analysing: "analyze",
  analyzing: "analyze",
  optimise: "optimize",
  optimised: "optimize",
  optimises: "optimize",
  optimized: "optimize",
  optimising: "optimize",
  optimizing: "optimize",
};

function normalizeActionVerb(value: string): string {
  const lower = value.toLowerCase().replace(/[^a-z-]/g, "");
  if (!lower) return "";
  const first = lower.split("-")[0] ?? lower;
  if (ACTION_VERB_ALIASES[first]) return ACTION_VERB_ALIASES[first];
  if (PROMPT_ACTION_VERBS.has(first)) return first;
  if (first.endsWith("ing") && PROMPT_ACTION_VERBS.has(first.slice(0, -3))) {
    return first.slice(0, -3);
  }
  if (first.endsWith("ed") && PROMPT_ACTION_VERBS.has(first.slice(0, -2))) {
    return first.slice(0, -2);
  }
  if (first.endsWith("s") && PROMPT_ACTION_VERBS.has(first.slice(0, -1))) {
    return first.slice(0, -1);
  }
  return "";
}

function compromiseActionVerbs(doc: ReturnType<typeof nlp>): string[] {
  return doc
    .verbs()
    .json({ normal: true })
    .map((entry: { verb?: { infinitive?: string }; normal?: string; text?: string }) =>
      normalizeActionVerb(
        entry.verb?.infinitive ?? entry.normal ?? entry.text ?? "",
      ),
    )
    .filter(Boolean);
}

function tokenActionVerbs(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z-]+/)
    .map(normalizeActionVerb)
    .filter(Boolean);
}

function analyzePromptShape(prompt: string): PromptShape {
  const lower = prompt.toLowerCase();
  const doc = nlp(prompt);
  const actions = [
    ...new Set([...compromiseActionVerbs(doc), ...tokenActionVerbs(prompt)]),
  ];
  const actionCount = actions.length;
  const question = doc.questions().out("array").length > 0;
  const hasAction = actionCount > 0;
  const multiStep =
    actionCount >= 3 ||
    hasAny(lower, [
      /\b(step by step|multi[- ]step|end[- ]to[- ]end|e2e|full flow)\b/,
      /\b(and then|then|after that|also|in addition|as well as)\b/,
      /\b(back and forth|all caveats|all gaps|everything needed)\b/,
    ]);
  const kind: PromptShapeKind =
    question && hasAction ? "mixed" : question ? "question" : "action";
  const signals = [
    `shape:${kind}`,
    `actions:${actionCount}`,
    ...(actions.length ? [`action-verbs:${actions.slice(0, 5).join("+")}`] : []),
    ...(multiStep ? ["multi-step"] : []),
  ];
  return { kind, actionCount, multiStep, signals };
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
  const promptShape = analyzePromptShape(prompt);
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
  signals.push(...promptShape.signals);
  if (promptShape.multiStep) add(5, "multi-step-action");
  else if (promptShape.kind === "mixed") add(1, "mixed-question-action");

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
  const trivialAnswer = toolProfile === "none" && isTrivialAnswerPrompt(lower);
  const risk = trivialAnswer
    ? "low"
    : riskForIntent(intent, toolProfile, contextTokens);
  if (trivialAnswer) signals.push("trivial-answer");
  signals.push(`intent:${intent}`, `risk:${risk}`);

  let tier: Tier = trivialAnswer
    ? "simple"
    : score >= 4
      ? "complex"
      : score >= 1
        ? "medium"
        : "simple";
  if (intent === "shell_simple" || trivialAnswer) tier = "simple";
  else if (promptShape.multiStep) tier = "complex";
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
    trivialAnswer
      ? 0.99
      : tier === "simple"
      ? Math.max(0.5, Math.min(0.99, 0.96 - Math.abs(score) * 0.02))
      : tier === "medium"
        ? Math.max(0.5, Math.min(0.99, 0.93 + Math.min(score, 3) * 0.01))
        : Math.max(0.5, Math.min(0.99, 0.9 + Math.min(score, 6) * 0.015));
  const ambiguous = confidence < 0.96;
  const estimatedClassifierTokens =
    countTokens(prompt.slice(0, config.classifier.maxPromptChars)) + 220;

  return {
    tier,
    intent,
    risk,
    toolProfile,
    promptShape,
    ambiguous,
    confidence,
    score,
    signals,
    estimatedClassifierTokens,
  };
}

function isContextualContinuationPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (!normalized || normalized.length > 80) return false;
  return hasAny(normalized, [
    /^(please\s+)?(continue|go on|proceed|keep going|carry on|resume)$/,
    /^(yes|yep|ok|okay|sure|sounds good|do it|go ahead)$/,
    /^(continue|proceed|resume)\s+(please|with it|the work|this|that)$/,
    /^(keep|continue)\s+(working|going)\s*(on\s+(it|this|that))?$/,
  ]);
}

function applyContinuationContext(
  analysis: LocalAnalysis,
  prompt: string,
  previous: RouterDecision | undefined,
): LocalAnalysis {
  if (!previous || !isContextualContinuationPrompt(prompt)) return analysis;
  return {
    ...analysis,
    tier: previous.tier,
    intent: previous.intent,
    risk: previous.risk,
    toolProfile: previous.toolProfile,
    ambiguous: false,
    confidence: Math.max(analysis.confidence, 0.98),
    signals: Array.from(
      new Set([
        ...analysis.signals,
        "contextual-continuation",
        `previous-tier:${previous.tier}`,
        `previous-intent:${previous.intent}`,
      ]),
    ),
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

function extractEventText(event: unknown): string | undefined {
  if (typeof event === "string") return event;
  if (!isObject(event)) return undefined;
  for (const key of ["output", "response", "result", "text", "message", "content"]) {
    const value = event[key];
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const text = value
        .map((part) =>
          isObject(part) && typeof part.text === "string" ? part.text : "",
        )
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
  }
  return undefined;
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
      classifierPromptText: string;
      classifierResponseText: string;
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
    classifierPromptText: classifierPrompt.text,
    classifierResponseText: text,
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
    promptShape: analysis.promptShape,
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

function incrementCounter(map: Record<string, number>, key: string | undefined): void {
  const safeKey = key && key.trim() ? key : "unknown";
  map[safeKey] = (map[safeKey] ?? 0) + 1;
}

function addRollupSample(
  bucket: TelemetryRollupBucket,
  analysis: LocalAnalysis,
  decision: RouterDecision,
  baselineCostUnits: number,
  actualCostUnits: number,
  promptSavings: number,
  classifierPromptTelemetry: ClassifierPromptTelemetry | undefined,
  memoryInjection: MemoryInjection | undefined,
): void {
  bucket.prompts += 1;
  bucket.estimatedTokensSaved += Math.max(0, Math.round(promptSavings));
  bucket.baselineCostUnits += Math.max(0, Math.round(baselineCostUnits));
  bucket.actualCostUnits += Math.max(0, Math.round(actualCostUnits));
  bucket.classifierTokens += classifierPromptTelemetry?.attempted
    ? Math.max(0, Math.round(analysis.estimatedClassifierTokens))
    : 0;
  bucket.memoryEstimatedTokensSaved += Math.max(
    0,
    Math.round(memoryInjection?.estimatedTokensSaved ?? 0),
  );
  bucket.compressionTokensSaved += Math.max(
    0,
    Math.round(
      classifierPromptTelemetry?.accepted
        ? classifierPromptTelemetry.tokensSaved
        : 0,
    ),
  );
  if (classifierPromptTelemetry?.guarded) bucket.compressionGuardRejections += 1;
  if (memoryInjection) bucket.memoryInjections += 1;
  if (analysis.promptShape.multiStep) bucket.multiStepPrompts += 1;
  if (decision.source === "fallback" && decision.tier !== "simple") {
    bucket.adaptiveFallbacks += 1;
  }
  if (decision.source === "classifier-cache") bucket.classifierCacheHits += 1;
  incrementCounter(bucket.tiers, decision.tier);
  incrementCounter(bucket.sources, decision.source);
  incrementCounter(bucket.intents, analysis.intent);
  incrementCounter(bucket.risks, analysis.risk);
  incrementCounter(bucket.promptShapes, analysis.promptShape.kind);
  incrementCounter(bucket.actionCounts, String(analysis.promptShape.actionCount));
  incrementCounter(bucket.models, decision.model);
}

function recordTelemetryRollup(
  cwd: string,
  analysis: LocalAnalysis,
  decision: RouterDecision,
  baselineCostUnits: number,
  actualCostUnits: number,
  promptSavings: number,
  classifierPromptTelemetry: ClassifierPromptTelemetry | undefined,
  memoryInjection: MemoryInjection | undefined,
  config: TokenomyConfig,
): void {
  if (!config.telemetry.enabled) return;
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const month = now.slice(0, 7);
  const rollups = loadTelemetryRollups(cwd);
  rollups.daily[day] ??= emptyRollupBucket();
  rollups.monthly[month] ??= emptyRollupBucket();
  for (const bucket of [
    rollups.lifetime,
    rollups.daily[day],
    rollups.monthly[month],
  ]) {
    addRollupSample(
      bucket,
      analysis,
      decision,
      baselineCostUnits,
      actualCostUnits,
      promptSavings,
      classifierPromptTelemetry,
      memoryInjection,
    );
  }
  saveTelemetryRollups(cwd, rollups, config);
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
  const shape = `shape:${entry.promptShape.kind} actions:${entry.promptShape.actionCount}${entry.promptShape.multiStep ? " multi-step" : ""}`;
  return [
    entry.at,
    `${entry.tier}/${entry.source}`,
    entry.model ?? "model:unknown",
    `thinking:${entry.thinking}`,
    `intent:${entry.intent}`,
    `risk:${entry.risk}`,
    shape,
    `confidence:${confidence}`,
    `ctx:${entry.contextBucket}`,
    `saved:${entry.estimatedTokensSaved}`,
    `prompt:${entry.promptHash}`,
    compression,
    guard,
    memory,
  ].join(" | ");
}

function mergeRollupBucket(
  target: TelemetryRollupBucket,
  source: TelemetryRollupBucket | undefined,
): void {
  if (!source) return;
  target.prompts += source.prompts;
  target.estimatedTokensSaved += source.estimatedTokensSaved;
  target.baselineCostUnits += source.baselineCostUnits;
  target.actualCostUnits += source.actualCostUnits;
  target.classifierTokens += source.classifierTokens;
  target.memoryEstimatedTokensSaved += source.memoryEstimatedTokensSaved;
  target.compressionTokensSaved += source.compressionTokensSaved;
  target.compressionGuardRejections += source.compressionGuardRejections;
  target.memoryInjections += source.memoryInjections;
  target.adaptiveFallbacks += source.adaptiveFallbacks;
  target.classifierCacheHits += source.classifierCacheHits;
  target.multiStepPrompts += source.multiStepPrompts;
  for (const [key, value] of Object.entries(source.tiers)) {
    target.tiers[key] = (target.tiers[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.sources)) {
    target.sources[key] = (target.sources[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.intents)) {
    target.intents[key] = (target.intents[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.risks)) {
    target.risks[key] = (target.risks[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.promptShapes)) {
    target.promptShapes[key] = (target.promptShapes[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.actionCounts)) {
    target.actionCounts[key] = (target.actionCounts[key] ?? 0) + value;
  }
  for (const [key, value] of Object.entries(source.models)) {
    target.models[key] = (target.models[key] ?? 0) + value;
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function rollupForRecentDays(
  rollups: TelemetryRollups,
  days: number,
): TelemetryRollupBucket {
  const bucket = emptyRollupBucket();
  const now = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    mergeRollupBucket(bucket, rollups.daily[dayKey(day)]);
  }
  return bucket;
}

function topCounters(
  label: string,
  counters: Record<string, number>,
  limit = 4,
): string {
  const values = Object.entries(counters)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`);
  return `${label}: ${values.length ? values.join(", ") : "none"}`;
}

function savingsPercent(bucket: TelemetryRollupBucket): string {
  if (bucket.baselineCostUnits <= 0) return "n/a";
  return `${Math.round((bucket.estimatedTokensSaved / bucket.baselineCostUnits) * 100)}%`;
}

function formatTelemetryReport(
  cwd: string,
  label: string,
  bucket: TelemetryRollupBucket,
  rollups: TelemetryRollups,
): string {
  return [
    `Tokenomy telemetry report (${label})`,
    `Prompts routed: ${bucket.prompts}`,
    `Estimated savings: ${bucket.estimatedTokensSaved} token-equivalent units (${savingsPercent(bucket)})`,
    `Estimated baseline cost units: ${bucket.baselineCostUnits}`,
    `Estimated routed cost units: ${bucket.actualCostUnits}`,
    `Classifier tokens estimated: ${bucket.classifierTokens}`,
    `Memory savings estimate: ${bucket.memoryEstimatedTokensSaved}`,
    `Compression savings estimate: ${bucket.compressionTokensSaved}`,
    `Memory injections: ${bucket.memoryInjections}`,
    `Classifier cache hits: ${bucket.classifierCacheHits}`,
    `Adaptive fallbacks: ${bucket.adaptiveFallbacks}`,
    `Multi-step prompts: ${bucket.multiStepPrompts}`,
    `Compression guard rejections: ${bucket.compressionGuardRejections}`,
    topCounters("Tiers", bucket.tiers),
    topCounters("Sources", bucket.sources),
    topCounters("Intents", bucket.intents),
    topCounters("Prompt shapes", bucket.promptShapes),
    topCounters("Action counts", bucket.actionCounts),
    topCounters("Models", bucket.models, 3),
    `Rollup updated: ${rollups.updatedAt || "never"}`,
    `Rollup file: ${telemetryRollupsPath(cwd)}`,
  ].join("\n");
}

function telemetryReportForAction(
  cwd: string,
  action: string,
): { label: string; bucket: TelemetryRollupBucket; rollups: TelemetryRollups } {
  const rollups = loadTelemetryRollups(cwd);
  const period = action.replace(/^report\s*/, "").trim() || "30d";
  if (period === "7d" || period === "week") {
    return {
      label: "last 7 days",
      bucket: rollupForRecentDays(rollups, 7),
      rollups,
    };
  }
  if (period === "30d") {
    return {
      label: "last 30 days",
      bucket: rollupForRecentDays(rollups, 30),
      rollups,
    };
  }
  if (period === "month" || period === "current-month") {
    const month = new Date().toISOString().slice(0, 7);
    return {
      label: month,
      bucket: rollups.monthly[month] ?? emptyRollupBucket(),
      rollups,
    };
  }
  if (period === "lifetime" || period === "all") {
    return { label: "lifetime", bucket: rollups.lifetime, rollups };
  }
  return {
    label: "last 30 days",
    bucket: rollupForRecentDays(rollups, 30),
    rollups,
  };
}

function memorySummary(memory: ProjectMemory | undefined, config: TokenomyConfig): string {
  const facts = memory?.facts ?? [];
  const stale = facts.filter((fact) => factIsStale(fact, config)).length;
  return `Memory: ${config.memory.enabled ? "enabled" : "disabled"}, inject:${config.memory.inject ? "on" : "off"}, facts:${facts.length}, stale:${stale}`;
}

function formatMemoryFact(fact: ProjectMemoryFact): string {
  return `${fact.id} | ${fact.kind}/${fact.source}/${fact.confidence} | uses:${fact.uses} | ${fact.text}`;
}

async function restoreModelIfPending(
  pendingRestore: PendingModelRestore | undefined,
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  trace?: DebugTrace,
): Promise<undefined> {
  if (!pendingRestore) return undefined;
  const currentLabel = modelLabel(ctx.model);
  if (currentLabel !== pendingRestore.selectedLabel) {
    traceEvent(trace, "model.restore.skipped", "current model changed before restore", {
      currentLabel,
      pendingRestore,
    });
    return undefined;
  }
  const ok = await pi.setModel(pendingRestore.restoreModel);
  traceEvent(trace, "model.restore.done", ok ? `restored ${pendingRestore.restoreLabel}` : `restore failed ${pendingRestore.restoreLabel}`, {
    ok,
    pendingRestore,
  });
  if (ctx.hasUI) {
    ctx.ui.notify(`Tokenomy restored model -> ${pendingRestore.restoreLabel}`, "info");
  }
  return undefined;
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
  let pendingModelRestore: PendingModelRestore | undefined;
  let debugTrace: DebugTrace | undefined;

  pi.registerFlag("tokenomy-off", {
    description: "Disable the Tokenomy token-saving router for this run",
    type: "boolean",
    default: false,
  });

  const restoreAfterAgent = async (event: unknown, ctx: ExtensionContext) => {
    const outputText = extractEventText(event);
    traceEvent(debugTrace, "agent.output", outputText ? "agent output captured" : "agent output unavailable", {
      rawOutput: outputText,
      rawEvent: event,
      outputCaptureAvailable: !!outputText,
    });
    const pending = pendingModelRestore;
    pendingModelRestore = undefined;
    await restoreModelIfPending(pending, pi, ctx, debugTrace);
  };

  pi.on("after_agent_end", restoreAfterAgent);
  pi.on("after_agent_finish", restoreAfterAgent);
  pi.on("after_agent_complete", restoreAfterAgent);

  pi.on("session_start", async (_event, ctx) => {
    const loaded = loadConfig(ctx.cwd);
    config = loaded.config;
    configWarnings = loaded.warnings;
    if (pi.getFlag("tokenomy-off")) config = { ...config, enabled: false };
    baselineModel = modelLabel(ctx.model);
    pendingModelRestore = undefined;
    debugTrace = config.debug.trace ? startDebugTrace(ctx.cwd) : undefined;
    traceEvent(
      debugTrace,
      "session.start",
      `Tokenomy ${packageVersion()} session started`,
      debugSessionSnapshot(ctx, config, baselineModel, lastDecision),
    );
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
    if (configWarnings.length && ctx.hasUI) {
      ctx.ui.notify(`Tokenomy config warnings:\n- ${configWarnings.join("\n- ")}`, "warning");
    }
    if (statsWarning && ctx.hasUI) {
      ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
    }
    if (debugTrace && ctx.hasUI) {
      ctx.ui.notify(debugWarningMessage(debugTrace.path), "warning");
    }
  });

  pi.on("input", (event, ctx) => {
    if (!config.enabled || event.source === "extension")
      return { action: "continue" as const };
    traceEvent(debugTrace, "input.received", `input chars=${event.text.length}`, {
      rawInput: event.text,
      source: event.source,
      rawEvent: event,
    });
    if (shouldBypassForLanguage(event.text)) {
      traceEvent(debugTrace, "language.bypass", "input bypassed by language detector", {
        rawInput: event.text,
      });
      return { action: "continue" as const };
    }
    const usage = ctx.getContextUsage();
    const imageCount = event.images?.length ?? 0;
    let analysis = analyzePrompt(
      event.text,
      usage?.tokens,
      imageCount,
      config,
    );
    analysis = applyContinuationContext(analysis, event.text, lastDecision);
    traceEvent(debugTrace, "analysis.input", `toolProfile=${analysis.toolProfile}`, {
      analysis,
      contextTokens: usage?.tokens,
      imageCount,
    });
    applyToolPolicy(analysis.toolProfile, config, pi, ctx);
    return { action: "continue" as const };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!config.enabled) return;
    traceEvent(debugTrace, "prompt.received", `chars=${event.prompt.length}`, {
      rawPrompt: event.prompt,
      rawSystemPrompt: event.systemPrompt,
      rawEvent: event,
    });
    if (shouldBypassForLanguage(event.prompt)) {
      traceEvent(debugTrace, "language.bypass", "prompt bypassed by language detector", {
        rawPrompt: event.prompt,
      });
      return;
    }

    pendingModelRestore = undefined;
    const modelBeforeRouting = ctx.model;
    const usage = ctx.getContextUsage();
    const contextTokens = usage?.tokens;
    const imageCount = event.images?.length ?? 0;
    let analysis = analyzePrompt(
      event.prompt,
      contextTokens,
      imageCount,
      config,
    );
    analysis = applyContinuationContext(analysis, event.prompt, lastDecision);
    traceEvent(
      debugTrace,
      "analysis.local",
      `tier=${analysis.tier} intent=${analysis.intent} risk=${analysis.risk} shape=${analysis.promptShape.kind} actions=${analysis.promptShape.actionCount} score=${analysis.score} confidence=${Math.round(analysis.confidence * 100)}%`,
      {
        analysis,
        contextTokens,
        imageCount,
        whyNotCheaper:
          analysis.tier === "simple"
            ? "already cheapest"
            : analysis.signals.join(",") || "local heuristic",
        whyNotStronger:
          analysis.tier === "complex"
            ? "already strongest configured tier"
            : "risk and score did not require stronger tier",
      },
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

    const classifierEligible = shouldUseClassifier(analysis, event.prompt, config);
    traceEvent(debugTrace, "classifier.eligible", `eligible=${classifierEligible}`, {
      eligible: classifierEligible,
      heuristicUncertain,
      estimatedClassifierTokens: analysis.estimatedClassifierTokens,
      maxEstimatedClassifierTokens: config.classifier.maxEstimatedClassifierTokens,
      ambiguous: analysis.ambiguous,
    });

    if (classifierEligible) {
      try {
        const cached = getClassifierCacheEntry(ctx.cwd, classifierKey, config);
        traceEvent(debugTrace, "classifier.cache", cached ? "classifier cache hit" : "classifier cache miss", {
          cacheKey: classifierKey,
          cached,
        });
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
        if (liveClassification) {
          traceEvent(debugTrace, "classifier.response", "classifier response received", {
            rawClassifierPrompt: liveClassification.classifierPromptText,
            rawClassifierResponse: liveClassification.classifierResponseText,
            promptTelemetry: liveClassification.promptTelemetry,
            parsed: liveClassification.result,
          });
        }
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
          traceEvent(debugTrace, "classifier.accepted", `tier=${tier} confidence=${Math.round(classified.confidence * 100)}%`, {
            classified,
            source,
          });
        } else {
          source = "fallback";
          reason = classified
            ? `classifier confidence ${Math.round(classified.confidence * 100)}% below ${Math.round(config.classifier.minConfidence * 100)}%`
            : "classifier unavailable";
          confidence = classified?.confidence;
          traceEvent(debugTrace, "classifier.rejected", reason, {
            classified,
            minConfidence: config.classifier.minConfidence,
          });
        }
      } catch (error) {
        source = "fallback";
        reason = `classifier failed: ${error instanceof Error ? error.message : String(error)}`;
        traceEvent(debugTrace, "error", "classifier failed", { error });
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
      traceEvent(debugTrace, "fallback.selected", `fallback=${fallbackTier}`, {
        fallbackTier,
        reason,
        risk: analysis.risk,
        intent: analysis.intent,
      });
    } else {
      target = findFirstModel(ctx, config.models[tier], config.provider);
    }
    if (!target) {
      target = findBestConfiguredFallbackModel(ctx, config);
      if (target) {
        source = "fallback";
        reason = `configured ${tier} model unavailable; fallback to ${target.id}`;
        tier = "simple";
        traceEvent(debugTrace, "fallback.selected", "configured tier unavailable", {
          target: modelLabel(target),
          reason,
        });
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
      promptShape: analysis.promptShape,
      thinking,
    };
    traceEvent(debugTrace, "route.selected", `${tier}/${source} -> ${decision.model ?? "current model"} thinking=${thinking}`, {
      decision,
      modelBeforeRouting: modelLabel(modelBeforeRouting),
      target: target ? modelLabel(target) : undefined,
    });

    let switchedModel = false;
    if (target && !config.debug.dryRun) {
      const alreadySelected =
        ctx.model?.provider === target.provider && ctx.model?.id === target.id;
      if (!alreadySelected) {
        const ok = await pi.setModel(target);
        switchedModel = ok;
        traceEvent(debugTrace, "model.set", ok ? `set ${modelLabel(target)}` : `failed ${modelLabel(target)}`, {
          ok,
          target: modelLabel(target),
        });
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

    const originalLabel = modelLabel(modelBeforeRouting);
    const selectedLabel = modelLabel(target);
    if (
      config.routing.restoreModelAfterPrompt &&
      switchedModel &&
      modelBeforeRouting &&
      originalLabel &&
      selectedLabel &&
      originalLabel !== selectedLabel
    ) {
      pendingModelRestore = {
        restoreModel: modelBeforeRouting,
        restoreLabel: originalLabel,
        selectedLabel,
      };
      traceEvent(debugTrace, "model.restore.scheduled", `restore ${originalLabel}`, {
        restoreLabel: originalLabel,
        selectedLabel,
      });
    }

    if (!config.debug.dryRun) pi.setThinkingLevel(thinking);
    lastDecision = decision;

    const baselineScore = baselineModel
      ? modelFamilyRank(baselineModel.split("/").pop() ?? baselineModel)
      : 0;
    const targetScore = target ? modelFamilyRank(target.id) : baselineScore;
    const costChunks = Math.max(
      1,
      Math.ceil((contextTokens ?? event.prompt.length) / 4000),
    );
    const baselineCostUnits = baselineScore * costChunks * 50;
    const actualCostUnits = targetScore * costChunks * 50;
    const promptSavings =
      Math.max(0, baselineCostUnits - actualCostUnits);
    estimatedTokensSaved += promptSavings;
    traceEvent(debugTrace, "counterfactual", `saved=${promptSavings}`, {
      baselineModel,
      selectedModel: modelLabel(target),
      baselineCostUnits,
      actualCostUnits,
      promptSavings,
      sessionEstimatedTokensSaved: estimatedTokensSaved,
    });
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
    traceEvent(debugTrace, "memory.loaded", `memoryFacts=${memory?.facts.length ?? 0} digest=${digestPrompt ? "yes" : "no"}`, {
      memory,
      digest,
      digestPrompt,
    });
    if (memoryInjection) {
      traceEvent(debugTrace, "memory.injected", `reason=${memoryInjection.reason} facts=${memoryInjection.factsUsed}`, {
        memoryInjection,
      });
    }
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
        recordTelemetryRollup(
          ctx.cwd,
          analysis,
          decision,
          baselineCostUnits,
          actualCostUnits,
          promptSavings,
          classifierPromptTelemetry,
          memoryInjection,
          config,
        );
        markMemoryFactsUsed(ctx.cwd, memory, memoryInjection);
        statsWarning = undefined;
        traceEvent(debugTrace, "telemetry.saved", "stats/history/rollups saved", {
          stats,
          routingHistoryPath: routingHistoryPath(ctx.cwd),
          telemetryRollupsPath: telemetryRollupsPath(ctx.cwd),
        });
      } catch (error) {
        statsWarning = `failed to save Tokenomy stats/history/rollups: ${error instanceof Error ? error.message : String(error)}`;
        traceEvent(debugTrace, "error", "failed to save stats/history/rollups", { error });
        if (ctx.hasUI) {
          ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
        }
      }
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
        updateProjectMemory(ctx.cwd, analysis, decision, config);
      } catch (error) {
        statsWarning = `failed to save Tokenomy project metadata: ${error instanceof Error ? error.message : String(error)}`;
        traceEvent(debugTrace, "error", "failed to save project metadata", { error });
      }
    }

    const discipline = buildTokenDiscipline(
      decision,
      contextTokens,
      config,
      estimatedTokensSaved,
    );
    const additions = [digestPrompt, memoryInjection?.text, discipline].filter(Boolean);
    traceEvent(debugTrace, "system.additions", `count=${additions.length}`, {
      rawAdditions: additions,
      digestPrompt,
      memoryInjectionText: memoryInjection?.text,
      discipline,
    });
    if (!additions.length) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${additions.join("\n\n")}`,
    };
  });

  pi.registerCommand("tokenomy", {
    description:
      "Show or change Tokenomy token-router status: /tokenomy [on|off|reload|status|explain|history|report|memory|debug on|debug off|debug path|export-history|export-report|reset-history|reset-stats|dry-run on|dry-run off]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || "status";
      if (action === "on") {
        config.enabled = true;
        ctx.ui.notify("Tokenomy enabled", "info");
        return;
      }
      if (action === "off") {
        config.enabled = false;
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
      if (action === "debug on") {
        config.debug.trace = true;
        debugTrace = startDebugTrace(ctx.cwd);
        traceEvent(debugTrace, "debug.enabled", "debug trace enabled by command", {
          ...debugSessionSnapshot(ctx, config, baselineModel, lastDecision),
        });
        ctx.ui.notify(debugWarningMessage(debugTrace.path), "warning");
        return;
      }
      if (action === "debug off") {
        traceEvent(debugTrace, "debug.disabled", "debug trace disabled by command");
        config.debug.trace = false;
        const path = debugTrace?.path;
        debugTrace = undefined;
        ctx.ui.notify(
          path
            ? `Tokenomy debug trace disabled\nTrace file: ${path}`
            : "Tokenomy debug trace disabled",
          "info",
        );
        return;
      }
      if (action === "debug path" || action === "debug") {
        ctx.ui.notify(
          debugTrace
            ? `Tokenomy debug trace: enabled\nTrace file: ${debugTrace.path}`
            : "Tokenomy debug trace: disabled",
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
          saveTelemetryRollups(ctx.cwd, emptyRollups(), config);
          statsWarning = undefined;
          ctx.ui.notify("Tokenomy stats reset", "info");
        } catch (error) {
          statsWarning = `failed to reset Tokenomy stats: ${error instanceof Error ? error.message : String(error)}`;
          ctx.ui.notify(`Tokenomy stats warning: ${statsWarning}`, "warning");
        }
        return;
      }
      if (action === "report" || action.startsWith("report ")) {
        try {
          const report = telemetryReportForAction(ctx.cwd, action);
          ctx.ui.notify(
            formatTelemetryReport(ctx.cwd, report.label, report.bucket, report.rollups),
            "info",
          );
        } catch (error) {
          ctx.ui.notify(
            `Tokenomy report warning: failed to load telemetry rollups: ${error instanceof Error ? error.message : String(error)}`,
            "warning",
          );
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
      if (action === "export-report") {
        ctx.ui.notify(
          `Tokenomy telemetry rollup file: ${telemetryRollupsPath(ctx.cwd)}`,
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
          `Prompt shape: ${lastDecision.promptShape.kind}, actions:${lastDecision.promptShape.actionCount}, multi-step:${lastDecision.promptShape.multiStep ? "yes" : "no"}`,
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
        `Telemetry: ${config.telemetry.enabled ? "enabled" : "disabled"} (${config.telemetry.maxEntries} history entries, ${config.telemetry.rollupRetentionDays} rollup days)`,
        memorySummary(safeLoadProjectMemory(ctx.cwd), config),
        `Prompt simplification: ${config.promptSimplification.enabled ? "enabled" : "disabled"}`,
        `Prompt compression: ${config.promptSimplification.compressionEnabled ? "enabled" : "disabled"}`,
        `Restore model after prompt: ${config.routing.restoreModelAfterPrompt ? "enabled" : "disabled"}`,
        `Debug trace: ${debugTrace ? `enabled (${debugTrace.path})` : "disabled"}`,
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
        `Telemetry rollup file: ${telemetryRollupsPath(ctx.cwd)}`,
        `Memory file: ${projectMemoryPath(ctx.cwd)}`,
        ...(statsWarning ? [`Stats warning: ${statsWarning}`] : []),
        `Config files: ${join(getAgentDir(), "tokenomy.json")} and ${join(ctx.cwd, CONFIG_DIR_NAME, "tokenomy.json")}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
