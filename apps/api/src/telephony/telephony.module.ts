import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { MyOperatorService } from './myoperator.service';
import { ExotelService } from './exotel.service';
import { TELEPHONY_PROVIDER, type TelephonyProvider } from './telephony.provider';

/**
 * Telephony adapters behind a swap-able TelephonyProvider seam. Both MyOperator
 * and Exotel are instantiated (so each provider's webhook route can parse with
 * its own adapter); the ACTIVE provider — used for outbound + recording download
 * — is chosen by TELEPHONY_PROVIDER (default myoperator) and injected via the
 * TELEPHONY_PROVIDER token. Global so calls + recordings can inject it.
 */
@Global()
@Module({
  providers: [
    MyOperatorService,
    ExotelService,
    {
      provide: TELEPHONY_PROVIDER,
      inject: [ConfigService, MyOperatorService, ExotelService],
      useFactory: (config: ConfigService<Env, true>, myoperator: MyOperatorService, exotel: ExotelService): TelephonyProvider => {
        const selected = config.get('TELEPHONY_PROVIDER', { infer: true });
        const provider = selected === 'exotel' ? exotel : myoperator;
        new Logger('TelephonyModule').log(`Active telephony provider: ${provider.id}${provider.isMock() ? ' (mock)' : ''}`);
        return provider;
      },
    },
  ],
  exports: [MyOperatorService, ExotelService, TELEPHONY_PROVIDER],
})
export class TelephonyModule {}
