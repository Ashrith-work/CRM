import { z } from 'zod';

/** Validated environment. ConfigModule runs `validateEnv` at boot so a
 * misconfigured deploy fails fast instead of at first request. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // PII protection. In production these MUST come from the vault (a boot check
  // warns when the dev defaults are in use). ENCRYPTION_KEY encrypts PII at rest
  // (AES-256-GCM); HASH_PEPPER keys the deterministic match-hashes (HMAC-SHA256).
  // 32-byte key as hex (64 chars) or base64. Key versioning enables rotation:
  // ENCRYPTION_KEY is the CURRENT version; ENCRYPTION_KEY_PREVIOUS decrypts rows
  // still under the old version during a re-encrypt job.
  ENCRYPTION_KEY: z.string().default('dev-only-insecure-encryption-key-change-me'),
  ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  ENCRYPTION_KEY_PREVIOUS_VERSION: z.coerce.number().int().min(1).optional(),
  HASH_PEPPER: z.string().default('dev-only-insecure-hash-pepper-change-me'),

  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_JWT_KEY: z.string().optional(),
  CLERK_AUTHORIZED_PARTIES: z.string().optional(),
  /** Clock-skew tolerance (ms) for JWT exp/nbf checks, so minor drift between
   * the client, Clerk, and this server does not reject otherwise-valid tokens. */
  CLERK_CLOCK_SKEW_MS: z.coerce.number().int().min(0).default(5_000),

  // Milestone 3 — reminders + notifications.
  /** How often the reminder sweep runs (ms). */
  REMINDER_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  /** Max concurrent send jobs (throttles a storm of simultaneous reminders). */
  REMINDER_SEND_CONCURRENCY: z.coerce.number().int().min(1).default(10),
  /** From address for reminder/notification emails. */
  EMAIL_FROM: z.string().default('CRM <no-reply@crm.local>'),
  /** If set, emails are sent via the Resend HTTP API; otherwise logged. */
  RESEND_API_KEY: z.string().optional(),
  /** Optional Expo access token for authenticated push (recommended in prod). */
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Milestone 5 — telephony + recording storage (Cloudinary). The active provider
  // is swap-able: 'myoperator' (default) or 'exotel'. Each provider's webhook
  // route parses with its own adapter; the active one does outbound + downloads.
  TELEPHONY_PROVIDER: z.enum(['myoperator', 'exotel']).default('myoperator'),

  // Exotel — unset ⇒ MOCK mode (no real dialing). Click-to-call uses HTTP Basic
  // auth (EXOTEL_API_KEY:EXOTEL_API_TOKEN); org mapping via EXOTEL_ACCOUNT_SID.
  EXOTEL_API_URL: z.string().default('https://api.exotel.com'),
  EXOTEL_ACCOUNT_SID: z.string().optional(),
  EXOTEL_API_KEY: z.string().optional(),
  EXOTEL_API_TOKEN: z.string().optional(),
  EXOTEL_CALLER_ID: z.string().optional(),
  /** Optional HMAC secret for webhook verification (Exotel usually uses URL basic-auth). */
  EXOTEL_WEBHOOK_SECRET: z.string().optional(),

  MYOPERATOR_API_URL: z.string().default('https://obd-api.myoperator.co'),
  /** When unset, the adapter runs in MOCK mode (generates ids; no real dialing). */
  MYOPERATOR_API_TOKEN: z.string().optional(),
  MYOPERATOR_COMPANY_ID: z.string().optional(),
  /** The org's caller-id / DID used as the "from" leg of a click-to-call. */
  MYOPERATOR_CALLER_ID: z.string().optional(),
  /** Shared secret for HMAC-SHA256 webhook verification. When set, bad
   * signatures are rejected; when unset (dev), webhooks are allowed with a warn. */
  MYOPERATOR_WEBHOOK_SECRET: z.string().optional(),

  /** Cloudinary — either CLOUDINARY_URL or the three discrete vars. Unset → MOCK. */
  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('crm/recordings'),
  /** Max recording size to fetch/store (bytes). Default 50 MB. */
  RECORDING_MAX_BYTES: z.coerce.number().int().min(1).default(50 * 1024 * 1024),
  /** TTL (seconds) for the signed recording playback URL. */
  RECORDING_URL_TTL_SECONDS: z.coerce.number().int().min(30).default(300),

  // Milestone 1 (commerce) — Shopify ingestion.
  /** Pinned Admin API version. */
  SHOPIFY_API_VERSION: z.string().default('2024-10'),
  SHOPIFY_API_KEY: z.string().optional(),
  /** App API secret — used for webhook HMAC (falls back if no webhook secret). */
  SHOPIFY_API_SECRET: z.string().optional(),
  /** Webhook signing secret (preferred for HMAC when present). */
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  /** Admin API access token. Unset ⇒ the connector reports not_connected. */
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().optional(),
  /** e.g. "nerige.myshopify.com". */
  SHOPIFY_SHOP_DOMAIN: z.string().optional(),
  /** Nightly reconciliation cadence (ms). Default 24h. */
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60 * 1000),

  // Milestone 3 — RFM analytics.
  /** Nightly RFM refresh cadence (ms). Default 24h. */
  RFM_REFRESH_INTERVAL_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60 * 1000),

  // Milestone 4 — abandoned-cart recovery.
  /** A cart is "abandoned" after this many minutes without conversion. */
  ABANDONED_CART_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(60),
  /** Enrollment sweep cadence (ms). Default 5 min. */
  CAMPAIGN_ENROLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(5 * 60 * 1000),
  /** Send sweep cadence (ms). Default 2 min. */
  CAMPAIGN_SEND_INTERVAL_MS: z.coerce.number().int().min(10_000).default(2 * 60 * 1000),
  /** Base URL used to build the (signed) unsubscribe link in emails. */
  APP_BASE_URL: z.string().default('http://localhost:4000'),
  /** HMAC key for signing unsubscribe links. */
  UNSUBSCRIBE_SECRET: z.string().default('dev-unsubscribe-secret'),
  /** When set, Resend webhooks must carry a matching HMAC (else dev-lenient). */
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // P2.2 — read-only AI assistant. When ANTHROPIC_API_KEY is unset the
  // assistant runs a deterministic, still-grounded fallback (MOCK mode), so the
  // safe tools / RBAC / grounding / caching / audit all work without a key.
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Cheap model for intent/tool routing. */
  ASSISTANT_ROUTING_MODEL: z.string().default('claude-haiku-4-5'),
  /** Stronger model for the final grounded composition. */
  ASSISTANT_COMPOSER_MODEL: z.string().default('claude-opus-4-8'),
  /** Hard cap on output tokens per model call (cost bound). */
  ASSISTANT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(1024),
  /** Max tool-calling iterations before composing (cost bound). */
  ASSISTANT_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  /** Short cache TTL for identical (org, role-scope, question) answers. 0 disables. */
  ASSISTANT_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),

  // P2.3 — Meta ads. When META_ACCESS_TOKEN / META_AD_ACCOUNT_ID are unset the
  // connector reports not_connected and workers skip gracefully (MOCK mode).
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** System-user / long-lived access token (Marketing API). */
  META_ACCESS_TOKEN: z.string().optional(),
  /** act_<id> (the "act_" prefix is added if missing). */
  META_AD_ACCOUNT_ID: z.string().optional(),
  META_BUSINESS_ID: z.string().optional(),
  /** Pinned Graph API version — bump deliberately. */
  META_GRAPH_VERSION: z.string().default('v21.0'),
  /** Daily ad-metrics + leads + attribution-refresh cadence (ms). Default 24h. */
  META_METRICS_INTERVAL_MS: z.coerce.number().int().min(60_000).default(24 * 60 * 60 * 1000),

  // VIP tiering. The INPUT is a config switch: 'clv' tiers on clvMinor (falling
  // back to netRevenueMinor when CLV isn't computed yet), 'spend' tiers purely on
  // netRevenueMinor. Thresholds are inclusive lower bounds in minor units (paise).
  VIP_TIER_INPUT: z.enum(['clv', 'spend']).default('clv'),
  VIP_TIER_VIP_MINOR: z.coerce.number().int().min(0).default(5_000_000), // ₹50,000
  VIP_TIER_GOLD_MINOR: z.coerce.number().int().min(0).default(2_000_000), // ₹20,000
  VIP_TIER_SILVER_MINOR: z.coerce.number().int().min(0).default(500_000), // ₹5,000

  // Loyalty ledger. Points earned = floor(order net ÷ divisor). Default: 1 point
  // per ₹100 (10,000 paise). Net = totalMinor − refundedMinor on paid/fulfilled.
  LOYALTY_EARN_DIVISOR_MINOR: z.coerce.number().int().min(1).default(10_000),

  // Threshold incentive engine. "X products" metric is defined PRECISELY here.
  INCENTIVE_TRIGGER_METRIC: z.enum(['units', 'orders', 'distinct_skus']).default('units'),
  INCENTIVE_TRIGGER_THRESHOLD: z.coerce.number().int().min(1).default(5),
  /** The discount VALUE cap (paise) — the reward can never exceed this. */
  INCENTIVE_MAX_VALUE_MINOR: z.coerce.number().int().min(1).default(50_000), // ₹500
  /** Minimum next-order subtotal to redeem (paise). */
  INCENTIVE_MIN_NEXT_ORDER_MINOR: z.coerce.number().int().min(0).default(200_000), // ₹2,000
  INCENTIVE_VALIDITY_DAYS: z.coerce.number().int().min(1).default(30),
  /**
   * Margin guard. When true (default — M5 margin data exists), low-margin SKUs
   * are EXCLUDED from issued codes. When false, guards are OFF and the incentive
   * records marginGuard=false so the exposure is HONEST (never faked).
   */
  INCENTIVE_MARGIN_GUARD: z
    .string()
    .transform((v) => v !== 'false' && v !== '0')
    .pipe(z.boolean())
    .default('true'),
  /** A SKU is "low-margin" below this contribution-margin %. */
  INCENTIVE_MARGIN_FLOOR_PCT: z.coerce.number().min(0).max(100).default(20),
  /** Expiry sweep cadence (ms). Default 1h. */
  INCENTIVE_SWEEP_INTERVAL_MS: z.coerce.number().int().min(60_000).default(60 * 60 * 1000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
