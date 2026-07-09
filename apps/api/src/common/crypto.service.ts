import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
// Ciphertext wire format: "<keyVersion>.<iv_b64>.<ct_b64>.<tag_b64>".
const CIPHERTEXT_RE = /^(\d+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)\.([A-Za-z0-9+/=]+)$/;

const DEV_KEY = 'dev-only-insecure-encryption-key-change-me';

/**
 * Authenticated field-level encryption (AES-256-GCM) for PII at rest. Ciphertext
 * carries its KEY VERSION so keys can be rotated without a flag day: new writes
 * use the current key; old rows decrypt under the previous key until a re-encrypt
 * job upgrades them.
 *
 * Graceful legacy pass-through: `decryptField` returns any value that isn't in
 * our ciphertext format unchanged (treating it as pre-migration plaintext), so
 * enabling encryption is additive — only new writes encrypt, and existing rows
 * keep working until the backfill runs.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly keyring = new Map<number, Buffer>();
  private readonly currentVersion: number;

  constructor(config: ConfigService<Env, true>) {
    const current = config.get('ENCRYPTION_KEY', { infer: true });
    this.currentVersion = config.get('ENCRYPTION_KEY_VERSION', { infer: true });
    this.keyring.set(this.currentVersion, deriveKey(current));

    const previous = config.get('ENCRYPTION_KEY_PREVIOUS', { infer: true });
    const previousVersion = config.get('ENCRYPTION_KEY_PREVIOUS_VERSION', { infer: true });
    if (previous && previousVersion) this.keyring.set(previousVersion, deriveKey(previous));

    if (current === DEV_KEY) {
      this.logger.warn('ENCRYPTION_KEY is the INSECURE DEV DEFAULT — set a real key from the vault in production.');
    }
  }

  /** The key version new writes are encrypted under (for re-encrypt-job targeting). */
  get version(): number {
    return this.currentVersion;
  }

  isEncrypted(value: string | null | undefined): boolean {
    return !!value && CIPHERTEXT_RE.test(value);
  }

  /** Encrypt a plaintext field → versioned, authenticated ciphertext. */
  encryptField(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return plaintext ?? null;
    const key = this.keyring.get(this.currentVersion)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${this.currentVersion}.${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
  }

  /**
   * Decrypt a field. Non-ciphertext values pass through unchanged (legacy
   * plaintext). A tampered/unknown-key ciphertext throws (never silently wrong).
   */
  decryptField(value: string | null | undefined): string | null {
    if (value == null) return null;
    const m = CIPHERTEXT_RE.exec(value);
    if (!m) return value; // legacy plaintext — pass through
    const [, versionStr, ivB64, ctB64, tagB64] = m;
    const key = this.keyring.get(Number(versionStr));
    if (!key) throw new Error(`No key for version ${versionStr} — cannot decrypt`);
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  }

  /** The version a stored ciphertext was written under (null for legacy plaintext). */
  versionOf(value: string | null | undefined): number | null {
    const m = value ? CIPHERTEXT_RE.exec(value) : null;
    return m ? Number(m[1]) : null;
  }
}

/** Derive a 32-byte AES key from an arbitrary key string (hex/base64/passphrase). */
function deriveKey(material: string): Buffer {
  return createHash('sha256').update(material, 'utf8').digest();
}
