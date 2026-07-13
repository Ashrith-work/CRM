import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsService } from './analytics.service';
import { KpiService } from './kpi.service';
import { AnalyticsController } from './analytics.controller';
import { RfmRefreshService } from './rfm-refresh.service';
import { ChurnScoreService } from './churn-score.service';
import { TierService } from './tier.service';
import { AnalyticsProcessor } from './analytics.processor';
import { SegmentService } from '../segments/segment.service';
import { SegmentsController } from '../segments/segments.controller';
import { ANALYTICS_QUEUE } from './analytics.constants';

/**
 * M3 — RFM analytics (materialized view + nightly refresh worker) + JSON
 * rule-tree segmentation. Endpoints READ the denormalized features; the worker
 * is the only writer of RFM scores + dynamic-segment membership.
 */
@Module({
  imports: [BullModule.registerQueue({ name: ANALYTICS_QUEUE })],
  controllers: [AnalyticsController, SegmentsController],
  providers: [AnalyticsService, KpiService, RfmRefreshService, ChurnScoreService, TierService, SegmentService, AnalyticsProcessor],
  exports: [AnalyticsService, KpiService, RfmRefreshService, ChurnScoreService, TierService, SegmentService],
})
export class AnalyticsModule {}
