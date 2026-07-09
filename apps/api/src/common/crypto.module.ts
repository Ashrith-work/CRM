import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { CustomerPiiService } from '../customers/customer-pii.service';

/**
 * PII protection primitives — global so identity resolution, the 360, exports,
 * audience sync, and the reward mailer can all encrypt-on-write / decrypt-on-read
 * without duplicating the crypto. Match-hashing lives in CustomerPiiService.
 */
@Global()
@Module({
  providers: [CryptoService, CustomerPiiService],
  exports: [CryptoService, CustomerPiiService],
})
export class CryptoModule {}
