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
