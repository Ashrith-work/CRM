import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Customer as CustomerDto, MergeResult } from '@crm/types';
import { Prisma, type Customer as CustomerRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerPiiService } from './customer-pii.service';

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
    private readonly pii: CustomerPiiService,
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
    // Match on the deterministic HASHES — never the encrypted originals.
    const emailHash = this.pii.emailHashOf(identity.email);
    const phoneHash = this.pii.phoneHashOf(identity.phone);

    const candidates = await this.findCandidates(organizationId, { externalId, emailHash, phoneHash });

    if (candidates.length === 0) {
      return this.createCustomer(organizationId, identity);
    }

    // Earliest-created survivor; merge the rest into it.
    const [survivor, ...duplicates] = candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const dup of duplicates) {
      await this.mergeCustomers(organizationId, survivor.id, dup.id, actorUserId, 'ingestion');
    }
    await this.fillMissing(survivor, identity);
    return survivor.id;
  }

  /** Manual admin merge. Audited. */
  async merge(organizationId: string, survivorId: string, mergedId: string, actorUserId: string): Promise<MergeResult> {
    if (survivorId === mergedId) throw new BadRequestException('survivorId and mergedId must differ');
    const survivor = await this.requireCustomer(organizationId, survivorId);
    const merged = await this.requireCustomer(organizationId, mergedId);
    const reattributed = await this.mergeCustomers(organizationId, survivor.id, merged.id, actorUserId, 'manual');
    return {
      survivor: this.serialize(await this.requireCustomer(organizationId, survivorId)),
      merged: this.serialize(await this.requireCustomer(organizationId, mergedId)),
      reattributed,
    };
  }

  /** Serialize a Customer row for an authorized human read — PII DECRYPTED. */
  serialize(row: CustomerRow): CustomerDto {
    return serializeCustomer({ ...row, ...this.pii.reveal(row) } as CustomerRow);
  }

  // ----- Internals --------------------------------------------------------
  private async findCandidates(
    organizationId: string,
    keys: { externalId: string | null; emailHash: string | null; phoneHash: string | null },
  ): Promise<CustomerRow[]> {
    const or: Prisma.CustomerWhereInput[] = [];
    if (keys.externalId) or.push({ externalId: keys.externalId });
    if (keys.emailHash) or.push({ emailHash: keys.emailHash });
    if (keys.phoneHash) or.push({ phoneHash: keys.phoneHash });
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

  private async createCustomer(organizationId: string, identity: CustomerIdentity): Promise<string> {
    const p = this.pii.protect(identity); // encrypt PII + compute match-hashes + domain
    try {
      const created = await this.prisma.customer.create({
        data: {
          organizationId,
          externalId: identity.externalId ?? null,
          email: p.email,
          phone: p.phone,
          firstName: p.firstName,
          lastName: p.lastName,
          emailHash: p.emailHash,
          phoneHash: p.phoneHash,
          emailDomain: p.emailDomain,
          nameSearch: this.pii.nameSearchOf(identity.firstName, identity.lastName),
        },
      });
      return created.id;
    } catch (err) {
      // Race: a concurrent insert claimed the same emailHash/externalId — re-resolve.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.findCandidates(organizationId, {
          externalId: identity.externalId ?? null,
          emailHash: p.emailHash,
          phoneHash: p.phoneHash,
        });
        if (again[0]) return again[0].id;
      }
      throw err;
    }
  }

  private async fillMissing(survivor: CustomerRow, identity: CustomerIdentity): Promise<void> {
    const p = this.pii.protect(identity);
    const patch: Prisma.CustomerUpdateInput = {};
    if (!survivor.externalId && identity.externalId) patch.externalId = identity.externalId;
    // "Missing" is judged by the HASH (the encrypted value is non-deterministic).
    if (!survivor.emailHash && p.emailHash) {
      patch.email = p.email;
      patch.emailHash = p.emailHash;
      patch.emailDomain = p.emailDomain;
    }
    if (!survivor.phoneHash && p.phoneHash) {
      patch.phone = p.phone;
      patch.phoneHash = p.phoneHash;
    }
    if (!survivor.firstName && p.firstName) patch.firstName = p.firstName;
    if (!survivor.lastName && p.lastName) patch.lastName = p.lastName;
    // Keep the searchable name in sync when a name first lands on this survivor.
    if (!survivor.nameSearch) {
      const ns = this.pii.nameSearchOf(identity.firstName, identity.lastName);
      if (ns) patch.nameSearch = ns;
    }
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
      // Point the merged row at the survivor and free its emailHash for uniqueness.
      this.prisma.customer.update({ where: { id: mergedId }, data: { mergedIntoId: survivorId, email: null, emailHash: null, emailDomain: null } }),
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
