import assert from "node:assert/strict";
import test from "node:test";
import {
  compareArms,
  summarizeArm,
  trendAgainst,
  wilsonInterval,
} from "../scripts/evaluation-core.mjs";
import { BUILTIN_SCENARIOS, scenariosForProfile } from "../scripts/evaluation-scenarios.mjs";

const run = (verified, credits) => ({
  verified,
  usage: { estimatedPlanCredits: credits },
});

test("ships a 30-case evaluation corpus and a short smoke profile", () => {
  assert.equal(BUILTIN_SCENARIOS.length, 30);
  assert.equal(scenariosForProfile("smoke").length, 5);
  assert.equal(scenariosForProfile("full").length, 30);
});

test("summarizes quality with Wilson confidence and measured credits", () => {
  const summary = summarizeArm([run(true, 1), run(false, 2)]);
  assert.equal(summary.successRate, 0.5);
  assert.equal(summary.estimatedPlanCredits, 3);
  assert.ok(summary.confidence95.low < 0.5);
  assert.ok(summary.confidence95.high > 0.5);
  assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 1 });
});

test("quality gate allows only the configured non-inferiority margin", () => {
  const baseline = [run(true, 2), run(true, 2), run(true, 2), run(false, 2)];
  const candidate = [run(true, 1), run(true, 1), run(false, 1), run(false, 1)];
  assert.equal(compareArms(baseline, candidate, 0).qualityGatePassed, false);
  assert.equal(compareArms(baseline, candidate, 0.25).qualityGatePassed, true);
  assert.equal(compareArms(baseline, candidate, 0.25).creditSavingPercent, 50);
});

test("reports quality and savings trends against previous evidence", () => {
  const previous = {
    comparisons: {
      router: { qualityDelta: -0.1, creditSavingPercent: 20 },
    },
  };
  const current = {
    comparisons: {
      router: { qualityDelta: 0, creditSavingPercent: 25 },
      full: { qualityDelta: 0, creditSavingPercent: 10 },
    },
  };
  assert.deepEqual(trendAgainst(previous, current), {
    router: { qualityDelta: 0.1, creditSavingPercentDelta: 5 },
    full: { status: "new-arm" },
  });
});
