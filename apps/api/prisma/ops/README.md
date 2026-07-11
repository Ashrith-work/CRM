# Shopify data ops scripts

One-off, **operator-run** maintenance scripts for the Shopify commerce data in the
CRM. They read credentials + `DATABASE_URL`/`DIRECT_URL` from `apps/api/.env`.
Run from the `apps/api` package, e.g.:

```bash
corepack pnpm --filter @crm/api exec tsx prisma/ops/<script>.ts
```

These are **not** part of the app runtime and are not imported by it. They were
used on 2026-07-11 to reconcile the CRM to the live store and remove the demo
seed so the CRM shows only real Shopify data.

| Script | Writes? | Outbound? | What it does |
|--------|---------|-----------|--------------|
| `reconcile.ts` | no | Shopify reads only | Compares CRM row counts to live Shopify `*/count.json`. |
| `safe-import.ts` | DB only | **none** | Idempotent backfill of missing customers/orders via the app's real mappers + `CommerceIngestService`, with loyalty/incentives/marketing-consent **stubbed to no-ops** (no reward emails, no Shopify discount-code writes). `--orders-only` skips the customers pass. |
| `deseed.ts` | DB (txn) | no | Deletes ONLY non-Shopify seed/demo rows; **dry-run by default**, `--apply` to execute. Preserves all real Shopify data, the real admin + RBAC, Integration rows, MARKETING consents, and real guest customers. Writes an `AuditLog` (`action=deseed.commerce-only`). |
| `verify.ts` | no | no | Asserts only-real invariants (PASS/FAIL) + revenue sanity. |

## Why these exist / notes

- **Real vs seed discriminator:** real Shopify rows have a **numeric** `externalId`;
  the demo seed uses **prefixed** ids (`shp_prod_`, `shp_cust_`, `shp_order_`, `chk_`).
  Presence/absence of `externalId` is NOT a reliable signal (guest customers are
  legitimately null; seed rows carry fake ids).
- **Customer count vs Shopify:** the CRM identity-resolution collapses Shopify
  customers who share an email/phone into one row, so the CRM customer count is
  legitimately **below** Shopify's raw customer count. Orders + products reconcile.
- **Neon connections:** run bulk imports against `DIRECT_URL` (session mode); the
  pooled `DATABASE_URL` (pgbouncer) drops connections under sustained load. Both
  `safe-import.ts` and `deseed.ts` default to `DIRECT_URL` and retry on drops.
- `deseed.ts` hard-codes this store's seed identifiers (`org_1`, `user_1`, the five
  `*.test` seed users, `org_2`). Review before reusing on another dataset.
