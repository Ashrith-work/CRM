import { z } from 'zod';

/**
 * Milestone 4 — sales dashboard + reporting. Read-only aggregation over M1–M3
 * data (no new domain tables). Money is ALWAYS integer minor units grouped by
 * currency — never summed across currencies. Rates are fractions in [0,1] and
 * are `null` when their denominator is zero (division-by-zero guard).
 */

// ---------------------------------------------------------------------------
// Period + scope.
// ---------------------------------------------------------------------------
export const PERIOD_PRESETS = ['today', 'week', 'month', 'quarter', 'custom'] as const;
export const PeriodPresetSchema = z.enum(PERIOD_PRESETS);
export type PeriodPreset = z.infer<typeof PeriodPresetSchema>;

/** Role-derived data scope: whole org, the requester's team(s), or just self. */
export const DASHBOARD_SCOPES = ['all', 'team', 'own'] as const;
export const DashboardScopeSchema = z.enum(DASHBOARD_SCOPES);
export type DashboardScope = z.infer<typeof DashboardScopeSchema>;

/** The resolved [start, end) window (UTC instants) + the tz it was computed in. */
export const ResolvedPeriodSchema = z.object({
  preset: PeriodPresetSchema,
  start: z.string(),
  end: z.string(),
  timezone: z.string(),
});
export type ResolvedPeriod = z.infer<typeof ResolvedPeriodSchema>;

/** Money never crosses currencies — every money metric is a per-currency list. */
export const MoneyByCurrencySchema = z.array(
  z.object({ currency: z.string(), amountMinor: z.number().int() }),
);
export type MoneyByCurrency = z.infer<typeof MoneyByCurrencySchema>;

// Common query fields (period + optional custom bounds + optional pipeline).
const periodQuery = {
  period: PeriodPresetSchema.optional().default('month'),
  /** For period=custom: inclusive local dates (YYYY-MM-DD). */
  from: z.string().optional(),
  to: z.string().optional(),
};

// ---------------------------------------------------------------------------
// Sales tiles.
// ---------------------------------------------------------------------------
export const DashboardSalesQueryInput = z.object({
  ...periodQuery,
  pipelineId: z.string().optional(),
  /** 'me' forces own-scope (mobile "My performance"); 'auto' uses the role. */
  scope: z.enum(['auto', 'me']).optional().default('auto'),
});
export type DashboardSalesQueryInput = z.infer<typeof DashboardSalesQueryInput>;

export const SalesTilesSchema = z.object({
  period: ResolvedPeriodSchema,
  scope: DashboardScopeSchema,
  /** Σ amountMinor over OPEN deals (current snapshot), per currency. */
  pipelineValue: MoneyByCurrencySchema,
  /** Σ round(amountMinor × stage.probability / 100) over OPEN deals, per currency. */
  weightedPipeline: MoneyByCurrencySchema,
  /** WON deals with closedAt in the period. */
  dealsWon: z.number().int(),
  revenueWon: MoneyByCurrencySchema,
  dealsLost: z.number().int(),
  /** won / (won + lost) among deals closed in the period; null if none closed. */
  winRate: z.number().nullable(),
  /** revenueWon / dealsWon, per currency (null-free; omit currencies with 0 wins). */
  avgDealSize: MoneyByCurrencySchema,
  dealsCreated: z.number().int(),
  activitiesLogged: z.number().int(),
  tasksOverdue: z.number().int(),
  tasksDone: z.number().int(),
});
export type SalesTiles = z.infer<typeof SalesTilesSchema>;

// ---------------------------------------------------------------------------
// Funnel (from stage history).
// ---------------------------------------------------------------------------
export const DashboardFunnelQueryInput = z.object({
  pipelineId: z.string().min(1),
  ...periodQuery,
});
export type DashboardFunnelQueryInput = z.infer<typeof DashboardFunnelQueryInput>;

export const FunnelStageSchema = z.object({
  stageId: z.string(),
  stageName: z.string(),
  position: z.number().int(),
  /** DISTINCT deals that passed through this stage (per stage_history). */
  dealsEntered: z.number().int(),
  /** dealsEntered(this) / dealsEntered(prev); null for the first stage or /0. */
  conversionFromPrev: z.number().nullable(),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const FunnelResponseSchema = z.object({
  period: ResolvedPeriodSchema,
  scope: DashboardScopeSchema,
  pipelineId: z.string(),
  stages: z.array(FunnelStageSchema),
  /** last-stage entrants / first-stage entrants; null if none entered. */
  overallConversion: z.number().nullable(),
});
export type FunnelResponse = z.infer<typeof FunnelResponseSchema>;

// ---------------------------------------------------------------------------
// Team performance (managers/owner only).
// ---------------------------------------------------------------------------
export const DashboardTeamQueryInput = z.object({ ...periodQuery });
export type DashboardTeamQueryInput = z.infer<typeof DashboardTeamQueryInput>;

export const TeamRepSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  pipelineValue: MoneyByCurrencySchema,
  dealsWon: z.number().int(),
  winRate: z.number().nullable(),
  activities: z.number().int(),
  tasksCompleted: z.number().int(),
});
export type TeamRep = z.infer<typeof TeamRepSchema>;

export const TeamResponseSchema = z.object({
  period: ResolvedPeriodSchema,
  scope: DashboardScopeSchema,
  reps: z.array(TeamRepSchema),
});
export type TeamResponse = z.infer<typeof TeamResponseSchema>;

// ---------------------------------------------------------------------------
// Trends (time series).
// ---------------------------------------------------------------------------
export const TREND_METRICS = ['won', 'created', 'revenue'] as const;
export const TrendMetricSchema = z.enum(TREND_METRICS);
export type TrendMetric = z.infer<typeof TrendMetricSchema>;

export const TREND_INTERVALS = ['week', 'month'] as const;
export const TrendIntervalSchema = z.enum(TREND_INTERVALS);
export type TrendInterval = z.infer<typeof TrendIntervalSchema>;

export const DashboardTrendsQueryInput = z.object({
  metric: TrendMetricSchema.optional().default('won'),
  interval: TrendIntervalSchema.optional().default('month'),
  pipelineId: z.string().optional(),
  ...periodQuery,
});
export type DashboardTrendsQueryInput = z.infer<typeof DashboardTrendsQueryInput>;

export const TrendPointSchema = z.object({
  start: z.string(),
  end: z.string(),
  /** Count for the metric (deals won / created) in the bucket. */
  count: z.number().int(),
  /** Money for the metric (revenue won / created pipeline), per currency. */
  valueByCurrency: MoneyByCurrencySchema,
});
export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const TrendsResponseSchema = z.object({
  metric: TrendMetricSchema,
  interval: TrendIntervalSchema,
  period: ResolvedPeriodSchema,
  scope: DashboardScopeSchema,
  points: z.array(TrendPointSchema),
});
export type TrendsResponse = z.infer<typeof TrendsResponseSchema>;
