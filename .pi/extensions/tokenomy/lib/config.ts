import {
  TOKENOMY_CONFIG_SCHEMA,
  type JsonSchema,
  schemaWarnings,
} from "./config-schema.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compatibleType(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual);
  if (isRecord(expected)) return isRecord(actual);
  return typeof expected === typeof actual;
}

function sanitize(
  base: unknown,
  override: unknown,
  path: string,
  warnings: string[],
  schema: JsonSchema,
): unknown {
  if (!compatibleType(base, override)) {
    warnings.push(
      `${path} has invalid type; expected ${
        Array.isArray(base) ? "array" : typeof base
      }`,
    );
    return base;
  }
  if (!isRecord(base) || !isRecord(override)) {
    const invalid = schemaWarnings(override, schema, path);
    if (invalid.length) {
      warnings.push(...invalid);
      return base;
    }
    return override;
  }

  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const childPath = `${path}.${key}`;
    if (!(key in base)) {
      if (typeof schema.additionalProperties === "object") {
        const invalid = schemaWarnings(
          value,
          schema.additionalProperties,
          childPath,
        );
        if (invalid.length) warnings.push(...invalid);
        else output[key] = value;
        continue;
      }
      warnings.push(`${childPath} is unknown and was ignored`);
      continue;
    }
    output[key] = sanitize(
      base[key],
      value,
      childPath,
      warnings,
      schema.properties?.[key] ?? {},
    );
  }
  return output;
}

export function mergeKnownConfig<T>(
  base: T,
  override: unknown,
  warnings: string[],
  path = "config",
): T {
  if (!isRecord(override)) {
    warnings.push(`${path} must be an object`);
    return base;
  }
  return sanitize(
    base,
    override,
    path,
    warnings,
    TOKENOMY_CONFIG_SCHEMA,
  ) as T;
}
