-- Customer PII encryption at rest + deterministic match-hash columns.
--
-- IMPORTANT: the email/phone/firstName/lastName columns now hold CIPHERTEXT.
-- AES-256-GCM + HMAC can't run in SQL, so this migration only changes the shape;
-- run the app-level backfill AFTER deploying to encrypt existing rows + populate
-- the hash/domain columns:  `pnpm --filter @crm/api pii:backfill`
-- (Reads decrypt existing PLAINTEXT via graceful pass-through until then, but
-- match-hashes / the AI-safe email domain are null for un-backfilled rows.)

-- Match-hash + non-PII domain columns.
ALTER TABLE "Customer" ADD COLUMN "emailHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "phoneHash" TEXT;
ALTER TABLE "Customer" ADD COLUMN "emailDomain" TEXT;

-- Uniqueness + lookup move OFF the (now non-deterministic ciphertext) PII columns
-- and ONTO the deterministic hashes.
DROP INDEX "Customer_organizationId_email_key";
DROP INDEX "Customer_organizationId_phone_idx";
CREATE UNIQUE INDEX "Customer_organizationId_emailHash_key" ON "Customer" ("organizationId", "emailHash");
CREATE INDEX "Customer_organizationId_phoneHash_idx" ON "Customer" ("organizationId", "phoneHash");
