import { verifyToken } from '@clerk/backend';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { ClerkClaims } from './auth.types';

/**
 * Isolates Clerk SDK usage so guards depend on a mockable seam.
 * Verifies a session JWT (networkless when CLERK_JWT_KEY is set).
 */
@Injectable()
export class ClerkService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async verifyToken(token: string): Promise<ClerkClaims> {
    const payload = await verifyToken(token, {
      secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }),
      jwtKey: this.config.get('CLERK_JWT_KEY', { infer: true }) || undefined,
      authorizedParties: this.authorizedParties(),
    });
    return payload as unknown as ClerkClaims;
  }

  private authorizedParties(): string[] | undefined {
    const raw = this.config.get('CLERK_AUTHORIZED_PARTIES', { infer: true });
    if (!raw) return undefined;
    const parties = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parties.length ? parties : undefined;
  }
}
