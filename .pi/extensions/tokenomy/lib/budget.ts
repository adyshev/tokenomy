export type BudgetTier = "simple" | "medium" | "complex";

export interface BudgetThreshold {
  name: "session" | "daily" | `tier:${BudgetTier}`;
  used: number;
  limit: number;
  effectiveLimit: number;
}

export function reachedBudgetThresholds(input: {
  tier: BudgetTier;
  sessionUsed: number;
  sessionLimit: number;
  dailyUsed: number;
  dailyLimit: number;
  tierUsed: number;
  tierLimit: number;
  warnAtPercent: number;
  reserveCredits: number;
}): BudgetThreshold[] {
  const reserve = Math.max(0, input.reserveCredits);
  const candidates: BudgetThreshold[] = [
    {
      name: "session",
      used: input.sessionUsed,
      limit: input.sessionLimit,
      effectiveLimit: Math.max(0, input.sessionLimit - reserve),
    },
    {
      name: "daily",
      used: input.dailyUsed,
      limit: input.dailyLimit,
      effectiveLimit: Math.max(0, input.dailyLimit - reserve),
    },
    {
      name: `tier:${input.tier}`,
      used: input.tierUsed,
      limit: input.tierLimit,
      effectiveLimit: input.tierLimit,
    },
  ];
  return candidates.filter(
    ({ used, limit, effectiveLimit }) =>
      limit > 0 &&
      used >= effectiveLimit * (input.warnAtPercent / 100),
  );
}

export function downshiftTier(
  tier: BudgetTier,
  maximumSteps: number,
): BudgetTier {
  const order: BudgetTier[] = ["simple", "medium", "complex"];
  const index = order.indexOf(tier);
  return order[Math.max(0, index - Math.max(1, Math.min(2, maximumSteps)))];
}

export function estimatedTurnsRemaining(
  used: number,
  limit: number,
  averageCredits: number,
): number | undefined {
  if (limit <= 0 || averageCredits <= 0) return undefined;
  return Math.max(0, Math.floor((limit - used) / averageCredits));
}
