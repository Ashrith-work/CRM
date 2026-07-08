import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Customer360,
  CustomerListItem,
  CustomerListQueryInput,
  InteractionType,
  RecentOrder,
  RecentOrdersQueryInput,
  TimelineItem,
  TimelineQueryInput,
} from '@crm/types';
import { Prisma, type Customer as CustomerRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { maskEmail, maskPhone } from '../common/pii.util';

const PROFILE_TTL_SECONDS = 60;
const LIST_SORTS = new Set(['netRevenueMinor', 'orderCount', 'lastOrderAt']);

/**
 * Customer 360 reads: a cached profile (identity + consents + denormalized
 * feature badges), the unified timeline (ONE indexed Interaction query), the
 * recent-orders panel with a range control, and the customer list. Built for
 * P95 < 300ms on 100k customers via the Interaction/Features indexes + cache.
 */
@Injectable()
export class Customer360Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ----- Profile (cached) -------------------------------------------------
  async get360(organizationId: string, id: string, unmasked: boolean): Promise<Customer360> {
    const customer = await this.resolveSurvivor(organizationId, id);
    const key = `c360:${organizationId}:${customer.id}:${unmasked ? 'u' : 'm'}`;

    const cached = await this.redis.cacheGet<Customer360>(key);
    if (cached) return cached;

    const features = await this.prisma.customerFeatures.findUnique({
      where: { organizationId_customerId: { organizationId, customerId: customer.id } },
    });

    const payload: Customer360 = {
      id: customer.id,
      externalId: customer.externalId,
      email: unmasked ? customer.email : maskEmail(customer.email),
      phone: unmasked ? customer.phone : maskPhone(customer.phone),
      firstName: customer.firstName,
      lastName: customer.lastName,
      mergedIntoId: customer.mergedIntoId,
      masked: !unmasked,
      // Placeholder consents — the commerce Customer is not linked to the CRM
      // Consent/Contact in M2; badges render "not captured" until wired.
      consents: [
        { purpose: 'marketing', status: 'NOT_CAPTURED' },
        { purpose: 'call_recording', status: 'NOT_CAPTURED' },
      ],
      features: {
        netRevenueMinor: features?.netRevenueMinor ?? 0,
        orderCount: features?.orderCount ?? 0,
        avgOrderValueMinor: features?.avgOrderValueMinor ?? 0,
        firstOrderAt: features?.firstOrderAt ? features.firstOrderAt.toISOString() : null,
        lastOrderAt: features?.lastOrderAt ? features.lastOrderAt.toISOString() : null,
        currency: features?.currency ?? null,
        badges: {
          rfm: features?.rfmScore ?? null,
          clv: features?.clvMinor ?? null,
          churnRisk: features?.churnRisk ?? null,
          apparelSize: features?.apparelSize ?? null,
          fit: features?.fit ?? null,
          styleAffinity: features?.styleAffinity ?? null,
        },
      },
    };
    await this.redis.cacheSet(key, payload, PROFILE_TTL_SECONDS);
    return payload;
  }

  // ----- Unified timeline (one indexed query) -----------------------------
  async timeline(organizationId: string, id: string, query: TimelineQueryInput): Promise<{ data: TimelineItem[]; nextCursor: string | null }> {
    const customer = await this.resolveSurvivor(organizationId, id);
    const where: Prisma.InteractionWhereInput = { organizationId, customerId: customer.id };
    if (query.type) where.type = query.type.toUpperCase() as Prisma.InteractionWhereInput['type'];

    const rows = await this.prisma.interaction.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const data = (hasMore ? rows.slice(0, query.limit) : rows).map((r) => ({
      id: r.id,
      type: r.type.toLowerCase() as InteractionType,
      refId: r.refId,
      summary: r.summary,
      occurredAt: r.occurredAt.toISOString(),
    }));
    const last = data[data.length - 1];
    return { data, nextCursor: hasMore && last ? last.id : null };
  }

  // ----- Recent orders + range control ------------------------------------
  async recentOrders(organizationId: string, id: string, query: RecentOrdersQueryInput): Promise<RecentOrder[]> {
    const customer = await this.resolveSurvivor(organizationId, id);
    const where: Prisma.OrderWhereInput = { organizationId, customerId: customer.id, deletedAt: null };

    let dateFiltered = false;
    if (query.year && query.month) {
      const start = new Date(Date.UTC(query.year, query.month - 1, 1));
      const end = query.month === 12 ? new Date(Date.UTC(query.year + 1, 0, 1)) : new Date(Date.UTC(query.year, query.month, 1));
      where.placedAt = { gte: start, lt: end };
      dateFiltered = true;
    } else if (query.year) {
      where.placedAt = { gte: new Date(Date.UTC(query.year, 0, 1)), lt: new Date(Date.UTC(query.year + 1, 0, 1)) };
      dateFiltered = true;
    } else if (query.from || query.to) {
      const range: Prisma.DateTimeFilter = {};
      if (query.from) range.gte = new Date(query.from);
      if (query.to) range.lte = new Date(query.to);
      where.placedAt = range;
      dateFiltered = true;
    }
    const take = dateFiltered ? 500 : query.limit > 0 ? query.limit : 500;

    const orders = await this.prisma.order.findMany({
      where,
      include: { items: { select: { title: true, variant: true, quantity: true } } },
      orderBy: { placedAt: 'desc' },
      take,
    });
    return orders.map(serializeRecentOrder);
  }

  // ----- Customer list (masked per role) ----------------------------------
  async list(organizationId: string, query: CustomerListQueryInput, unmasked: boolean): Promise<{ data: CustomerListItem[]; nextCursor: string | null }> {
    if (query.search) {
      // Search narrows to a small set — filter customers, attach features, sort in JS.
      const customers = await this.prisma.customer.findMany({
        where: {
          organizationId,
          deletedAt: null,
          mergedIntoId: null,
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        },
        take: query.limit,
      });
      const features = await this.featuresFor(organizationId, customers.map((c) => c.id));
      const data = customers
        .map((c) => this.toListItem(c, features.get(c.id), unmasked))
        .sort((a, b) => b.netRevenueMinor - a.netRevenueMinor);
      return { data, nextCursor: null };
    }

    // Fast path: order by an indexed CustomerFeatures column, then load customers.
    const sort = query.sort && LIST_SORTS.has(query.sort) ? query.sort : 'netRevenueMinor';
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId },
      orderBy: [{ [sort]: query.order }, { id: query.order }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = feats.length > query.limit;
    const page = hasMore ? feats.slice(0, query.limit) : feats;
    const customers = await this.prisma.customer.findMany({
      where: { organizationId, id: { in: page.map((f) => f.customerId) }, deletedAt: null, mergedIntoId: null },
    });
    const custById = new Map(customers.map((c) => [c.id, c]));
    const data = page
      .map((f) => {
        const c = custById.get(f.customerId);
        return c ? this.toListItem(c, f, unmasked) : null;
      })
      .filter((v): v is CustomerListItem => v !== null);
    const last = page[page.length - 1];
    return { data, nextCursor: hasMore && last ? last.id : null };
  }

  // ----- helpers ----------------------------------------------------------
  private toListItem(c: CustomerRow, f: { netRevenueMinor: number; orderCount: number; lastOrderAt: Date | null; currency: string | null } | undefined, unmasked: boolean): CustomerListItem {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.externalId || c.id;
    return {
      id: c.id,
      name,
      email: unmasked ? c.email : maskEmail(c.email),
      orderCount: f?.orderCount ?? 0,
      netRevenueMinor: f?.netRevenueMinor ?? 0,
      currency: f?.currency ?? null,
      lastOrderAt: f?.lastOrderAt ? f.lastOrderAt.toISOString() : null,
    };
  }

  private async featuresFor(organizationId: string, customerIds: string[]) {
    const rows = await this.prisma.customerFeatures.findMany({ where: { organizationId, customerId: { in: customerIds } } });
    return new Map(rows.map((r) => [r.customerId, r]));
  }

  /** Follow a merged customer to its survivor (show the survivor's 360). */
  private async resolveSurvivor(organizationId: string, id: string): Promise<CustomerRow> {
    const first = await this.prisma.customer.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!first) throw new NotFoundException('Customer not found');
    let current: CustomerRow = first;
    let guard = 0;
    while (current.mergedIntoId && guard++ < 20) {
      const next = await this.prisma.customer.findFirst({ where: { id: current.mergedIntoId, organizationId } });
      if (!next) break;
      current = next;
    }
    return current;
  }
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: { select: { title: true; variant: true; quantity: true } } } }>;

export function serializeRecentOrder(o: OrderWithItems): RecentOrder {
  const itemsSummary = o.items
    .map((it) => `${it.title}${it.variant ? ` (${it.variant})` : ''} ×${it.quantity}`)
    .join(', ');
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    placedAt: o.placedAt.toISOString(),
    monthLabel: o.placedAt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    status: o.status,
    financialStatus: o.financialStatus,
    netMinor: o.totalMinor - o.refundedMinor,
    currency: o.currency,
    itemsSummary,
    discountCode: o.discountCode,
    discountMinor: o.discountMinor,
  };
}
