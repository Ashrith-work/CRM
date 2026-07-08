import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  DashboardFunnelQueryInput,
  DashboardSalesQueryInput,
  DashboardScope,
  DashboardTeamQueryInput,
  DashboardTrendsQueryInput,
  FunnelResponse,
  MoneyByCurrency,
  ResolvedPeriod,
  SalesTiles,
  TeamRep,
  TeamResponse,
  TrendsResponse,
} from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { resolvePeriod, generateBuckets, type Period } from './dashboard.period';
import {
  computeFunnel,
  computeSalesTiles,
  computeTrends,
  sumByCurrency,
  winRate,
  type ClosedDealRow,
  type OpenDealRow,
  type TrendDealRow,
} from './dashboard.math';
import { canReadTeam, resolveScope } from './dashboard.scope';

/** Short cache TTL — dashboards read a warm aggregate, not a live recompute. */
const CACHE_TTL_SECONDS = 300;

interface Ctx {
  organizationId: string;
  userId: string;
  permissions: string[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
  ) {}

  // ----- Sales tiles -------------------------------------------------------
  async sales(ctx: Ctx, query: DashboardSalesQueryInput): Promise<SalesTiles> {
    const scope: DashboardScope = query.scope === 'me' ? 'own' : resolveScope(ctx.permissions);
    const tz = await this.users.timezoneFor(ctx.organizationId, ctx.userId);
    const period = resolvePeriod(query.period, tz, new Date(), query.from, query.to);
    const key = this.key('sales', ctx, scope, { ...query, tz });

    const cached = await this.redis.cacheGet<SalesTiles>(key);
    if (cached) return cached;

    const userIds = await this.scopeUserIds(ctx, scope);
    const owner = userFilter('ownerId', userIds);
    const assignee = userFilter('assigneeId', userIds);
    const actor = userFilter('actorId', userIds);
    const pipeline = query.pipelineId ? { pipelineId: query.pipelineId } : {};
    const now = new Date();

    const [openRows, closedRows, dealsCreated, activitiesLogged, tasksOverdue, tasksDone] =
      await Promise.all([
        this.prisma.deal.findMany({
          where: { organizationId: ctx.organizationId, deletedAt: null, status: 'OPEN', ...owner, ...pipeline },
          select: { amountMinor: true, currency: true, stage: { select: { probability: true } } },
        }),
        this.prisma.deal.findMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            status: { in: ['WON', 'LOST'] },
            closedAt: { gte: period.start, lt: period.end },
            ...owner,
            ...pipeline,
          },
          select: { amountMinor: true, currency: true, status: true },
        }),
        this.prisma.deal.count({
          where: { organizationId: ctx.organizationId, deletedAt: null, createdAt: { gte: period.start, lt: period.end }, ...owner, ...pipeline },
        }),
        this.prisma.activityEvent.count({
          where: { organizationId: ctx.organizationId, createdAt: { gte: period.start, lt: period.end }, ...actor },
        }),
        this.prisma.task.count({
          where: { organizationId: ctx.organizationId, deletedAt: null, status: 'OPEN', dueAt: { lt: now }, ...assignee },
        }),
        this.prisma.task.count({
          where: { organizationId: ctx.organizationId, deletedAt: null, status: 'DONE', completedAt: { gte: period.start, lt: period.end }, ...assignee },
        }),
      ]);

    const openDeals: OpenDealRow[] = openRows.map((d) => ({
      amountMinor: d.amountMinor,
      currency: d.currency,
      probability: d.stage?.probability ?? 0,
    }));
    const closedDeals: ClosedDealRow[] = closedRows.map((d) => ({
      amountMinor: d.amountMinor,
      currency: d.currency,
      status: d.status as 'WON' | 'LOST',
    }));

    const tiles = computeSalesTiles({ openDeals, closedDeals, dealsCreated, activitiesLogged, tasksOverdue, tasksDone });
    const payload: SalesTiles = { period: toResolved(query.period, period, tz), scope, ...tiles };
    await this.redis.cacheSet(key, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  // ----- Funnel ------------------------------------------------------------
  async funnel(ctx: Ctx, query: DashboardFunnelQueryInput): Promise<FunnelResponse> {
    const scope = resolveScope(ctx.permissions);
    const tz = await this.users.timezoneFor(ctx.organizationId, ctx.userId);
    const period = resolvePeriod(query.period, tz, new Date(), query.from, query.to);
    const key = this.key('funnel', ctx, scope, { ...query, tz });

    const cached = await this.redis.cacheGet<FunnelResponse>(key);
    if (cached) return cached;

    const userIds = await this.scopeUserIds(ctx, scope);
    const owner = userFilter('ownerId', userIds);

    const stages = await this.prisma.stage.findMany({
      where: { organizationId: ctx.organizationId, pipelineId: query.pipelineId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, position: true },
    });
    // Cohort: deals created in the period, in this pipeline, in scope.
    const cohort = await this.prisma.deal.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        pipelineId: query.pipelineId,
        createdAt: { gte: period.start, lt: period.end },
        ...owner,
      },
      select: { id: true },
    });
    const cohortIds = cohort.map((d) => d.id);
    const entries = cohortIds.length
      ? await this.prisma.stageHistory.findMany({
          where: { organizationId: ctx.organizationId, dealId: { in: cohortIds } },
          select: { dealId: true, toStageId: true },
        })
      : [];

    const { stages: funnelStages, overallConversion } = computeFunnel(stages, entries);
    const payload: FunnelResponse = {
      period: toResolved(query.period, period, tz),
      scope,
      pipelineId: query.pipelineId,
      stages: funnelStages,
      overallConversion,
    };
    await this.redis.cacheSet(key, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  // ----- Team --------------------------------------------------------------
  async team(ctx: Ctx, query: DashboardTeamQueryInput): Promise<TeamResponse> {
    if (!canReadTeam(ctx.permissions)) {
      throw new ForbiddenException('You do not have access to team metrics');
    }
    const scope = resolveScope(ctx.permissions); // 'team' or 'all'
    const tz = await this.users.timezoneFor(ctx.organizationId, ctx.userId);
    const period = resolvePeriod(query.period, tz, new Date(), query.from, query.to);
    const key = this.key('team', ctx, scope, { ...query, tz });

    const cached = await this.redis.cacheGet<TeamResponse>(key);
    if (cached) return cached;

    const repIds = await this.teamRepIds(ctx, scope);
    const reps = await this.prisma.user.findMany({
      where: { organizationId: ctx.organizationId, id: { in: repIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const inReps = { in: repIds };

    const [openByOwner, closedByOwner, activityByActor, tasksByAssignee] = await Promise.all([
      this.prisma.deal.groupBy({
        by: ['ownerId', 'currency'],
        where: { organizationId: ctx.organizationId, deletedAt: null, status: 'OPEN', ownerId: inReps },
        _sum: { amountMinor: true },
      }),
      this.prisma.deal.groupBy({
        by: ['ownerId', 'status'],
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          status: { in: ['WON', 'LOST'] },
          closedAt: { gte: period.start, lt: period.end },
          ownerId: inReps,
        },
        _count: { _all: true },
      }),
      this.prisma.activityEvent.groupBy({
        by: ['actorId'],
        where: { organizationId: ctx.organizationId, createdAt: { gte: period.start, lt: period.end }, actorId: inReps },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId'],
        where: { organizationId: ctx.organizationId, deletedAt: null, status: 'DONE', completedAt: { gte: period.start, lt: period.end }, assigneeId: inReps },
        _count: { _all: true },
      }),
    ]);

    const pipelineByUser = new Map<string, MoneyByCurrency>();
    const rawPipeline = new Map<string, Array<{ currency: string; amountMinor: number }>>();
    for (const g of openByOwner) {
      if (!g.ownerId) continue;
      const list = rawPipeline.get(g.ownerId) ?? [];
      list.push({ currency: g.currency, amountMinor: g._sum.amountMinor ?? 0 });
      rawPipeline.set(g.ownerId, list);
    }
    for (const [uid, list] of rawPipeline) pipelineByUser.set(uid, sumByCurrency(list));

    const wonLost = new Map<string, { won: number; lost: number }>();
    for (const g of closedByOwner) {
      if (!g.ownerId) continue;
      const wl = wonLost.get(g.ownerId) ?? { won: 0, lost: 0 };
      if (g.status === 'WON') wl.won += g._count._all;
      else if (g.status === 'LOST') wl.lost += g._count._all;
      wonLost.set(g.ownerId, wl);
    }
    const activityByUser = new Map<string, number>();
    for (const g of activityByActor) if (g.actorId) activityByUser.set(g.actorId, g._count._all);
    const tasksByUser = new Map<string, number>();
    for (const g of tasksByAssignee) tasksByUser.set(g.assigneeId, g._count._all);

    const rows: TeamRep[] = reps.map((u) => {
      const wl = wonLost.get(u.id) ?? { won: 0, lost: 0 };
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
      return {
        userId: u.id,
        name,
        email: u.email,
        pipelineValue: pipelineByUser.get(u.id) ?? [],
        dealsWon: wl.won,
        winRate: winRate(wl.won, wl.lost),
        activities: activityByUser.get(u.id) ?? 0,
        tasksCompleted: tasksByUser.get(u.id) ?? 0,
      };
    });
    rows.sort((a, b) => b.dealsWon - a.dealsWon || a.name.localeCompare(b.name));

    const payload: TeamResponse = { period: toResolved(query.period, period, tz), scope, reps: rows };
    await this.redis.cacheSet(key, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  // ----- Trends ------------------------------------------------------------
  async trends(ctx: Ctx, query: DashboardTrendsQueryInput): Promise<TrendsResponse> {
    const scope = resolveScope(ctx.permissions);
    const tz = await this.users.timezoneFor(ctx.organizationId, ctx.userId);
    const period = resolvePeriod(query.period, tz, new Date(), query.from, query.to);
    const key = this.key('trends', ctx, scope, { ...query, tz });

    const cached = await this.redis.cacheGet<TrendsResponse>(key);
    if (cached) return cached;

    const userIds = await this.scopeUserIds(ctx, scope);
    const owner = userFilter('ownerId', userIds);
    const pipeline = query.pipelineId ? { pipelineId: query.pipelineId } : {};
    const buckets = generateBuckets(period, query.interval, tz);

    let rows: TrendDealRow[];
    if (query.metric === 'created') {
      const deals = await this.prisma.deal.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, createdAt: { gte: period.start, lt: period.end }, ...owner, ...pipeline },
        select: { createdAt: true, amountMinor: true, currency: true },
      });
      rows = deals.map((d) => ({ when: d.createdAt, amountMinor: d.amountMinor, currency: d.currency }));
    } else {
      // 'won' and 'revenue' both key off WON deals closed in the period.
      const deals = await this.prisma.deal.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null, status: 'WON', closedAt: { gte: period.start, lt: period.end }, ...owner, ...pipeline },
        select: { closedAt: true, amountMinor: true, currency: true },
      });
      rows = deals.map((d) => ({ when: d.closedAt as Date, amountMinor: d.amountMinor, currency: d.currency }));
    }

    const payload: TrendsResponse = {
      metric: query.metric,
      interval: query.interval,
      period: toResolved(query.period, period, tz),
      scope,
      points: computeTrends(buckets, rows),
    };
    await this.redis.cacheSet(key, payload, CACHE_TTL_SECONDS);
    return payload;
  }

  // ----- Scope helpers -----------------------------------------------------
  /** User ids for a scope; null means "no user filter" (whole org). */
  private async scopeUserIds(ctx: Ctx, scope: DashboardScope): Promise<string[] | null> {
    if (scope === 'all') return null;
    if (scope === 'own') return [ctx.userId];
    return this.teamRepIds(ctx, scope);
  }

  /** Concrete rep ids for the team table (or all org users for scope 'all'). */
  private async teamRepIds(ctx: Ctx, scope: DashboardScope): Promise<string[]> {
    if (scope === 'all') {
      const users = await this.prisma.user.findMany({
        where: { organizationId: ctx.organizationId },
        select: { id: true },
      });
      return users.map((u) => u.id);
    }
    const memberships = await this.prisma.teamMembership.findMany({
      where: { organizationId: ctx.organizationId, userId: ctx.userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);
    if (teamIds.length === 0) return [ctx.userId];
    const members = await this.prisma.teamMembership.findMany({
      where: { organizationId: ctx.organizationId, teamId: { in: teamIds } },
      select: { userId: true },
    });
    return [...new Set([ctx.userId, ...members.map((m) => m.userId)])];
  }

  private key(endpoint: string, ctx: Ctx, scope: DashboardScope, params: unknown): string {
    // Own/team results depend on the requester; 'all' is shared org-wide.
    const scopePart = scope === 'all' ? 'all' : ctx.userId;
    return `dash:${endpoint}:${ctx.organizationId}:${scope}:${scopePart}:${JSON.stringify(params)}`;
  }
}

/**
 * Add a `{ field: { in: ids } }` fragment, or nothing when scope is org-wide.
 * Typed as a loose filter record so it spreads into Deal / ActivityEvent / Task
 * where-clauses alike (ownerId / actorId / assigneeId are all String columns).
 */
function userFilter(
  field: 'ownerId' | 'assigneeId' | 'actorId',
  userIds: string[] | null,
): Record<string, { in: string[] }> {
  return userIds ? { [field]: { in: userIds } } : {};
}

function toResolved(preset: ResolvedPeriod['preset'], period: Period, tz: string): ResolvedPeriod {
  return { preset, start: period.start.toISOString(), end: period.end.toISOString(), timezone: tz };
}
