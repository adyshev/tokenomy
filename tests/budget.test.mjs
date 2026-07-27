import assert from "node:assert/strict";
import test from "node:test";
import {
  downshiftTier,
  estimatedTurnsRemaining,
  reachedBudgetThresholds,
} from "../.pi/extensions/tokenomy/lib/budget.ts";

test("budget thresholds honor reserves and per-tier limits", () => {
  const thresholds = reachedBudgetThresholds({
    tier: "medium",
    sessionUsed: 8,
    sessionLimit: 10,
    dailyUsed: 0,
    dailyLimit: 0,
    tierUsed: 2,
    tierLimit: 2.5,
    warnAtPercent: 80,
    reserveCredits: 1,
  });
  assert.deepEqual(
    thresholds.map(({ name }) => name),
    ["session", "tier:medium"],
  );
  assert.equal(thresholds[0].effectiveLimit, 9);
});

test("downshift policy can save one or two tiers", () => {
  assert.equal(downshiftTier("complex", 1), "medium");
  assert.equal(downshiftTier("complex", 2), "simple");
  assert.equal(downshiftTier("medium", 2), "simple");
  assert.equal(downshiftTier("simple", 2), "simple");
});

test("remaining turn estimate uses the observed average and spendable limit", () => {
  assert.equal(estimatedTurnsRemaining(2, 10, 2), 4);
  assert.equal(estimatedTurnsRemaining(9.5, 10, 2), 0);
  assert.equal(estimatedTurnsRemaining(2, 0, 2), undefined);
  assert.equal(estimatedTurnsRemaining(2, 10, 0), undefined);
});
