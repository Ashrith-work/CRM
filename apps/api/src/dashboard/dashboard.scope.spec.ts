import { PERMISSIONS } from '@crm/types';
import { canReadTeam, resolveScope } from './dashboard.scope';

describe('dashboard scope (role → data scope)', () => {
  it('maps the highest permission to the widest scope', () => {
    expect(
      resolveScope([PERMISSIONS.DASHBOARD_READ, PERMISSIONS.DASHBOARD_READ_TEAM, PERMISSIONS.DASHBOARD_READ_ALL]),
    ).toBe('all');
    expect(resolveScope([PERMISSIONS.DASHBOARD_READ, PERMISSIONS.DASHBOARD_READ_TEAM])).toBe('team');
    expect(resolveScope([PERMISSIONS.DASHBOARD_READ])).toBe('own');
    expect(resolveScope([])).toBe('own');
  });

  it('gates the team table: only team/all may read it (a rep cannot)', () => {
    expect(canReadTeam([PERMISSIONS.DASHBOARD_READ_ALL])).toBe(true);
    expect(canReadTeam([PERMISSIONS.DASHBOARD_READ_TEAM])).toBe(true);
    expect(canReadTeam([PERMISSIONS.DASHBOARD_READ])).toBe(false); // rep → 403
  });
});
