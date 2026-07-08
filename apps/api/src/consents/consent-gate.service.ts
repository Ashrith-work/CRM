import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * The ConsentGate — the single check performed before a recording is ever
 * downloaded, stored, or served. If the matched contact has not GRANTED
 * CALL_RECORDING consent (or there is no matched contact), it writes an audit
 * row and returns false; the caller must then NOT touch the recording.
 */
@Injectable()
export class ConsentGate {
  private readonly logger = new Logger(ConsentGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * @returns true only when CALL_RECORDING consent is GRANTED for the contact.
   *   On a block, records an audit row ("recording.blocked") with the reason.
   */
  async ensureCanStore(
    organizationId: string,
    contactId: string | null,
    callId: string,
    actorUserId?: string | null,
  ): Promise<boolean> {
    const reason = await this.blockReason(organizationId, contactId);
    if (!reason) return true;

    this.logger.warn(`Recording blocked for call ${callId}: ${reason}`);
    await this.audit.record({
      organizationId,
      actorUserId: actorUserId ?? null,
      action: 'recording.blocked',
      entity: 'Call',
      entityId: callId,
      after: { reason, contactId },
    });
    return false;
  }

  /** null when allowed; otherwise a short reason string. */
  private async blockReason(organizationId: string, contactId: string | null): Promise<string | null> {
    if (!contactId) return 'no matched contact';
    const consent = await this.prisma.consent.findFirst({
      where: { organizationId, contactId, purpose: 'CALL_RECORDING', deletedAt: null },
      select: { status: true },
    });
    if (!consent) return 'consent not captured';
    if (consent.status !== 'GRANTED') return `consent ${consent.status.toLowerCase()}`;
    return null;
  }
}
