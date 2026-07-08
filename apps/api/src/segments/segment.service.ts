import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  RuleGroup,
  SaveSegmentInput,
  Segment as SegmentDto,
  SegmentPreviewResponse,
  SegmentSampleRow,
} from '@crm/types';
import { Prisma, type Segment as SegmentRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { maskEmail } from '../common/pii.util';
import { translateRules } from './segment.engine';

const SAMPLE_SIZE = 20;

/**
 * JSON rule-tree segments over CustomerFeatures. Preview returns a count +
 * 20-row sample; STATIC segments snapshot membership at save, DYNAMIC ones are
 * recomputed by the nightly refresh. All queries are the SAFE translated Prisma
 * `where` (never string-concatenated).
 */
@Injectable()
export class SegmentService {
  constructor(private readonly prisma: PrismaService) {}

  private where(organizationId: string, rules: RuleGroup): Prisma.CustomerFeaturesWhereInput {
    return { organizationId, AND: [translateRules(rules)] };
  }

  async preview(organizationId: string, rules: RuleGroup, unmasked: boolean): Promise<SegmentPreviewResponse> {
    const where = this.where(organizationId, rules);
    const [count, rows] = await Promise.all([
      this.prisma.customerFeatures.count({ where }),
      this.prisma.customerFeatures.findMany({ where, orderBy: { netRevenueMinor: 'desc' }, take: SAMPLE_SIZE }),
    ]);
    const sample = await this.decorate(organizationId, rows, unmasked);
    return { count, sample };
  }

  async save(organizationId: string, actorUserId: string, input: SaveSegmentInput): Promise<SegmentDto> {
    const segment = await this.prisma.segment.create({
      data: {
        organizationId,
        name: input.name,
        description: input.description ?? null,
        rules: input.rules as unknown as Prisma.InputJsonValue,
        type: input.type,
        refreshCron: input.refreshCron ?? null,
        createdById: actorUserId,
      },
    });
    // Snapshot membership now (STATIC keeps it; DYNAMIC seeds it, refresh updates it).
    await this.recompute(organizationId, segment.id, input.rules);
    return this.serialize(await this.require(organizationId, segment.id));
  }

  async list(organizationId: string): Promise<SegmentDto[]> {
    const rows = await this.prisma.segment.findMany({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return rows.map(serializeSegment);
  }

  async get(organizationId: string, id: string): Promise<SegmentDto> {
    return this.serialize(await this.require(organizationId, id));
  }

  async members(organizationId: string, id: string, cursor: string | undefined, limit: number, unmasked: boolean): Promise<{ data: SegmentSampleRow[]; nextCursor: string | null }> {
    await this.require(organizationId, id);
    const memberships = await this.prisma.segmentMembership.findMany({
      where: { organizationId, segmentId: id },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = memberships.length > limit;
    const page = hasMore ? memberships.slice(0, limit) : memberships;
    const features = await this.prisma.customerFeatures.findMany({ where: { organizationId, customerId: { in: page.map((m) => m.customerId) } } });
    const data = await this.decorate(organizationId, features, unmasked);
    const last = page[page.length - 1];
    return { data, nextCursor: hasMore && last ? last.id : null };
  }

  /** Recompute a dynamic segment's membership now (also used at save time). */
  async recompute(organizationId: string, segmentId: string, rules: RuleGroup): Promise<number> {
    const where = this.where(organizationId, rules);
    const matches = await this.prisma.customerFeatures.findMany({ where, select: { customerId: true } });

    await this.prisma.$transaction([
      this.prisma.segmentMembership.deleteMany({ where: { organizationId, segmentId } }),
      this.prisma.segmentMembership.createMany({
        data: matches.map((m) => ({ organizationId, segmentId, customerId: m.customerId })),
        skipDuplicates: true,
      }),
      this.prisma.segment.update({ where: { id: segmentId }, data: { memberCount: matches.length, lastRefreshedAt: new Date() } }),
    ]);
    return matches.length;
  }

  /** Nightly: recompute every DYNAMIC segment's membership. */
  async refreshDynamic(): Promise<number> {
    const segments = await this.prisma.segment.findMany({ where: { type: 'DYNAMIC', deletedAt: null } });
    let refreshed = 0;
    for (const s of segments) {
      await this.recompute(s.organizationId, s.id, s.rules as unknown as RuleGroup);
      refreshed += 1;
    }
    return refreshed;
  }

  // ----- helpers ----------------------------------------------------------
  private async decorate(organizationId: string, features: Array<{ customerId: string; netRevenueMinor: number; rSegment: string | null }>, unmasked: boolean): Promise<SegmentSampleRow[]> {
    const customers = await this.prisma.customer.findMany({ where: { organizationId, id: { in: features.map((f) => f.customerId) } } });
    const byId = new Map(customers.map((c) => [c.id, c]));
    return features.map((f) => {
      const c = byId.get(f.customerId);
      const name = c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.externalId || f.customerId : f.customerId;
      return {
        customerId: f.customerId,
        name,
        email: c ? (unmasked ? c.email : maskEmail(c.email)) : null,
        netRevenueMinor: f.netRevenueMinor,
        rSegment: f.rSegment,
      };
    });
  }

  private async require(organizationId: string, id: string): Promise<SegmentRow> {
    const s = await this.prisma.segment.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!s) throw new NotFoundException('Segment not found');
    return s;
  }

  private serialize(row: SegmentRow): SegmentDto {
    return serializeSegment(row);
  }
}

export function serializeSegment(row: SegmentRow): SegmentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description,
    rules: row.rules as unknown,
    type: row.type,
    refreshCron: row.refreshCron,
    memberCount: row.memberCount,
    lastRefreshedAt: row.lastRefreshedAt ? row.lastRefreshedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
