import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  DEFAULT_MODEL_TIERS,
  KNOWN_PLUS_MODELS,
  PLAN_CREDIT_RATE_CARD_VERSION,
  PLAN_CREDIT_RATES,
  PLUS_MODEL_CATALOG_VERIFIED_AT,
  rateCardAgeDays,
} from "../.pi/extensions/tokenomy/lib/models.ts";

const root = resolve(import.meta.dirname, "..");
const pi = resolve(root, "node_modules/.bin/pi");
const maxAgeDays = Number.parseInt(
  process.env.TOKENOMY_CATALOG_MAX_AGE_DAYS || "30",
  10,
);
const run = spawnSync(
  pi,
  ["--offline", "--approve", "--no-session", "--list-models", "openai-codex"],
  { cwd: root, encoding: "utf8", env: process.env },
);
if (run.status !== 0) {
  process.stderr.write(run.stderr);
  process.exit(run.status ?? 1);
}
const available = run.stdout
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter(([provider, model]) => provider === "openai-codex" && model)
  .map(([, model]) => model);
if (available.length === 0) {
  console.error(
    "No authenticated openai-codex models were visible; sign in to Pi before running test:catalog.",
  );
  process.exit(2);
}
const configured = [...new Set(Object.values(DEFAULT_MODEL_TIERS).flat())];
const missingConfigured = configured.filter((model) => !available.includes(model));
const untrackedAvailable = available.filter(
  (model) => !KNOWN_PLUS_MODELS.includes(model),
);
const missingRates = configured.filter((model) => !PLAN_CREDIT_RATES[model]);
const ageDays = rateCardAgeDays(PLAN_CREDIT_RATE_CARD_VERSION);
const staleRateCard = ageDays === undefined || ageDays > maxAgeDays;
const result = {
  checkedAt: new Date().toISOString(),
  catalogVerifiedAt: PLUS_MODEL_CATALOG_VERIFIED_AT,
  rateCardVersion: PLAN_CREDIT_RATE_CARD_VERSION,
  rateCardAgeDays: ageDays,
  maxAgeDays,
  available,
  configured,
  missingConfigured,
  untrackedAvailable,
  missingRates,
  staleRateCard,
};
console.log(JSON.stringify(result, null, 2));
if (untrackedAvailable.length) {
  console.warn(`New untracked models: ${untrackedAvailable.join(", ")}`);
}
process.exit(
  missingConfigured.length || missingRates.length || staleRateCard ? 1 : 0,
);
