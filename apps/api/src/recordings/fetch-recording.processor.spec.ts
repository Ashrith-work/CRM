import { FetchRecordingProcessor } from './fetch-recording.processor';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { MyOperatorService } from '../telephony/myoperator.service';
import type { CloudinaryService } from './cloudinary.service';
import type { ConsentGate } from '../consents/consent-gate.service';
import type { Env } from '../config/env';
import type { Job } from 'bullmq';

const CALL = {
  id: 'call1',
  organizationId: 'org1',
  contactId: 'ct1',
  agentUserId: 'u1',
  deletedAt: null,
  recordingStatus: 'PENDING',
  recordingSourceUrl: 'https://rec.example/r.mp3',
};

function fetchJob(): Job {
  return { data: { type: 'fetch', callId: 'call1' }, opts: { attempts: 5 }, attemptsMade: 0 } as unknown as Job;
}

function make(opts: {
  allowed: boolean;
  sizeBytes?: number;
  maxBytes?: number;
  call?: Record<string, unknown> | null;
}) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    call: { findUnique: jest.fn().mockResolvedValue(opts.call === undefined ? CALL : opts.call), update },
  } as unknown as PrismaService;
  const config = { get: jest.fn().mockReturnValue(opts.maxBytes ?? 50 * 1024 * 1024) } as unknown as ConfigService<Env, true>;
  const downloadRecording = jest.fn().mockResolvedValue({ buffer: Buffer.alloc(opts.sizeBytes ?? 10), contentType: 'audio/mpeg', sizeBytes: opts.sizeBytes ?? 10 });
  const myoperator = { downloadRecording } as unknown as MyOperatorService;
  const upload = jest.fn().mockResolvedValue({ publicId: 'crm/recordings/acme/call1', bytes: opts.sizeBytes ?? 10 });
  const cloudinary = { upload } as unknown as CloudinaryService;
  const gate = { ensureCanStore: jest.fn().mockResolvedValue(opts.allowed) } as unknown as ConsentGate;
  return { processor: new FetchRecordingProcessor(prisma, config, myoperator, cloudinary, gate), update, downloadRecording, upload, gate };
}

describe('FetchRecordingProcessor (fetch)', () => {
  it('downloads + uploads + marks STORED when consent is GRANTED', async () => {
    const { processor, update, downloadRecording, upload } = make({ allowed: true });
    const res = await processor.process(fetchJob());

    expect(downloadRecording).toHaveBeenCalledWith('https://rec.example/r.mp3');
    expect(upload).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'call1' },
      data: { recordingStoredUrl: 'crm/recordings/acme/call1', recordingStatus: 'STORED' },
    });
    expect(res).toEqual({ ok: true });
  });

  it('blocks (no download) and marks BLOCKED when consent is not granted', async () => {
    const { processor, update, downloadRecording } = make({ allowed: false });
    const res = await processor.process(fetchJob());

    expect(downloadRecording).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'call1' }, data: { recordingStatus: 'BLOCKED' } });
    expect(res).toEqual({ ok: false });
  });

  it('marks FAILED (no upload) when the recording exceeds the size guard', async () => {
    const { processor, update, upload } = make({ allowed: true, sizeBytes: 999, maxBytes: 100 });
    const res = await processor.process(fetchJob());

    expect(upload).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: 'call1' }, data: { recordingStatus: 'FAILED' } });
    expect(res).toEqual({ ok: false });
  });
});
