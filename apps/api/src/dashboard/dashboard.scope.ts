import { PERMISSIONS, type DashboardScope } from '@crm/types';

/**
 * Map a user's permissions to their dashboard data scope:
 *   dashboard:read_all  → 'all'   (owner — org-wide)
 *   dashboard:read_team → 'team'  (manager — their team[s])
 *   dashboard:read      → 'own'   (rep — self only)
 * Highest wins. Pure so the role→scope mapping is unit-testable.
 */
export function resolveScope(permissions: string[]): DashboardScope {
  if (permissions.includes(PERMISSIONS.DASHBOARD_READ_ALL)) return 'all';
  if (permissions.includes(PERMISSIONS.DASHBOARD_READ_TEAM)) return 'team';
  return 'own';
}

/** Can this user read team-wide data (team table + team/all scope)? */
export function canReadTeam(permissions: string[]): boolean {
  return (
    permissions.includes(PERMISSIONS.DASHBOARD_READ_ALL) ||
    permissions.includes(PERMISSIONS.DASHBOARD_READ_TEAM)
  );
}
