import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { CryptoService } from './crypto.service';
import { CustomerPiiService } from '../customers/customer-pii.service';

/**
 * Real CryptoService + CustomerPiiService wired to a fixed test key/pepper, for
 * unit specs that exercise the encryption/hash boundary (not mocks — the specs
 * assert real ciphertext round-trips and deterministic match-hashes).
 */
export function makeTestConfig(overrides: Partial<Record<keyof Env, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    ENCRYPTION_KEY: 'test-encryption-key-0001',
    ENCRYPTION_KEY_VERSION: 1,
    ENCRYPTION_KEY_PREVIOUS: undefined,
    ENCRYPTION_KEY_PREVIOUS_VERSION: undefined,
    HASH_PEPPER: 'test-hash-pepper-0001',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

export function makeCrypto(overrides?: Partial<Record<keyof Env, unknown>>): CryptoService {
  return new CryptoService(makeTestConfig(overrides));
}

export function makePii(overrides?: Partial<Record<keyof Env, unknown>>): { crypto: CryptoService; pii: CustomerPiiService } {
  const config = makeTestConfig(overrides);
  const crypto = new CryptoService(config);
  const pii = new CustomerPiiService(crypto, config);
  return { crypto, pii };
}
