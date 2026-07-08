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

  // Milestone 5 — telephony (MyOperator) + recording storage (Cloudinary).
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
