export interface PlanCreditRates {
  input: number;
  cacheRead: number;
  output: number;
}

// Verified against an authenticated ChatGPT Plus Pi catalog on 2026-07-27.
// Availability is checked independently from plan-credit rates because preview
// models can appear before a trustworthy rate is known.
export const PLUS_MODEL_CATALOG_VERIFIED_AT = "2026-07-27";
export const KNOWN_PLUS_MODELS = [
  "gpt-5.3-codex-spark",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
] as const;

// ChatGPT plan credit rates verified on 2026-07-27. Models without a verified
// rate remain discoverable but are not selected by the default economy tiers.
export const PLAN_CREDIT_RATE_CARD_VERSION = "2026-07-27";
export const PLAN_CREDIT_RATES: Record<string, PlanCreditRates> = {
  "gpt-5.6-sol": { input: 125, cacheRead: 12.5, output: 750 },
  "gpt-5.6-terra": { input: 62.5, cacheRead: 6.25, output: 375 },
  "gpt-5.6-luna": { input: 25, cacheRead: 2.5, output: 150 },
  "gpt-5.5": { input: 125, cacheRead: 12.5, output: 750 },
  "gpt-5.4": { input: 62.5, cacheRead: 6.25, output: 375 },
  "gpt-5.4-mini": { input: 18.75, cacheRead: 1.875, output: 113 },
  "gpt-5.3-codex": { input: 43.75, cacheRead: 4.375, output: 350 },
  "gpt-5.2-codex": { input: 43.75, cacheRead: 4.375, output: 350 },
};

export const DEFAULT_MODEL_TIERS = {
  classifier: ["gpt-5.4-mini"],
  simple: ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.4"],
  medium: ["gpt-5.6-terra", "gpt-5.4", "gpt-5.4-mini"],
  complex: ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra"],
} as const;

export function rateCardAgeDays(
  version: string,
  now = new Date(),
): number | undefined {
  const timestamp = Date.parse(`${version}T00:00:00Z`);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, (now.getTime() - timestamp) / (24 * 60 * 60 * 1000));
}
