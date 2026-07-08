import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { RfmRefreshService } from './rfm-refresh.service';
import { ChurnScoreService } from './churn-score.service';
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
  providers: [AnalyticsService, RfmRefreshService, ChurnScoreService, SegmentService, AnalyticsProcessor],
  exports: [RfmRefreshService, ChurnScoreService, SegmentService],
})
export class AnalyticsModule {}
