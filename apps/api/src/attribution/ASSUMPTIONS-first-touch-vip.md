# First-touch source on orders + VIP tiering · Assumptions & Notes

## Scope: mostly an extension of P2.3
The `attribution/*` module, the `Touchpoint` model, Shopify cart-attribute UTM
capture (`Order.attributes`), the selectable first/last/linear/time-decay models
(default first-touch, labelled), coverage, and reconciliation were all built in
P2.3. This milestone adds the pieces that were still missing:

- **`Order.firstTouchSource`** (new column) — set at ingestion from the cart
  attributes, so order-level coverage is a cheap indexed aggregate. Existing
  orders are backfilled in the migration from their captured `attributes.utm`.
- **Touchpoint at ingestion** — `commerce-ingest.upsertOrder` now also upserts a
  `web` Touchpoint per order (idempotent on org+channel+sessionId), in addition
  to the nightly `captureOrderTouchpoints` backfill. Every touchpoint is stored.
- **Order-level coverage %** — `GET /attribution/order-coverage`: orders with a
  known first-touch source ÷ all orders, with a per-source breakdown. `null` and
  `"unknown"` fold into one honest "unknown" bucket — a source is never invented.
- **VIP tiering** — `CustomerFeatures.vipTier` (new column) + `TierService`
  assigns `VIP|Gold|Silver|Standard` from a **config switch**:
  - `VIP_TIER_INPUT=clv` (default) tiers on `clvMinor`, **falling back to
    `netRevenueMinor`** when CLV isn't computed yet — so it upgrades to CLV
    automatically once M5/CLV data lands (M5 is already built here, so it uses
    CLV by default).
  - `VIP_TIER_INPUT=spend` tiers purely on `netRevenueMinor` (M3 spend).
  - Thresholds are env-configurable (`VIP_TIER_VIP_MINOR` / `_GOLD_` / `_SILVER_`,
    inclusive lower bounds in paise; defaults ₹50k / ₹20k / ₹5k).
  - Runs in the **nightly analytics refresh** (right after CLV is written) — no
    separate worker app (the repo has none); `AnalyticsProcessor` calls
    `TierService.assignAll()`.
- **VIP badge on the M2 profile** — Customer 360 `badges.vipTier`, rendered as a
  MetricBadge with a `vip_tier` glossary tooltip.
- **Dashboard** — `/dashboard/analytics/attribution`: coverage % + per-source
  breakdown (unknown labelled), the model-selectable LTV-by-source, and the
  Meta-vs-store reconciliation.

## Assumptions / decisions
1. **`firstTouchSource` is per-ORDER** (the source that drove that order's
   landing), distinct from a customer's first-touch (the earliest Touchpoint,
   used by `source_ltv_cac`). Both are legitimate; order coverage uses the former.
2. **"Right time" for the source** = the cart-attribute UTM on the order. A
   theme/checkout snippet must write landing UTMs into cart attributes
   (`note_attributes`) — Shopify doesn't persist UTMs. Without it, every order is
   `firstTouchSource="unknown"` and coverage reflects that honestly.
3. **Tier writes are minimal** — `assignTiersForOrg` only updates rows whose tier
   actually changed, so the nightly pass is cheap.
4. **Migration backfill** derives `firstTouchSource` for existing orders from
   `attributes.utm.source` (Meta-family → `meta`, else lowercased, else
   `unknown`) — matching the runtime `firstTouchSource()` normalization.
5. **No new permissions** — coverage/attribution reads reuse `ads:read`; the tier
   worker is internal.

## Tests
- `analytics/tier.service.spec.ts` — `computeTier` band boundaries, the
  clv-vs-spend config switch (incl. CLV→spend fallback), and change-only writes.
- `attribution/order-coverage.spec.ts` — coverage math, null+unknown folding,
  zero-order safety.
- Existing (unchanged, still green): utm capture / first-touch bucketing /
  reconciliation (P2.3), commerce-ingest.

## Not done (per NON-GOALS)
No Meta/Google connect here (that's the ads milestone), no last-click-as-truth
(first-touch default, model always labelled), no mobile.
