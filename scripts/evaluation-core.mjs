export function wilsonInterval(successes, total, z = 1.96) {
  if (total <= 0) return { low: 0, high: 1 };
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = proportion + (z * z) / (2 * total);
  const margin =
    z *
    Math.sqrt(
      (proportion * (1 - proportion)) / total +
        (z * z) / (4 * total * total),
    );
  return {
    low: Math.max(0, (center - margin) / denominator),
    high: Math.min(1, (center + margin) / denominator),
  };
}

export function summarizeArm(runs) {
  const successes = runs.filter((run) => run.verified).length;
  const total = runs.length;
  const estimatedPlanCredits = runs.reduce(
    (sum, run) => sum + run.usage.estimatedPlanCredits,
    0,
  );
  return {
    successes,
    total,
    successRate: total > 0 ? successes / total : 0,
    confidence95: wilsonInterval(successes, total),
    estimatedPlanCredits,
    averageCredits: total > 0 ? estimatedPlanCredits / total : 0,
  };
}

export function compareArms(baselineRuns, candidateRuns, maxQualityDrop = 0) {
  const baseline = summarizeArm(baselineRuns);
  const candidate = summarizeArm(candidateRuns);
  const qualityDelta = candidate.successRate - baseline.successRate;
  const creditSavingPercent =
    baseline.estimatedPlanCredits > 0
      ? ((baseline.estimatedPlanCredits - candidate.estimatedPlanCredits) /
          baseline.estimatedPlanCredits) *
        100
      : null;
  return {
    baseline,
    candidate,
    qualityDelta,
    maxQualityDrop,
    qualityGatePassed: qualityDelta >= -maxQualityDrop,
    creditDelta:
      candidate.estimatedPlanCredits - baseline.estimatedPlanCredits,
    creditSavingPercent,
  };
}

export function trendAgainst(previous, current) {
  if (!previous?.comparisons || !current?.comparisons) return undefined;
  return Object.fromEntries(
    Object.entries(current.comparisons).map(([arm, comparison]) => {
      const prior = previous.comparisons[arm];
      return [
        arm,
        prior
          ? {
              qualityDelta:
                comparison.qualityDelta - (prior.qualityDelta ?? 0),
              creditSavingPercentDelta:
                comparison.creditSavingPercent === null ||
                prior.creditSavingPercent === null
                  ? null
                  : comparison.creditSavingPercent -
                    prior.creditSavingPercent,
            }
          : { status: "new-arm" },
      ];
    }),
  );
}
