import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TelephonyAuthError, TelephonyConfigError } from './http.util';

/** Un-recoverable telephony failures that need a human — surfaced, never hidden. */
export type TelephonyErrorKind = 'auth_error' | 'config_error' | 'signature_mismatch';

/**
 * Surfaces UN-RECOVERABLE provider failures (bad/rotated API key, account/number
 * misconfig, webhook signature mismatch) onto the org's Integration row so a
 * human sees them: status → ERROR with the granular reason in `config`, plus an
 * audit entry and an error log. It never silently swallows — recoverable errors
 * are handled by retry/refresh/reconcile elsewhere; only the un-fixable ones
 * reach here. recordHealthy() clears the flag once the provider recovers.
 */
@Injectable()
export class TelephonyStatusService {
  private readonly logger = new Logger(TelephonyStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async recordError(
    organizationId: string,
    provider: string,
    kind: TelephonyErrorKind,
    reason: string,
  ): Promise<void> {
    const providerKey = provider.toUpperCase();
    const config = {
      telephony: true,
      errorKind: kind,
      reason,
      lastErrorAt: new Date().toISOString(),
    } as Prisma.InputJsonValue;

    await this.prisma.integration.upsert({
      where: { organizationId_provider: { organizationId, provider: providerKey } },
      update: { status: 'ERROR', config },
      create: { organizationId, provider: providerKey, status: 'ERROR', config },
    });

    // Loud on purpose: this class of failure cannot auto-fix and needs a human.
    this.logger.error(`Telephony ${providerKey} ${kind}: ${reason} (org ${organizationId}) — needs a human`);
    await this.audit.record({
      organizationId,
      action: 'telephony.integration.error',
      entity: 'Integration',
      entityId: providerKey,
      after: { provider: providerKey, kind, reason },
    });
  }

  /**
   * A spoofed/misconfigured webhook (bad signature) — un-recoverable. Resolve the
   * org from the payload's company id and surface it; if the org can't be
   * resolved, log loudly (still never swallowed).
   */
  async recordWebhookSignatureMismatch(provider: string, companyId: string | null | undefined): Promise<void> {
    const org = companyId
      ? await this.prisma.organization.findFirst({
          where: { OR: [{ myoperatorCompanyId: companyId }, { exotelAccountSid: companyId }] },
          select: { id: true },
        })
      : null;
    if (!org) {
      this.logger.error(
        `Telephony ${provider.toUpperCase()} webhook signature mismatch (company ${companyId ?? '?'}) — rejected; org unresolved`,
      );
      return;
    }
    await this.recordError(org.id, provider, 'signature_mismatch', `Webhook signature verification failed (company ${companyId})`);
  }

  /** Clear a prior ERROR once the provider works again (idempotent no-op otherwise). */
  async recordHealthy(organizationId: string, provider: string): Promise<void> {
    const providerKey = provider.toUpperCase();
    const existing = await this.prisma.integration.findUnique({
      where: { organizationId_provider: { organizationId, provider: providerKey } },
    });
    if (!existing || existing.status !== 'ERROR') return;
    await this.prisma.integration.update({
      where: { id: existing.id },
      data: {
        status: 'CONNECTED',
        config: { telephony: true, recoveredAt: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      organizationId,
      action: 'telephony.integration.recovered',
      entity: 'Integration',
      entityId: providerKey,
    });
  }
}

/** Map a thrown telephony error to an un-recoverable kind + reason (else null). */
export function classifyTelephonyError(err: unknown): { kind: 'auth_error' | 'config_error'; reason: string } | null {
  if (err instanceof TelephonyAuthError) return { kind: 'auth_error', reason: err.message };
  if (err instanceof TelephonyConfigError) return { kind: 'config_error', reason: err.message };
  return null;
}
