import { API_ROUTES, MeResponseSchema, type MeResponse } from '@crm/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Calls the shared backend's GET /api/v1/me and validates the response. */
export async function fetchMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}${API_ROUTES.me}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET ${API_ROUTES.me} failed: ${res.status}`);
  }
  return MeResponseSchema.parse(await res.json());
}
