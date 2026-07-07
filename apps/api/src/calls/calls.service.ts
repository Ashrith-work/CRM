import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Call as CallDto,
  CallListQueryInput,
  ClickToCallInput,
  LogCallInput,
  MyOperatorWebhook,
  RecordingUrlResponse,
  UpdateCallInput,
} from '@crm/types';
import { Prisma, type ActivityEventType, type Call as CallRow, type CallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { ConsentService } from '../consents/consent.service';
import { MyOperatorService } from '../telephony/myoperator.service';
import { RecordingsService } from '../recordings/recordings.service';
import { resolveActors } from '../common/actors.util';
import { matchContactByNumber, nationalNumber, normalizeE164 } from '../common/phone.util';
import type { Env } from '../config/env';

const TERMINAL: CallStatus[] = ['COMPLETED', 'MISSED', 'FAILED', 'NO_ANSWER'];

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly activity: ActivityService,
    private readonly consents: ConsentService,
    private readonly myoperator: MyOperatorService,
    private readonly recordings: RecordingsService,
  ) {}

  // ----- Outbound click-to-call -------------------------------------------
  async clickToCall(organizationId: string, actorId: string, input: ClickToCallInput): Promise<CallDto> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, organizationId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const customer = normalizeE164(input.toNumber ?? contact.phone);
    if (!customer) throw new BadRequestException('Contact has no phone number to dial');
    if (input.dealId) await this.assertDeal(organizationId, input.dealId);

    const agentNumber = this.config.get('MYOPERATOR_CALLER_ID', { infer: true }) ?? 'agent';
    const { externalCallId } = await this.myoperator.clickToCall({ agentNumber, customerNumber: customer });

    const call = await this.prisma.call.create({
      data: {
        organizationId,
        direction: 'OUTBOUND',
        fromNumber: agentNumber,
        toNumber: customer,
        agentUserId: actorId,
        contactId: contact.id,
        dealId: input.dealId ?? null,
        status: 'RINGING',
        startedAt: new Date(),
        externalCallId,
        recordingStatus: 'NONE',
      },
    });
    await this.emitCallActivity(call, 'CALL_LOGGED', actorId);
    return this.get(organizationId, call.id);
  }

  // ----- Manual log -------------------------------------------------------
  async log(organizationId: string, actorId: string, input: LogCallInput): Promise<CallDto> {
    let contactId = input.contactId ?? null;
    if (!contactId) {
      const customer = input.direction === 'INBOUND' ? input.fromNumber : input.toNumber;
      contactId = (await this.matchContact(organizationId, customer)).contactId;
    } else {
      await this.assertContact(organizationId, contactId);
    }
    if (input.dealId) await this.assertDeal(organizationId, input.dealId);

    const call = await this.prisma.call.create({
      data: {
        organizationId,
        direction: input.direction,
        fromNumber: normalizeE164(input.fromNumber) ?? input.fromNumber ?? '',
        toNumber: normalizeE164(input.toNumber) ?? input.toNumber ?? '',
        agentUserId: actorId,
        contactId,
        dealId: input.dealId ?? null,
        status: input.status,
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        durationSeconds: input.durationSeconds ?? null,
        disposition: input.disposition ?? null,
        notes: input.notes ?? null,
        recordingStatus: 'NONE',
      },
    });
    await this.emitCallActivity(call, activityForStatus(call.status), actorId);
    return this.get(organizationId, call.id);
  }

  // ----- Webhook (public, verified upstream) ------------------------------
  /** Idempotent on (organizationId, externalCallId): a retried event upserts one Call. */
  async processWebhook(payload: MyOperatorWebhook): Promise<{ callId: string | null; created: boolean }> {
    const event = this.myoperator.parseEvent(payload);
    if (!event.externalCallId) {
      this.logger.warn('Webhook without a call id — ignored');
      return { callId: null, created: false };
    }
    const organizationId = await this.resolveOrg(event.companyId, event.externalCallId);
    if (!organizationId) {
      this.logger.warn(`Webhook for unknown company ${event.companyId ?? '?'} — ignored`);
      return { callId: null, created: false };
    }

    const existing = await this.prisma.call.findUnique({
      where: { organizationId_externalCallId: { organizationId, externalCallId: event.externalCallId } },
    });

    // Customer number is the non-org leg.
    const customerNumber = event.direction === 'INBOUND' ? event.fromNumber : event.toNumber;
    const match = existing?.contactId
      ? { contactId: existing.contactId, ambiguous: existing.ambiguousMatch }
      : await this.matchContact(organizationId, customerNumber);

    const hasRecording = !!event.recordingUrl;
    const recordingStatus = hasRecording && TERMINAL.includes(event.status)
      ? 'PENDING'
      : existing?.recordingStatus ?? 'NONE';

    const call = await this.prisma.call.upsert({
      where: { organizationId_externalCallId: { organizationId, externalCallId: event.externalCallId } },
      update: {
        status: event.status,
        answeredAt: event.answeredAt ?? existing?.answeredAt ?? null,
        endedAt: event.endedAt ?? existing?.endedAt ?? null,
        durationSeconds: event.durationSeconds ?? existing?.durationSeconds ?? null,
        contactId: match.contactId,
        ambiguousMatch: match.ambiguous,
        recordingSourceUrl: event.recordingUrl ?? existing?.recordingSourceUrl ?? null,
        recordingStatus,
      },
      create: {
        organizationId,
        direction: event.direction,
        fromNumber: normalizeE164(event.fromNumber) ?? event.fromNumber ?? '',
        toNumber: normalizeE164(event.toNumber) ?? event.toNumber ?? '',
        contactId: match.contactId,
        ambiguousMatch: match.ambiguous,
        status: event.status,
        startedAt: event.startedAt ?? new Date(),
        answeredAt: event.answeredAt,
        endedAt: event.endedAt,
        durationSeconds: event.durationSeconds,
        externalCallId: event.externalCallId,
        recordingSourceUrl: event.recordingUrl,
        recordingStatus,
      },
    });

    // Emit activity only when the call first reaches a terminal state (avoids
    // duplicate timeline entries on retried webhooks).
    const becameTerminal = TERMINAL.includes(event.status) && !(existing && TERMINAL.includes(existing.status));
    if (becameTerminal && call.contactId) {
      await this.emitCallActivity(call, activityForStatus(event.status), call.agentUserId);
    }

    // On a completed call with a recording, kick off the (consent-gated) fetch.
    // Never let a queue hiccup fail the webhook — the Call is already persisted
    // and the sweep/next event can re-trigger the fetch.
    if (hasRecording && event.status === 'COMPLETED' && recordingStatus === 'PENDING') {
      try {
        await this.recordings.enqueueFetch(call.id);
      } catch (err) {
        this.logger.error(`Failed to enqueue recording fetch for call ${call.id}: ${(err as Error).message}`);
      }
    }

    return { callId: call.id, created: !existing };
  }

  // ----- Reads / writes ---------------------------------------------------
  async list(
    organizationId: string,
    currentUserId: string,
    query: CallListQueryInput,
  ): Promise<{ data: CallDto[]; nextCursor: string | null }> {
    const where: Prisma.CallWhereInput = { organizationId, deletedAt: null };
    if (query.contactId) where.contactId = query.contactId;
    if (query.dealId) where.dealId = query.dealId;
    if (query.agentUserId) where.agentUserId = query.agentUserId === 'me' ? currentUserId : query.agentUserId;
    if (query.direction) where.direction = query.direction;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      const range: Prisma.DateTimeNullableFilter = {};
      if (query.from) range.gte = new Date(query.from);
      if (query.to) range.lte = new Date(query.to);
      where.startedAt = range;
    }
    if (query.search) {
      where.OR = [
        { fromNumber: { contains: query.search } },
        { toNumber: { contains: query.search } },
        { disposition: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.call.findMany({
      where,
      orderBy: [{ startedAt: query.order }, { id: query.order }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const last = data[data.length - 1];
    return {
      data: await this.serializeMany(organizationId, data),
      nextCursor: hasMore && last ? last.id : null,
    };
  }

  async get(organizationId: string, id: string): Promise<CallDto> {
    const call = await this.requireCall(organizationId, id);
    return (await this.serializeMany(organizationId, [call]))[0];
  }

  async update(organizationId: string, id: string, input: UpdateCallInput, actorId: string): Promise<CallDto> {
    const call = await this.requireCall(organizationId, id);
    if (input.dealId) await this.assertDeal(organizationId, input.dealId);
    await this.prisma.call.update({
      where: { id },
      data: {
        ...(input.disposition !== undefined ? { disposition: input.disposition } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.dealId !== undefined ? { dealId: input.dealId } : {}),
      },
    });
    if (call.contactId) {
      await this.activity.emit({
        organizationId,
        entityType: 'CONTACT',
        entityId: call.contactId,
        eventType: 'CALL_LOGGED',
        actorId,
        metadata: { callId: id, updated: true } as Prisma.InputJsonValue,
        source: 'api',
      });
    }
    return this.get(organizationId, id);
  }

  async recordingUrl(organizationId: string, id: string, actorId: string): Promise<RecordingUrlResponse> {
    const call = await this.requireCall(organizationId, id);
    return this.recordings.getSignedUrl(call, actorId);
  }

  // ----- Helpers ----------------------------------------------------------
  private async resolveOrg(companyId: string | null, externalCallId: string): Promise<string | null> {
    if (companyId) {
      const org = await this.prisma.organization.findUnique({ where: { myoperatorCompanyId: companyId }, select: { id: true } });
      if (org) return org.id;
    }
    // Fall back to an existing call created by click-to-call.
    const existing = await this.prisma.call.findFirst({ where: { externalCallId }, select: { organizationId: true } });
    return existing?.organizationId ?? null;
  }

  /** Match a raw number to a contact (prefilter by last-4 digits, confirm in JS). */
  private async matchContact(organizationId: string, rawNumber: string | null | undefined) {
    const e164 = normalizeE164(rawNumber);
    const nat = nationalNumber(e164);
    if (!nat) return { contactId: null, ambiguous: false };
    const candidates = await this.prisma.contact.findMany({
      where: { organizationId, deletedAt: null, phone: { contains: nat.slice(-4) } },
      select: { id: true, phone: true, updatedAt: true },
      take: 200,
    });
    return matchContactByNumber(candidates, e164);
  }

  private async emitCallActivity(call: CallRow, eventType: ActivityEventType, actorId: string | null): Promise<void> {
    if (!call.contactId) return;
    await this.activity.emit({
      organizationId: call.organizationId,
      entityType: 'CONTACT',
      entityId: call.contactId,
      eventType,
      actorId: actorId ?? null,
      metadata: { callId: call.id, direction: call.direction, status: call.status, durationSeconds: call.durationSeconds } as Prisma.InputJsonValue,
      source: 'api',
    });
  }

  private async assertContact(organizationId: string, contactId: string): Promise<void> {
    const c = await this.prisma.contact.findFirst({ where: { id: contactId, organizationId, deletedAt: null }, select: { id: true } });
    if (!c) throw new BadRequestException('contactId does not reference a contact in this org');
  }

  private async assertDeal(organizationId: string, dealId: string): Promise<void> {
    const d = await this.prisma.deal.findFirst({ where: { id: dealId, organizationId, deletedAt: null }, select: { id: true } });
    if (!d) throw new BadRequestException('dealId does not reference a deal in this org');
  }

  private async requireCall(organizationId: string, id: string): Promise<CallRow> {
    const call = await this.prisma.call.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  private async serializeMany(organizationId: string, calls: CallRow[]): Promise<CallDto[]> {
    const actors = await resolveActors(this.prisma, organizationId, calls.map((c) => c.agentUserId));
    const contactIds = calls.map((c) => c.contactId).filter((v): v is string => !!v);
    const dealIds = calls.map((c) => c.dealId).filter((v): v is string => !!v);
    const [contacts, deals, consentMap] = await Promise.all([
      contactIds.length
        ? this.prisma.contact.findMany({ where: { organizationId, id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, phone: true } })
        : Promise.resolve([]),
      dealIds.length
        ? this.prisma.deal.findMany({ where: { organizationId, id: { in: dealIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      this.consents.statusForMany(organizationId, contactIds),
    ]);
    const contactById = new Map(contacts.map((c) => [c.id, c]));
    const dealById = new Map(deals.map((d) => [d.id, d]));

    return calls.map((c) => {
      const contact = c.contactId ? contactById.get(c.contactId) : undefined;
      const deal = c.dealId ? dealById.get(c.dealId) : undefined;
      return {
        id: c.id,
        organizationId: c.organizationId,
        direction: c.direction,
        fromNumber: c.fromNumber,
        toNumber: c.toNumber,
        agentUserId: c.agentUserId,
        agent: c.agentUserId ? actors.get(c.agentUserId) ?? null : null,
        contactId: c.contactId,
        contact: contact ? { id: contact.id, firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone } : null,
        dealId: c.dealId,
        deal: deal ? { id: deal.id, name: deal.name } : null,
        status: c.status,
        startedAt: c.startedAt ? c.startedAt.toISOString() : null,
        answeredAt: c.answeredAt ? c.answeredAt.toISOString() : null,
        endedAt: c.endedAt ? c.endedAt.toISOString() : null,
        durationSeconds: c.durationSeconds,
        disposition: c.disposition,
        notes: c.notes,
        externalCallId: c.externalCallId,
        recordingStatus: c.recordingStatus,
        recordingAvailable: c.recordingStatus === 'STORED',
        consentStatus: c.contactId ? consentMap.get(c.contactId) ?? 'NOT_CAPTURED' : null,
        ambiguousMatch: c.ambiguousMatch,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }
}

function activityForStatus(status: CallStatus): ActivityEventType {
  if (status === 'COMPLETED') return 'CALL_COMPLETED';
  if (status === 'MISSED') return 'CALL_MISSED';
  return 'CALL_LOGGED';
}
