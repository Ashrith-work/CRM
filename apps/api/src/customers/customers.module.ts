import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IdentityService } from './identity.service';
import { AiSafeCustomerRepository } from './ai-safe-customer.repository';
import { CustomersController } from './customers.controller';
import { Customer360Service } from './customer360.service';
import { Customer360Controller } from './customer360.controller';
import { ExperienceExportService } from './experience-export.service';
import { ExportProcessor } from './export.processor';
import { PurchaseAnalysisService } from './purchase-analysis.service';
import { EscalationService } from './escalation.service';
import { EXPORT_QUEUE } from './export.constants';

/**
 * Commerce customers: identity resolution + manual merge (M1), and the
 * Customer 360 reads + multi-tab Excel export with its async worker (M2).
 */
@Module({
  imports: [BullModule.registerQueue({ name: EXPORT_QUEUE })],
  controllers: [CustomersController, Customer360Controller],
  providers: [IdentityService, AiSafeCustomerRepository, Customer360Service, ExperienceExportService, ExportProcessor, PurchaseAnalysisService, EscalationService],
  exports: [IdentityService, AiSafeCustomerRepository],
})
export class CustomersModule {}
