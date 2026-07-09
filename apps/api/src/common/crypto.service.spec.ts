import { makeCrypto } from './crypto.testkit';
import { CryptoService } from './crypto.service';
import { makeTestConfig } from './crypto.testkit';

/**
 * AES-256-GCM field encryption: round-trips, ciphertext-at-rest, authenticated
 * tamper detection, legacy pass-through (additive rollout), and versioned key
 * rotation (old rows decrypt under the previous key).
 */
describe('CryptoService', () => {
  it('round-trips a value and stores CIPHERTEXT (not the plaintext) at rest', () => {
    const crypto = makeCrypto();
    const ct = crypto.encryptField('jane@nerige.co');
    expect(ct).not.toBeNull();
    expect(ct).not.toContain('jane@nerige.co');
    expect(crypto.isEncrypted(ct)).toBe(true);
    expect(crypto.decryptField(ct)).toBe('jane@nerige.co');
  });

  it('is non-deterministic — the same plaintext encrypts to different ciphertext', () => {
    const crypto = makeCrypto();
    expect(crypto.encryptField('secret')).not.toBe(crypto.encryptField('secret'));
  });

  it('passes NULL/empty through unchanged', () => {
    const crypto = makeCrypto();
    expect(crypto.encryptField(null)).toBeNull();
    expect(crypto.encryptField('')).toBe('');
    expect(crypto.decryptField(null)).toBeNull();
  });

  it('treats non-ciphertext as legacy plaintext (additive rollout)', () => {
    const crypto = makeCrypto();
    // A pre-migration raw value survives a decrypt untouched.
    expect(crypto.decryptField('legacy-plaintext@old.co')).toBe('legacy-plaintext@old.co');
  });

  it('detects tampering — a mutated ciphertext throws (never silently wrong)', () => {
    const crypto = makeCrypto();
    const ct = crypto.encryptField('sensitive')!;
    const parts = ct.split('.');
    // Flip a byte in the ciphertext segment.
    const tamperedCt = Buffer.from(parts[2], 'base64');
    tamperedCt[0] ^= 0xff;
    parts[2] = tamperedCt.toString('base64');
    expect(() => crypto.decryptField(parts.join('.'))).toThrow();
  });

  it('rotates keys: a v1 ciphertext still decrypts after v2 becomes current', () => {
    const v1 = makeCrypto({ ENCRYPTION_KEY: 'key-one', ENCRYPTION_KEY_VERSION: 1 });
    const legacy = v1.encryptField('rotate-me')!;
    expect(legacy.startsWith('1.')).toBe(true);

    // New service: v2 is current, v1 kept as the previous key on the keyring.
    const v2 = new CryptoService(
      makeTestConfig({
        ENCRYPTION_KEY: 'key-two',
        ENCRYPTION_KEY_VERSION: 2,
        ENCRYPTION_KEY_PREVIOUS: 'key-one',
        ENCRYPTION_KEY_PREVIOUS_VERSION: 1,
      }),
    );
    expect(v2.version).toBe(2);
    // Old row (v1) still readable…
    expect(v2.decryptField(legacy)).toBe('rotate-me');
    // …and new writes go out under v2.
    expect(v2.encryptField('fresh')!.startsWith('2.')).toBe(true);
  });

  it('throws when no key exists for a ciphertext version', () => {
    const crypto = makeCrypto({ ENCRYPTION_KEY: 'only-v1', ENCRYPTION_KEY_VERSION: 1 });
    // A ciphertext tagged v9 with no key on the ring.
    const forged = '9.' + Buffer.from('x').toString('base64') + '.' + Buffer.from('y').toString('base64') + '.' + Buffer.from('z').toString('base64');
    expect(() => crypto.decryptField(forged)).toThrow(/No key for version 9/);
  });
});
