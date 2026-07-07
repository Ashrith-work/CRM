import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Customer as CustomerDto, MergeResult } from '@crm/types';
import { Prisma, type Customer as CustomerRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { normalizeE164 } from '../common/phone.util';
import { normalizeEmail } from '../ingestion/shopify.mappers';

export interface CustomerIdentity {
  externalId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Identity resolution for ingested commerce customers. Normalizes on write and
 * does EXACT-MATCH merge only (email OR phone OR externalId) — never fuzzy/AI.
 * The (org, email) unique constraint is upheld by nulling a merged row's email.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Find-or-create the Customer for an identity, merging any exact-match
   * duplicates into a single survivor. Returns the survivor's id.
   */
  async resolveCustomer(
    organizationId: string,
    identity: CustomerIdentity,
    actorUserId?: string | null,
  ): Promise<string> {
    const externalId = identity.externalId || null;
    const email = normalizeEmail(identity.email);
    const phone = normalizeE164(identity.phone ?? null);

    const candidates = await this.findCandidates(organizationId, { externalId, email, phone });

    if (candidates.length === 0) {
      return this.createCustomer(organizationId, { externalId, email, phone, firstName: identity.firstName ?? null, lastName: identity.lastName ?? null });
    }

    // Earliest-created survivor; merge the rest into it.
    const [survivor, ...duplicates] = candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const dup of duplicates) {
      await this.mergeCustomers(organizationId, survivor.id, dup.id, actorUserId, 'ingestion');
    }
    await this.fillMissing(survivor, { externalId, email, phone, firstName: identity.firstName ?? null, lastName: identity.lastName ?? null });
    return survivor.id;
  }

  /** Manual admin merge. Audited. */
  async merge(organizationId: string, survivorId: string, mergedId: string, actorUserId: string): Promise<MergeResult> {
    if (survivorId === mergedId) throw new BadRequestException('survivorId and mergedId must differ');
    const survivor = await this.requireCustomer(organizationId, survivorId);
    const merged = await this.requireCustomer(organizationId, mergedId);
    const reattributed = await this.mergeCustomers(organizationId, survivor.id, merged.id, actorUserId, 'manual');
    return {
      survivor: serializeCustomer(await this.requireCustomer(organizationId, survivorId)),
      merged: serializeCustomer(await this.requireCustomer(organizationId, mergedId)),
      reattributed,
    };
  }

  // ----- Internals --------------------------------------------------------
  private async findCandidates(
    organizationId: string,
    keys: { externalId: string | null; email: string | null; phone: string | null },
  ): Promise<CustomerRow[]> {
    const or: Prisma.CustomerWhereInput[] = [];
    if (keys.externalId) or.push({ externalId: keys.externalId });
    if (keys.email) or.push({ email: keys.email });
    if (keys.phone) or.push({ phone: keys.phone });
    if (or.length === 0) return [];

    const rows = await this.prisma.customer.findMany({
      where: { organizationId, deletedAt: null, mergedIntoId: null, OR: or },
    });
    // Resolve any that were already merged to their survivor, then de-dupe.
    const resolved = await Promise.all(rows.map((r) => this.resolveSurvivor(r)));
    const byId = new Map(resolved.map((r) => [r.id, r]));
    return [...byId.values()];
  }

  private async resolveSurvivor(customer: CustomerRow): Promise<CustomerRow> {
    let current = customer;
    let guard = 0;
    while (current.mergedIntoId && guard++ < 20) {
      const next = await this.prisma.customer.findUnique({ where: { id: current.mergedIntoId } });
      if (!next) break;
      current = next;
    }
    return current;
  }

  private async createCustomer(organizationId: string, data: CustomerIdentity): Promise<string> {
    try {
      const created = await this.prisma.customer.create({
        data: {
          organizationId,
          externalId: data.externalId ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
        },
      });
      return created.id;
    } catch (err) {
      // Race: a concurrent insert claimed the same email/externalId — re-resolve.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findCandidates(organizationId, {
          externalId: data.externalId ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
        });
        if (again[0]) return again[0].id;
      }
      throw err;
    }
  }

  private async fillMissing(survivor: CustomerRow, data: CustomerIdentity): Promise<void> {
    const patch: Prisma.CustomerUpdateInput = {};
    if (!survivor.externalId && data.externalId) patch.externalId = data.externalId;
    if (!survivor.email && data.email) patch.email = data.email;
    if (!survivor.phone && data.phone) patch.phone = data.phone;
    if (!survivor.firstName && data.firstName) patch.firstName = data.firstName;
    if (!survivor.lastName && data.lastName) patch.lastName = data.lastName;
    if (Object.keys(patch).length === 0) return;
    try {
      await this.prisma.customer.update({ where: { id: survivor.id }, data: patch });
    } catch (err) {
      // A unique clash while backfilling a field — safe to skip.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      this.logger.warn(`fillMissing skipped a unique clash for customer ${survivor.id}`);
    }
  }

  /** Re-attribute the merged customer's data to the survivor; keep both rows. */
  private async mergeCustomers(
    organizationId: string,
    survivorId: string,
    mergedId: string,
    actorUserId: string | null | undefined,
    source: string,
  ): Promise<{ orders: number; carts: number; events: number }> {
    const [orders, carts, events] = await this.prisma.$transaction([
      this.prisma.order.updateMany({ where: { organizationId, customerId: mergedId }, data: { customerId: survivorId } }),
      this.prisma.cart.updateMany({ where: { organizationId, customerId: mergedId }, data: { customerId: survivorId } }),
      this.prisma.commerceEvent.updateMany({ where: { organizationId, customerId: mergedId }, data: { customerId: survivorId } }),
      // Point the merged row at the survivor and free its email for uniqueness.
      this.prisma.customer.update({ where: { id: mergedId }, data: { mergedIntoId: survivorId, email: null } }),
    ]);

    await this.audit.record({
      organizationId,
      actorUserId: actorUserId ?? null,
      action: 'customer.merge',
      entity: 'Customer',
      entityId: mergedId,
      after: { survivorId, mergedId, source, reattributed: { orders: orders.count, carts: carts.count, events: events.count } },
    });
    return { orders: orders.count, carts: carts.count, events: events.count };
  }

  private async requireCustomer(organizationId: string, id: string): Promise<CustomerRow> {
    const c = await this.prisma.customer.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }
}

export function serializeCustomer(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    externalId: row.externalId,
    email: row.email,
    phone: row.phone,
    firstName: row.firstName,
    lastName: row.lastName,
    mergedIntoId: row.mergedIntoId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
