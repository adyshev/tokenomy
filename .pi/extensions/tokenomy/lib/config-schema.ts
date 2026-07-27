import { DEFAULT_CONFIG_TEMPLATE } from "./defaults.ts";

export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "boolean";
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  minItems?: number;
  title?: string;
  $schema?: string;
  $id?: string;
}

const ENUMS: Record<string, unknown[]> = {
  mode: ["save", "balanced", "quality"],
  "thinking.simple": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "thinking.medium": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "thinking.complex": ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  "experiments.modes[]": ["save", "balanced", "quality"],
  "budgets.policy": ["warn", "save", "ask"],
  "adaptive.mediumFallbackMinRisk": ["low", "medium", "high"],
  "adaptive.complexFallbackIntents[]": [
    "answer",
    "shell_simple",
    "read",
    "single_edit",
    "multi_edit",
    "debug",
    "architecture",
    "local_workflow",
    "release",
  ],
  "languages.enabled[]": ["en", "uk", "ru", "es", "fr", "de", "pt", "unknown"],
};

const MINIMUMS: Record<string, number> = {
  "classifier.maxPromptChars": 1,
  "classifier.maxEstimatedClassifierTokens": 0,
  "classifier.maxCallsPerSession": 0,
  "classifier.minEstimatedNetCredits": 0,
  "classifier.minConfidence": 0,
  "quality.evaluatorMaxPromptChars": 1,
  "quality.evaluatorMaxOutputChars": 1,
  "quality.minEvaluatorScore": 0,
  "experiments.sampleRate": 0,
  "registry.refreshHours": 1,
  "registry.maxAgeDays": 1,
  "quota.staleAfterMinutes": 1,
  "budgets.sessionCredits": 0,
  "budgets.dailyCredits": 0,
  "budgets.reserveCredits": 0,
  "budgets.maxDownshiftTiers": 1,
  "budgets.tierSessionCredits.simple": 0,
  "budgets.tierSessionCredits.medium": 0,
  "budgets.tierSessionCredits.complex": 0,
  "cache.classifierTtlMs": 0,
  "cache.maxClassifierEntries": 1,
  "telemetry.maxEntries": 1,
  "telemetry.rollupRetentionDays": 30,
  "contextEconomy.compactAtPercent": 50,
  "contextEconomy.minTokens": 0,
  "contextEconomy.cooldownTurns": 0,
  "memory.maxFacts": 1,
  "memory.maxInjectedChars": 200,
  "memory.maxFactChars": 40,
  "memory.staleAfterDays": 1,
  "memory.minContextTokensForInjection": 0,
  "distillation.minContextTokens": 0,
  "distillation.repeatPromptThreshold": 1,
  "distillation.maxDigestChars": 200,
  "thresholds.largeContextTokens": 0,
  "thresholds.hugeContextTokens": 0,
  "thresholds.longPromptChars": 0,
  "thresholds.veryLongPromptChars": 0,
  "toolEconomy.maxResultTokens": 100,
  "toolEconomy.preserveHeadChars": 0,
  "toolEconomy.preserveTailChars": 0,
  "debug.retentionDays": 1,
  "promptDiscipline.maxAnswerBulletsSimple": 1,
  "promptSimplification.minCompressionSavingsTokens": 0,
  "promptSimplification.maxClassifierPromptChars": 400,
  "promptSimplification.maxLineChars": 80,
  "promptSimplification.headLines": 0,
  "promptSimplification.tailLines": 0,
  "promptSimplification.preserveSignalLines": 0,
};

const MAXIMUMS: Record<string, number> = {
  "classifier.minConfidence": 1,
  "quality.minEvaluatorScore": 1,
  "experiments.sampleRate": 1,
  "budgets.warnAtPercent": 100,
  "budgets.maxDownshiftTiers": 2,
  "contextEconomy.compactAtPercent": 100,
};

function schemaFromValue(value: unknown, path = ""): JsonSchema {
  const enumValues = ENUMS[path];
  if (enumValues) return { enum: enumValues };
  if (Array.isArray(value)) {
    const schema: JsonSchema = {
      type: "array",
      items:
        ENUMS[`${path}[]`] !== undefined
          ? { enum: ENUMS[`${path}[]`] }
          : schemaFromValue(value[0] ?? "", `${path}[]`),
    };
    if (path.startsWith("models.")) schema.minItems = 1;
    return schema;
  }
  if (value && typeof value === "object") {
    if (path === "planCredits.rates") {
      return {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: false,
          properties: {
            input: { type: "number", minimum: 0 },
            cacheRead: { type: "number", minimum: 0 },
            output: { type: "number", minimum: 0 },
            cacheWrite: { type: "number", minimum: 0 },
          },
        },
      };
    }
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(value).map(([key, item]) => {
          const childPath = path ? `${path}.${key}` : key;
          return [key, schemaFromValue(item, childPath)];
        }),
      ),
    };
  }
  const schema: JsonSchema = {
    type:
      typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string",
  };
  if (MINIMUMS[path] !== undefined) schema.minimum = MINIMUMS[path];
  if (MAXIMUMS[path] !== undefined) schema.maximum = MAXIMUMS[path];
  if (path === "budgets.warnAtPercent") {
    delete schema.minimum;
    schema.exclusiveMinimum = 0;
  }
  if (
    typeof value === "string" &&
    ["provider", "planCredits.rateCardVersion"].includes(path)
  ) {
    schema.minLength = 1;
  }
  return schema;
}

export const TOKENOMY_CONFIG_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/adyshev/tokenomy/blob/main/.pi/tokenomy.schema.json",
  title: "Tokenomy for Pi configuration",
  ...schemaFromValue(DEFAULT_CONFIG_TEMPLATE),
};

function matchesType(value: unknown, type: JsonSchema["type"]): boolean {
  if (!type) return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  return typeof value === type;
}

export function schemaWarnings(
  value: unknown,
  schema: JsonSchema = TOKENOMY_CONFIG_SCHEMA,
  path = "config",
): string[] {
  const warnings: string[] = [];
  if (!matchesType(value, schema.type)) {
    return [`${path} must be ${schema.type}`];
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return [`${path} must be one of ${schema.enum.join(", ")}`];
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      warnings.push(`${path} must be at least ${schema.minimum}`);
    }
    if (
      schema.exclusiveMinimum !== undefined &&
      value <= schema.exclusiveMinimum
    ) {
      warnings.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      warnings.push(`${path} must be at most ${schema.maximum}`);
    }
  }
  if (
    typeof value === "string" &&
    schema.minLength !== undefined &&
    value.length < schema.minLength
  ) {
    warnings.push(`${path} must not be empty`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      warnings.push(`${path} must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        warnings.push(...schemaWarnings(item, schema.items!, `${path}[${index}]`));
      });
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) {
        warnings.push(...schemaWarnings(item, child, `${path}.${key}`));
      } else if (typeof schema.additionalProperties === "object") {
        warnings.push(
          ...schemaWarnings(item, schema.additionalProperties, `${path}.${key}`),
        );
      } else if (schema.additionalProperties === false) {
        warnings.push(`${path}.${key} is unknown`);
      }
    }
  }
  return warnings;
}
