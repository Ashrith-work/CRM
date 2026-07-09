# PII Protection — encryption at rest, match-hashes, and the AI boundary

This milestone protects customer PII (name, email, phone) so that:

1. The AI assistant and any external API **never** receive raw PII — only a
   `customer_id`, a pseudonym (`Customer #<id>`), and non-identifying fields
   (email **domain**, RFM/CLV/churn bands, VIP tier, order count, net revenue).
2. The CRM can still send emails, show Customer 360 to authorized humans, run
   identity resolution / dedup, and export — because PII is **encrypted**
   (reversible), not one-way hashed.

## How it works

### 1. Encryption at rest (AES-256-GCM) — `CryptoService`
`Customer.email`, `phone`, `firstName`, `lastName` store **ciphertext**, wire
format `` `<keyVersion>.<iv_b64>.<ct_b64>.<tag_b64>` ``. Keys come from
`ENCRYPTION_KEY` (vault, **never** the DB). Ciphertext carries its key version so
keys rotate without a flag day: new writes use the current key; old rows decrypt
under `ENCRYPTION_KEY_PREVIOUS` until `pii:backfill` re-encrypts them.
Decryption happens **only** in the API layer, for an RBAC-authorized human read,
and is **audited** (`customer.pii.reveal`). Plaintext is never logged.

**Graceful legacy pass-through:** `decryptField` returns any non-ciphertext value
unchanged (treated as pre-migration plaintext). This makes encryption *additive* —
existing rows and tests keep working; only new writes (through `CustomerPiiService.protect`)
encrypt. Run the backfill to encrypt historical rows.

### 2. Deterministic match-hashes (HMAC-SHA256) — `CustomerPiiService`
`Customer.emailHash` / `phoneHash` = `HMAC-SHA256(normalized, HASH_PEPPER)`,
indexed. Identity resolution + dedup + Meta lead-conversion matching all run on
these hashes (the encrypted originals are non-deterministic and can't be matched
or uniquely-indexed). The hash is a **secondary** index; the encrypted value is
the source of truth. `@@unique([organizationId, emailHash])` replaces the old
unique on `email`; `@@index([organizationId, phoneHash])` replaces the old phone
index. `emailDomain` (non-PII) is derived for the AI-safe view.

### 3. The AI-safe boundary — `AiSafeCustomerRepository` → `SafeCustomer`
The assistant's query tools and any external-API payload builder touch customers
**only** through this repository. Its return type is `SafeCustomer`
(`customerId`, `pseudonym`, `emailDomain`, RFM/CLV/churn/VIP, counts) — it
**cannot carry** name/email/phone and it **never decrypts**. It reads only
`{ id, emailDomain }` from `Customer`. Re-identification is exclusively the human,
RBAC-gated, audited Customer 360 path — the AI is never in it.

### 4. Free-text scrubbing — `scrubPii`
Defense-in-depth: before any free text (notes, tool strings) reaches an LLM
prompt, `scrubPii` masks emails, phones, and Title-Case names. This catches PII
embedded in free text that the structural boundary can't see.

### 5. Outbound hashing (third-party requirement only) — audience sync
Meta Custom Audiences require SHA-256-hashed emails/phones. `AudienceService`
decrypts a **copy** server-side (ConsentGate-gated: only GRANTED + non-suppressed
customers) and hashes it at upload. Raw PII never leaves us.

## Operational notes

- **Migration:** `20260722000000_customer_pii_encryption` is DDL-only (adds the
  hash/domain columns + swaps the indexes). AES/HMAC can't run in SQL, so encrypt
  historical rows with the app-level backfill **after** deploy:
  `pnpm --filter @crm/api pii:backfill`.
- **Key rotation:** move the old key to `ENCRYPTION_KEY_PREVIOUS(_VERSION)`, set a
  new `ENCRYPTION_KEY`/`_VERSION`, deploy, then run `pii:backfill` (idempotent —
  it reveals+re-protects every row, upgrading it to the current key version).
- **Pepper change:** invalidates all stored match-hashes → run `pii:backfill` to
  recompute them.

## Assumptions / scope

- **Scope = the commerce `Customer` only.** CRM `Contact`/`Lead` are the top of
  the funnel and are not on the AI/Meta boundary in this milestone; encrypting
  them is a follow-up. Lead→customer matching already hashes via `CustomerPiiService`.
- **Search over encrypted columns is limited.** A DB `contains` can't match
  ciphertext. Customer-list **email** search resolves via the exact `emailHash`;
  **name** search scans a bounded candidate set (`SEARCH_SCAN_CAP = 1000`) and
  filters on the decrypted name. Large-tenant fuzzy name search would need a
  blind-index / search-service follow-up.
- **Customer 360 caching:** only the **masked** profile is cached in Redis. The
  unmasked (decrypted) profile is rebuilt per request so raw PII never rests in
  the cache and every unmasked read is audited.
- **Names are shown decrypted to any COMMERCE_READ human** (masked view still
  shows the name, masks email/phone) — matching the pre-existing product
  behavior. Tighten to admin-only if policy requires.
