import { z } from 'zod';

/**
 * Zod schemas are the runtime + compile-time contract for API payloads.
 * Both clients validate/parse responses against these; the API validates
 * requests and shapes responses to match. Never redefine these shapes elsewhere.
 */

export const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const TeamSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type Team = z.infer<typeof TeamSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
});
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  clerkUserId: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
});
export type User = z.infer<typeof UserSchema>;

/** Response shape for GET /api/v1/me. */
export const MeResponseSchema = z.object({
  user: UserSchema,
  organization: OrganizationSchema,
  team: TeamSchema.nullable(),
  role: RoleSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

/** Response shape for GET /api/v1/health. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string(),
  services: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Standard error envelope returned by the API. */
export const ApiErrorSchema = z.object({
  statusCode: z.number(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
