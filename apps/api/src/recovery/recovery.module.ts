import { Module } from '@nestjs/common';
import { RecoveryService } from './recovery.service';
import { RecoveryController } from './recovery.controller';

/**
 * Recovery-lead assignment: dynamic prospect segments (cart-abandoners +
 * identified non-buyers), assignment + progress + office-wide coordination +
 * conversion attribution. Prisma/CryptoModule(PII)/AuditService are global.
 */
@Module({
  controllers: [RecoveryController],
  providers: [RecoveryService],
  exports: [RecoveryService],
})
export class RecoveryModule {}
