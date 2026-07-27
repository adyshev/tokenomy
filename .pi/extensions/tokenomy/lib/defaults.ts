import {
  DEFAULT_MODEL_TIERS,
  PLAN_CREDIT_RATE_CARD_VERSION,
  PLAN_CREDIT_RATES,
} from "./models.ts";

export const DEFAULT_CONFIG_TEMPLATE = {
  enabled: true,
  mode: "balanced",
  provider: "openai-codex",
  models: {
    classifier: [...DEFAULT_MODEL_TIERS.classifier],
    simple: [...DEFAULT_MODEL_TIERS.simple],
    medium: [...DEFAULT_MODEL_TIERS.medium],
    complex: [...DEFAULT_MODEL_TIERS.complex],
  },
  thinking: { simple: "minimal", medium: "low", complex: "medium" },
  classifier: {
    enabled: true,
    onlyWhenAmbiguous: true,
    maxPromptChars: 4000,
    maxEstimatedClassifierTokens: 1400,
    maxCallsPerSession: 12,
    minEstimatedNetCredits: 0.01,
    minConfidence: 0.95,
  },
  planCredits: {
    enabled: true,
    rateCardVersion: PLAN_CREDIT_RATE_CARD_VERSION,
    rates: PLAN_CREDIT_RATES,
  },
  quality: {
    correctionDetection: true,
    evaluatorEnabled: false,
    evaluatorModels: ["gpt-5.4-mini"],
    evaluatorMaxPromptChars: 4000,
    evaluatorMaxOutputChars: 6000,
    minEvaluatorScore: 0.8,
  },
  experiments: {
    enabled: false,
    sampleRate: 1,
    modes: ["save", "balanced", "quality"],
  },
  providers: { allowed: ["openai-codex"], autoDiscoverModels: false },
  registry: {
    rateCardPath: ".pi/tokenomy-rate-card.json",
    rateCardUrl: "",
    refreshHours: 24,
    maxAgeDays: 30,
  },
  quota: {
    accountSnapshotPath: ".pi/tokenomy-account-quota.json",
    staleAfterMinutes: 60,
  },
  budgets: {
    sessionCredits: 0,
    dailyCredits: 0,
    warnAtPercent: 80,
    policy: "warn",
    reserveCredits: 0,
    maxDownshiftTiers: 1,
    tierSessionCredits: { simple: 0, medium: 0, complex: 0 },
  },
  cache: {
    enabled: true,
    classifierTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxClassifierEntries: 200,
    projectDigest: true,
  },
  telemetry: { enabled: true, maxEntries: 200, rollupRetentionDays: 400 },
  contextEconomy: {
    autoCompact: false,
    compactAtPercent: 85,
    minTokens: 80_000,
    cooldownTurns: 8,
    customInstructions:
      "Preserve the active task, decisions, modified files, validation results, blockers, and exact next steps. Drop repeated logs and superseded exploration.",
  },
  memory: {
    enabled: true,
    inject: false,
    maxFacts: 80,
    maxInjectedChars: 1200,
    maxFactChars: 240,
    staleAfterDays: 30,
    minContextTokensForInjection: 20_000,
  },
  distillation: {
    enabled: false,
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
    restoreThinkingAfterPrompt: true,
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
  toolEconomy: {
    measureResults: true,
    truncateOversized: false,
    maxResultTokens: 6000,
    preserveHeadChars: 12000,
    preserveTailChars: 6000,
  },
  languages: { enabled: ["en", "uk", "ru", "es", "fr", "de", "pt"] },
  debug: {
    dryRun: false,
    trace: false,
    verbose: false,
    retentionDays: 7,
    redact: true,
  },
  promptDiscipline: { enabled: true, maxAnswerBulletsSimple: 5 },
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
  ui: { status: true, notifyDecisions: true },
};

export function createDefaultConfig(): typeof DEFAULT_CONFIG_TEMPLATE {
  return structuredClone(DEFAULT_CONFIG_TEMPLATE);
}
