import {
  isValidTimeZone,
  localYmd,
  safeTimeZone,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  zonedWallClockToUtc,
} from './timezone.util';

describe('timezone.util (DST-aware wall-clock ↔ UTC)', () => {
  it('converts 9am local to the correct UTC instant, respecting DST', () => {
    // New York summer = EDT (UTC−4): 9am → 13:00Z.
    expect(zonedWallClockToUtc(2026, 7, 10, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-07-10T13:00:00.000Z',
    );
    // New York winter = EST (UTC−5): 9am → 14:00Z.
    expect(zonedWallClockToUtc(2026, 1, 10, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-01-10T14:00:00.000Z',
    );
    // Kolkata (UTC+5:30, no DST): 9am → 03:30Z.
    expect(zonedWallClockToUtc(2026, 7, 10, 9, 0, 'Asia/Kolkata').toISOString()).toBe(
      '2026-07-10T03:30:00.000Z',
    );
    // UTC is the identity.
    expect(zonedWallClockToUtc(2026, 7, 10, 9, 0, 'UTC').toISOString()).toBe('2026-07-10T09:00:00.000Z');
  });

  it('computes the local day and its boundaries in the given timezone', () => {
    // 2026-07-10T02:00Z is still 2026-07-09 (22:00) in New York.
    const instant = new Date('2026-07-10T02:00:00.000Z');
    expect(localYmd(instant, 'America/New_York')).toEqual({ year: 2026, month: 7, day: 9 });

    // Start of that NY local day = 2026-07-09 00:00 EDT = 04:00Z.
    expect(startOfLocalDayUtc(instant, 'America/New_York').toISOString()).toBe('2026-07-09T04:00:00.000Z');
    // Next local midnight = 2026-07-10 00:00 EDT = 04:00Z.
    expect(startOfNextLocalDayUtc(instant, 'America/New_York').toISOString()).toBe(
      '2026-07-10T04:00:00.000Z',
    );
  });

  it('validates timezones and falls back to UTC for invalid ones', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(safeTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(safeTimeZone('bogus')).toBe('UTC');
    expect(safeTimeZone(null)).toBe('UTC');
  });
});
