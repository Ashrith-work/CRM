import { Global, Module } from '@nestjs/common';
import { ClerkService } from './clerk.service';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { UserContextService } from './user-context.service';

@Global()
@Module({
  providers: [ClerkService, UserContextService, ClerkAuthGuard],
  exports: [ClerkService, UserContextService, ClerkAuthGuard],
})
export class AuthModule {}
