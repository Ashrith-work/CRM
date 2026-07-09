import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AttributionService } from './attribution.service';

/**
 * Refresh the attribution materialized views. Capture web touchpoints from
 * orders first (so first-touch bucketing sees them), then REFRESH the views.
 * CONCURRENTLY where possible (each view has a unique index), plain fallback.
 */
@Injectable()
export class AttributionRefreshService {
  private readonly logger = new Logger(AttributionRefreshService.name);
  private static readonly VIEWS = ['source_ltv_cac', 'ad_performance'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly attribution: AttributionService,
  ) {}

  /** Capture order touchpoints for every org, then refresh the ads views. */
  async refreshAll(): Promise<{ orgs: number; touchpoints: number }> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true } });
    let touchpoints = 0;
    for (const { id } of orgs) {
      touchpoints += await this.attribution.captureOrderTouchpoints(id);
    }
    await this.refreshViews();
    this.logger.log(`Attribution refresh: ${touchpoints} order touchpoints across ${orgs.length} org(s)`);
    return { orgs: orgs.length, touchpoints };
  }

  async refreshViews(): Promise<void> {
    for (const view of AttributionRefreshService.VIEWS) {
      try {
        await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
      } catch (err) {
        this.logger.warn(`CONCURRENTLY refresh of ${view} failed (${(err as Error).message}); falling back`);
        await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`);
      }
    }
  }
}
