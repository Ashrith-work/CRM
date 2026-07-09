import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { CryptoService } from '../common/crypto.service';
import { normalizeEmail } from '../ingestion/shopify.mappers';
import { normalizeE164 } from '../common/phone.util';

export interface PiiInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/** Encrypted PII + the deterministic match-hashes + the non-PII email domain. */
export interface ProtectedPii {
  email: string | null; // ciphertext
  phone: string | null; // ciphertext
  firstName: string | null; // ciphertext
  lastName: string | null; // ciphertext
  emailHash: string | null;
  phoneHash: string | null;
  emailDomain: string | null; // NON-PII, cleartext (for the AI-safe view)
}

export interface RevealedPii {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}

/**
 * The single gate for Customer PII. On WRITE, `protect` encrypts name/email/phone
 * (AES-256-GCM), computes deterministic HMAC match-hashes (email/phone), and
 * derives the non-PII email domain. On authorized human READ, `reveal` decrypts.
 * Match lookups use `emailHashOf`/`phoneHashOf` — never the encrypted originals.
 * The hash is a SECONDARY index; the encrypted value stays the source of truth.
 */
@Injectable()
export class CustomerPiiService {
  private readonly pepper: string;

  constructor(
    private readonly crypto: CryptoService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('HASH_PEPPER', { infer: true });
  }

  /** Encrypt + hash + derive-domain for a write. Normalizes email/phone first. */
  protect(input: PiiInput): ProtectedPii {
    const email = normalizeEmail(input.email);
    const phone = normalizeE164(input.phone ?? null);
    return {
      email: this.crypto.encryptField(email),
      phone: this.crypto.encryptField(phone),
      firstName: this.crypto.encryptField(input.firstName ?? null),
      lastName: this.crypto.encryptField(input.lastName ?? null),
      emailHash: this.emailHashOf(email),
      phoneHash: this.phoneHashOf(phone),
      emailDomain: domainOf(email),
    };
  }

  /** Decrypt PII for an authorized human-facing read. */
  reveal(row: RevealedPii): RevealedPii {
    return {
      email: this.crypto.decryptField(row.email),
      phone: this.crypto.decryptField(row.phone),
      firstName: this.crypto.decryptField(row.firstName),
      lastName: this.crypto.decryptField(row.lastName),
    };
  }

  /** Full name from an (encrypted) row — decrypted, for human display. */
  revealName(row: { firstName: string | null; lastName: string | null }): string | null {
    const first = this.crypto.decryptField(row.firstName);
    const last = this.crypto.decryptField(row.lastName);
    const name = [first, last].filter(Boolean).join(' ').trim();
    return name || null;
  }

  /** HMAC-SHA256(normalized email, pepper) — the deterministic match key. */
  emailHashOf(rawEmail: string | null | undefined): string | null {
    const email = normalizeEmail(rawEmail);
    return email ? this.hmac(email) : null;
  }

  phoneHashOf(rawPhone: string | null | undefined): string | null {
    const phone = normalizeE164(rawPhone ?? null);
    return phone ? this.hmac(phone) : null;
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.pepper).update(value).digest('hex');
  }
}

/** The domain portion of an email (non-PII) — e.g. "jane@gmail.com" → "gmail.com". */
export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) || null : null;
}
