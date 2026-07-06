import { API_ROUTES, MeResponseSchema, type MeResponse } from '@crm/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Fetches GET /api/v1/me from the shared backend using a Clerk session token.
 * Response is validated against the shared zod schema — the single source of truth.
 */
export async function fetchMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}${API_ROUTES.me}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`GET ${API_ROUTES.me} failed: ${res.status} ${res.statusText}`);
  }

  return MeResponseSchema.parse(await res.json());
}
