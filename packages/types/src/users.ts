import { z } from 'zod';

/**
 * Milestone 3 — org user directory + per-user timezone. The directory powers the
 * assignee picker (web + mobile). Each user carries an IANA `timezone` so
 * reminders and agenda buckets resolve against their local day (default UTC).
 */

export const OrgUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  /** IANA timezone name, e.g. "America/New_York". */
  timezone: z.string(),
});
export type OrgUser = z.infer<typeof OrgUserSchema>;

export const OrgUserListResponseSchema = z.object({ data: z.array(OrgUserSchema) });
export type OrgUserListResponse = z.infer<typeof OrgUserListResponseSchema>;

/** PATCH /me/timezone — set the current user's timezone. */
export const UpdateTimezoneInput = z.object({
  timezone: z.string().min(1).max(64),
});
export type UpdateTimezoneInput = z.infer<typeof UpdateTimezoneInput>;
