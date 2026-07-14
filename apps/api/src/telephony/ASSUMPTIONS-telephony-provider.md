# Telephony: swap-able provider (Mock + MyOperator + Exotel) · Assumptions & Notes

> **Update (mock-first + resilience).** A first-class `MockTelephonyProvider`
> (`mock.service.ts` + `mock.fixtures.ts`) was added and `TELEPHONY_PROVIDER` now
> **defaults to `mock`** — the whole pipeline runs from fixtures with no account,
> and going live is the one-line switch to `myoperator` (see
> `HOW-TO-CONNECT-MYOPERATOR.md`). Also added: a self-healing HTTP layer
> (`http.util.ts` — retry+backoff+jitter, refresh-once on auth, typed
> `TelephonyAuthError`/`TelephonyConfigError`), a reconciliation sweep for MISSED
> webhooks (`calls/call-reconcile.processor.ts`), un-recoverable-error surfacing
> onto the Integration row (`telephony-status.service.ts`), and telephony
> connectivity in `GET /health`. The interface gained `fetchRecentCalls` +
> `healthCheck` (implemented by all three adapters). Everything below still holds.



## Scope: M5 already existed — this fills the provider-abstraction gap
Reconnaissance found **M5 call management is fully built** (Call model, consent
gate, recording worker → Cloudinary, webhook HMAC verify + idempotent upsert,
E.164 number→contact match, calls UI + timeline) — but **only against MyOperator**,
with the concrete `MyOperatorService` injected everywhere and **no Exotel**. So I
added the swap-able seam + the Exotel adapter and left everything else untouched.

- **`TelephonyProvider` interface + DI token** (`telephony/telephony.provider.ts`)
  — the 6 provider methods (`isMock`, `callerId`, `clickToCall`, `verifySignature`,
  `webhookSecretConfigured`, `parseEvent`, `downloadRecording`) + the neutral
  `NormalizedCallEvent`/`ClickToCallParams`/`DownloadedRecording` shapes. Shared
  normalization (`mapStatus`/`mapDirection`/`parseTime`) moved to `normalize.util.ts`.
- **`MyOperatorService` now implements it** (unchanged behavior; re-exports the
  shared types so existing importers keep working).
- **`ExotelService`** — click-to-call via the Exotel `Calls/connect` API (HTTP
  Basic auth), HMAC webhook verify (via `EXOTEL_WEBHOOK_SECRET`), Exotel
  status-callback → normalized event, recording download. MOCK when
  `EXOTEL_API_TOKEN`/`EXOTEL_ACCOUNT_SID` are unset.
- **Provider selection** — `TELEPHONY_PROVIDER` env (`myoperator` default |
  `exotel`); `TelephonyModule` provides both adapters + the active one under the
  `TELEPHONY_PROVIDER` token (used for outbound + recording download). Each
  provider's webhook route parses with its own adapter.
- **Exotel webhook route** (`POST /webhooks/exotel`) alongside the existing
  `/webhooks/myoperator`; both call the shared, provider-agnostic
  `CallsService.processWebhookEvent(normalizedEvent)`.
- **Org mapping** — added `Organization.exotelAccountSid` (unique) so inbound
  Exotel webhooks resolve to an org the same way MyOperator's company id does
  (`resolveOrg` now matches either).

## What was reused unchanged (NOT rebuilt)
Consent-gated recording pipeline (ConsentGate → download → Cloudinary
`authenticated` upload → signed URL, size/TTL guards, DPDP purge), webhook HMAC
verification + idempotent `(org, externalCallId)` upsert, E.164 number→contact
matching (0/1/many), the CALL timeline activity, and the calls UI (history,
consent-gated player, click-to-call) — all pre-existing and provider-agnostic, so
they work under either provider with no change.

## Assumptions / decisions
1. **One active provider at a time** (the spec's "swap-able"). `TELEPHONY_PROVIDER`
   picks it for outbound + downloads; you point that provider's webhooks at the
   CRM. Both webhook routes are registered so a mid-migration overlap still works
   (each parses with its own adapter).
2. **Exotel webhook auth**: Exotel typically secures callbacks with HTTP Basic
   auth on the callback URL (configured in Exotel), not a body HMAC. Our
   `verifySignature` adds an optional HMAC layer (`EXOTEL_WEBHOOK_SECRET` +
   `x-exotel-signature`); dev-lenient when unset (logged), matching MyOperator.
3. **Exotel org mapping** uses `EXOTEL_ACCOUNT_SID` (one Exotel account per
   deployment) set into the event's `companyId` and matched against
   `Organization.exotelAccountSid`. Outbound calls also resolve via the existing
   click-to-call Call row (the `resolveOrg` fallback).
4. **India data residency** (unchanged, pre-existing gap): enforced by
   *provisioning* the Cloudinary account/sub-account in India — the adapter is
   region-agnostic in code (documented in `cloudinary.service.ts`). Not changed
   here.
5. **No new permissions / no DB churn beyond one nullable column** — the calls UI,
   consent gate, and recording worker are all reused as-is.

## Env added
`TELEPHONY_PROVIDER` (myoperator|exotel), `EXOTEL_API_URL`, `EXOTEL_ACCOUNT_SID`,
`EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID`, `EXOTEL_WEBHOOK_SECRET`.
Unset ⇒ Exotel runs in MOCK mode.

## Tests
- `exotel.service.spec.ts` — MOCK detection, MOCK click-to-call, status-callback
  parsing → normalized event, HMAC verify (lenient/strict), id + caller id.
- Existing (unchanged, still green): `calls.service.spec.ts` (idempotent webhook,
  number→contact match, timeline, gated fetch) + `fetch-recording.processor.spec.ts`
  (consent gate, size guard, retry) — now running through the provider seam.

## Not done (per NON-GOALS)
No transcription/summaries/sentiment (M16), no WhatsApp/SMS, no mobile.
