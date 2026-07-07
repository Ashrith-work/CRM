import type { FunnelStage, MoneyByCurrency, TrendPoint } from '@crm/types';
import type { Period } from './dashboard.period';

/**
 * Pure dashboard aggregation. Every function here is deterministic and
 * framework-free (no Prisma, no Redis) so it can be golden-tested against a
 * hand-computed dataset. The service's only job is to fetch the minimal rows
 * and hand them to these functions.
 *
 * Money rule: integer minor units, grouped by currency, NEVER summed across
 * currencies. Rates are fractions in [0,1] and `null` when the denominator is 0.
 */

export interface OpenDealRow {
  amountMinor: number;
  currency: string;
  /** stage.probability, 0–100. */
  probability: number;
}

export interface ClosedDealRow {
  amountMinor: number;
  currency: string;
  status: 'WON' | 'LOST';
}

/** Sum amounts per currency; result is sorted by currency for stable output. */
export function sumByCurrency(items: Array<{ currency: string; amountMinor: number }>): MoneyByCurrency {
  const map = new Map<string, number>();
  for (const it of items) map.set(it.currency, (map.get(it.currency) ?? 0) + it.amountMinor);
  return [...map.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Weighted pipeline per currency: round(Σ(amountMinor × probability) / 100).
 * amountMinor and probability are integers, so the product is exact; a single
 * round per currency avoids per-deal rounding drift.
 */
export function weightedByCurrency(open: OpenDealRow[]): MoneyByCurrency {
  const map = new Map<string, number>();
  for (const d of open) map.set(d.currency, (map.get(d.currency) ?? 0) + d.amountMinor * d.probability);
  return [...map.entries()]
    .map(([currency, product]) => ({ currency, amountMinor: Math.round(product / 100) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

/** won / (won + lost); null when no deals closed (division-by-zero guard). */
export function winRate(won: number, lost: number): number | null {
  const total = won + lost;
  return total === 0 ? null : won / total;
}

export interface TilesInput {
  openDeals: OpenDealRow[];
  /** Deals closed (WON/LOST) within the period. */
  closedDeals: ClosedDealRow[];
  dealsCreated: number;
  activitiesLogged: number;
  tasksOverdue: number;
  tasksDone: number;
}

export interface TilesResult {
  pipelineValue: MoneyByCurrency;
  weightedPipeline: MoneyByCurrency;
  dealsWon: number;
  revenueWon: MoneyByCurrency;
  dealsLost: number;
  winRate: number | null;
  avgDealSize: MoneyByCurrency;
  dealsCreated: number;
  activitiesLogged: number;
  tasksOverdue: number;
  tasksDone: number;
}

export function computeSalesTiles(input: TilesInput): TilesResult {
  const won = input.closedDeals.filter((d) => d.status === 'WON');
  const lost = input.closedDeals.filter((d) => d.status === 'LOST');

  // Per-currency won count + sum for revenue and average deal size.
  const wonByCurrency = new Map<string, { count: number; sum: number }>();
  for (const d of won) {
    const agg = wonByCurrency.get(d.currency) ?? { count: 0, sum: 0 };
    agg.count += 1;
    agg.sum += d.amountMinor;
    wonByCurrency.set(d.currency, agg);
  }

  const revenueWon = [...wonByCurrency.entries()]
    .map(([currency, { sum }]) => ({ currency, amountMinor: sum }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const avgDealSize = [...wonByCurrency.entries()]
    .map(([currency, { count, sum }]) => ({ currency, amountMinor: Math.round(sum / count) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    pipelineValue: sumByCurrency(input.openDeals),
    weightedPipeline: weightedByCurrency(input.openDeals),
    dealsWon: won.length,
    revenueWon,
    dealsLost: lost.length,
    winRate: winRate(won.length, lost.length),
    avgDealSize,
    dealsCreated: input.dealsCreated,
    activitiesLogged: input.activitiesLogged,
    tasksOverdue: input.tasksOverdue,
    tasksDone: input.tasksDone,
  };
}

// ---------------------------------------------------------------------------
// Funnel.
// ---------------------------------------------------------------------------
export interface StageRef {
  id: string;
  name: string;
  position: number;
}

/** One stage_history row: a deal entered a stage. */
export interface StageEntry {
  dealId: string;
  toStageId: string;
}

/**
 * Funnel from stage history: for each stage, the count of DISTINCT deals that
 * passed through it (any stage_history row with toStageId = stage). A won deal
 * still counts in the earlier stages it moved through; reopened/backward moves
 * produce extra rows but are de-duped by dealId.
 */
export function computeFunnel(
  stages: StageRef[],
  entries: StageEntry[],
): { stages: FunnelStage[]; overallConversion: number | null } {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const dealsByStage = new Map<string, Set<string>>();
  for (const s of ordered) dealsByStage.set(s.id, new Set());
  for (const e of entries) dealsByStage.get(e.toStageId)?.add(e.dealId);

  const result: FunnelStage[] = ordered.map((s, i) => {
    const entered = dealsByStage.get(s.id)?.size ?? 0;
    const prevEntered = i === 0 ? null : (dealsByStage.get(ordered[i - 1].id)?.size ?? 0);
    const conversionFromPrev =
      prevEntered === null ? null : prevEntered === 0 ? null : entered / prevEntered;
    return {
      stageId: s.id,
      stageName: s.name,
      position: s.position,
      dealsEntered: entered,
      conversionFromPrev,
    };
  });

  const first = result[0]?.dealsEntered ?? 0;
  const last = result[result.length - 1]?.dealsEntered ?? 0;
  const overallConversion = result.length < 2 || first === 0 ? null : last / first;
  return { stages: result, overallConversion };
}

// ---------------------------------------------------------------------------
// Trends.
// ---------------------------------------------------------------------------
export interface TrendDealRow {
  /** closedAt for won/revenue, createdAt for created. */
  when: Date;
  amountMinor: number;
  currency: string;
}

/** Bucket deals into the given periods: count + money-by-currency per bucket. */
export function computeTrends(buckets: Period[], deals: TrendDealRow[]): TrendPoint[] {
  return buckets.map((b) => {
    const inBucket = deals.filter((d) => d.when >= b.start && d.when < b.end);
    return {
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      count: inBucket.length,
      valueByCurrency: sumByCurrency(inBucket),
    };
  });
}
