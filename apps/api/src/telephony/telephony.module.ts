import { Global, Module } from '@nestjs/common';
import { MyOperatorService } from './myoperator.service';

/** Telephony adapter (MyOperator). Global so calls + recordings can inject it. */
@Global()
@Module({
  providers: [MyOperatorService],
  exports: [MyOperatorService],
})
export class TelephonyModule {}
