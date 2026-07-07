import { Module } from '@nestjs/common';
import { IdentityService } from './identity.service';
import { CustomersController } from './customers.controller';

/** Commerce customers — identity resolution + the manual merge endpoint. */
@Module({
  controllers: [CustomersController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class CustomersModule {}
