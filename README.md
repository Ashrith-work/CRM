# CRM — Milestones 0 (Foundation) + 1 (Core CRM) + 2 (Revenue) + 3 (Activity) + 4 (Dashboard)

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

## Stack

| Area      | Tech                                                              |
| --------- | ---------------------------------------------------------------- |
| Monorepo  | Turborepo + pnpm workspaces                                      |
| Backend   | NestJS, REST under `/api/v1`, Prisma, PostgreSQL, Redis/BullMQ, Socket.io |
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
pnpm db:migrate             # apply migrations (M0 + M1 + M2 + M3 + M4 indexes)
pnpm db:seed                # org + team + roles + users + sample CRM/deal/task data
```

The seed creates an `Acme` org, a `Core Team`, three system roles
(`owner`/`admin`/`member`), an **owner** user, a read-only **member** user, and
sample CRM data (companies, contacts, leads, tags, custom-field definitions, a
note, and activity), sample deals, and **sample tasks** (an overdue follow-up, an
upcoming call, a meeting — each with a reminder) plus one unread notification, so
every screen has something to show.

**Perf seed.** To load contacts for the list P95 test:

```bash
SEED_BULK_CONTACTS=50000 pnpm db:seed   # bulk-inserts 50k contacts (batched)
```

### Binding the seed to your Clerk identity

`/api/v1/me` looks up the app user by the Clerk `sub` in the token. After you
sign in once, copy your Clerk **user id** (and optionally **org id**) into
`apps/api/.env`, then re-run `pnpm db:seed`:

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
