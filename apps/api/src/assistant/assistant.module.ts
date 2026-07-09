import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CustomersModule } from '../customers/customers.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { GroundingService } from './grounding.service';
import { AnthropicService } from './anthropic.service';
import { AssistantOrchestrator } from './orchestrator';
import { EmbedGlossaryProcessor } from './embed-glossary.processor';
import { ASSISTANT_QUEUE } from './assistant.constants';

/**
 * P2.2 — the read-only AI assistant. Reuses M5's AnalyticsService + M3's
 * SegmentService (the safe query surfaces) via AnalyticsModule; adds the safe
 * tool layer, pgvector glossary grounding + embedding worker, the read-only
 * LLM orchestrator, caching, and audit. No mutation path exists.
 */
@Module({
  imports: [AnalyticsModule, CustomersModule, BullModule.registerQueue({ name: ASSISTANT_QUEUE })],
  controllers: [AssistantController],
  providers: [AssistantService, GroundingService, AnthropicService, AssistantOrchestrator, EmbedGlossaryProcessor],
})
export class AssistantModule {}
