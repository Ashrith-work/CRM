# P2.3 — Meta Ads + Attribution + Audience Sync · Assumptions & Notes

## What was built
- **Meta client** (`ads/meta.service.ts`) — Graph Marketing API, pinned version,
  cursor pagination + throttle backoff. MOCK/not_connected = `connection()`
  returns null when `META_ACCESS_TOKEN`/`META_AD_ACCOUNT_ID` are unset; workers
  skip gracefully (same pattern as the Shopify client).
- **Connect + status** (`ads/meta-connect.service.ts`, `AdsController`) — upserts
  `Integration(provider='meta')`, verifies the ad account, `sync-now` enqueues.
- **Daily metrics pull** (`ads/meta-sync.service.ts` + `meta-ads.processor.ts`) —
  campaign→adset→ad hierarchy + daily Insights; creative metrics rolled up from
  their ads. Spend parsed to integer minor units (`parseMinor`). Upsert on
  `UNIQUE(org, entityType, entityId, date)` → **idempotent** (re-pull overwrites).
- **Lead-Ads import** — `AdLead` (distinct from the CRM `Lead`; see below), a
  first-touch Meta `Touchpoint`, and conversion re-attribution on first purchase.
- **Attribution** (`attribution/*`) — every touchpoint stored; first-touch UTM
  rides in via Shopify **cart attributes** (`note_attributes` → `Order.attributes`);
  `source_ltv_cac` materialized view gives CAC / LTV / LTV:CAC / payback per
  first-touch source; last/linear/time-decay computed on demand and **labelled**.
  Coverage % counts "unknown" honestly; reconciliation shows Meta-reported vs
  store-actual (revenue uses store-actual).
- **Audience sync** (`audiences/*`) — segment → Meta Custom/Suppression audience,
  **ConsentGate-gated** (reuses M4's `MarketingConsentGate`): only GRANTED +
  non-suppressed customers, PII SHA-256 hashed before upload, audited via
  `AudienceSync`. A non-consented/suppressed customer is never sent.
- **Glossary + dashboard** — added `roas`, `cac`, `ltv_cac`, `payback`,
  `first_touch`, `conversions`, `attribution_coverage`; `/dashboard/analytics/ads`
  source-ROI page with a model selector, coverage, reconciliation, ad performance,
  and a lookalike-seed segment hand-off.

## Assumptions / decisions
1. **`AdLead`, not `Lead`.** A CRM `Lead` model already exists (converts to a
   `Contact`). Meta Lead-Ads leads are a **new `AdLead`** model (first-touch
   attributed, converts to a `Customer`) so M1 is untouched. The objective's
   "Lead" = this `AdLead`.
2. **In-process workers, not `apps/worker`.** The objective names
   `apps/worker/*.worker.ts`, but this repo has no worker app — background jobs
   are BullMQ `WorkerHost` processors inside modules. Implemented as one
   `MetaAdsProcessor` (metrics / leads / refresh / nightly audience re-sync).
3. **Marketing consent ingestion added.** The ConsentGate reads `Consent`, which
   nothing populated outside seed — so audiences would always be empty in prod.
   Added a minimal `MarketingConsentWriter` that records MARKETING consent from
   Shopify `accepts_marketing` during ingestion, so the gate is meaningful.
4. **First-touch UTM needs a theme snippet.** Shopify doesn't persist UTMs, so a
   checkout/theme snippet must write landing UTMs into **cart attributes**
   (`note_attributes`); the ingestion mapper now reads them into
   `Order.attributes`. Absent → source "unknown" (never fabricated); coverage %
   reflects it.
5. **`source` is not a segment field.** The rule-tree engine has RFM/CLV/churn
   fields only, so a "Meta-acquired" filter can't be expressed as a segment. The
   lookalike-seed hand-off uses `clvBand=High`; narrow to the Meta cohort in the
   builder. (A future `firstTouchSource` segment field would close this.)
6. **`ad_performance` conversions are Meta-reported** (over-report); revenue/ROAS
   is store-actual at the source level in `source_ltv_cac`.
7. **`ads:read` / `ads:manage` permissions** need a **re-seed** for existing orgs
   (`pnpm db:seed`); owner gets them via ALL, admin gets both, member gets read.
8. **Two new materialized views** (`source_ltv_cac`, `ad_performance`) are
   unmanaged raw objects (like the existing RFM/analytics views) — created in the
   migration, refreshed by `AttributionRefreshService`, not modeled in Prisma.
9. **Env additions**: `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`,
   `META_AD_ACCOUNT_ID`, `META_BUSINESS_ID`, `META_GRAPH_VERSION` (default v21.0),
   `META_METRICS_INTERVAL_MS` (24h). Configure a Meta spend alert out of band.

## Tests (all green without DB except the golden view spec)
- Idempotent metric upsert (same day twice → one row set); spend → minor units.
- First-touch bucketing (`creditWeights` first/last/linear/time-decay); UTM
  capture + normalization; coverage; Meta-vs-store reconciliation math.
- **ConsentGate audience sync (critical): non-consented / suppressed customers
  are EXCLUDED and their PII is never sent; PII is SHA-256 hashed.**
- Lead import mapping + conversion re-attribution (touchpoint → customer).
- Golden `source_ltv_cac`: CAC / LTV / LTV:CAC / payback vs a hand-computed
  fixture (DB-backed — needs Postgres + migration, like the RFM golden spec).

## Not done (per NON-GOALS)
No Google Ads / GA4, no automated bidding/optimization, no AI copy, no mobile,
no last-click presented as truth (first-touch default, model always labelled).
