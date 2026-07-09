import { CallsService } from './calls.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { ActivityService } from '../activity/activity.service';
import type { ConsentService } from '../consents/consent.service';
import type { MyOperatorService, NormalizedCallEvent } from '../telephony/myoperator.service';
import type { RecordingsService } from '../recordings/recordings.service';
import type { Env } from '../config/env';

function event(overrides: Partial<NormalizedCallEvent> = {}): NormalizedCallEvent {
  return {
    externalCallId: 'ext1',
    companyId: 'moc1',
    direction: 'INBOUND',
    status: 'COMPLETED',
    fromNumber: '+919876543210',
    toNumber: '+911140001234',
    agentNumber: null,
    startedAt: new Date('2026-07-01T10:00:00Z'),
    answeredAt: new Date('2026-07-01T10:00:05Z'),
    endedAt: new Date('2026-07-01T10:03:00Z'),
    durationSeconds: 175,
    recordingUrl: 'https://rec.example/r.mp3',
    ...overrides,
  };
}

function makeService(opts: {
  findUnique?: jest.Mock;
  contacts?: unknown[];
  upsertReturn?: Record<string, unknown>;
}) {
  const upsert = jest.fn().mockResolvedValue(
    opts.upsertReturn ?? { id: 'call1', organizationId: 'org1', contactId: null, agentUserId: null, direction: 'INBOUND', status: 'COMPLETED', durationSeconds: 175 },
  );
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'org1' }) },
    call: {
      findUnique: opts.findUnique ?? jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      upsert,
    },
    contact: { findMany: jest.fn().mockResolvedValue(opts.contacts ?? []) },
  } as unknown as PrismaService;

  const emit = jest.fn().mockResolvedValue(undefined);
  const enqueueFetch = jest.fn().mockResolvedValue(undefined);
  const myoperator = { parseEvent: jest.fn().mockReturnValue(event()) } as unknown as MyOperatorService;
  const service = new CallsService(
    prisma,
    {} as ConfigService<Env, true>,
    { emit } as unknown as ActivityService,
    { statusForMany: jest.fn().mockResolvedValue(new Map()) } as unknown as ConsentService,
    myoperator,
    { enqueueFetch } as unknown as RecordingsService,
  );
  return { service, prisma, upsert, emit, enqueueFetch, myoperator };
}

describe('CallsService.processWebhook', () => {
  it('is idempotent on (org, externalCallId): a retried event upserts one Call', async () => {
    // 1st time no existing row; 2nd time the (terminal) row already exists.
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'call1', organizationId: 'org1', contactId: null, status: 'COMPLETED', ambiguousMatch: false, recordingStatus: 'STORED' });
    const { service, upsert } = makeService({ findUnique });

    const first = await service.processWebhook({ call_id: 'ext1' });
    const second = await service.processWebhook({ call_id: 'ext1' });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // Both go through the same unique key — never a second create path.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { organizationId_externalCallId: { organizationId: 'org1', externalCallId: 'ext1' } },
      }),
    );
  });

  it('matches the caller number to a contact and enqueues the recording fetch', async () => {
    const { service, upsert, emit, enqueueFetch } = makeService({
      contacts: [{ id: 'ct1', phone: '+919876543210', updatedAt: new Date('2026-06-01') }],
      upsertReturn: { id: 'call1', organizationId: 'org1', contactId: 'ct1', agentUserId: 'u1', direction: 'INBOUND', status: 'COMPLETED', durationSeconds: 175 },
    });

    const res = await service.processWebhook({ call_id: 'ext1' });

    expect(res.created).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ contactId: 'ct1' }) }),
    );
    // Terminal + matched contact → a CALL_COMPLETED timeline entry.
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'CALL_COMPLETED', entityId: 'ct1' }));
    // Completed call with a recording url → consent-gated fetch enqueued.
    expect(enqueueFetch).toHaveBeenCalledWith('call1');
  });

  it('ignores an event with no external call id', async () => {
    const { service, upsert } = makeService({});
    (service as unknown as { provider: { parseEvent: jest.Mock } }).provider.parseEvent = jest
      .fn()
      .mockReturnValue(event({ externalCallId: null }));
    const res = await service.processWebhook({});
    expect(res).toEqual({ callId: null, created: false });
    expect(upsert).not.toHaveBeenCalled();
  });
});
