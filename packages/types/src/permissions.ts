/**
 * Canonical permission + role definitions. This is the single source of truth
 * shared by the API (enforcement), the web app, and the mobile app (UI gating).
 */

export const PERMISSIONS = {
  ORG_READ: 'org:read',
  ORG_MANAGE: 'org:manage',
  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  TEAM_READ: 'team:read',
  TEAM_MANAGE: 'team:manage',
  ROLE_READ: 'role:read',
  ROLE_MANAGE: 'role:manage',
  AUDIT_READ: 'audit:read',

  // Milestone 1 — CRM.
  CONTACT_READ: 'contact:read',
  CONTACT_MANAGE: 'contact:manage',
  COMPANY_READ: 'company:read',
  COMPANY_MANAGE: 'company:manage',
  LEAD_READ: 'lead:read',
  LEAD_MANAGE: 'lead:manage',
  TAG_READ: 'tag:read',
  TAG_MANAGE: 'tag:manage',
  NOTE_READ: 'note:read',
  NOTE_MANAGE: 'note:manage',
  CUSTOM_FIELD_READ: 'custom_field:read',
  CUSTOM_FIELD_MANAGE: 'custom_field:manage',
  ACTIVITY_READ: 'activity:read',

  // Milestone 2 — revenue layer.
  PIPELINE_READ: 'pipeline:read',
  PIPELINE_MANAGE: 'pipeline:manage',
  DEAL_READ: 'deal:read',
  DEAL_MANAGE: 'deal:manage',

  // Milestone 3 — activity tasks + reminders. Notifications/push tokens are
  // per-user and gated by USER_READ (held by every role), not a dedicated key.
  TASK_READ: 'task:read',
  TASK_MANAGE: 'task:manage',

  // Milestone 4 — dashboard/reporting. Three keys select the data scope:
  //   read      → own metrics (rep)
  //   read_team → team metrics + team table (manager)
  //   read_all  → org-wide metrics (owner)
  DASHBOARD_READ: 'dashboard:read',
  DASHBOARD_READ_TEAM: 'dashboard:read_team',
  DASHBOARD_READ_ALL: 'dashboard:read_all',

  // Milestone 5 — call management + DPDP consent.
  CALL_READ: 'call:read',
  CALL_MANAGE: 'call:manage',
  CONSENT_READ: 'consent:read',
  CONSENT_MANAGE: 'consent:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** System role names seeded for every organization. */
export const SYSTEM_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

/**
 * Default permission grants per system role, following least privilege:
 * - owner: everything
 * - admin: everything except transferring/deleting org-level ownership concerns
 * - member: read-only, no audit access (used to prove 403 in tests)
 */
export const ROLE_PERMISSIONS: Record<SystemRoleName, Permission[]> = {
  [SYSTEM_ROLES.OWNER]: [...ALL_PERMISSIONS],
  [SYSTEM_ROLES.ADMIN]: [
    PERMISSIONS.ORG_READ,
    PERMISSIONS.USER_READ,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.TEAM_READ,
    PERMISSIONS.TEAM_MANAGE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.AUDIT_READ,
    // Full CRM management.
    PERMISSIONS.CONTACT_READ,
    PERMISSIONS.CONTACT_MANAGE,
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.COMPANY_MANAGE,
    PERMISSIONS.LEAD_READ,
    PERMISSIONS.LEAD_MANAGE,
    PERMISSIONS.TAG_READ,
    PERMISSIONS.TAG_MANAGE,
    PERMISSIONS.NOTE_READ,
    PERMISSIONS.NOTE_MANAGE,
    PERMISSIONS.CUSTOM_FIELD_READ,
    PERMISSIONS.CUSTOM_FIELD_MANAGE,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.PIPELINE_READ,
    PERMISSIONS.PIPELINE_MANAGE,
    PERMISSIONS.DEAL_READ,
    PERMISSIONS.DEAL_MANAGE,
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_MANAGE,
    // Admin acts as a team manager for dashboards (team-scoped + team table).
    PERMISSIONS.DASHBOARD_READ,
    PERMISSIONS.DASHBOARD_READ_TEAM,
    // Call management + consent.
    PERMISSIONS.CALL_READ,
    PERMISSIONS.CALL_MANAGE,
    PERMISSIONS.CONSENT_READ,
    PERMISSIONS.CONSENT_MANAGE,
  ],
  [SYSTEM_ROLES.MEMBER]: [
    PERMISSIONS.ORG_READ,
    PERMISSIONS.USER_READ,
    PERMISSIONS.TEAM_READ,
    // CRM read-only (proves the 403 path on any :manage route).
    PERMISSIONS.CONTACT_READ,
    PERMISSIONS.COMPANY_READ,
    PERMISSIONS.LEAD_READ,
    PERMISSIONS.TAG_READ,
    PERMISSIONS.NOTE_READ,
    PERMISSIONS.CUSTOM_FIELD_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.PIPELINE_READ,
    PERMISSIONS.DEAL_READ,
    // Reps manage their own activity tasks + follow-ups.
    PERMISSIONS.TASK_READ,
    PERMISSIONS.TASK_MANAGE,
    // Reps see only their own dashboard metrics (own-scope).
    PERMISSIONS.DASHBOARD_READ,
    // Reps place/log calls and capture recording consent.
    PERMISSIONS.CALL_READ,
    PERMISSIONS.CALL_MANAGE,
    PERMISSIONS.CONSENT_READ,
    PERMISSIONS.CONSENT_MANAGE,
  ],
};
