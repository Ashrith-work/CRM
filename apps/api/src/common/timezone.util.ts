/**
 * Timezone helpers. Every datetime is stored/compared in UTC; these functions
 * translate between a user's local wall-clock (in an IANA timezone) and the
 * absolute UTC instant, and compute local-day boundaries for agenda bucketing.
 *
 * DST-correct: offsets are derived per-instant from Intl (which knows each
 * zone's DST rules for a given date), never a fixed offset.
 */

/** Offset (ms) of `tz` at the moment `date`, i.e. localWallClock − trueUtc. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  // `hour` can come back as 24 at midnight in some environments — normalize.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asUtc - date.getTime();
}

/** True if `tz` is a valid IANA timezone name (else falls back to UTC upstream). */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a wall-clock time expressed in `tz` to the absolute UTC instant.
 * Handles DST by resolving the offset at the target instant (with one
 * refinement pass for the spring-forward / fall-back boundary).
 *
 * Example: (2026, 7, 10, 9, 0, 'America/New_York') → 2026-07-10T13:00:00Z (EDT, UTC−4).
 */
export function zonedWallClockToUtc(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = tzOffsetMs(new Date(naiveUtc), tz);
  let ts = naiveUtc - offset1;
  const offset2 = tzOffsetMs(new Date(ts), tz);
  if (offset2 !== offset1) ts = naiveUtc - offset2;
  return new Date(ts);
}

/** The local Y-M-D (in `tz`) of the instant `date`. */
export function localYmd(date: Date, tz: string): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return { year: map.year, month: map.month, day: map.day };
}

/** UTC instant of local midnight (start of `date`'s day in `tz`). */
export function startOfLocalDayUtc(date: Date, tz: string): Date {
  const { year, month, day } = localYmd(date, tz);
  return zonedWallClockToUtc(year, month, day, 0, 0, tz);
}

/** UTC instant of the next local midnight (start of the following day in `tz`). */
export function startOfNextLocalDayUtc(date: Date, tz: string): Date {
  const start = startOfLocalDayUtc(date, tz);
  // Add 26h then re-snap to local midnight so DST transitions can't miss a day.
  return startOfLocalDayUtc(new Date(start.getTime() + 26 * 3_600_000), tz);
}

/** Resolve a possibly-invalid timezone to a safe IANA name (fallback UTC). */
export function safeTimeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : 'UTC';
}
