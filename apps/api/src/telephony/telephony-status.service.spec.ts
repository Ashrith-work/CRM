import { classifyTelephonyError, TelephonyStatusService } from './telephony-status.service';
import { TelephonyAuthError, TelephonyConfigError } from './http.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

function make(existing: { id: string; status: string } | null = null) {
  const integration = {
    upsert: jest.fn().mockResolvedValue({}),
    findUnique: jest.fn().mockResolvedValue(existing),
    update: jest.fn().mockResolvedValue({}),
  };
  const organization = { findFirst: jest.fn().mockResolvedValue({ id: 'org1' }) };
  const prisma = { integration, organization } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { svc: new TelephonyStatusService(prisma, audit), integration, organization, audit };
}

describe('TelephonyStatusService (un-recoverable error surfacing)', () => {
  it('recordError sets Integration ERROR with the reason and writes an audit row', async () => {
    const { svc, integration, audit } = make();
    await svc.recordError('org1', 'myoperator', 'auth_error', 'invalid API key');

    const arg = integration.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId_provider: { organizationId: 'org1', provider: 'MYOPERATOR' } });
    expect(arg.update.status).toBe('ERROR');
    expect(arg.update.config).toMatchObject({ errorKind: 'auth_error', reason: 'invalid API key' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'telephony.integration.error' }));
  });

  it('recordWebhookSignatureMismatch resolves the org and records signature_mismatch', async () => {
    const { svc, integration, organization } = make();
    await svc.recordWebhookSignatureMismatch('mock', 'MOCK_CO');
    expect(organization.findFirst).toHaveBeenCalled();
    expect(integration.upsert.mock.calls[0][0].update.config).toMatchObject({ errorKind: 'signature_mismatch' });
  });

  it('signature mismatch for an unknown company does NOT throw or upsert (still logged)', async () => {
    const { svc, integration, organization } = make();
    organization.findFirst.mockResolvedValue(null);
    await expect(svc.recordWebhookSignatureMismatch('mock', 'UNKNOWN')).resolves.toBeUndefined();
    expect(integration.upsert).not.toHaveBeenCalled();
  });

  it('recordHealthy clears a prior ERROR, and no-ops when not in error', async () => {
    const errored = make({ id: 'int1', status: 'ERROR' });
    await errored.svc.recordHealthy('org1', 'myoperator');
    expect(errored.integration.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'int1' }, data: expect.objectContaining({ status: 'CONNECTED' }) }),
    );

    const healthy = make({ id: 'int2', status: 'CONNECTED' });
    await healthy.svc.recordHealthy('org1', 'myoperator');
    expect(healthy.integration.update).not.toHaveBeenCalled();
  });
});

describe('classifyTelephonyError', () => {
  it('maps typed telephony errors and ignores generic errors', () => {
    expect(classifyTelephonyError(new TelephonyAuthError('x'))).toEqual({ kind: 'auth_error', reason: 'x' });
    expect(classifyTelephonyError(new TelephonyConfigError('y', 400))).toEqual({ kind: 'config_error', reason: 'y' });
    expect(classifyTelephonyError(new Error('z'))).toBeNull();
  });
});
