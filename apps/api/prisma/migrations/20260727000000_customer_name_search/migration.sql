-- Fast, indexed name typeahead. Names are encrypted at rest, so a trigram index
-- can't sit on the ciphertext — add a normalized plaintext `nameSearch` column and
-- a pg_trgm GIN index so `nameSearch ILIKE '%q%'` is index-backed. Deliberate
-- perf/PII tradeoff (names already display-exposed to commerce:read; email/phone
-- remain encrypted + hash-only). Backfilled by prisma/ops/backfill-name-search.ts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE "Customer" ADD COLUMN "nameSearch" TEXT;

-- GIN trigram index → supports LIKE/ILIKE '%q%' name search without a seq scan.
CREATE INDEX "Customer_nameSearch_trgm_idx" ON "Customer" USING gin ("nameSearch" gin_trgm_ops);
