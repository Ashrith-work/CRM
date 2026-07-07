import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Consent as ConsentDto, ConsentPurpose, ConsentSource, ConsentStatus } from '@crm/types';
import type { Consent as ConsentRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RECORDING_FETCH_QUEUE, type PurgeRecordingJob } from '../recordings/recording.constants';

/**
 * DPDP call-recording consent per contact. One row per (contact, purpose);
 * absence means NOT_CAPTURED. Withdrawing consent enqueues a purge of any
 * already-stored recordings (erasure).
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RECORDING_FETCH_QUEUE) private readonly recordingQueue: Queue,
  ) {}

  async statusFor(
    organizationId: string,
    contactId: string,
    purpose: ConsentPurpose = 'CALL_RECORDING',
  ): Promise<ConsentStatus> {
    const row = await this.prisma.consent.findFirst({
      where: { organizationId, contactId, purpose, deletedAt: null },
      select: { status: true },
    });
    return (row?.status as ConsentStatus) ?? 'NOT_CAPTURED';
  }

  /** Bulk status lookup for a set of contacts (used when serializing call lists). */
  async statusForMany(organizationId: string, contactIds: string[]): Promise<Map<string, ConsentStatus>> {
    const ids = [...new Set(contactIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.consent.findMany({
      where: { organizationId, contactId: { in: ids }, purpose: 'CALL_RECORDING', deletedAt: null },
      select: { contactId: true, status: true },
    });
    return new Map(rows.map((r) => [r.contactId, r.status as ConsentStatus]));
  }

  async list(organizationId: string, contactId: string): Promise<ConsentDto[]> {
    const rows = await this.prisma.consent.findMany({
      where: { organizationId, contactId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(serializeConsent);
  }

  async set(
    organizationId: string,
    contactId: string,
    purpose: ConsentPurpose,
    status: 'GRANTED' | 'WITHDRAWN',
    source: ConsentSource | undefined,
  ): Promise<ConsentDto> {
    const now = new Date();
    const row = await this.prisma.consent.upsert({
      where: { organizationId_contactId_purpose: { organizationId, contactId, purpose } },
      update: {
        status,
        source: source ?? undefined,
        ...(status === 'GRANTED' ? { grantedAt: now, withdrawnAt: null } : { withdrawnAt: now }),
        deletedAt: null,
      },
      create: {
        organizationId,
        contactId,
        purpose,
        status,
        source: source ?? null,
        grantedAt: status === 'GRANTED' ? now : null,
        withdrawnAt: status === 'WITHDRAWN' ? now : null,
      },
    });

    // DPDP erasure: withdrawing consent purges any stored recordings.
    if (status === 'WITHDRAWN') {
      await this.recordingQueue.add(
        'purge',
        { type: 'purge', organizationId, contactId } satisfies PurgeRecordingJob,
        { jobId: `purge_${organizationId}_${contactId}_${now.getTime()}`, removeOnComplete: true, removeOnFail: 50, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
      );
    }
    return serializeConsent(row);
  }
}

export function serializeConsent(row: ConsentRow): ConsentDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    contactId: row.contactId,
    purpose: row.purpose,
    status: row.status,
    source: row.source,
    grantedAt: row.grantedAt ? row.grantedAt.toISOString() : null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
