import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BoardResponse,
  BoardColumn,
  CreateDealInput,
  CustomFieldValues,
  Deal as DealDto,
  DealListQueryInput,
  MoveDealInput,
  ReopenDealInput,
  StageHistory as StageHistoryDto,
  Tag,
  UpdateDealInput,
} from '@crm/types';
import { Prisma, type ActivityEventType, type Deal as DealRow, type Stage as StageRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TagsService } from '../tags/tags.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { resolveActors } from '../common/actors.util';
import { cursorArgs, resolveOrderBy, toPage } from '../common/list.util';
import { serializeStage } from '../stages/stages.service';
import { serializePipeline } from '../pipelines/pipelines.service';

const SORTABLE = ['name', 'amountMinor', 'expectedCloseDate', 'createdAt', 'updatedAt'] as const;
const BOARD_PAGE = 25;

const DEAL_INCLUDE = {
  contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  company: { select: { id: true, name: true } },
} as const;
type DealWithRefs = Prisma.DealGetPayload<{ include: typeof DEAL_INCLUDE }>;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly tags: TagsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  // ----- Reads -------------------------------------------------------------
  async list(
    organizationId: string,
    query: DealListQueryInput,
  ): Promise<{ data: DealDto[]; nextCursor: string | null }> {
    const where: Prisma.DealWhereInput = { organizationId, deletedAt: null };
    if (query.pipelineId) where.pipelineId = query.pipelineId;
    if (query.stageId) where.stageId = query.stageId;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.status) where.status = query.status;
    if (query.contactId) where.contactId = query.contactId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.search) where.name = { contains: query.search, mode: 'insensitive' };

    const rows = await this.prisma.deal.findMany({
      where,
      include: DEAL_INCLUDE,
      orderBy: resolveOrderBy(query.sort, query.order, SORTABLE),
      take: query.limit + 1,
      ...cursorArgs(query.cursor),
    });
    const page = toPage(rows, query.limit);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'DEAL', page.data.map((d) => d.id));
    return {
      data: page.data.map((d) => serializeDeal(d, tagMap.get(d.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async get(organizationId: string, id: string): Promise<DealDto> {
    const deal = await this.prisma.deal.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: DEAL_INCLUDE,
    });
    if (!deal) throw new NotFoundException('Deal not found');
    const tagMap = await this.tags.tagsForEntities(organizationId, 'DEAL', [id]);
    return serializeDeal(deal, tagMap.get(id) ?? []);
  }

  // ----- Writes ------------------------------------------------------------
  async create(
    organizationId: string,
    input: CreateDealInput,
    actorId: string,
    source = 'api',
  ): Promise<DealDto> {
    const customFields = await this.customFields.validate(organizationId, 'DEAL', input.customFields);
    const stages = await this.pipelineStages(organizationId, input.pipelineId);
    const stage = input.stageId
      ? stages.find((s) => s.id === input.stageId)
      : stages[0];
    if (!stage) {
      throw new BadRequestException(
        input.stageId ? 'stageId is not a stage of this pipeline' : 'Pipeline has no stages',
      );
    }
    await this.assertLinks(organizationId, input.contactId ?? null, input.companyId ?? null);

    const deal = await this.prisma.deal.create({
      data: {
        organizationId,
        name: input.name,
        pipelineId: input.pipelineId,
        stageId: stage.id,
        amountMinor: input.amountMinor ?? 0,
        currency: input.currency ?? 'USD',
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        ownerId: input.ownerId ?? actorId,
        contactId: input.contactId ?? null,
        companyId: input.companyId ?? null,
        customFields: customFields as Prisma.InputJsonValue,
        status: stage.type === 'WON' ? 'WON' : stage.type === 'LOST' ? 'LOST' : 'OPEN',
        closedAt: stage.type === 'OPEN' ? null : new Date(),
      },
    });

    // Opening stage-history row so the progression view has a starting point.
    await this.prisma.stageHistory.create({
      data: { organizationId, dealId: deal.id, fromStageId: null, toStageId: stage.id, changedById: actorId },
    });

    if (input.tagIds?.length) {
      await this.tags.setEntityTags(organizationId, 'DEAL', deal.id, input.tagIds, actorId);
    }
    await this.emitDealActivity(deal, 'CREATED', actorId, { stageName: stage.name }, source);
    return this.get(organizationId, deal.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateDealInput,
    actorId: string,
    source = 'api',
  ): Promise<DealDto> {
    const current = await this.requireDeal(organizationId, id);
    const customFields =
      input.customFields !== undefined
        ? await this.customFields.validate(organizationId, 'DEAL', input.customFields)
        : undefined;
    if (input.contactId !== undefined || input.companyId !== undefined) {
      await this.assertLinks(
        organizationId,
        input.contactId === undefined ? current.contactId : input.contactId,
        input.companyId === undefined ? current.companyId : input.companyId,
      );
    }

    await this.prisma.deal.update({
      where: { id },
      data: {
        name: input.name,
        amountMinor: input.amountMinor,
        currency: input.currency,
        ...(input.expectedCloseDate !== undefined
          ? { expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null }
          : {}),
        ownerId: input.ownerId,
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
        ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
      },
    });

    if (input.tagIds) {
      await this.tags.setEntityTags(organizationId, 'DEAL', id, input.tagIds, actorId);
    }
    const after = await this.requireDeal(organizationId, id);
    await this.emitDealActivity(after, 'UPDATED', actorId, {}, source);
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireDeal(organizationId, id);
    await this.prisma.deal.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Move a deal to another stage in ONE transaction: update stageId, append a
   * StageHistory row (with secondsInPreviousStage), and set WON/LOST status +
   * closedAt when the target is terminal. Emits STAGE_CHANGED (+ WON/LOST),
   * mirrored onto the linked contact/company timelines.
   */
  async move(
    organizationId: string,
    id: string,
    input: MoveDealInput,
    actorId: string,
    source = 'api',
  ): Promise<DealDto> {
    const deal = await this.requireDeal(organizationId, id);
    if (deal.status !== 'OPEN') {
      throw new ConflictException('Deal is WON/LOST; reopen it before moving');
    }
    const toStage = await this.stageInPipeline(organizationId, deal.pipelineId, input.toStageId);
    if (toStage.id === deal.stageId) return this.get(organizationId, id); // no-op

    const fromStageId = deal.stageId;
    const seconds = await this.secondsInCurrentStage(organizationId, deal, fromStageId);
    const terminal = toStage.type === 'WON' ? 'WON' : toStage.type === 'LOST' ? 'LOST' : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id },
        data: {
          stageId: toStage.id,
          status: terminal ?? 'OPEN',
          closedAt: terminal ? new Date() : null,
        },
      });
      await tx.stageHistory.create({
        data: {
          organizationId,
          dealId: id,
          fromStageId,
          toStageId: toStage.id,
          changedById: actorId,
          secondsInPreviousStage: seconds,
        },
      });
    });

    await this.emitDealActivity(deal, 'STAGE_CHANGED', actorId, { fromStageId, toStageId: toStage.id, toStageName: toStage.name }, source);
    if (terminal === 'WON') await this.emitDealActivity(deal, 'WON', actorId, { stageName: toStage.name }, source);
    if (terminal === 'LOST') await this.emitDealActivity(deal, 'LOST', actorId, { stageName: toStage.name }, source);

    return this.get(organizationId, id);
  }

  /** Reopen a WON/LOST deal into an OPEN stage (defaults to the first open stage). */
  async reopen(
    organizationId: string,
    id: string,
    input: ReopenDealInput,
    actorId: string,
    source = 'api',
  ): Promise<DealDto> {
    const deal = await this.requireDeal(organizationId, id);
    if (deal.status === 'OPEN') throw new ConflictException('Deal is already open');

    const stages = await this.pipelineStages(organizationId, deal.pipelineId);
    const target = input.toStageId
      ? stages.find((s) => s.id === input.toStageId)
      : stages.find((s) => s.type === 'OPEN');
    if (!target) throw new BadRequestException('No open stage available to reopen into');

    const fromStageId = deal.stageId;
    const seconds = await this.secondsInCurrentStage(organizationId, deal, fromStageId);

    await this.prisma.$transaction(async (tx) => {
      await tx.deal.update({ where: { id }, data: { stageId: target.id, status: 'OPEN', closedAt: null } });
      await tx.stageHistory.create({
        data: { organizationId, dealId: id, fromStageId, toStageId: target.id, changedById: actorId, secondsInPreviousStage: seconds },
      });
    });

    await this.emitDealActivity(deal, 'REOPENED', actorId, { toStageId: target.id, toStageName: target.name }, source);
    return this.get(organizationId, id);
  }

  // ----- Stage history + board --------------------------------------------
  async stageHistory(organizationId: string, dealId: string): Promise<StageHistoryDto[]> {
    await this.requireDeal(organizationId, dealId);
    const rows = await this.prisma.stageHistory.findMany({
      where: { organizationId, dealId },
      orderBy: { changedAt: 'asc' },
    });
    const stageIds = new Set<string>();
    rows.forEach((r) => {
      if (r.fromStageId) stageIds.add(r.fromStageId);
      stageIds.add(r.toStageId);
    });
    const stages = await this.prisma.stage.findMany({
      where: { organizationId, id: { in: [...stageIds] } },
      select: { id: true, name: true },
    });
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    const actors = await resolveActors(this.prisma, organizationId, rows.map((r) => r.changedById));

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      dealId: r.dealId,
      fromStageId: r.fromStageId,
      fromStageName: r.fromStageId ? (stageName.get(r.fromStageId) ?? null) : null,
      toStageId: r.toStageId,
      toStageName: stageName.get(r.toStageId) ?? null,
      changedById: r.changedById,
      changedBy: actors.get(r.changedById) ?? null,
      changedAt: r.changedAt.toISOString(),
      secondsInPreviousStage: r.secondsInPreviousStage,
    }));
  }

  async board(organizationId: string, pipelineId: string): Promise<BoardResponse> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId, deletedAt: null },
      include: { stages: { where: { deletedAt: null }, orderBy: { position: 'asc' } } },
    });
    if (!pipeline) throw new NotFoundException('Pipeline not found');

    // Per-stage count + sum in one grouped query.
    const grouped = await this.prisma.deal.groupBy({
      by: ['stageId'],
      where: { organizationId, pipelineId, deletedAt: null },
      _count: { _all: true },
      _sum: { amountMinor: true },
    });
    const byStage = new Map(grouped.map((g) => [g.stageId, { count: g._count._all, sum: g._sum.amountMinor ?? 0 }]));

    // A page of deals per stage.
    const pageByStage = new Map<string, DealWithRefs[]>();
    for (const stage of pipeline.stages) {
      const rows = await this.prisma.deal.findMany({
        where: { organizationId, pipelineId, stageId: stage.id, deletedAt: null },
        include: DEAL_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: BOARD_PAGE + 1,
      });
      pageByStage.set(stage.id, rows);
    }

    const allDealIds = [...pageByStage.values()].flat().map((d) => d.id);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'DEAL', allDealIds);

    let totalCount = 0;
    let totalSum = 0;
    let totalWeighted = 0;
    const columns: BoardColumn[] = pipeline.stages.map((stage) => {
      const agg = byStage.get(stage.id) ?? { count: 0, sum: 0 };
      const weighted = computeWeightedMinor(agg.sum, stage.probability);
      totalCount += agg.count;
      totalSum += agg.sum;
      totalWeighted += weighted;

      const rows = pageByStage.get(stage.id) ?? [];
      const page = toPage(rows, BOARD_PAGE);
      return {
        stage: serializeStage(stage),
        totals: { count: agg.count, sumMinor: agg.sum, weightedMinor: weighted },
        deals: page.data.map((d) => serializeDeal(d, tagMap.get(d.id) ?? [])),
        nextCursor: page.nextCursor,
      };
    });

    return {
      pipeline: serializePipeline(pipeline),
      columns,
      totals: { count: totalCount, sumMinor: totalSum, weightedMinor: totalWeighted },
    };
  }

  // ----- Helpers -----------------------------------------------------------
  private async emitDealActivity(
    deal: Pick<DealRow, 'organizationId' | 'id' | 'name' | 'contactId' | 'companyId'>,
    eventType: ActivityEventType,
    actorId: string,
    metadata: Record<string, unknown>,
    source: string,
  ): Promise<void> {
    const meta = metadata as Prisma.InputJsonValue;
    await this.activity.emit({ organizationId: deal.organizationId, entityType: 'DEAL', entityId: deal.id, eventType, actorId, metadata: meta, source });
    const mirror = { ...metadata, dealId: deal.id, dealName: deal.name } as Prisma.InputJsonValue;
    if (deal.contactId) {
      await this.activity.emit({ organizationId: deal.organizationId, entityType: 'CONTACT', entityId: deal.contactId, eventType, actorId, metadata: mirror, source });
    }
    if (deal.companyId) {
      await this.activity.emit({ organizationId: deal.organizationId, entityType: 'COMPANY', entityId: deal.companyId, eventType, actorId, metadata: mirror, source });
    }
  }

  /** Seconds the deal has spent in its current stage (since it entered it). */
  private async secondsInCurrentStage(
    organizationId: string,
    deal: DealRow,
    currentStageId: string,
  ): Promise<number> {
    const lastEnter = await this.prisma.stageHistory.findFirst({
      where: { organizationId, dealId: deal.id, toStageId: currentStageId },
      orderBy: { changedAt: 'desc' },
      select: { changedAt: true },
    });
    const enteredAt = lastEnter?.changedAt ?? deal.createdAt;
    return Math.max(0, Math.floor((Date.now() - enteredAt.getTime()) / 1000));
  }

  private async pipelineStages(organizationId: string, pipelineId: string): Promise<StageRow[]> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!pipeline) throw new BadRequestException('pipelineId does not reference a pipeline in this org');
    return this.prisma.stage.findMany({
      where: { organizationId, pipelineId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
  }

  private async stageInPipeline(
    organizationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<StageRow> {
    const stage = await this.prisma.stage.findFirst({
      where: { id: stageId, organizationId, pipelineId, deletedAt: null },
    });
    if (!stage) throw new BadRequestException('toStageId is not a stage of this deal’s pipeline');
    return stage;
  }

  private async assertLinks(
    organizationId: string,
    contactId: string | null,
    companyId: string | null,
  ): Promise<void> {
    if (contactId) {
      const c = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId, deletedAt: null }, select: { id: true } });
      if (!c) throw new BadRequestException('contactId does not reference a contact in this org');
    }
    if (companyId) {
      const c = await this.prisma.company.findFirst({ where: { id: companyId, organizationId, deletedAt: null }, select: { id: true } });
      if (!c) throw new BadRequestException('companyId does not reference a company in this org');
    }
  }

  private async requireDeal(organizationId: string, id: string): Promise<DealRow> {
    const deal = await this.prisma.deal.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }
}

/**
 * Weighted pipeline value in minor units: sum(amountMinor) * probability / 100,
 * rounded to the nearest minor unit. Money stays integer end-to-end.
 */
export function computeWeightedMinor(sumMinor: number, probability: number): number {
  return Math.round((sumMinor * probability) / 100);
}

export function serializeDeal(deal: DealWithRefs, tags: Tag[]): DealDto {
  return {
    id: deal.id,
    organizationId: deal.organizationId,
    name: deal.name,
    pipelineId: deal.pipelineId,
    stageId: deal.stageId,
    amountMinor: deal.amountMinor,
    currency: deal.currency,
    expectedCloseDate: deal.expectedCloseDate ? deal.expectedCloseDate.toISOString() : null,
    ownerId: deal.ownerId,
    contactId: deal.contactId,
    contact: deal.contact
      ? {
          id: deal.contact.id,
          firstName: deal.contact.firstName,
          lastName: deal.contact.lastName,
          email: deal.contact.email,
          phone: deal.contact.phone,
        }
      : null,
    companyId: deal.companyId,
    company: deal.company ? { id: deal.company.id, name: deal.company.name } : null,
    status: deal.status,
    closedAt: deal.closedAt ? deal.closedAt.toISOString() : null,
    customFields: (deal.customFields as CustomFieldValues) ?? {},
    tags,
    createdAt: deal.createdAt.toISOString(),
    updatedAt: deal.updatedAt.toISOString(),
  };
}
