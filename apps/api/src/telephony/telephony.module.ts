import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { MockTelephonyService } from './mock.service';
import { MyOperatorService } from './myoperator.service';
import { ExotelService } from './exotel.service';
import { TelephonyStatusService } from './telephony-status.service';
import { TELEPHONY_PROVIDER, type TelephonyProvider } from './telephony.provider';

/**
 * Telephony adapters behind a swap-able TelephonyProvider seam. All three
 * (Mock, MyOperator, Exotel) are instantiated (so each provider's webhook route
 * can parse with its own adapter); the ACTIVE provider — used for outbound +
 * recording download + reconciliation — is chosen by TELEPHONY_PROVIDER
 * (default MOCK) and injected via the TELEPHONY_PROVIDER token. Global so calls
 * + recordings can inject it. TelephonyStatusService surfaces un-recoverable
 * provider errors onto the Integration row.
 */
@Global()
@Module({
  providers: [
    MockTelephonyService,
    MyOperatorService,
    ExotelService,
    TelephonyStatusService,
    {
      provide: TELEPHONY_PROVIDER,
      inject: [ConfigService, MockTelephonyService, MyOperatorService, ExotelService],
      useFactory: (
        config: ConfigService<Env, true>,
        mock: MockTelephonyService,
        myoperator: MyOperatorService,
        exotel: ExotelService,
      ): TelephonyProvider => {
        const selected = config.get('TELEPHONY_PROVIDER', { infer: true });
        const provider = selected === 'myoperator' ? myoperator : selected === 'exotel' ? exotel : mock;
        new Logger('TelephonyModule').log(`Active telephony provider: ${provider.id}${provider.isMock() ? ' (mock)' : ''}`);
        return provider;
      },
    },
  ],
  exports: [MockTelephonyService, MyOperatorService, ExotelService, TelephonyStatusService, TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
