import { Workbook } from 'exceljs';
import { ExperienceExportService } from './experience-export.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { AuditService } from '../audit/audit.service';
import type { Queue } from 'bullmq';

function build() {
  const create = jest.fn().mockResolvedValue({});
  const record = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    customer: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', firstName: 'Jane', lastName: 'Doe', email: 'jane@nerige.co', externalId: 'x' }]) },
    customerFeatures: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1', orderCount: 2, netRevenueMinor: 250000, avgOrderValueMinor: 125000, firstOrderAt: new Date('2026-01-01'), lastOrderAt: new Date('2026-06-01'), currency: 'INR' }]) },
    order: { findMany: jest.fn().mockResolvedValue([{ customerId: 'c1', orderNumber: '1042', externalId: '555', placedAt: new Date('2026-06-01T00:00:00Z'), status: 'FULFILLED', financialStatus: 'PAID', totalMinor: 150000, refundedMinor: 0, currency: 'INR', discountCode: 'DIWALI10', discountMinor: 10000, items: [{ title: 'Cotton Tee', variant: 'M / Black', quantity: 2 }] }]) },
    experienceExport: { create },
  } as unknown as PrismaService;
  const redis = { cacheGet: jest.fn(), cacheSet: jest.fn() } as unknown as RedisService;
  const audit = { record } as unknown as AuditService;
  const service = new ExperienceExportService(prisma, redis, audit, { add: jest.fn() } as unknown as Queue);
  return { service, create, record };
}

async function load(buffer: Buffer): Promise<Workbook> {
  const wb = new Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('ExperienceExportService.buildWorkbook', () => {
  it('has the 8 tabs, real Orders/Discounts data (money in major units), placeholders elsewhere', async () => {
    const { service } = build();
    const wb = await load(await service.buildWorkbook('org1', ['c1'], false));

    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary', 'Orders', 'Discounts & Incentives', 'Support & Calls', 'Campaigns & Messages', 'Behaviour & Attribution', 'Returns', 'Loyalty',
    ]);
    // Orders row 2: net value = 1500.00 (150000 paise / 100), discount code carried.
    const orders = wb.getWorksheet('Orders')!;
    expect(orders.getRow(2).getCell(6).value).toBe(1500);
    expect(orders.getRow(2).getCell(9).value).toBe('DIWALI10');
    // Discounts tab has the discount amount 100 (10000 paise / 100).
    expect(wb.getWorksheet('Discounts & Incentives')!.getRow(2).getCell(4).value).toBe(100);
    // A placeholder tab says "no data yet".
    expect(String(wb.getWorksheet('Returns')!.getRow(2).getCell(1).value)).toContain('no data yet');
  });

  it('masks email in the workbook unless unmasked', async () => {
    const { service } = build();
    const maskedWb = await load(await service.buildWorkbook('org1', ['c1'], true));
    expect(maskedWb.getWorksheet('Summary')!.getRow(2).getCell(2).value).toBe('j•••@n•••.co');

    const rawWb = await load(await service.buildWorkbook('org1', ['c1'], false));
    expect(rawWb.getWorksheet('Summary')!.getRow(2).getCell(2).value).toBe('jane@nerige.co');
  });

  it('recordExport writes an ExperienceExport row AND an AuditLog row', async () => {
    const { service, create, record } = build();
    await service.recordExport('org1', 'admin1', 'c1', true);
    expect(create).toHaveBeenCalledWith({ data: { organizationId: 'org1', actorUserId: 'admin1', customerId: 'c1', masked: true } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'experience.export', entityId: 'c1' }));
  });
});
