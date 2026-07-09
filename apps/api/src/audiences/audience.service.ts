import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AudienceSyncDto, AudienceType, SyncAudienceInput } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketingConsentGate } from '../campaigns/marketing-consent-gate.service';
import { hashEmail, hashPhone } from '../common/hash.util';
import { MetaService } from '../ads/meta.service';
import { MetaConnectService } from '../ads/meta-connect.service';

export interface ConsentedMember {
  customerId: string;
  email: string | null;
  phone: string | null;
}

export interface AudiencePayload {
  schema: string[];
  data: string[][];
}

/**
 * Segment → Meta audience sync — ConsentGate-gated. A customer is uploaded ONLY
 * if they have GRANTED marketing consent AND are not suppressed (the SAME gate
 * M4 sends through). PII is SHA-256 hashed before it leaves us. Every push is
 * recorded in AudienceSync. A non-consented / suppressed customer is NEVER sent.
 */
@Injectable()
export class AudienceService {
  private readonly logger = new Logger(AudienceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gate: MarketingConsentGate,
    private readonly meta: MetaService,
    private readonly connect: MetaConnectService,
  ) {}

  async list(organizationId: string): Promise<AudienceSyncDto[]> {
    const rows = await this.prisma.audienceSync.findMany({ where: { organizationId }, orderBy: { updatedAt: 'desc' } });
    return rows.map(serializeAudienceSync);
  }

  /**
   * Resolve the CONSENTED, non-suppressed members of a segment. This is the
   * security core: every member is passed through the ConsentGate; the excluded
   * are counted, never uploaded.
   */
  async resolveConsentedMembers(organizationId: string, segmentId: string): Promise<{ members: ConsentedMember[]; excluded: number }> {
    const memberships = await this.prisma.segmentMembership.findMany({
      where: { organizationId, segmentId },
      select: { customerId: true },
    });
    const customers = await this.prisma.customer.findMany({
      where: { organizationId, id: { in: memberships.map((m) => m.customerId) }, deletedAt: null },
      select: { id: true, email: true, phone: true },
    });

    const members: ConsentedMember[] = [];
    let excluded = 0;
    for (const c of customers) {
      // The gate requires an email to check suppression; no email → not eligible.
      const eligible = c.email ? await this.gate.isEligible(organizationId, c.id, c.email) : false;
      if (!eligible) {
        excluded += 1;
        continue;
      }
      members.push({ customerId: c.id, email: c.email, phone: c.phone });
    }
    return { members, excluded };
  }

  /** Hash PII into Meta's upload schema. Rows with no identifier are dropped. */
  buildPayload(members: ConsentedMember[]): AudiencePayload {
    const schema = ['EMAIL_SHA256', 'PHONE_SHA256'];
    const data: string[][] = [];
    for (const m of members) {
      const e = hashEmail(m.email);
      const p = hashPhone(m.phone);
      if (!e && !p) continue; // nothing to match on
      data.push([e ?? '', p ?? '']);
    }
    return { schema, data };
  }

  async sync(organizationId: string, actorUserId: string, input: SyncAudienceInput): Promise<AudienceSyncDto> {
    const segment = await this.prisma.segment.findFirst({ where: { id: input.segmentId, organizationId, deletedAt: null } });
    if (!segment) throw new NotFoundException('Segment not found');

    const { members, excluded } = await this.resolveConsentedMembers(organizationId, input.segmentId);
    const payload = this.buildPayload(members);

    // Reuse the audience for this (segment, type) if we made one before.
    const existing = await this.prisma.audienceSync.findFirst({ where: { organizationId, segmentId: input.segmentId, type: input.type } });
    let metaAudienceId = existing?.metaAudienceId ?? null;

    const conn = await this.connect.connectionFor(organizationId);
    if (conn && payload.data.length > 0) {
      try {
        if (!metaAudienceId) {
          const name = input.name ?? `${segment.name} (${input.type})`;
          metaAudienceId = await this.meta.createCustomAudience(conn, name, `CRM ${input.type} audience for segment ${segment.name}`);
        }
        await this.meta.addUsers(conn, metaAudienceId, payload.schema, payload.data);
      } catch (err) {
        this.logger.error(`Meta audience upload failed: ${(err as Error).message}`);
      }
    } else if (!conn) {
      this.logger.warn(`Meta not connected — computed ${payload.data.length} consented rows for segment ${input.segmentId} but did not push`);
    }

    const syncedAt = conn ? new Date() : existing?.lastSyncedAt ?? null;
    const record = existing
      ? await this.prisma.audienceSync.update({
          where: { id: existing.id },
          data: { metaAudienceId, sizeSynced: payload.data.length, excludedByConsent: excluded, lastSyncedAt: syncedAt },
        })
      : await this.prisma.audienceSync.create({
          data: { organizationId, segmentId: input.segmentId, type: input.type, metaAudienceId, sizeSynced: payload.data.length, excludedByConsent: excluded, lastSyncedAt: syncedAt },
        });

    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'audience.sync',
      entity: 'AudienceSync',
      entityId: record.id,
      after: { segmentId: input.segmentId, type: input.type, sizeSynced: payload.data.length, excludedByConsent: excluded, pushed: !!conn },
    });

    return serializeAudienceSync(record);
  }
}

export function serializeAudienceSync(row: {
  id: string;
  segmentId: string;
  metaAudienceId: string | null;
  type: AudienceType;
  sizeSynced: number;
  excludedByConsent: number;
  lastSyncedAt: Date | null;
}): AudienceSyncDto {
  return {
    id: row.id,
    segmentId: row.segmentId,
    metaAudienceId: row.metaAudienceId,
    type: row.type,
    sizeSynced: row.sizeSynced,
    excludedByConsent: row.excludedByConsent,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}
