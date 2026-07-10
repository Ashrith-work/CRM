import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, RecoveryStatus as DbRecoveryStatus, type Customer as CustomerRow } from '@prisma/client';
import type {
  AssignProspectInput,
  AssignResult,
  CoordinationResponse,
  LogProgressInput,
  ProgressListResponse,
  ProgressUpdateDto,
  Prospect,
  ProspectListResponse,
  ProspectSegment,
  RecoveryMetricsResponse,
  RecoveryStatus,
} from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { maskEmail, maskPhone } from '../common/pii.util';
import { scrubPii } from '../assistant/scrub-pii.util';
import type { Env } from '../config/env';

const QUALIFYING = [OrderStatus.PAID, OrderStatus.FULFILLED]; // an order that means "they bought"
const DAY_MS = 86_400_000;

/**
 * Recovery-lead assignment: turns two DYNAMIC prospect segments (cart-abandoners
 * + identified non-buyers) into assignable, trackable follow-up work. Buyers are
 * never prospects (a qualifying order drops them from the segment and auto-credits
 * the owner). PII (email/phone) is masked unless the caller holds pii:read.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: CustomerPiiService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private thresholdDate(): Date {
    const minutes = this.config.get('ABANDONED_CART_THRESHOLD_MINUTES', { infer: true });
    return new Date(Date.now() - minutes * 60_000);
  }

  /** Of the candidate ids, which customers HAVE a qualifying (paid/fulfilled) order. */
  private async buyerIds(organizationId: string, candidateIds: string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const rows = await this.prisma.order.findMany({
      where: { organizationId, deletedAt: null, status: { in: QUALIFYING }, customerId: { in: candidateIds } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    return new Set(rows.map((r) => r.customerId).filter((v): v is string => !!v));
  }

  // ---- Prospect lists ----------------------------------------------------
  async listProspects(organizationId: string, segment: ProspectSegment, unmasked: boolean, limit = 100): Promise<ProspectListResponse> {
    return segment === 'cart_abandoner'
      ? this.cartAbandoners(organizationId, unmasked, limit)
      : this.nonBuyers(organizationId, unmasked, limit);
  }

  /** Segment A: a Cart with items + checkoutStartedAt past the threshold + no conversion, whose customer never bought. */
  private async cartAbandoners(organizationId: string, unmasked: boolean, limit: number): Promise<ProspectListResponse> {
    const threshold = this.thresholdDate();
    const carts = await this.prisma.cart.findMany({
      where: {
        organizationId,
        deletedAt: null,
        convertedOrderId: null,
        customerId: { not: null },
        checkoutStartedAt: { lt: threshold },
        items: { some: {} },
      },
      include: { items: { select: { title: true, quantity: true, priceMinor: true } } },
      orderBy: { checkoutStartedAt: 'desc' },
      take: limit,
    });
    // Anonymous (identity-less) abandoned carts — counted only, never assignable.
    const anonymousCount = await this.prisma.cart.count({
      where: { organizationId, deletedAt: null, convertedOrderId: null, customerId: null, checkoutStartedAt: { lt: threshold }, items: { some: {} } },
    });

    const custIds = uniq(carts.map((c) => c.customerId).filter((v): v is string => !!v));
    const buyers = await this.buyerIds(organizationId, custIds);
    const custById = await this.customersById(organizationId, custIds);

    const data: Prospect[] = [];
    for (const cart of carts) {
      const cid = cart.customerId;
      if (!cid || buyers.has(cid)) continue; // bought later → not a prospect
      const cust = custById.get(cid);
      if (!cust || cust.deletedAt || cust.mergedIntoId) continue;
      const value = cart.items.reduce((s, it) => s + it.priceMinor * it.quantity, 0);
      const summary = cart.items.map((it) => `${it.title}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(', ');
      data.push(this.toProspect(cust, 'cart_abandoner', unmasked, {
        cartSummary: summary || null,
        valueAtRiskMinor: value,
        daysSince: Math.floor((Date.now() - cart.checkoutStartedAt.getTime()) / DAY_MS),
      }));
    }
    return { data, nextCursor: null, anonymousCount };
  }

  /** Segment B: an IDENTIFIED customer (email/phone hash or externalId) with zero qualifying orders. */
  private async nonBuyers(organizationId: string, unmasked: boolean, limit: number): Promise<ProspectListResponse> {
    const candidates = await this.prisma.customer.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        OR: [{ emailHash: { not: null } }, { phoneHash: { not: null } }, { externalId: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 4, // over-fetch, filter out buyers, then cap
    });
    const buyers = await this.buyerIds(organizationId, candidates.map((c) => c.id));
    // Anonymous storefront sessions with no linked customer — counted only.
    const anonymousCount = await this.prisma.commerceEvent.count({ where: { organizationId, customerId: null } });

    const data: Prospect[] = [];
    for (const cust of candidates) {
      if (buyers.has(cust.id)) continue;
      data.push(this.toProspect(cust, 'non_buyer', unmasked, {
        cartSummary: null,
        valueAtRiskMinor: 0,
        daysSince: Math.floor((Date.now() - cust.createdAt.getTime()) / DAY_MS),
      }));
      if (data.length >= limit) break;
    }
    return { data, nextCursor: null, anonymousCount };
  }

  private toProspect(cust: CustomerRow, segment: ProspectSegment, unmasked: boolean, extra: { cartSummary: string | null; valueAtRiskMinor: number; daysSince: number | null }): Prospect {
    const revealed = this.pii.reveal(cust);
    const name = this.pii.revealName(cust);
    return {
      customerId: cust.id,
      displayName: (name && name.trim()) || `Customer #${cust.id.slice(-6)}`,
      email: unmasked ? revealed.email : maskEmail(revealed.email),
      phone: unmasked ? revealed.phone : maskPhone(revealed.phone),
      segment,
      cartSummary: extra.cartSummary,
      valueAtRiskMinor: extra.valueAtRiskMinor,
      daysSince: extra.daysSince,
      ownerUserId: cust.ownerUserId ?? null,
      status: (cust.recoveryStatus as RecoveryStatus | null) ?? null,
      masked: !unmasked,
    };
  }

  private async customersById(organizationId: string, ids: string[]): Promise<Map<string, CustomerRow>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.customer.findMany({ where: { organizationId, id: { in: ids } } });
    return new Map(rows.map((c) => [c.id, c]));
  }

  // ---- Assignment (only prospects, never buyers) -------------------------
  async assign(organizationId: string, actorUserId: string, input: AssignProspectInput): Promise<AssignResult> {
    const buyers = await this.buyerIds(organizationId, input.customerIds);
    const targets = input.customerIds.filter((id) => !buyers.has(id)); // never assign a buyer
    let updated = 0;
    for (const customerId of targets) {
      const current = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId, deletedAt: null },
        select: { ownerUserId: true, recoveryStatus: true },
      });
      if (!current) continue;
      const fromUserId = current.ownerUserId ?? null;
      if (fromUserId === input.toUserId) continue; // no-op
      await this.prisma.customer.update({
        where: { id: customerId },
        data: {
          ownerUserId: input.toUserId,
          // Begin tracking on first assignment; preserve an existing status.
          recoveryStatus: input.toUserId && !current.recoveryStatus ? DbRecoveryStatus.to_contact : current.recoveryStatus,
        },
      });
      await this.prisma.customerAssignmentHistory.create({
        data: { organizationId, customerId, fromUserId, toUserId: input.toUserId, actorUserId, reason: input.reason ?? null },
      });
      updated += 1;
    }
    await this.audit.record({ organizationId, actorUserId, action: 'recovery.assign', entity: 'Customer', after: { count: updated, toUserId: input.toUserId } });
    return { updated };
  }

  // ---- Progress / follow-up log ------------------------------------------
  async logProgress(organizationId: string, actorUserId: string, input: LogProgressInput): Promise<ProgressUpdateDto> {
    const note = input.note ? scrubPii(input.note) : null; // PII-scrubbed before storage/AI
    const row = await this.prisma.progressUpdate.create({
      data: { organizationId, customerId: input.customerId, authorUserId: actorUserId, status: input.status, note },
    });
    await this.prisma.customer.update({
      where: { id: input.customerId },
      data: { recoveryStatus: input.status, ...(input.status === 'converted' ? { recoveryConvertedAt: new Date() } : {}) },
    });
    await this.audit.record({ organizationId, actorUserId, action: 'recovery.progress', entity: 'Customer', entityId: input.customerId, after: { status: input.status } });
    return serializeProgress(row);
  }

  async progressFor(organizationId: string, customerId: string): Promise<ProgressListResponse> {
    const rows = await this.prisma.progressUpdate.findMany({ where: { organizationId, customerId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: rows.map(serializeProgress) };
  }

  // ---- Office-wide coordination view -------------------------------------
  async coordination(organizationId: string, unmasked: boolean, filters: { ownerUserId?: string; status?: RecoveryStatus } = {}): Promise<CoordinationResponse> {
    await this.reconcileConversions(organizationId);
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId,
        deletedAt: null,
        recoveryStatus: { not: null },
        ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
        ...(filters.status ? { recoveryStatus: filters.status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const latest = await this.latestProgress(organizationId, customers.map((c) => c.id));
    return {
      data: customers.map((c) => {
        const name = this.pii.revealName(c);
        const lp = latest.get(c.id);
        return {
          customerId: c.id,
          displayName: (name && name.trim()) || `Customer #${c.id.slice(-6)}`,
          ownerUserId: c.ownerUserId ?? null,
          status: (c.recoveryStatus as RecoveryStatus | null) ?? null,
          lastUpdateAt: lp ? lp.createdAt.toISOString() : null,
          lastNote: lp ? lp.note : null,
          masked: !unmasked,
        };
      }),
    };
  }

  private async latestProgress(organizationId: string, customerIds: string[]): Promise<Map<string, { createdAt: Date; note: string | null }>> {
    const m = new Map<string, { createdAt: Date; note: string | null }>();
    if (customerIds.length === 0) return m;
    const rows = await this.prisma.progressUpdate.findMany({ where: { organizationId, customerId: { in: customerIds } }, orderBy: { createdAt: 'desc' } });
    for (const r of rows) if (!m.has(r.customerId)) m.set(r.customerId, { createdAt: r.createdAt, note: r.note });
    return m;
  }

  // ---- Conversion attribution --------------------------------------------
  /** Owned prospects who now have a qualifying order → mark CONVERTED, credit the owner. Idempotent. */
  async reconcileConversions(organizationId: string): Promise<number> {
    const owned = await this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null, ownerUserId: { not: null }, recoveryStatus: { notIn: [DbRecoveryStatus.converted, DbRecoveryStatus.lost] } },
      select: { id: true, ownerUserId: true },
    });
    if (owned.length === 0) return 0;
    const buyers = await this.buyerIds(organizationId, owned.map((c) => c.id));
    let converted = 0;
    for (const c of owned) {
      if (!buyers.has(c.id) || !c.ownerUserId) continue;
      await this.prisma.customer.update({ where: { id: c.id }, data: { recoveryStatus: DbRecoveryStatus.converted, recoveryConvertedAt: new Date() } });
      await this.prisma.progressUpdate.create({ data: { organizationId, customerId: c.id, authorUserId: c.ownerUserId, status: DbRecoveryStatus.converted, note: 'Auto-converted: qualifying order placed.' } });
      converted += 1;
    }
    if (converted > 0) await this.audit.record({ organizationId, action: 'recovery.autoConvert', entity: 'Customer', after: { converted } });
    return converted;
  }

  /** Assigned vs converted per team member — did the human follow-up work? */
  async metrics(organizationId: string): Promise<RecoveryMetricsResponse> {
    await this.reconcileConversions(organizationId);
    const owned = await this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null, ownerUserId: { not: null }, recoveryStatus: { not: null } },
      select: { ownerUserId: true, recoveryStatus: true },
    });
    const byOwner = new Map<string, { assigned: number; converted: number }>();
    for (const c of owned) {
      if (!c.ownerUserId) continue;
      const m = byOwner.get(c.ownerUserId) ?? { assigned: 0, converted: 0 };
      m.assigned += 1;
      if (c.recoveryStatus === DbRecoveryStatus.converted) m.converted += 1;
      byOwner.set(c.ownerUserId, m);
    }
    return {
      data: [...byOwner.entries()].map(([ownerUserId, m]) => ({ ownerUserId, assigned: m.assigned, converted: m.converted, conversionRate: m.assigned ? m.converted / m.assigned : 0 })),
    };
  }
}

function serializeProgress(row: { id: string; customerId: string; authorUserId: string; status: DbRecoveryStatus; note: string | null; createdAt: Date }): ProgressUpdateDto {
  return { id: row.id, customerId: row.customerId, authorUserId: row.authorUserId, status: row.status as RecoveryStatus, note: row.note, createdAt: row.createdAt.toISOString() };
}

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}
