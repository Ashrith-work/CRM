/**
 * Customer PII backfill + re-encrypt (key rotation) job.
 *
 * Run AFTER the encryption migration to encrypt existing plaintext rows and
 * populate emailHash/phoneHash/emailDomain. Idempotent: it `reveal`s each row
 * (decrypt-or-passthrough → plaintext) then `protect`s it under the CURRENT key,
 * so re-running it after a key rotation re-encrypts every row under the new key
 * with no data loss.
 *
 *   pnpm --filter @crm/api pii:backfill
 */
import { PrismaClient } from '@prisma/client';
import { CryptoService } from '../src/common/crypto.service';
import { CustomerPiiService } from '../src/customers/customer-pii.service';

const DEFAULTS: Record<string, unknown> = {
  ENCRYPTION_KEY: 'dev-only-insecure-encryption-key-change-me',
  ENCRYPTION_KEY_VERSION: 1,
  HASH_PEPPER: 'dev-only-insecure-hash-pepper-change-me',
};
const config = { get: (k: string) => process.env[k] ?? DEFAULTS[k] } as never;

const crypto = new CryptoService(config);
const pii = new CustomerPiiService(crypto, config);
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const batchSize = 500;
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const rows = await prisma.customer.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, email: true, phone: true, firstName: true, lastName: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const plain = pii.reveal(r); // decrypt existing (or pass through legacy plaintext)
      const p = pii.protect(plain); // re-encrypt + (re)compute hashes/domain under the current key
      await prisma.customer.update({
        where: { id: r.id },
        data: {
          email: p.email,
          phone: p.phone,
          firstName: p.firstName,
          lastName: p.lastName,
          emailHash: p.emailHash,
          phoneHash: p.phoneHash,
          emailDomain: p.emailDomain,
        },
      });
      total += 1;
    }
    cursor = rows[rows.length - 1].id;
  }
  // eslint-disable-next-line no-console
  console.log(`PII backfill complete: ${total} customer(s) encrypted under key v${crypto.version}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('PII backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
