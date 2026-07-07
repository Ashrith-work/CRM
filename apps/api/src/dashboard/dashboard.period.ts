import type { PeriodPreset } from '@crm/types';
import { BadRequestException } from '@nestjs/common';
import {
  localYmd,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  zonedWallClockToUtc,
} from '../common/timezone.util';

/**
 * Period-boundary math for the dashboard. Every window is a half-open
 * `[start, end)` of UTC instants, but the boundaries are the requester's LOCAL
 * calendar edges (start of their week/month/quarter), so "this month" means
 * their month — DST-correct because we re-snap to local midnight via
 * `zonedWallClockToUtc` rather than adding fixed millisecond spans.
 */

export interface Period {
  start: Date;
  end: Date;
}

function ymdToUtc(year: number, month: number, day: number, tz: string): Date {
  return zonedWallClockToUtc(year, month, day, 0, 0, tz);
}

/** Add `n` calendar days to a local-midnight instant, re-snapping to local midnight. */
function addLocalDays(startUtc: Date, tz: string, n: number): Date {
  const { year, month, day } = localYmd(startUtc, tz);
  const shifted = new Date(Date.UTC(year, month - 1, day) + n * 86_400_000);
  return ymdToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), tz);
}

/** Add `n` calendar months to a local month-start, re-snapping to local midnight. */
function addLocalMonths(startUtc: Date, tz: string, n: number): Date {
  const { year, month } = localYmd(startUtc, tz);
  const zeroBased = month - 1 + n;
  const newYear = year + Math.floor(zeroBased / 12);
  const newMonth = ((zeroBased % 12) + 12) % 12; // 0-based, wrapped
  return ymdToUtc(newYear, newMonth + 1, 1, tz);
}

export function startOfLocalWeekUtc(now: Date, tz: string): Date {
  const { year, month, day } = localYmd(now, tz);
  // Day-of-week of the pure calendar date (UTC of the naked date == weekday).
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun … 6=Sat
  const mondayOffset = (dow + 6) % 7; // Monday-start week
  const monday = new Date(Date.UTC(year, month - 1, day) - mondayOffset * 86_400_000);
  return ymdToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), tz);
}

export function startOfLocalMonthUtc(now: Date, tz: string): Date {
  const { year, month } = localYmd(now, tz);
  return ymdToUtc(year, month, 1, tz);
}

export function startOfLocalQuarterUtc(now: Date, tz: string): Date {
  const { year, month } = localYmd(now, tz);
  const quarterStartMonth = month - ((month - 1) % 3);
  return ymdToUtc(year, quarterStartMonth, 1, tz);
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Resolve a preset (+ optional custom bounds) into a `[start, end)` window. */
export function resolvePeriod(
  preset: PeriodPreset,
  tz: string,
  now: Date,
  from?: string,
  to?: string,
): Period {
  switch (preset) {
    case 'today':
      return { start: startOfLocalDayUtc(now, tz), end: startOfNextLocalDayUtc(now, tz) };
    case 'week': {
      const start = startOfLocalWeekUtc(now, tz);
      return { start, end: addLocalDays(start, tz, 7) };
    }
    case 'month': {
      const start = startOfLocalMonthUtc(now, tz);
      return { start, end: addLocalMonths(start, tz, 1) };
    }
    case 'quarter': {
      const start = startOfLocalQuarterUtc(now, tz);
      return { start, end: addLocalMonths(start, tz, 3) };
    }
    case 'custom': {
      const f = from?.match(YMD);
      const t = to?.match(YMD);
      if (!f || !t) {
        throw new BadRequestException('custom period requires from & to as YYYY-MM-DD');
      }
      const start = ymdToUtc(+f[1], +f[2], +f[3], tz);
      const toStart = ymdToUtc(+t[1], +t[2], +t[3], tz);
      const end = addLocalDays(toStart, tz, 1); // inclusive of the `to` day
      if (end <= start) throw new BadRequestException('custom period: `to` must be on or after `from`');
      return { start, end };
    }
  }
}

/** Split `[start, end)` into week/month buckets stepping from `start`. */
export function generateBuckets(period: Period, interval: 'week' | 'month', tz: string): Period[] {
  const buckets: Period[] = [];
  let cursor = period.start;
  let guard = 0;
  while (cursor < period.end && guard++ < 500) {
    const next = interval === 'week' ? addLocalDays(cursor, tz, 7) : addLocalMonths(cursor, tz, 1);
    buckets.push({ start: cursor, end: next < period.end ? next : period.end });
    cursor = next;
  }
  return buckets;
}
