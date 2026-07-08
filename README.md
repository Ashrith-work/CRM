# CRM — M0–M5 + Commerce + Customer 360 + RFM + Cart Recovery (MVP) + Deep Analytics

An API-first CRM monorepo. A single **NestJS** backend is consumed by both a
**Next.js** web app (installable PWA) and an **Expo** React Native app. All
business logic and types live once, in the backend and in `packages/types`;
clients never duplicate it.

> **Milestone 0:** auth + org/RBAC/audit foundation (`/api/v1/me`).
> **Milestone 1:** the core CRM data model + screens — Companies, Contacts,
> Leads, plus Custom Fields, Tags, Notes, and a reusable Activity Timeline.
> Web gets full CRUD + admin; mobile gets browse/detail/quick-add,
> tap-to-call/email, notes, and lead status/convert.
> **Milestone 2:** the revenue layer — Pipelines, Stages, Deals, and an
> append-only Stage History. Web gets a drag-and-drop Kanban board + deal
> screens + pipeline admin; mobile gets a stage-segmented pipeline view + deal
> detail with a stage picker. Deals link to Contacts/Companies and emit into the
> M1 activity timeline. Money is stored as **integer minor units** — never a float.
> **Milestone 3:** the activity layer — unified **Tasks** (TASK/FOLLOW_UP/
> MEETING/CALL) linked to any M1/M2 record, a **restart-safe reminder engine** on
> BullMQ, and **multi-channel notifications** (in-app via Socket.io, email, and
> Expo push) behind one `NotificationService`. Reminders respect each assignee's
> timezone and fire exactly once. Web gets a tasks list, a calendar, a live
> notification center, and follow-up sections on Contact/Deal pages; mobile
> registers for push, shows a Today+overdue list and agenda, and does
> mark-done / log-outcome / snooze / quick-add.
> **Milestone 4:** the sales dashboard + reporting layer — read-only aggregates
> over M1–M3 data (NO new tables): headline tiles, a funnel computed from stage
> history, team-performance metrics, and trends. Everything is role-scoped
> (rep=own / manager=team / owner=all), period-filtered in the user's timezone,
> money-safe (integer minor units, grouped by currency), Redis-cached, and
> pinned by a golden-dataset test. Web gets the full dashboard (tiles + funnel +
> Recharts trends + team table + period/pipeline filters); mobile gets a "My
> performance" glance.
> **Commerce (Shopify ingestion):** import a Shopify store's customers, products,
> and orders — **historical backfill + live webhooks** — idempotently, resolving
> duplicate identities into one Customer. HMAC-verified + deduped webhooks, money
> as integer paise, a BullMQ backfill + nightly reconciliation worker, and a
> Settings connection panel. No analytics/AI. (This is the user's "M1"; labeled
> *Commerce* here to avoid colliding with the repo's M1 = Core CRM.)
> **Customer 360:** one profile per commerce customer — a unified, filterable
> timeline (ONE indexed `Interaction` query), a recent-orders panel with a range
> control, denormalized metric badges (each with a glossary tooltip), and a
> one-click multi-tab Excel "Customer Experience" export. **PII masked per role**;
> **P95 < 300ms on 100k customers** (measured 1–14ms at the query layer). (The
> user's "M2"; labeled *Customer 360* to avoid colliding with the repo's M2 =
> Revenue.)
> **RFM Analytics:** basic RFM computed in a **materialized view** (`customer_rfm`,
> refreshed nightly), written into `CustomerFeatures` with a deterministic segment
> label; a **golden-dataset test** matches hand-computed values exactly (incl. a
> refund + single-order case); the glossary gains analytics definitions; and a
> **JSON rule-tree segment builder** targets a campaign audience (safe
> parameterized queries, static snapshot / dynamic refresh). (The user's "M3";
> labeled *RFM Analytics* to avoid colliding with the repo's M3 = Activity.)
> **Cart Recovery (the MVP ship line):** the first closed loop — abandoned carts
> trigger a **consent-gated** email recovery sequence (T+1h/+24h/+72h) that **halts
> on purchase**, with a dashboard tile reporting **recovery rate + recovered
> revenue** on real orders. Restart-safe sweeps (not per-step delayed jobs); every
> send is consent-checked + logged; blocked sends are audited, never silent.
> **Deep Analytics (P2.1):** four more materialized views — **revenue_daily**
> (org-timezone buckets), **cohort_retention**, **customer_clv**, and
> **contribution_margin** — plus a **heuristic (non-ML) churn score** via a weekly
> job. Wires the M2 CLV/churn badges to real values, and **every analytics chart
> ends in a "build segment from this" action** (insight → segment → campaign).
> Margin is real when per-SKU COGS exists, otherwise labelled "Estimated (excludes
> COGS)". Metrics match a hand-computed golden dataset.
> **Milestone 5:** call management — **MyOperator** telephony (click-to-call +
> inbound/outbound webhooks) logging every call to the matched contact's
> timeline, with recordings stored in **Cloudinary** and playable ONLY with
> **DPDP call-recording consent** (a ConsentGate blocks + audits otherwise).
> Webhooks are signature-verified and idempotent; recording fetch is an async,
> retrying, consent-gated BullMQ worker. Capture & storage only — **no
> transcription/AI** (that is M6).

## Stack

| Area      | Tech                                                              |
| --------- | ---------------------------------------------------------------- |
| Monorepo  | Turborepo + pnpm workspaces                                      |
| Backend   | NestJS, REST under `/api/v1`, Prisma, PostgreSQL, Redis/BullMQ, Socket.io |
| Telephony | MyOperator (click-to-call + webhooks) · recordings in Cloudinary       |
| Auth      | Clerk (JWT verified in a Nest guard)                             |
| Web       | Next.js (App Router) + React + Tailwind + TypeScript, PWA        |
| Mobile    | Expo / React Native (TypeScript)                                 |
| Deploy    | API → Railway, Web → Vercel                                      |

## Repository layout

```
apps/
  api/        NestJS — all business logic, RBAC, audit, activity, Prisma
  web/        Next.js App Router PWA — full CRM CRUD + admin
  mobile/     Expo app — browse/detail/quick-add + tap-to-call/email
packages/
  types/      Shared DTOs + zod schemas (single source of truth)
  config/     Shared eslint / tsconfig / tailwind presets
```

## Prerequisites

- Node.js ≥ 20 and pnpm ≥ 9 (`npm i -g pnpm`)
- Docker (for local Postgres + Redis), or your own Postgres/Redis
- A [Clerk](https://clerk.com) application (free) for auth keys

## 1. Install

```bash
pnpm install
```

## 2. Configure environment

```bash
cp apps/api/.env.example      apps/api/.env
cp apps/web/.env.example      apps/web/.env.local
cp apps/mobile/.env.example   apps/mobile/.env
```

Get the keys from **Clerk Dashboard → API Keys**:

- `CLERK_SECRET_KEY` → `apps/api/.env`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` → `apps/web/.env.local`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` → `apps/mobile/.env`

## 3. Start infrastructure + database

```bash
docker compose up -d        # Postgres + Redis
pnpm db:migrate             # apply migrations (M0–M5)
pnpm db:seed                # org + team + roles + users + sample CRM/deal/task data
```

### Demo seed (realistic fake data)

`pnpm db:seed` runs `apps/api/prisma/seed.ts` — a **local-only**, re-runnable
[faker](https://fakerjs.dev) seed (fixed seed → reproducible) that fills the DB
with coherent CRM data so every list, timeline, and dashboard has believable
content on both clients. It **wipes the seeded tables first**, then inserts:

- Two orgs — **Acme Inc** (`acme`, the rich one) + **Globex Partners** (tiny, to
  prove tenant isolation).
- Users: 1 **admin** (owner role → org-wide dashboards), 1 **manager** (admin
  role → team scope), **4 reps** (member role → own scope), all on a team, mostly
  `Asia/Kolkata`.
- ~50 companies, ~300 contacts (linked, ~15% with custom fields), ~100 leads
  (~30% converted), 12 tags, a 6-stage INR pipeline, ~200 deals (owners spread
  across reps; **amountMinor in integer paise**; ~44% open / ~21% won / ~35%
  lost → **win rate ≈ 36%**), full **stage_history** per deal, ~500 tasks
  (overdue / today / upcoming / done, meetings with start-end), activity events,
  notes, a few reminders + notifications. Timestamps are spread across the last
  ~10 months (this month **and** last month both have data) so trends are real.
- ~120 calls (inbound/outbound, realistic status mix) + DPDP consent on ~45% of
  contacts — every **STORED** recording has GRANTED consent; consent-less
  completed calls are **BLOCKED**. The org's `myoperatorCompanyId` is set so
  webhooks resolve to it.
- A connected **Shopify** integration + ~20 commerce customers, 8 products, and
  40 orders (money in **paise**, mixed paid/partially-refunded/refunded/pending)
  so the Settings panel shows real CRM order counts. **RFM segments** for these
  customers populate on the first refresh (~10s after the API boots, or `POST
  /analytics/refresh`). Set `SEED_COMMERCE_CUSTOMERS=100000` for the 100k perf run.
- A **recovery campaign** (3 steps) + marketing `Consent` (~70% opted in), a few
  abandoned carts, one **recovered** cart, and one **suppressed** customer — so the
  recovery tile shows real rate + revenue, and the send/enrollment sweeps run live.
- Products carry per-SKU **COGS** and the org is **hasCogs=true**, so contribution
  margin is **real**; CLV bands + heuristic churn populate on the first refresh
  (~10–20s after boot, or `POST /analytics/refresh`).

```bash
pnpm db:seed                 # SMALL (fast local demo) — the default
SEED_MODE=large pnpm db:seed # LARGE — ~2k companies / ~50k contacts / ~10k deals (batched)
```

**Safety:** the seed refuses to run if `NODE_ENV=production` or if `DATABASE_URL`
does not point at a local/dev host — it wipes tables and is for local testing
only.

### Binding the seed to your Clerk identity

`/api/v1/me` looks up the app user by the Clerk `sub` in the token. After you
sign in once, copy your Clerk **user id** (and optionally **org id**) into
`apps/api/.env`, then re-run `pnpm db:seed` — it binds your identity to the seed's
**admin** user (owner role), so you sign in and see the org-wide dashboards:

```
SEED_CLERK_USER_ID=user_xxx      # from Clerk Dashboard → Users
SEED_CLERK_ORG_ID=org_xxx        # optional
SEED_USER_EMAIL=you@example.com
```

Without this, a signed-in Clerk user has no matching DB row and gets
**403 — not provisioned**, which is expected.

## 4. Run locally

```bash
pnpm dev:api        # NestJS on http://localhost:4000  (routes under /api/v1)
pnpm dev:web        # Next.js on http://localhost:3000
pnpm dev:mobile     # Expo dev server (press i / a, or scan the QR)
```

> **Note:** if port 3000 is taken (e.g. by Grafana), start web on another port:
> `pnpm --filter @crm/web dev -- -p 3001`.

Quick check:

```bash
curl http://localhost:4000/api/v1/health     # 200, public
curl http://localhost:4000/api/v1/contacts   # 401, no token
```

### Mobile networking note

`localhost` from a device/emulator is not your machine. Set
`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` accordingly:

- iOS simulator: `http://localhost:4000`
- Android emulator: `http://10.0.2.2:4000`
- Physical device: `http://<your-LAN-IP>:4000` (same Wi-Fi)

## Endpoints

All CRM routes require a Clerk bearer token and are org-scoped, RBAC-checked,
and audit-logged. List endpoints are cursor-paginated and return
`{ data: T[], nextCursor: string | null }`.

| Method | Route | Permission | Notes |
| ------ | ----- | ---------- | ----- |
| GET | `/api/v1/health` | Public | DB + Redis status |
| GET | `/api/v1/me` | `user:read` | Current user + org + team + role |
| GET | `/api/v1/audit-logs` | `audit:read` | 403 for members |
| GET | `/api/v1/contacts` | `contact:read` | `?search=&cursor=&limit=&sort=&order=&tagId=&companyId=&ownerId=` |
| POST | `/api/v1/contacts` | `contact:manage` | core fields + `customFields` + `tagIds` |
| GET | `/api/v1/contacts/:id` | `contact:read` | includes `company`, `tags` |
| PATCH | `/api/v1/contacts/:id` | `contact:manage` | partial update |
| DELETE | `/api/v1/contacts/:id` | `contact:manage` | soft delete |
| GET/POST | `/api/v1/companies` | `company:read` / `company:manage` | filter by contacts via `contacts?companyId=` |
| GET/PATCH/DELETE | `/api/v1/companies/:id` | `company:read` / `company:manage` | delete detaches contacts (never cascades) |
| GET/POST | `/api/v1/leads` | `lead:read` / `lead:manage` | `?status=` filter |
| GET/PATCH/DELETE | `/api/v1/leads/:id` | `lead:read` / `lead:manage` | |
| PATCH | `/api/v1/leads/:id/status` | `lead:manage` | `{ status }` — emits `STATUS_CHANGED` |
| POST | `/api/v1/leads/:id/convert` | `lead:manage` + `contact:manage` | `{ companyId? | companyName? }` — dedup by email; 409 if already converted |
| GET | `/api/v1/tags` | `tag:read` | |
| POST/PATCH/DELETE | `/api/v1/tags[/:id]` | `tag:manage` | unique name per org |
| POST | `/api/v1/tags/assign` \| `/unassign` | `tag:manage` | `{ tagId, entityType, entityId }` |
| GET/POST | `/api/v1/notes` | `note:read` / `note:manage` | `?entityType=&entityId=` — emits `NOTE_ADDED` |
| GET | `/api/v1/activity` | `activity:read` | `?entityType=&entityId=` — newest-first timeline |
| GET/POST | `/api/v1/custom-fields` | `custom_field:read` / `custom_field:manage` | `?entityType=` (incl. `DEAL`) |
| PATCH/DELETE | `/api/v1/custom-fields/:id` | `custom_field:manage` | |
| GET/POST | `/api/v1/pipelines` | `pipeline:read` / `pipeline:manage` | pipeline includes its stages |
| GET/PATCH/DELETE | `/api/v1/pipelines/:id` | `pipeline:read` / `pipeline:manage` | delete blocked while it holds deals |
| GET | `/api/v1/pipelines/:id/board` | `deal:read` | deals grouped by stage + per-stage `{count, sumMinor, weightedMinor}` |
| GET/POST | `/api/v1/stages` | `pipeline:read` / `pipeline:manage` | `?pipelineId=`; delete blocked while it holds deals |
| POST | `/api/v1/stages/reorder` | `pipeline:manage` | `{ pipelineId, stageIds[] }` — positions stay contiguous |
| PATCH/DELETE | `/api/v1/stages/:id` | `pipeline:manage` | name/probability/type/position |
| GET/POST | `/api/v1/deals` | `deal:read` / `deal:manage` | `?pipelineId=&stageId=&ownerId=&status=&contactId=&companyId=&search=` |
| GET/PATCH/DELETE | `/api/v1/deals/:id` | `deal:read` / `deal:manage` | PATCH is core fields only (not stage/status) |
| GET | `/api/v1/deals/:id/history` | `deal:read` | append-only stage progression + time-in-stage |
| POST | `/api/v1/deals/:id/move` | `deal:manage` | `{ toStageId }` — 1 tx: stage + StageHistory + `STAGE_CHANGED`/`WON`/`LOST`; 409 if terminal |
| POST | `/api/v1/deals/:id/reopen` | `deal:manage` | `{ toStageId? }` — WON/LOST → OPEN |
| GET | `/api/v1/users` | `user:read` | org user directory (assignee picker) + each user's `timezone` |
| PATCH | `/api/v1/me/timezone` | `user:read` | `{ timezone }` — IANA tz for reminders/agenda |
| GET | `/api/v1/tasks` | `task:read` | `?bucket=overdue\|today\|upcoming\|all&type=&status=&priority=&assigneeId=(me)&relatedType=&relatedId=&from=&to=&search=` |
| POST | `/api/v1/tasks` | `task:manage` | Task + `reminders:[{minutesBefore,channels?}]`; `assigneeId` defaults to creator |
| GET | `/api/v1/tasks/agenda` | `task:read` | `?assigneeId=&type=` → `{ timezone, overdue[], today[], upcoming[] }` in the assignee's local day |
| GET/PATCH/DELETE | `/api/v1/tasks/:id` | `task:read` / `task:manage` | PATCH re-syncs reminders when `reminders` or the anchor changes |
| POST | `/api/v1/tasks/:id/complete` | `task:manage` | `{ outcome? }` — sets DONE + `completedAt`, cancels reminders, emits `TASK_COMPLETED` |
| POST | `/api/v1/tasks/:id/cancel` | `task:manage` | cancels the task + its pending reminders |
| POST | `/api/v1/tasks/:id/reschedule` | `task:manage` | `{ dueAt?/startAt?/endAt? }` — shifts reminders, preserving each offset |
| POST | `/api/v1/tasks/:id/snooze` | `task:manage` | `{ remindAt }` — reschedules the reminder to a new time |
| POST | `/api/v1/tasks/:id/reassign` | `task:manage` | `{ assigneeId }` — the pending reminder redirects to the new owner |
| GET | `/api/v1/notifications` | `user:read` | `?unread=true&cursor=&limit=` → `{ data, nextCursor, unreadCount }` |
| GET | `/api/v1/notifications/unread-count` | `user:read` | `{ count }` |
| POST | `/api/v1/notifications/:id/read` \| `/read-all` | `user:read` | mark one / all read (emits a live unread count) |
| POST | `/api/v1/push-tokens` | `user:read` | `{ token, platform: IOS\|ANDROID }` — register an Expo device token (UNIQUE) |
| DELETE | `/api/v1/push-tokens` | `user:read` | `{ token }` — unregister |
| GET | `/api/v1/dashboard/sales` | `dashboard:read` | `?period=today\|week\|month\|quarter\|custom&from=&to=&pipelineId=&scope=auto\|me` → tiles (role-scoped) |
| GET | `/api/v1/dashboard/funnel` | `dashboard:read` | `?pipelineId=&period=` → distinct deals per stage (from stage_history) + conversions |
| GET | `/api/v1/dashboard/team` | `dashboard:read_team` | per-rep metrics; **reps (member) get 403** |
| GET | `/api/v1/dashboard/trends` | `dashboard:read` | `?metric=won\|created\|revenue&interval=week\|month&period=&pipelineId=` |
| POST | `/api/v1/calls/click-to-call` | `call:manage` | `{ contactId, dealId? }` — dials via MyOperator, logs an OUTBOUND Call |
| POST | `/api/v1/calls` | `call:manage` | manually log a call (mobile) |
| GET | `/api/v1/calls` | `call:read` | `?contactId=&agentUserId=(me)&direction=&status=&from=&to=&search=` |
| GET/PATCH | `/api/v1/calls/:id` | `call:read` / `call:manage` | PATCH disposition/notes/link deal |
| GET | `/api/v1/calls/:id/recording` | `call:read` | short-lived **signed** Cloudinary URL — **consent-gated** (null url + reason otherwise) |
| GET/POST | `/api/v1/consents` | `consent:read` / `consent:manage` | `?contactId=`; POST `{ contactId, status: GRANTED\|WITHDRAWN, source? }` — withdraw **purges** stored recordings |
| POST | `/api/v1/webhooks/myoperator` | **Public** (HMAC-verified) | inbound/outbound events; **idempotent** on `(org, externalCallId)` |
| GET | `/api/v1/integrations` | `integration:read` | connected third-party providers (Configure) |
| POST | `/api/v1/integrations/connect` \| `/:id/disconnect` | `integration:manage` | connect/disconnect; **members get 403 `{ code: FORBIDDEN }`** |
| POST | `/api/v1/ingestion/shopify/connect` | `commerce:manage` | verify creds (shop call) + upsert the Shopify Integration |
| GET | `/api/v1/ingestion/shopify/status` | `commerce:read` | status + shopDomain + lastSyncedAt + CRM-vs-Shopify order counts + sync job |
| POST | `/api/v1/ingestion/shopify/sync-now` | `commerce:manage` | enqueue the backfill (runs in the worker, never the request) |
| POST | `/api/v1/customers/merge` | `commerce:manage` | `{ survivorId, mergedId }` — manual identity merge (audited) |
| POST | `/api/v1/webhooks/shopify` | **Public** (HMAC-verified) | live topics; **idempotent** on `X-Shopify-Webhook-Id` (WebhookDelivery ledger) |
| GET | `/api/v1/customers` | `commerce:read` | customer list (net revenue / orders / last order); **PII masked** unless `pii:read` |
| GET | `/api/v1/customers/:id` | `commerce:read` | Customer 360 (identity + consents + feature badges); cached; masked per role |
| GET | `/api/v1/customers/:id/timeline` | `commerce:read` | unified timeline (`?type=&cursor=`) — ONE indexed `Interaction` query |
| GET | `/api/v1/customers/:id/orders` | `commerce:read` | recent orders + range (`?limit=(0=all)&from=&to=&year=&month=`); net = total−refunded |
| GET | `/api/v1/customers/:id/export` | `commerce:read` | sync **.xlsx** download (8 tabs); masked unless `pii:read`; writes ExperienceExport + AuditLog |
| POST | `/api/v1/customers/:id/export/async` \| `/export/segment` | `commerce:read` / `commerce:manage` | async/batch export via the worker (JobStatus) |
| GET | `/api/v1/analytics/summary` | `analytics:read` | RFM summary + segment distribution (reads the view-backed features) |
| POST | `/api/v1/analytics/refresh` | `segment:manage` | force an RFM refresh for this org now |
| POST | `/api/v1/segments/preview` | `segment:read` | `{count, sample:20}` for a rule tree (< 2s) |
| POST | `/api/v1/segments` | `segment:manage` | save (static snapshot \| dynamic + refreshCron) |
| GET | `/api/v1/segments` \| `/:id` \| `/:id/members` | `segment:read` | list / detail / members (masked per role) |
| POST | `/api/v1/segments/:id/refresh` | `segment:manage` | recompute a dynamic segment's membership |
| GET | `/api/v1/analytics/revenue-trend` | `analytics:read` | net revenue per day (org tz), from `revenue_daily` |
| GET | `/api/v1/analytics/cohorts` | `analytics:read` | cohort retention grid, from `cohort_retention` |
| GET | `/api/v1/analytics/clv-distribution` | `analytics:read` | CLV High/Mid/Low bands, from `customer_clv` |
| GET | `/api/v1/analytics/churn-watchlist` | `analytics:read` | at-risk **high-CLV first**; heuristic churn |
| GET | `/api/v1/analytics/margin` | `analytics:read` | contribution margin (real or **estimate-labelled**) |

### Deep analytics (P2.1)

- **Four materialized views** (raw SQL, endpoints only READ them):
  `revenue_daily` (net revenue per **org-timezone** day), `cohort_retention`
  (first-purchase-month cohorts × monthly periods; period 0 = acquisition),
  `customer_clv` (historical net revenue, banded High/Mid/Low by tertile), and
  `contribution_margin` (per org-day). Paid/fulfilled only; refunds subtract.
- **CLV/churn badges are real** — the nightly refresh writes `clvMinor`/`clvBand`
  into `CustomerFeatures`; a **weekly heuristic churn** job writes
  `churnRisk`/`churnBand`. The M2 profile badges now show real values + tooltips.
- **Heuristic churn (explainable, non-ML)** — `daysSinceLast ÷ the customer's own
  median inter-purchase gap`: ≤1× = Low, ≤2× = Medium, >2× = High; **<2 orders =
  Unknown** (never over-flag). The rule is defensible per customer.
- **Margin honesty** — real (`net − COGS`) only when the org **hasCogs** and
  products carry `costMinor`; otherwise a labelled **"Estimated margin (excludes
  COGS)"** everywhere it appears (UI, glossary, API `label`). Never presented as
  exact.
- **Insight → action** — every chart has a **"build segment from this"** action
  that opens M3's segment builder pre-filled (VIP from High-CLV, save at-risk VIPs
  from High-churn+High-CLV, win-back from long-inactive), closing the loop into an
  M4 campaign audience. `clvBand`/`churnBand` are real segment fields.
- **Tiered refresh** — revenue on ingest, RFM/CLV/views nightly, churn weekly
  (also a one-time run ~10–20s after boot).
| GET | `/api/v1/campaigns` \| `/:id/enrollments` | `campaign:read` | recovery campaign(s) + enrollments (masked per role) |
| GET | `/api/v1/campaigns/recovery-stats` | `campaign:read` | recovery rate + recovered revenue (the MVP tile) |
| POST | `/api/v1/campaigns/run` | `campaign:manage` | trigger the enrollment + send sweeps now |
| GET | `/api/v1/campaigns/unsubscribe` | **Public** (HMAC) | signed unsubscribe link → Suppression |
| POST | `/api/v1/webhooks/resend` | **Public** (HMAC) | delivery events → CampaignSend status + Suppression |

### Abandoned-cart recovery (the closed loop / MVP ship line)

- **Consent gate is mandatory** — a marketing send is allowed ONLY if the customer
  has GRANTED marketing `Consent` (seeded from Shopify `accepts_marketing`) AND the
  email is not on `Suppression`. A blocked send is **audited** (`marketing.blocked`)
  and written as a `BLOCKED` CampaignSend — never silently skipped.
- **Restart-safe sweeps, not per-step delayed jobs** — an **enrollment** sweep finds
  carts abandoned > 60 min (unconverted, consented, not suppressed) and enrolls them
  idempotently (`UNIQUE(campaignId, cartId)`); a **send** sweep fires the earliest
  DUE step (T+1h/+24h/+72h from `checkoutStartedAt`) — each tick queries what's due.
- **Halt on purchase** — before every send it re-checks the cart's `convertedOrderId`
  (set by M1 ingestion when the matching order arrives) and re-checks consent; a
  conversion or withdrawal halts the sequence immediately.
- **Email channel behind a one-method interface** (`MessageChannelAdapter`) so
  WhatsApp/SMS slot in later without touching campaign logic; the **Resend** adapter
  is mock-safe. Every send writes a `CampaignSend` (channel, templateVersion,
  status, outcomeAt). A provider outage marks the send **DELAYED** (not failed) and
  retries next tick. Resend webhooks map delivered/opened/clicked/bounced/complained
  → status + `Suppression`; a signed unsubscribe link suppresses future sends.
- **Recovery tile** — `recovery rate = recovered ÷ abandoned` (a cart is recovered
  if the customer ordered after enrollment within the attribution window, default
  7 days); `recovered revenue` = net of those orders. Both resolve their tooltip
  from the glossary.

### RFM analytics + segmentation

- **Materialized view** — `customer_rfm` (raw SQL) computes, per customer,
  `MAX(placedAt)` / `COUNT(*)` / `SUM(totalMinor − refundedMinor)` over
  **paid+fulfilled** orders only, then `NTILE(5)` quintiles (recent = 5) with a
  deterministic `customer_id` tiebreak. Endpoints **read** the view (via the
  denormalized `CustomerFeatures`) — they never recompute inline.
- **Refresh worker** (nightly, tiered: revenue on ingest, RFM nightly) — `REFRESH
  MATERIALIZED VIEW CONCURRENTLY`, then writes `rScore/fScore/mScore` + a
  deterministic **segment label** (`rfmSegment(r,f,m)` matrix: Champions, Loyal,
  At Risk, …) + `daysSinceLast` into `CustomerFeatures`. Runs once ~10s after boot
  so a fresh deploy is populated immediately. The **M2 profile badges now show
  real RFM values**.
- **Glossary** gains analytics defs (RFM real; CLV/churn/cohort/LTV:CAC stubs;
  AOV/recovery) — every KPI's info tooltip resolves from the one registry.
- **Segment engine** — a JSON rule tree `{op: AND|OR, rules: [{field,op,value} |
  nested]}` is translated into a **SAFE parameterized Prisma `where`** over
  CustomerFeatures: fields + ops are **whitelisted**, values coerced, never
  string-concatenated or eval'd. **Static** segments snapshot membership at save;
  **dynamic** ones are recomputed by the nightly job. A segment is reusable as a
  campaign audience (M4 consumes it).
- **Golden-dataset test** (`analytics/golden-dataset.spec.ts`) — hand-computed RFM
  asserted **exactly** against the real view + worker, including the refund case
  (monetary subtracts the refund), a single-order customer, mixed paid/fulfilled,
  and a zero-order customer (excluded). Wrong numbers **fail**.

### Customer 360

- **Fast timeline** — `Interaction` is a **denormalized pointer** (`type`, `refId`,
  `summary`, `occurredAt`) written per order/event on ingest, so the 360 timeline
  is **one indexed query** (`@@index([org, customerId, occurredAt])`) instead of a
  live cross-join. `CustomerFeatures` denormalizes per-customer aggregates (net
  revenue, order count, first/last, AOV — refund-aware) for the list + badges +
  fast profile. **P95 < 300ms on 100k** (index scans measured 1–14ms; profile is
  Redis-cached 60s).
- **Recent-orders range control** — default last 3; presets 3/6/12/all; custom
  from–to; year/month. Dates render "Mon YYYY"; value is **net (total−refunded)**
  in paise; discount code + amount shown.
- **PII masking by role** — only `pii:read` (owner/admin) sees raw email/phone; all
  others get masked forms (`j•••@n•••.co`, `•••••••3210`) on the profile, list, and
  **export**. Every export writes an `ExperienceExport` **and** an `AuditLog` row.
- **Glossary registry** (`@crm/types` `glossary`) — the single source mapping
  `metricKey → { plainLanguage, formula, dataWindow, lastSynced }`; the web
  `InfoTooltip` resolves every metric's tooltip from it (the same source will feed
  the AI assistant + exports, so a number never means two things).
- Merged customers resolve to the **survivor** (orders re-attributed in M1); RFM/
  CLV/churn/size/fit/style badges are **placeholders** until M3.

### Commerce ingestion (Shopify)

- **Backfill** (BullMQ worker): customers → products → orders, cursor-paginated
  (REST Link `page_info`) with **429 leaky-bucket backoff** (Retry-After /
  exponential + jitter). Every row upserts on `UNIQUE(org, externalId)`. Progress
  is a `SyncJobStatus` the Settings panel renders.
- **Webhooks**: HMAC-SHA256 of the **raw body** (`SHOPIFY_WEBHOOK_SECRET` →
  `SHOPIFY_API_SECRET`) is checked **before any parse/DB** (bad → 401);
  idempotency is the `WebhookDelivery(org, provider, eventId)` unique key (retry →
  200 no-op). The controller acks fast; the worker applies the event with the
  **same mappers as backfill** (out-of-order tolerant via upsert). `refunds/create`
  recomputes `refundedMinor` + `financialStatus` (order kept, never zeroed).
- **Money** is parsed from strings into **integer minor units** (`"1234.50"` →
  `123450`) with no float; times are UTC; `variant` holds apparel SIZE/COLOUR.
- **Identity resolution** (exact-match only, never fuzzy/AI): normalize email
  (trim+lowercase) + phone (E.164, IN); a matching email/phone/externalId is the
  same person. A guest order + a later account with the same email → **one
  Customer** (survivor owns both order sets); the merged row keeps `mergedIntoId`
  and its email is nulled so `UNIQUE(org, email)` holds.
- **Nightly reconciliation** (repeatable job): re-import orders since
  `lastSyncedAt`, fill gaps from dropped webhooks, and alert if counts diverge —
  the CRM self-heals.

### Call management (M5)

- **Click-to-call** creates an OUTBOUND `Call` (RINGING) with the MyOperator
  `externalCallId`; the webhook then fills in status/timing/duration.
- **Webhook** is `@Public()` but authenticity is verified by **HMAC-SHA256** of
  the raw body against `MYOPERATOR_WEBHOOK_SECRET` (a bad signature → 401; a
  spoofed event is rejected). Processing **upserts on the `(organizationId,
  externalCallId)` unique key**, so a retried event yields exactly one Call.
  The org is resolved from the payload's `company_id` (→ `Organization.
  myoperatorCompanyId`) or an existing click-to-call row.
- **Number → contact** matching normalizes to E.164 (default +91) and matches on
  the national number: 0 → log against the number (offer to create); 1 → linked;
  >1 → most-recently-updated + `ambiguousMatch`.
- **DPDP ConsentGate** — before any recording is downloaded, stored, or served,
  the matched contact's `CALL_RECORDING` consent must be `GRANTED`; otherwise the
  recording is set `BLOCKED` and an **audit row** (`recording.blocked`) is
  written — the audio is never fetched. Missed/failed/no-answer calls are logged
  with no recording.
- **Async recording worker** (BullMQ): on a completed call with a recording and
  GRANTED consent → download from MyOperator (size-guarded) → upload to Cloudinary
  (`type: authenticated`) → `recordingStatus = STORED`. Retries with backoff;
  `FAILED` after the last attempt (the Call is kept). Playback is only ever a
  short-lived **signed** URL. Withdrawing consent enqueues a **purge** (erasure).

### Dashboard / reporting (M4)

Read-only aggregation over M1–M3 data — **no new domain tables**. Design points:

- **Role scope** — `dashboard:read_all` → org-wide (owner), `dashboard:read_team`
  → the requester's team(s) (admin/manager), `dashboard:read` → self (member/rep).
  The scope resolves to a set of user ids that filter deals (`ownerId`),
  activities (`actorId`), and tasks (`assigneeId`). `/dashboard/sales?scope=me`
  forces own-scope (mobile "My performance").
- **Timezone-correct periods** — `this week/month/quarter` boundaries are the
  requester's LOCAL calendar edges (DST-correct via `zonedWallClockToUtc`), then
  compared as UTC instants. `custom` takes `from`/`to` as local `YYYY-MM-DD`.
- **Money-safe** — sums stay integer minor units and are **grouped by currency**
  (never summed across); every money metric is a `{ currency, amountMinor }[]`.
- **Rates guard division by zero** — win rate / conversion are `null` (rendered
  `—` / 0%) when their denominator is 0.
- **Funnel from stage history** — for each stage, the count of **DISTINCT** deals
  that entered it (any `stage_history` row with that `toStageId`); a won deal
  still counts in earlier stages, and reopened/backward moves de-dupe by deal.
- **Cached** — each payload is cached in Redis for 5 min, keyed by
  (endpoint, org, scope, user/all, params). A cache miss/error degrades to a live
  recompute (never a failed request). Aggregate queries are backed by new
  composite indexes (`Deal(org,status,closedAt)`, `Deal(org,createdAt)`,
  `ActivityEvent(org,actorId,createdAt)`, `Task(org,assigneeId,completedAt)`);
  a materialized view is the next step if these outgrow the cache.

Realtime: clients open a Socket.io connection to the **`/notifications`**
namespace (`auth: { token }`, Clerk-verified), join a per-user room, and receive
`notification` (new `Notification`) + `unread_count` (`{ count }`) events.

### Reminder engine + notifications (M3)

Reminders are plain DB rows (`status = SCHEDULED`), so scheduling is **inherently
restart-safe** — there are no in-memory timers. A **repeatable BullMQ sweep**
(every `REMINDER_SWEEP_INTERVAL_MS`, default 60s) selects due & `SCHEDULED`
reminders, **claims each atomically** (`SCHEDULED → SENT` in one guarded UPDATE),
and enqueues a **send** job keyed by the reminder id. The send worker
(concurrency-capped by `REMINDER_SEND_CONCURRENCY` to throttle storms) fans out a
notification to the task's **current** assignee. This gives the guarantees:

- **Restart-safe** — a reminder that came due while the worker was down is still
  `SCHEDULED` with a past `remindAt`, so the next sweep catches it.
- **Exactly once** — the atomic claim + per-reminder job id mean no reminder fires
  twice, even with overlapping sweeps.
- **Redirect on reassign** — the recipient is resolved at send time, so a
  reassigned task's pending reminder reaches the new owner.
- **Skips stale** — reminders for a DONE/CANCELLED/deleted task are dropped.

`NotificationService.fanOut(...)` is the single channel-adapter fan-out: it always
creates the durable in-app `Notification` row (seen on next load even if the user
was offline), then delivers each requested channel **exactly once** — **IN_APP**
(Socket.io room emit), **EMAIL** (Resend HTTP API if `RESEND_API_KEY` is set, else
logged), **PUSH** (Expo Push API; tokens Expo reports as `DeviceNotRegistered`
are pruned). `deliveredChannels` records what succeeded.

### Activity timeline

`ActivityService.emit(...)` is the shared timeline emitter called by **every**
mutation. It writes an `ActivityEvent` (`CREATED`, `UPDATED`, `NOTE_ADDED`,
`TAG_ADDED`, `STATUS_CHANGED`, `CONVERTED`, and M3's `TASK_CREATED` /
`TASK_UPDATED` / `TASK_COMPLETED` / `TASK_CANCELLED`) — distinct from the infra
`AuditLog` (written automatically by the `AuditInterceptor` on every mutating
request). Task events are emitted onto the **related** record's timeline, so a
follow-up shows up on its contact/company/lead/deal.

## Data model (M1)

Every table carries `organizationId`, `createdAt`, `updatedAt`, and (where
soft-deletable) `deletedAt`; all lists exclude soft-deleted rows.

- **Company** — name, domain, industry, size, website, phone, addressJson,
  ownerId, customFields (JSONB)
- **Contact** — firstName, lastName, email, phone, jobTitle, companyId (nullable
  FK, `SetNull` on company delete), ownerId, customFields
- **Lead** — firstName, lastName, email, phone, source, status
  (`NEW`/`CONTACTED`/`QUALIFIED`/`UNQUALIFIED`/`CONVERTED`), convertedContactId,
  customFields
- **Tag** / **Taggable** — unique tag name per org; polymorphic assignment
- **Note** — polymorphic (`entityType`/`entityId`), authored body
- **CustomFieldDefinition** — per entity type; `TEXT`/`NUMBER`/`DATE`/`BOOLEAN`/
  `SELECT`; values validated + coerced by type on every write
- **ActivityEvent** — append-only domain timeline

### Data model (M2 — revenue)

`EntityType` gains `DEAL` (so deals carry tags/notes/custom fields/activity);
`ActivityEventType` gains `STAGE_CHANGED`/`WON`/`LOST`/`REOPENED`.

- **Pipeline** — name, isDefault, position
- **Stage** — pipelineId, name, position, probability (0–100), type
  (`OPEN`/`WON`/`LOST`)
- **Deal** — name, pipelineId, stageId, **amountMinor (INTEGER minor units)** +
  currency, expectedCloseDate, ownerId, contactId?/companyId? (`SetNull`), status
  (`OPEN`/`WON`/`LOST`), closedAt, customFields
- **StageHistory** — append-only: dealId, fromStageId?, toStageId, changedById,
  changedAt, secondsInPreviousStage

`POST /deals/:id/move` runs in one transaction (stage + StageHistory +
activity), mirrors the event onto the linked contact/company timelines, and sets
`status=WON/LOST` + `closedAt` when the target stage is terminal. The board
returns per-stage `count`, `sumMinor`, and `weightedMinor = sumMinor ×
probability / 100` (rounded, integer).

### Data model (M3 — activity)

`ActivityEventType` gains `TASK_CREATED`/`TASK_UPDATED`/`TASK_COMPLETED`/
`TASK_CANCELLED`; `User` gains a `timezone` (IANA, default `UTC`).

- **Task** — type (`TASK`/`FOLLOW_UP`/`MEETING`/`CALL`), title, description,
  status (`OPEN`/`DONE`/`CANCELLED`), priority (`LOW`/`MEDIUM`/`HIGH`), `dueAt?`,
  `startAt?`/`endAt?` (meetings), location, meetingUrl, `assigneeId`,
  `createdById`, `relatedType?`/`relatedId?` (→ contact/company/lead/deal),
  `completedAt`, `outcome`
- **Reminder** — taskId, `remindAt` (UTC), `channels[]`
  (`IN_APP`/`EMAIL`/`PUSH`), status (`SCHEDULED`/`SENT`/`CANCELLED`), `sentAt`
  (append-only; one row per reminder)
- **Notification** — userId (recipient), type
  (`REMINDER`/`ASSIGNMENT`/`MENTION`/`SYSTEM`), title, body,
  `relatedType?`/`relatedId?`, `taskId?`, `readAt`, `deliveredChannels[]`
- **PushToken** — userId, token (UNIQUE), platform (`IOS`/`ANDROID`), lastSeenAt

### Data model (M5 — calls)

`ActivityEventType` gains `CALL_LOGGED`/`CALL_COMPLETED`/`CALL_MISSED`;
`Organization` gains `myoperatorCompanyId` (unique — maps a webhook to the org).

- **Call** — direction (`INBOUND`/`OUTBOUND`), from/toNumber, agentUserId,
  contactId?, dealId?, status (`RINGING`/`IN_PROGRESS`/`COMPLETED`/`MISSED`/
  `FAILED`/`NO_ANSWER`), startedAt/answeredAt/endedAt, durationSeconds,
  disposition, notes, `externalCallId`, recordingSourceUrl/recordingStoredUrl
  (internal), `recordingStatus` (`NONE`/`PENDING`/`STORED`/`BLOCKED`/`FAILED`),
  ambiguousMatch — **UNIQUE(organizationId, externalCallId)** for idempotency
- **Consent** — contactId, purpose (`CALL_RECORDING`), status
  (`GRANTED`/`WITHDRAWN`/`NOT_CAPTURED`), source (`IVR_DISCLOSURE`/`EXPLICIT`),
  grantedAt/withdrawnAt — UNIQUE(organizationId, contactId, purpose)
- Blocked-recording attempts reuse **AuditLog** (`action = recording.blocked`).

### M0 retrofit — foundation shell

A later M0-foundation spec was reconciled **additively** onto this repo (rather
than rebuilt, which would break M1–M5):

- **Integration** model — org-scoped connected providers (CLERK / MYOPERATOR /
  CLOUDINARY / …), status + non-secret config; secrets stay in env. UNIQUE(org,
  provider). Managed via `/api/v1/integrations` (Configure).
- **RBAC 403 carries a machine `code: "FORBIDDEN"`** so clients can branch on it.
- **Web dashboard shell** — job-to-be-done nav (**Understand / Act / Support /
  Configure**), a **light/dark theme toggle**, an `EmptyState` component, and an
  Integrations page under Configure.
- Kept as-is (already satisfied M0): pnpm monorepo, Clerk + JWT guard, audit
  interceptor (one row per mutation), Redis/BullMQ, CI (`ci.yml`) + `deploy.yml`.
  NOT changed (would break M1–M5): the `owner/admin/member` roles (spec's 5-role
  set), `packages/types` (vs `db`/`shared`/`ui`), and in-process workers (vs a
  separate `apps/worker`).

### Data model (Commerce — Shopify)

New tables, all org-scoped with `UNIQUE(org, externalId)` and integer-minor money:
- **Customer** — externalId?, email? (unique per org), phone? (E.164), names,
  `mergedIntoId` (merge survivor pointer)
- **Product** — externalId, title, imageUrl
- **Order** — externalId, orderNumber, customerId?, status
  (`PENDING`/`PAID`/`FULFILLED`/`CANCELLED`/`REFUNDED`), financialStatus
  (`PENDING`/`PAID`/`PARTIALLY_REFUNDED`/`REFUNDED`), **totalMinor / refundedMinor
  / discountMinor** (paise), currency, discountCode, placedAt (UTC)
- **OrderItem** — title, `variant` (SIZE/COLOUR), quantity, priceMinor
- **Cart / CartItem** — checkoutStartedAt, `convertedOrderId` (set when a matching
  order arrives — halts M4 abandoned-cart)
- **CommerceEvent** — behavioral stream (`CHECKOUT_STARTED`/`ADD_TO_CART`/
  `ORDER_PLACED`)
- **WebhookDelivery** — dedup ledger, `UNIQUE(org, provider, eventId)`

(These are the commerce entities, distinct from the CRM's Contact/Company/Deal.)

### Data model (Customer 360)

- **Interaction** — denormalized timeline pointer (`type`
  order/event/message/call/ticket/note/return, `refId`, `summary`, `occurredAt`);
  `UNIQUE(org, type, refId)` (idempotent) + `@@index([org, customerId, occurredAt])`
- **CustomerFeatures** — per-customer aggregates (netRevenueMinor, orderCount,
  first/last order, AOV) maintained on ingest, + M3 placeholders (rfm/clv/churn/
  size/fit/style); `UNIQUE(org, customerId)`
- **ExperienceExport** — export audit (actor, customerId?, masked, createdAt)

### Data model (RFM analytics + segments)

- **customer_rfm** — raw SQL **materialized view** (not in the Prisma schema; see
  the `..._m3_rfm_segments` migration), unique index on `customer_id` for
  `REFRESH … CONCURRENTLY`
- **CustomerFeatures** gains `rScore/fScore/mScore/rSegment/rfmScore/daysSinceLast`
  (written by the refresh worker)
- **Segment** — `rules` (JSON rule tree), `type` (STATIC|DYNAMIC), `refreshCron`,
  `memberCount`, `lastRefreshedAt`
- **SegmentMembership** — `UNIQUE(segmentId, customerId)`; snapshot for static,
  recomputed for dynamic

### Data model (deep analytics)

- **Materialized views** `revenue_daily`, `cohort_retention`, `customer_clv`,
  `contribution_margin` (raw SQL — see the `..._p21_analytics` migration)
- **Organization** gains `timezone` (day-bucketing) + `hasCogs` (margin honesty);
  **Product** gains `costMinor` (per-SKU COGS)
- **CustomerFeatures** gains `clvBand` (High/Mid/Low) + `churnBand`
  (Low/Medium/High/Unknown), and now populates `clvMinor` + `churnRisk`

### Data model (cart recovery)

- **Consent** is now polymorphic — `contactId?` (call recording, M5) OR
  `customerId?` (marketing, from Shopify), + `MARKETING` purpose / `SHOPIFY` source
- **Suppression** — `UNIQUE(org, email)`, reason unsubscribe/bounce/complaint/manual
- **Campaign** / **CampaignStep** (delayMinutes 60/1440/4320, versioned
  `MessageTemplate`) / **CampaignEnrollment** (`UNIQUE(campaignId, cartId)` —
  idempotent) / **CampaignSend** (`UNIQUE(enrollmentId, campaignStepId)` — one send
  per step; channel, templateVersion, status, outcomeAt)

## RBAC model

Permissions and role→permission grants are defined once in
`packages/types/src/permissions.ts` and enforced by `PermissionsGuard` via
`@RequirePermission()`.

- **owner** — all permissions
- **admin** — all CRM read + manage (contacts/companies/leads/tags/notes/custom
  fields/**pipelines/deals**) + activity read
- **member** — read-only across CRM, **plus `task:manage`** so reps manage their
  own tasks/follow-ups (still proves the 403 path on other `:manage` routes)

Notifications and push tokens are per-user and gated by `user:read` (held by
every role) — a user only ever sees/mutates their own.

Dashboard scope keys (M4) select how much data each role sees:
- **owner** → `dashboard:read_all` → org-wide metrics
- **admin** → `dashboard:read_team` → their team(s) (acts as manager); can read the
  team table
- **member** → `dashboard:read` → own metrics only; **403** on `/dashboard/team`

M5 adds `call:read`/`call:manage` and `consent:read`/`consent:manage` — granted to
all three roles (reps place/log calls and capture consent). The webhook is public
(HMAC-verified, not RBAC).

## Testing

```bash
pnpm --filter @crm/api test        # unit: custom-field validation, activity emitter, tag uniqueness,
                                    #   weighted-value math, guards
                                    #   M3 — timezone→remindAt math (DST), reminder (re)schedule/cancel/
                                    #        snooze/shift, sweep claims only due+SCHEDULED (atomic, once),
                                    #        send skips DONE + redirects to current assignee, notification
                                    #        fan-out delivers each channel once + prunes stale push tokens,
                                    #        agenda buckets in the assignee timezone
                                    #   M4 — GOLDEN DATASET: every tile / win rate / funnel conversion /
                                    #        trend point asserted exactly (multi-currency, integer minor
                                    #        units); weighted pipeline, funnel distinct-per-stage (incl.
                                    #        reopened), period boundaries in IST/EST-DST, div-by-zero
                                    #        guards, role→scope + team 403
                                    #   M5 — webhook idempotency (dup externalCallId → one Call),
                                    #        E.164 number→contact match (none/one/ambiguous),
                                    #        ConsentGate blocks + audits when consent absent, fetch-
                                    #        recording worker stores on consent / BLOCKED otherwise /
                                    #        FAILED over the size guard
                                    #   Commerce — money string→paise (no float drift), Shopify mappers
                                    #        (status/refund/variant), HMAC valid/tampered, webhook dedup
                                    #        idempotency, pagination + 429 backoff resume, identity merge
                                    #        (guest+account→one, email-unique respected), reconcile gap-fill
                                    #   Customer 360 — PII masking, recent-orders range logic (presets/
                                    #        custom/year-month, net + "Mon YYYY"), timeline ordering+type
                                    #        filter, Excel export content + masking + audit rows, glossary
                                    #        resolution; 100k read P95 (index scans 1–14ms)
                                    #   RFM — GOLDEN DATASET (exact r/f/m/segment/net incl. refund +
                                    #        single-order + zero-order + daysSinceLast, real view+worker),
                                    #        segment matrix, safe rule→where translation (whitelist, no
                                    #        injection), segment preview (<2s) + dynamic-refresh recompute
                                    #   Recovery — HALT-ON-PURCHASE (convert mid-sequence → no more sends),
                                    #        consent gate (blocked + audit-logged), suppression respected,
                                    #        provider outage → DELAYED + retry, idempotent enrollment,
                                    #        recovery-rate vs HAND-COMPUTED fixture, Resend webhooks
                                    #   Deep analytics — GOLDEN dataset for the views: CLV tertile bands,
                                    #        cohort retention % (period-0 boundary), margin WITH + WITHOUT
                                    #        COGS (real vs estimate); heuristic churn bands (median-gap rule)
pnpm --filter @crm/api test:e2e    # integration (real Postgres):
                                    #   M1 — create→timeline, convert+dedup, re-convert blocked, tag filter,
                                    #        company-delete detaches, RBAC, soft-delete
                                    #   M2 — deal in minor units + board totals, move persists + StageHistory
                                    #        + activity mirrored to contact, WON sets status/closedAt, terminal
                                    #        move blocked, reopen, filter by stage/owner, block stage/pipeline
                                    #        delete with deals, RBAC
```

The integration suite boots the CRM modules with the auth layer stubbed and runs
against the dev Postgres under a throwaway org that is cascade-deleted after.

**Mobile smoke (manual):** with the API running and `EXPO_PUBLIC_API_URL` set,
launch Expo → a list loads → tap a contact's phone opens the dialer (`tel:`) →
quick-add creates a record that appears in the list.

## Scripts (root)

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | Run all apps in dev (Turborepo) |
| `pnpm build` | Build shared packages + all apps |
| `pnpm lint` / `pnpm typecheck` | Lint / type-check everything |
| `pnpm test` | Run unit tests |
| `pnpm db:migrate` | Prisma migrate (dev) |
| `pnpm db:seed` | Seed the database (add `SEED_BULK_CONTACTS=50000` for perf) |

## Deployment

### API → Railway

1. Create a Railway project; add **PostgreSQL** and **Redis** plugins.
2. Add a service from this repo. Railway reads `apps/api/railway.json` and builds
   with `apps/api/Dockerfile`.
3. Set service variables: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` (reference the
   plugins), `CLERK_SECRET_KEY`, `CORS_ORIGINS` (your Vercel URL), optionally
   `CLERK_JWT_KEY` / `CLERK_AUTHORIZED_PARTIES`.
4. Deploy — the container runs `prisma migrate deploy` then starts the API.
   Health check: `/api/v1/health`.

### Web → Vercel

1. Import the repo into Vercel; set **Root Directory** to `apps/web`
   (`apps/web/vercel.json` handles the monorepo build/install commands).
2. Set env vars: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_API_URL` (your Railway API URL).
3. Deploy. Add the Vercel domain to the API's `CORS_ORIGINS` and to Clerk's
   allowed origins.

## Assumptions (M1 + M2)

- **`ownerId` / `authorId` / `actorId` are soft references** (plain `User.id`
  scalars, not FKs) to avoid a web of back-relations on `User`; they're resolved
  to display names on read and always org-scoped.
- **Cursor pagination, no `COUNT(*)`** on list endpoints (returns `nextCursor`
  only) to keep large lists under the P95 budget. Composite indexes on
  `(organizationId, deletedAt)`, status, email, owner, and tag joins back this.
- **Custom-field validation is strict**: unknown keys, missing required fields,
  and type mismatches are rejected atomically (no partial write). SELECT values
  must be within the defined options.
- **Duplicate email**: creation is allowed (clients warn by searching first);
  dedup happens on lead conversion (case-insensitive email match).
- **Request validation uses a `ZodValidationPipe`** with the shared schemas from
  `packages/types`; it composes with the global class-validator pipe (a no-op for
  plain-object params).
- **Mobile navigation is hand-rolled** (a lightweight screen-stack context) to
  stay dependency-free per the existing app's minimalism; no offline. (Push is
  added in M3 via `expo-notifications`, guarded to degrade gracefully.)
- M1/M2 forms omit an owner picker (no users-list endpoint then); the server
  defaults `ownerId` to the current user. M3 adds `GET /users` for the task
  assignee picker.
- **Money is integer minor units** (`amountMinor`) + an ISO-4217 `currency`
  everywhere; clients divide by 100 only for display. Deals default to `USD`.
- **Stage/status split**: a deal's stage changes only via `/move` (or `/reopen`);
  `PATCH /deals/:id` never touches stage or status. Moving into a terminal
  (`WON`/`LOST`) stage closes the deal; a closed deal must be reopened before it
  can move again (last-write-wins on concurrent moves; the web board rolls back a
  failed optimistic move).
- **Deal timeline mirroring**: deal events are emitted on the deal and mirrored
  onto the linked contact/company timelines so deal activity shows there.
- **`secondsInPreviousStage`** is computed from the most recent StageHistory
  entry into the current stage (or the deal's `createdAt` for the first move); an
  opening history row (`fromStageId=null`) is written at deal creation.
- **Web drag-and-drop uses native HTML5 DnD** (no dnd dependency); mobile changes
  stage via a picker (no board), per the M2 non-goals.

## Assumptions (M3 — activity)

- **Reminders are DB-row-driven, not timer-driven.** Scheduling just writes
  `SCHEDULED` rows; a 60s BullMQ sweep polls them. This is what makes the engine
  restart-safe with no reconciliation logic, and lets the atomic `SCHEDULED→SENT`
  claim (plus a per-reminder job id) guarantee each reminder fires exactly once.
- **Reminder offsets are relative** (`minutesBefore` the anchor = `startAt` for
  meetings, else `dueAt`). `remindAt = anchor − offset`, and the anchor is an
  absolute UTC instant, so a "9am reminder" fires at 9am the assignee's local time
  because the client sends the correct instant. The stored `User.timezone` is used
  for **DST-correct** display and for bucketing agenda "overdue/today/upcoming"
  against the assignee's local day (`zonedWallClockToUtc` / `startOfNextLocalDayUtc`
  are unit-tested, incl. EDT↔EST and +05:30).
- **The in-app row is the source of truth.** `fanOut` always persists the
  `Notification` (so an offline user sees it next load); email/push are
  best-effort side channels wrapped so a channel failure never blocks the others.
  Each channel is attempted once per notification; `deliveredChannels` records
  successes.
- **Email/push are dependency-free adapters.** Email uses the Resend HTTP API via
  `fetch` (or logs when `RESEND_API_KEY` is unset); push uses the Expo Push API via
  `fetch` (no `expo-server-sdk`). Swapping in SES/Postmark/FCM is a one-method
  change behind the same adapter interface.
- **Reassign redirects by resolution, not row rewrite.** The send worker resolves
  the task's *current* assignee at fire time, so pending reminders reach the new
  owner without touching reminder rows. Complete/cancel/delete cancel pending
  reminders; reschedule shifts them preserving each offset.
- **Notifications/push tokens are self-scoped** (gated by `user:read`); tasks use
  a new `task:read`/`task:manage` pair (members get both to run their own work).
- **Socket.io shares the API port** (`/notifications` namespace) and authenticates
  the handshake with the Clerk token; rooms are `org:{org}:user:{user}` so there is
  no cross-tenant bleed.
- **Mobile push degrades gracefully.** Registration is wrapped in try/catch and
  no-ops on simulators / Expo Go limitations, so the rest of the app always works;
  a real device with a dev/EAS build receives pushes and tapping one opens the task.
  Per the non-goals, there is no offline task creation and no external calendar sync.

## Assumptions (M4 — dashboard)

- **No new domain tables** — the dashboard is pure read-only aggregation over
  M1–M3 (deals, stage_history, activity, tasks). The only migration is
  **indexes**.
- **Role→scope mapping** uses the existing three system roles: owner →
  `read_all` (org), admin → `read_team` (their team, i.e. the "manager"), member
  → `read` (self). This is the pragmatic mapping onto the seeded roles; a
  dedicated "manager" role would slot in the same way. Team membership drives the
  team set (`TeamMembership`); a user in no team resolves "team" to just self.
- **Aggregation math is pure + framework-free** (`dashboard.math.ts` /
  `dashboard.period.ts`), so the golden-dataset test asserts exact numbers with
  no DB — deterministic and fast. The service only fetches minimal rows and
  delegates. (An e2e that seeds the same dataset into Postgres is a drop-in later;
  the numbers are identical.)
- **Pipeline value / weighted pipeline are a live snapshot** of OPEN deals (not
  period-bound); won/revenue/win-rate/avg/created/activities/tasks are
  period-bound. **Weighted** = `round(Σ(amountMinor × probability) / 100)` per
  currency (one round per currency, no per-deal drift).
- **Funnel cohort** = deals **created in the period** within the pipeline (+ scope);
  each stage counts distinct deals that entered it per `stage_history`.
  `overallConversion` = last-stage entrants / first-stage entrants.
- **Cache TTL is 5 min** (short, so numbers stay fresh); the cache is an
  optimization only — a miss or Redis error recomputes live. No explicit
  invalidation on write (a stale window ≤ TTL is acceptable for a dashboard).
- **Trends `revenue`** reuses the WON series (revenue = won deal value); the web
  chart plots `count` for won/created and per-currency `value` for revenue.

## Assumptions (M5 — calls)

- **MyOperator + Cloudinary run in MOCK mode when unconfigured** — click-to-call
  generates a fake `externalCallId`, and recording "storage" returns a mock
  public id, so the whole flow (and the seed) works locally without real
  credentials. The **provider download is always a real HTTP fetch** (only
  Cloudinary is mocked), so mock-mode STORED requires a reachable recording URL;
  the fetch→store path is otherwise covered by unit tests + seeded STORED rows.
- **Webhook auth = HMAC-SHA256 over the raw body** (`x-myoperator-signature`)
  against `MYOPERATOR_WEBHOOK_SECRET`; unset ⇒ accepted with a warning (dev). The
  app boots with `rawBody: true` so the signature is checked over exact bytes.
- **Org resolution for webhooks**: `payload.company_id` →
  `Organization.myoperatorCompanyId`, falling back to an existing click-to-call
  row's org. Events for an unknown company are ignored (logged), not errored.
- **Agent number**: click-to-call uses `MYOPERATOR_CALLER_ID` as the agent/DID
  leg (users don't store a personal phone); per-user DID mapping is a later
  refinement.
- **Consent gate is checked at store AND serve time** — a recording withdrawn
  after storage is purged (async) and re-blocked on the next serve. Purge sets
  `recordingStatus = BLOCKED` and drops the Cloudinary asset (no `PURGED` state).
- **E.164 default is +91 (India)**; matching is on the national number via a
  cheap last-4-digit DB prefilter confirmed in JS (no libphonenumber dependency).
- **BullMQ custom job ids use `_` not `:`** (BullMQ forbids `:` in custom ids) —
  applies to the recording fetch/purge jobs and the M3 reminder send jobs.
- **Data residency**: recordings live in the Cloudinary account's region —
  provision it in India; the adapter itself is region-agnostic. Per the non-goals
  there is no transcription/AI, no WhatsApp/SMS, and no mobile offline.

## Assumptions (Commerce — Shopify)

- **Architecture adaptation** — the spec references `apps/worker` / `packages/db` /
  "Part 5"; consistent with the M0 retrofit decision, the ingestion pipeline was
  built into the existing repo (`apps/api/src/ingestion` + in-process BullMQ
  worker, `packages/types`, the M0 `Integration` model), not a new worker app.
- **No live Nerige store in this environment** — the connector/backfill/reconcile
  call the real Admin API when `SHOPIFY_ADMIN_ACCESS_TOKEN` + `SHOPIFY_SHOP_DOMAIN`
  are set; without them `connect` reports **not_connected with a reason** (no
  crash) and backfill is a no-op. The full pipeline (mappers, money, HMAC, dedup,
  identity, pagination+429, reconcile) is covered by mocked unit tests, and the
  **webhook path was verified live** (valid→200, retry→duplicate, tampered→401,
  one Order in paise, customer normalized).
- **Webhook HMAC requires a secret** — unlike M5's dev-lenient MyOperator webhook,
  the Shopify webhook rejects everything (401) unless `SHOPIFY_WEBHOOK_SECRET` (or
  `SHOPIFY_API_SECRET`) is set, per the strict "verify FIRST" requirement.
- **Identity is exact-match only** (email/phone/externalId), never fuzzy/AI. The
  survivor is the earliest-created row; merges are audited (`customer.merge`), keep
  both rows, and null the merged email to uphold `UNIQUE(org, email)`.
- **Refunds are additive** — `refunds/create` increments `refundedMinor` by that
  refund's successful transactions (safe because deliveries are deduped) and
  recomputes `financialStatus`; the order is never deleted/zeroed.
- **Backfill uses REST cursor pagination + 429 backoff**; the Shopify **Bulk
  Operations** (JSONL) path is the documented next step for very large histories.
- **Commerce read** is granted to all roles (`commerce:read`) so reps can view
  Customer 360 (masked); `commerce:manage` (connect/sync/merge/segment-export) and
  `pii:read` (unmasked) are owner/admin. Org for a webhook resolves via
  `X-Shopify-Shop-Domain` → `Integration.config.shopDomain` (single-store falls
  back to the sole Shopify integration).

## Assumptions (Customer 360)

- **Architecture adaptation** (same as prior retrofits) — built into `apps/api`
  (`customers` module + in-process export worker) + `packages/types` glossary +
  `apps/web` components, not `apps/worker`/`packages/shared`/`packages/ui`.
- **Interaction is the fast-360 backbone** — written on ingest per order (ORDER)
  and per checkout (EVENT); the seed backfills it for seeded orders, and
  `CommerceIngestService` recomputes `CustomerFeatures` per order. Real M2 data =
  ORDER + EVENT interactions; message/call/ticket/note/return are future.
- **Performance** — the 300ms P95 is met at the query layer (measured 1–14ms on
  100k via `EXPLAIN ANALYZE` on the `Interaction`/`CustomerFeatures` indexes) plus
  a 60s Redis cache on the profile; run `SEED_COMMERCE_CUSTOMERS=100000 pnpm
  db:seed` to reproduce the 100k dataset.
- **Consent badges are placeholders** — the commerce `Customer` isn't linked to the
  CRM `Consent`/`Contact`, so marketing/call_recording render `NOT_CAPTURED` for
  now (wired in a later phase). RFM/CLV/churn/size/fit/style badges are likewise
  placeholders until M3 fills `CustomerFeatures`.
- **Export** — single-customer is a **sync** `.xlsx` stream (the acceptance path);
  the async worker + JobStatus + segment/batch path is wired for large history and
  admin "export a segment" (stores the workbook in Redis for a short-TTL download).
  8 tabs; Summary/Orders/Discounts carry real data, the rest render headers + a
  "no data yet" row. Non-admin workbooks are PII-masked.
- **Glossary** is introduced in Customer 360 (version 1) with the money/order
  metrics; RFM analytics extends it (version 2, never redefines) with the
  analytics metrics.

## Assumptions (RFM analytics + segments)

- **Architecture adaptation** (same as prior retrofits) — the materialized view +
  refresh worker live in `apps/api` (raw SQL migration + in-process BullMQ nightly
  job), the rule engine + endpoints in `apps/api/src/{analytics,segments}`, the
  RuleBuilder in `apps/web`, and the glossary in `packages/types` — not
  `packages/db` / `apps/worker` / `packages/ui`.
- **RFM is real, the deeper metrics are stubs** — CLV/churn/cohort/LTV:CAC are
  glossary + `CustomerFeatures` placeholders (no computation this phase), per the
  non-goals; only RFM (+ revenue/AOV) is wired to real values.
- **Canonical revenue = paid/fulfilled, refund-adjusted** — both the view and the
  on-ingest `recomputeFeatures` now filter to `PAID`/`FULFILLED` and subtract
  refunds, so a customer's badges, the analytics summary, and RFM all agree.
- **NTILE determinism** — a `customer_id` tiebreak makes quintile boundaries
  reproducible; with fewer than 5 scored customers each lands in its own tile
  (the golden dataset uses 5 so ranks are unambiguous).
- **The refresh runs nightly + once ~10s after boot** (so demos/tests don't wait a
  day); trigger it on demand with `POST /analytics/refresh` (admin). Dynamic
  segments are recomputed by the same nightly pass (a single daily sweep — the
  per-segment `refreshCron` is stored but not independently scheduled yet).
- **Segments query is injection-safe** — the tree becomes a structured Prisma
  `where` (whitelisted fields/ops, coerced values); it is never string-built.
- **Golden test is DB-backed** — it runs the real `customer_rfm` view + worker
  against Postgres (as in CI); the two DB-backed suites raise their timeout to
  tolerate parallel-run load.

## Assumptions (cart recovery — the MVP loop)

- **Architecture adaptation** (same retrofit) — the enrollment + send sweeps run
  in-process (`apps/api/src/campaigns` + BullMQ repeatables), the ConsentGate +
  Resend adapter + webhooks live under `apps/api`, and the UI in `apps/web` — not
  `apps/worker` / `packages/shared` / `packages/ui`.
- **Consent is polymorphic, not a rebuild** — rather than a separate marketing
  table, the existing M5 `Consent` gained an optional `customerId` + `MARKETING`
  purpose (M5 call-recording rows keep `contactId`), so "no send without granted
  marketing consent" is one gate over one table.
- **Sweeps, not delayed jobs** — restart-safe by construction (each tick queries
  what's due); tunable via `ABANDONED_CART_THRESHOLD_MINUTES` (60) and the
  enroll/send intervals. Also runs once ~10s after boot for a live demo.
- **Email is mock-safe** — without `RESEND_API_KEY` the adapter logs + returns a
  synthetic id (the loop still runs end-to-end); the webhook is dev-lenient unless
  `RESEND_WEBHOOK_SECRET` is set. Unsubscribe links are HMAC-signed
  (`UNSUBSCRIBE_SECRET`). Verified live: sweeps fired steps 1→2→3, a suppressed
  customer's send was BLOCKED + audited, a converted cart halted, and the
  unsubscribe link wrote a Suppression row.
- **Non-goals honored** — email only (WhatsApp/SMS is the next channel behind the
  same interface), one campaign type (ABANDONED_CART), no AI copy, no mobile.

## Assumptions (deep analytics — P2.1)

- **Architecture adaptation** (same retrofit) — the 4 views are raw SQL in the
  `..._p21_analytics` migration; the refresh + weekly churn workers run in-process
  (`apps/api/src/analytics`); dashboards in `apps/web`; glossary in
  `packages/types` — not `packages/db` / `apps/worker` / `packages/shared`.
- **CLV is historical, not predictive** — MVP CLV = lifetime net revenue (paid/
  fulfilled, refund-adjusted), banded by tertile per org. Predictive CLV + ML churn
  are Phase 3 (non-goals).
- **Churn is a transparent heuristic** — recency vs the customer's own median
  inter-purchase gap (documented above); RFM recency correlates but the gap ratio
  is the primary, defensible signal. New customers (<2 orders) are **Unknown**, not
  flagged.
- **Margin honesty is enforced** — the demo org (`Nerige`) has `hasCogs=true` +
  seeded per-SKU `costMinor`, so it shows **real** contribution margin; without
  COGS the same code path returns an `is_estimate` flag and the "Estimated margin
  (excludes COGS)" label (surfaced in the API, glossary, and UI). The golden test
  asserts **both** paths.
- **Timezone bucketing** — `revenue_daily`/`cohort_retention`/`contribution_margin`
  bucket `placedAt` (stored UTC) into the **org timezone** (`Asia/Kolkata` default),
  not a UTC day.
- **"Build segment from this"** reuses M3's engine — the chart passes a pre-filled
  rule tree to the builder (the cohort win-back uses `daysSinceLast` as a proxy for
  cohort drop-off, since cohort isn't a per-customer feature column).
- **Golden dataset (DB-backed)** runs the real views against Postgres (as in CI):
  CLV bands, cohort retention % incl. the period-0 boundary, and margin with +
  without COGS — all asserted exactly; churn bands via a pure deterministic test.
