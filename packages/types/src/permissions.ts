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
  ],
  [SYSTEM_ROLES.MEMBER]: [
    PERMISSIONS.ORG_READ,
    PERMISSIONS.USER_READ,
    PERMISSIONS.TEAM_READ,
  ],
};
