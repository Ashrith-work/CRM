# How to connect MyOperator (go live)

The telephony pipeline runs today on the **mock** provider — click-to-call,
webhooks, number→contact matching, the timeline, the consent gate, recording
storage, reconciliation, and health all work from fixtures with **no account**.
Going live is a config change; **no business logic changes.**

## 1. Set the env vars (`apps/api/.env`)

```bash
TELEPHONY_PROVIDER=myoperator          # the ONLY switch that flips mock → live
MYOPERATOR_API_URL=https://obd-api.myoperator.co
MYOPERATOR_API_TOKEN=<your api key>    # unset ⇒ adapter stays in mock mode
MYOPERATOR_COMPANY_ID=<your company id>
MYOPERATOR_CALLER_ID=<your DID / number>   # the "from" leg of click-to-call
MYOPERATOR_WEBHOOK_SECRET=<shared secret>  # enables HMAC verification (below)

# Recording storage (store ONLY with call-recording consent). Provision the
# Cloudinary account/sub-account in INDIA for DPDP data residency.
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>
# (or CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)
```

Restart the API. The boot log prints `Active telephony provider: myoperator`.

## 2. Map your MyOperator account to the org

Set `Organization.myoperatorCompanyId` = your MyOperator **company_id** (the value
MyOperator sends in webhook payloads). Inbound webhooks resolve to the org by
matching this; outbound calls resolve via the click-to-call `Call` row.

## 3. Register the webhook URL in the MyOperator dashboard

```
POST  https://<your-api-host>/api/v1/webhooks/myoperator
Header:  x-myoperator-signature: <HMAC-SHA256(rawBody, MYOPERATOR_WEBHOOK_SECRET)>
```

- With `MYOPERATOR_WEBHOOK_SECRET` set, a bad/missing signature is **rejected
  (401)** and surfaced onto the org's Integration row (status `ERROR`, reason
  `signature_mismatch`).
- If MyOperator can't sign the body, leave the secret unset in dev — webhooks are
  accepted with a warning (never do this in production).

## 4. The one live-call check

1. From a customer/contact page, click **Call** (`POST /api/v1/calls/click-to-call`).
   A `Call` is created `RINGING` with an `externalCallId`; your phone rings.
2. Answer, talk briefly, hang up. MyOperator posts status callbacks to the webhook.
3. Confirm on the call: status → `COMPLETED`, `durationSeconds` set, the call on the
   contact timeline, and `GET /api/v1/health` shows `services.telephony: "up"`.
4. If the contact has **granted** call-recording consent, the recording is fetched
   and stored (`recordingStatus: STORED`, playable via the consent-gated signed
   URL). Without consent it is `BLOCKED` and never downloaded (audited).

## What auto-heals vs. what needs a human

- **Auto-heals (no action):** transient network/5xx/429 → retried with backoff+jitter;
  expired/invalid token → one refresh + retry; duplicate webhook → idempotent no-op;
  a **missed** webhook → the reconciliation sweep (`TELEPHONY_RECONCILE_INTERVAL_MS`,
  default 5 min) re-pulls recent calls and fills the gap; recording-fetch failure →
  BullMQ retry queue; provider briefly down → queued/retried, not failed.
- **Needs a human (surfaced, never swallowed):** invalid API key/secret, account
  misconfig, number not permitted, webhook signature mismatch → the org's
  **Integration** row is set to `status: ERROR` with the reason (`auth_error` /
  `config_error` / `signature_mismatch`) + an AuditLog + an error-level log.

## Assumptions

- One active provider at a time (`TELEPHONY_PROVIDER`); all provider webhook routes
  stay registered so a mid-migration overlap still works. `exotel` is also supported.
- Call-recording consent is **contact-scoped** (`ConsentPurpose.CALL_RECORDING`); the
  gate is re-checked at store time AND at playback time.
- MyOperator's recent-calls report endpoint used by reconciliation is
  `GET {API}/report/call?company_id=…&from=<epoch>`; adjust the path in
  `myoperator.service.ts#fetchRecentCalls` if your account exposes a different route.
  In mock mode it returns nothing to pull.
- Data residency is enforced by **provisioning** Cloudinary in India (the adapter is
  region-agnostic in code).
- No transcription/summaries/AI — capture + store only (a later milestone).
