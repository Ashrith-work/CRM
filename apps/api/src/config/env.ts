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
