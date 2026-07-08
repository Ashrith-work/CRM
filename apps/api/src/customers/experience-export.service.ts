import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Workbook } from 'exceljs';
import { EXPERIENCE_EXPORT_TABS, type ExportStatusResponse } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { maskEmail } from '../common/pii.util';
import { EXPORT_QUEUE, type ExportJob } from './export.constants';

/** Tabs with real data now vs. placeholder "no data yet" (modules land later). */
const POPULATED = new Set(['Summary', 'Orders', 'Discounts & Incentives']);

/**
 * Customer-Experience Excel export (exceljs). The SAME engine powers the sync
 * single-customer download and the async segment/large-history worker. Non-admin
 * callers get a PII-masked workbook. Every export writes an ExperienceExport row
 * AND an AuditLog row.
 */
@Injectable()
export class ExperienceExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @InjectQueue(EXPORT_QUEUE) private readonly queue: Queue,
  ) {}

  /** Build the 8-tab workbook for one or more customers. */
  async buildWorkbook(organizationId: string, customerIds: string[], masked: boolean): Promise<Buffer> {
    const customers = await this.prisma.customer.findMany({ where: { organizationId, id: { in: customerIds } } });
    const features = await this.prisma.customerFeatures.findMany({ where: { organizationId, customerId: { in: customerIds } } });
    const featBy = new Map(features.map((f) => [f.customerId, f]));
    const orders = await this.prisma.order.findMany({
      where: { organizationId, customerId: { in: customerIds }, deletedAt: null },
      include: { items: { select: { title: true, variant: true, quantity: true } } },
      orderBy: { placedAt: 'desc' },
    });

    const wb = new Workbook();
    wb.creator = 'CRM';
    const sheets = new Map(EXPERIENCE_EXPORT_TABS.map((t) => [t, wb.addWorksheet(t)]));
    const name = (id: string) => {
      const c = customers.find((x) => x.id === id);
      return c ? [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.externalId || id : id;
    };
    const email = (raw: string | null) => (masked ? maskEmail(raw) : raw);

    // Summary
    const summary = sheets.get('Summary')!;
    summary.addRow(['Customer', 'Email', 'Orders', 'Net revenue', 'Avg order value', 'First order', 'Last order', 'Currency']);
    for (const c of customers) {
      const f = featBy.get(c.id);
      summary.addRow([
        name(c.id),
        email(c.email),
        f?.orderCount ?? 0,
        major(f?.netRevenueMinor ?? 0),
        major(f?.avgOrderValueMinor ?? 0),
        f?.firstOrderAt?.toISOString().slice(0, 10) ?? '',
        f?.lastOrderAt?.toISOString().slice(0, 10) ?? '',
        f?.currency ?? '',
      ]);
    }

    // Orders
    const ordersSheet = sheets.get('Orders')!;
    ordersSheet.addRow(['Customer', 'Order #', 'Placed', 'Status', 'Financial', 'Net value', 'Currency', 'Items', 'Discount code']);
    for (const o of orders) {
      ordersSheet.addRow([
        name(o.customerId ?? ''),
        o.orderNumber ?? o.externalId,
        o.placedAt.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        o.status,
        o.financialStatus,
        major(o.totalMinor - o.refundedMinor),
        o.currency,
        o.items.map((it) => `${it.title}${it.variant ? ` (${it.variant})` : ''} ×${it.quantity}`).join(', '),
        o.discountCode ?? '',
      ]);
    }

    // Discounts & Incentives
    const discounts = sheets.get('Discounts & Incentives')!;
    discounts.addRow(['Customer', 'Order #', 'Discount code', 'Discount amount', 'Order net']);
    for (const o of orders.filter((x) => x.discountCode || x.discountMinor > 0)) {
      discounts.addRow([name(o.customerId ?? ''), o.orderNumber ?? o.externalId, o.discountCode ?? '', major(o.discountMinor), major(o.totalMinor - o.refundedMinor)]);
    }

    // Placeholder tabs — headers + a single "no data yet" row.
    for (const tab of EXPERIENCE_EXPORT_TABS) {
      if (POPULATED.has(tab)) continue;
      const s = sheets.get(tab)!;
      s.addRow([tab]);
      s.addRow(['no data yet — this module is not enabled yet']);
    }

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** Persist the export audit trail (ExperienceExport + AuditLog). */
  async recordExport(organizationId: string, actorUserId: string, customerId: string | null, masked: boolean): Promise<void> {
    await this.prisma.experienceExport.create({ data: { organizationId, actorUserId, customerId, masked } });
    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'experience.export',
      entity: 'Customer',
      entityId: customerId,
      after: { masked, customerId },
    });
  }

  /** Sync single-customer export → the workbook bytes + a filename. */
  async exportCustomer(organizationId: string, id: string, actorUserId: string, unmasked: boolean): Promise<{ buffer: Buffer; filename: string }> {
    const customer = await this.prisma.customer.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true, mergedIntoId: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const targetId = customer.mergedIntoId ?? customer.id;
    const buffer = await this.buildWorkbook(organizationId, [targetId], !unmasked);
    await this.recordExport(organizationId, actorUserId, targetId, !unmasked);
    return { buffer, filename: `customer-experience-${targetId}.xlsx` };
  }

  /** Enqueue an async export (large single history OR a whole segment). */
  async enqueueExport(organizationId: string, actorUserId: string, customerIds: string[], unmasked: boolean): Promise<string> {
    const jobId = `exp_${organizationId}_${actorUserId}_${customerIds.length}_${Math.round(Math.random() * 1e9)}`;
    await this.setStatus(jobId, { state: 'queued', ready: false, filename: null, error: null });
    await this.queue.add(
      'export',
      { organizationId, actorUserId, customerIds, masked: !unmasked, filename: `customer-experience-${customerIds.length}.xlsx` } satisfies ExportJob,
      { jobId, removeOnComplete: true, removeOnFail: 50, attempts: 2 },
    );
    return jobId;
  }

  async status(jobId: string): Promise<ExportStatusResponse> {
    return (await this.redis.cacheGet<ExportStatusResponse>(`exportstatus:${jobId}`)) ?? { state: 'failed', ready: false, filename: null, error: 'unknown job' };
  }

  async download(jobId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    const status = await this.status(jobId);
    if (!status.ready) return null;
    const b64 = await this.redis.cacheGet<string>(`exportfile:${jobId}`);
    if (!b64) return null;
    return { buffer: Buffer.from(b64, 'base64'), filename: status.filename ?? 'export.xlsx' };
  }

  async setStatus(jobId: string, status: ExportStatusResponse): Promise<void> {
    await this.redis.cacheSet(`exportstatus:${jobId}`, status, 900);
  }

  async storeFile(jobId: string, buffer: Buffer): Promise<void> {
    await this.redis.cacheSet(`exportfile:${jobId}`, buffer.toString('base64'), 900);
  }
}

const major = (minor: number): number => Math.round(minor) / 100;
