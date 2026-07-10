# Neon DB roles — least privilege (Part A, layer 3)

Goal: no single credential can read or destroy everything. Split the one
all-powerful connection into **three purpose-scoped roles**, so a leaked runtime
credential can't run DDL or drop tables, and the analytics/AI read path can't
even `SELECT` raw PII columns at the database level (belt-and-suspenders on top of
the app's encryption + AI-safe boundary).

> This is **infrastructure** you apply once in Neon — it is not app code. Run the
> SQL below as the Neon **owner** role (Neon console → SQL Editor, or `psql` with
> the owner connection string).

## The three roles

| Role | Used by | Privileges | Maps to env var |
|---|---|---|---|
| `crm_migrator` | `prisma migrate deploy` (CI/deploy only) | DDL on the schema (create/alter/drop) | `DIRECT_URL` |
| `crm_app` | the running API (runtime) | DML only: `SELECT/INSERT/UPDATE/DELETE`. **No DDL, no superuser, no role mgmt** | `DATABASE_URL` |
| `crm_analytics_ro` | analytics / AI read path | `SELECT` only, and **NOT** on Customer PII columns | `ANALYTICS_DATABASE_URL` (new) |

The schema already separates `DATABASE_URL` (runtime) from `DIRECT_URL`
(migrations), so adopting `crm_migrator`/`crm_app` is just pointing each at a
different role — no app change. The read-only role needs the AI/analytics path to
use a separate connection (see "Wiring", step 3).

## 1. Create the roles

```sql
-- Run as the Neon owner. Use strong, per-environment passwords from the vault.
CREATE ROLE crm_migrator      LOGIN PASSWORD '<vault:crm_migrator_pw>';
CREATE ROLE crm_app           LOGIN PASSWORD '<vault:crm_app_pw>';
CREATE ROLE crm_analytics_ro  LOGIN PASSWORD '<vault:crm_analytics_ro_pw>';

-- None of these are superuser / createrole / createdb (that's the default; keep it).
-- Everyone may connect to the DB and use the public schema.
GRANT CONNECT ON DATABASE crm TO crm_migrator, crm_app, crm_analytics_ro;
GRANT USAGE   ON SCHEMA public TO crm_migrator, crm_app, crm_analytics_ro;
```

## 2. Grant per-role privileges

```sql
-- migrator: full DDL/DML so `prisma migrate deploy` can build the schema.
GRANT ALL ON SCHEMA public TO crm_migrator;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO crm_migrator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO crm_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT ALL ON TABLES TO crm_migrator;

-- app (runtime): DML only, no DDL. Future tables auto-granted via the migrator's
-- default privileges below so new migrations don't lock the app out.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES  IN SCHEMA public TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO crm_app;

-- analytics/AI (read-only): SELECT on everything EXCEPT raw PII columns.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO crm_analytics_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE crm_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO crm_analytics_ro;
```

## 3. Lock raw PII away from the read-only role (column-level)

The Customer PII columns are already AES-256-GCM ciphertext, but the analytics/AI
path has no business reading them at all. Revoke the whole table, then grant back
only the non-identifying columns (this mirrors what `AiSafeCustomerRepository`
selects: `id`, `emailDomain`).

```sql
REVOKE SELECT ON "Customer" FROM crm_analytics_ro;
GRANT  SELECT ("id", "organizationId", "externalId", "emailDomain",
               "mergedIntoId", "createdAt", "updatedAt", "deletedAt")
  ON "Customer" TO crm_analytics_ro;
-- NOTE: email, phone, firstName, lastName, emailHash, phoneHash are intentionally
-- NOT granted — the read-only role cannot select them at all.
```

If you prefer a view-based boundary, create `customer_safe` (id + emailDomain +
non-PII) and grant only that view to `crm_analytics_ro`, revoking `Customer`
entirely.

## 4. Wiring the app

1. **Migrations** — `DIRECT_URL` → `crm_migrator` (CI/deploy runs `prisma migrate deploy`).
2. **Runtime** — `DATABASE_URL` → `crm_app`. All keep `?sslmode=require` (enforced at boot in `apps/api/src/config/env.ts`).
3. **Analytics/AI read path** — add `ANALYTICS_DATABASE_URL` → `crm_analytics_ro` and point the AI-safe repository / analytics queries at a second read-only PrismaClient. This is a **follow-up code change** (a `PrismaReadService` bound to `ANALYTICS_DATABASE_URL`); until then the boundary is enforced by the app (AI-safe repo + `test:pii`), and this role just isn't used yet.

Example Neon URLs (passwords from the vault, never committed):
```
DIRECT_URL=postgresql://crm_migrator:...@<host>/crm?sslmode=require
DATABASE_URL=postgresql://crm_app:...@<host>/crm?sslmode=require
ANALYTICS_DATABASE_URL=postgresql://crm_analytics_ro:...@<host>/crm?sslmode=require
```

## 5. Verify

```sql
-- crm_app cannot DDL:
SET ROLE crm_app;
CREATE TABLE _should_fail (x int);   -- expect: permission denied for schema public
RESET ROLE;

-- crm_analytics_ro cannot read raw PII:
SET ROLE crm_analytics_ro;
SELECT email FROM "Customer" LIMIT 1; -- expect: permission denied for column email
SELECT id, "emailDomain" FROM "Customer" LIMIT 1; -- expect: OK
RESET ROLE;
```

## 6. Rotation

Neon supports per-role password reset. Rotate on a schedule and after any
suspected exposure; because each environment/role has its own credential, rotating
one doesn't disturb the others. Keep every password in the vault only.
