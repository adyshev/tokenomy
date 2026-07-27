import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_MODEL_TIERS,
  KNOWN_PLUS_MODELS,
  PLAN_CREDIT_RATES,
  rateCardAgeDays,
} from "../.pi/extensions/tokenomy/lib/models.ts";

test("all default routed models are cataloged and have verified rates", () => {
  for (const model of new Set(Object.values(DEFAULT_MODEL_TIERS).flat())) {
    assert.ok(KNOWN_PLUS_MODELS.includes(model), `${model} is cataloged`);
    assert.ok(PLAN_CREDIT_RATES[model], `${model} has a rate`);
  }
});

test("tracks available preview models without routing before rate verification", () => {
  assert.ok(KNOWN_PLUS_MODELS.includes("gpt-5.3-codex-spark"));
  assert.equal(PLAN_CREDIT_RATES["gpt-5.3-codex-spark"], undefined);
  assert.equal(
    Object.values(DEFAULT_MODEL_TIERS)
      .flat()
      .includes("gpt-5.3-codex-spark"),
    false,
  );
});

test("computes rate-card age from a version date", () => {
  assert.equal(rateCardAgeDays("2026-07-01", new Date("2026-07-11T00:00:00Z")), 10);
  assert.equal(rateCardAgeDays("not-a-date"), undefined);
});
