import { verifyToken, createClerkClient, type ClerkClient } from '@clerk/backend';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import type { ClerkClaims } from './auth.types';

/** Short, log-friendly classification of why a token was rejected. */
export type TokenRejectionReason = 'expired' | 'not-active-yet' | 'invalid-signature' | 'unauthorized-party' | 'invalid';

/** Verification failure carrying the precise reason (for guard-side logging). */
export class TokenVerificationFailure extends Error {
  constructor(readonly reason: TokenRejectionReason, readonly detail: string) {
    super(`token ${reason}: ${detail}`);
    this.name = 'TokenVerificationFailure';
  }
}

/**
 * Isolates Clerk SDK usage so guards depend on a mockable seam. Verifies a
 * session JWT with the OFFICIAL @clerk/backend verifier against Clerk's JWKS
 * (networkless when CLERK_JWT_KEY is set) — never hand-rolled. Applies a
 * configurable clock-skew tolerance and maps SDK errors to a precise reason.
 */
@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private client?: ClerkClient;

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** The signed-in user's primary email (lowercased), or null — used to bind a
   * Clerk account to a seeded user when the clerkUserId isn't known yet. */
  async getUserEmail(clerkUserId: string): Promise<string | null> {
    try {
      this.client ??= createClerkClient({ secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }) });
      const user = await this.client.users.getUser(clerkUserId);
      const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ?? user.emailAddresses[0];
      return primary?.emailAddress?.toLowerCase() ?? null;
    } catch (err) {
      this.logger.warn(`Could not fetch Clerk email for ${clerkUserId}: ${(err as Error).message}`);
      return null;
    }
  }

  async verifyToken(token: string): Promise<ClerkClaims> {
    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }),
        jwtKey: this.config.get('CLERK_JWT_KEY', { infer: true }) || undefined,
        authorizedParties: this.authorizedParties(),
        clockSkewInMs: this.config.get('CLERK_CLOCK_SKEW_MS', { infer: true }),
      });
      return payload as unknown as ClerkClaims;
    } catch (err) {
      throw classifyVerificationError(err);
    }
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

/**
 * Map a @clerk/backend verification error to a precise, log-friendly reason.
 * Robust to the SDK's error shape (reason may be an object with an `id` or a
 * plain string) and falls back to message-text matching.
 */
export function classifyVerificationError(err: unknown): TokenVerificationFailure {
  const e = err as { reason?: { id?: string } | string; message?: string };
  const reasonId = typeof e.reason === 'string' ? e.reason : e.reason?.id;
  const text = `${reasonId ?? ''} ${e.message ?? ''}`.toLowerCase();
  let reason: TokenRejectionReason = 'invalid';
  if (text.includes('expired')) reason = 'expired';
  else if (text.includes('not-active') || text.includes('not active') || text.includes('nbf')) reason = 'not-active-yet';
  else if (text.includes('signature')) reason = 'invalid-signature';
  else if (text.includes('authorized-part') || text.includes('authorized part') || text.includes('azp')) reason = 'unauthorized-party';
  return new TokenVerificationFailure(reason, reasonId ?? e.message ?? 'verification failed');
}
