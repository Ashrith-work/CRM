import { z } from 'zod';

/**
 * M0 retrofit — third-party integrations. Stores only NON-SECRET config;
 * secrets live in env/secret storage. Providers are open strings (e.g.
 * MYOPERATOR, CLOUDINARY, CLERK, SHOPIFY).
 */

export const INTEGRATION_STATUSES = ['CONNECTED', 'DISCONNECTED', 'ERROR', 'PAUSED'] as const;
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const IntegrationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  provider: z.string(),
  status: IntegrationStatusSchema,
  externalAccountId: z.string().nullable(),
  config: z.record(z.string(), z.unknown()),
  connectedById: z.string().nullable(),
  connectedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const ConnectIntegrationInput = z.object({
  provider: z.string().min(1).max(60),
  externalAccountId: z.string().max(200).optional(),
  /** Non-secret config only. */
  config: z.record(z.string(), z.unknown()).optional(),
});
export type ConnectIntegrationInput = z.infer<typeof ConnectIntegrationInput>;

export const IntegrationListResponseSchema = z.object({ data: z.array(IntegrationSchema) });
export type IntegrationListResponse = z.infer<typeof IntegrationListResponseSchema>;
