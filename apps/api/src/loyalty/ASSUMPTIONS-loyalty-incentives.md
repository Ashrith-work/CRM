# Loyalty ledger + threshold incentive engine · Assumptions & Notes

## What was built
- **Append-only loyalty ledger** (`loyalty/*`) — `LoyaltyTransaction` (delta, reason,
  refOrderId). **Balance is always `SUM(delta)`** — there is no mutable balance
  field. Earn on paid/fulfilled orders, burn on redemption, negative CLAWBACK on
  refund. `reconcileOrder` **converges** an order's ledger to its target
  (`floor(net ÷ divisor)`), so it is idempotent and handles partial/full refunds
  as one correcting transaction. Rows are never edited or deleted.
- **Threshold incentive engine** (`incentives/*`) — on a paid order, if the
  customer crosses the trigger, issue a Shopify code discount with: a **VALUE cap**
  (the reward is issued as a FIXED_AMOUNT = the cap, so value can never exceed it),
  **low-margin-SKU exclusion**, a **minimum next-order value**, and a **validity
  window**. Redemption is tracked once (`redeemedOrderId`, set when a matching code
  lands via M1 ingestion — double-redemption prevented by the ACTIVE→REDEEMED
  guard); a refund of the qualifying order reverses it; an hourly sweep expires
  lapsed ones (restart-safe, stable jobId).
- **Consent-gated notification** — the reward email goes through M4's
  `MarketingConsentGate` + `ResendAdapter`. No consent → no email (the code still
  attaches silently in Shopify).
- **Hooks** — `commerce-ingest.upsertOrder` calls `loyalty.reconcileOrder` +
  `incentives.onOrder`; `applyRefund` calls `reconcileOrder` (clawback) +
  `incentives.onRefund` (reverse).
- **UI** — `/dashboard/incentives`: engine settings (states the numbers; honest
  margin-guard banner) + issued-incentive table (code, caps, excluded SKUs, guard,
  validity, status, redeemed-by). Loyalty balance/ledger/redeem via the API.

## The PRECISE "X products" definition (Part 9)
The trigger metric is configurable (`INCENTIVE_TRIGGER_METRIC`) and **DEFAULTS to
`units`**, measured over the customer's paid/fulfilled orders:
- **`units`** (default) → total item quantity (`SUM(OrderItem.quantity)`).
- **`orders`** → count of paid/fulfilled orders.
- **`distinct_skus`** → number of distinct products purchased.
Threshold is `INCENTIVE_TRIGGER_THRESHOLD` (default 5). Documented in
`packages/types/src/incentives.ts` and enforced in `IncentiveService.measure`.

## Margin guard — HONEST, never faked (Part 9)
M5 margin data exists (`Product.costMinor` + order-item prices), so the guard is
**real**: a SKU is excluded when its computed contribution margin
(`(avgPrice − cost) ÷ avgPrice`) is below `INCENTIVE_MARGIN_FLOOR_PCT` (default 20%).
- `INCENTIVE_MARGIN_GUARD=true` (default): low-margin SKUs are excluded from the
  code; the incentive records `marginGuard=true`.
- If the guard is requested but **no product has cost data**, we DON'T pretend —
  the incentive is issued with `marginGuard=false` and a logged warning that it is
  exposed. Setting `INCENTIVE_MARGIN_GUARD=false` likewise records `marginGuard=false`.
- Unknown-cost SKUs (cost present for some, not others) are left IN the code (we
  only exclude *provably* low-margin SKUs); never-sold products can't be judged and
  are left in. The UI shows the guard state honestly.

## Assumptions / decisions
1. **Earn rate**: `floor(net ÷ LOYALTY_EARN_DIVISOR_MINOR)`, default 1 point per
   ₹100. Net = `totalMinor − refundedMinor` on paid/fulfilled orders.
2. **Reward = the value cap** (FIXED_AMOUNT). This is the Part 9-safe choice:
   percentage discounts can't be hard-value-capped on classic Shopify price rules,
   so v1 issues a capped fixed amount. `discountPercent`/PERCENT stay in the model
   for a future Shopify-Functions implementation.
3. **Shopify issuance is MOCK-friendly**: `ShopifyDiscountService` reads the shop
   domain + admin token from env and POSTs a price rule (once-per-customer,
   usage_limit 1, min subtotal, entitlement-scoped when excluding SKUs) + code.
   Token unset → a locally-generated code is returned and the incentive still
   exists (attach the code later). Never blocks the order path.
4. **One active incentive per customer at a time** (no stacking a second active
   one); after redemption/expiry they can qualify again. Stacking WITH other promos
   is Shopify's own combination setting (out of scope here).
5. **Refund reversal** targets the ACTIVE incentive whose `sourceOrderId` was
   refunded. An already-REDEEMED incentive (the discount was used) is left as-is.
6. **Loyalty burn on redemption** happens only when an incentive has `pointsCost > 0`
   (points-funded rewards); threshold rewards are free (`pointsCost = 0`). Manual
   point redemption is `POST /loyalty/:customerId/redeem` (refuses to go negative).
7. **New permissions** (`loyalty:*`, `incentive:*`) need a re-seed for existing orgs.

## Tests
- `loyalty.service.spec.ts` — earn math, refund clawback (correcting delta),
  idempotent convergence, balance = SUM, burn refuses negative.
- `incentive.service.spec.ts` — the three trigger metrics, value-capped issuance,
  threshold + no-stacking gates, margin-guard honesty (excludes low-margin;
  refuses to pretend with no cost data), redeem-once / no-double-redemption, refund
  reversal, and the ConsentGate on notification.

## Not done (per NON-GOALS)
No workflow builder, no channels beyond M4 email, no mobile.
