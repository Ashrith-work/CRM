import { generateBuckets, resolvePeriod } from './dashboard.period';

const iso = (d: Date) => d.toISOString();

describe('dashboard period boundaries (in the requester timezone)', () => {
  it('"this month" boundaries differ by timezone', () => {
    // 2026-02-28T20:00Z is still Feb in UTC but already March 1 in IST (+05:30).
    const now = new Date('2026-02-28T20:00:00Z');
    const utc = resolvePeriod('month', 'UTC', now);
    const ist = resolvePeriod('month', 'Asia/Kolkata', now);
    expect(iso(utc.start)).toBe('2026-02-01T00:00:00.000Z');
    expect(iso(ist.start)).toBe('2026-02-28T18:30:00.000Z'); // 2026-03-01 00:00 IST
    expect(iso(ist.end)).toBe('2026-03-31T18:30:00.000Z'); // 2026-04-01 00:00 IST
  });

  it('month spanning a DST transition uses each edge’s offset (New York)', () => {
    // US DST begins 2026-03-08, so the 1st is EST (−5) and April 1 is EDT (−4).
    const now = new Date('2026-03-20T12:00:00Z');
    const p = resolvePeriod('month', 'America/New_York', now);
    expect(iso(p.start)).toBe('2026-03-01T05:00:00.000Z'); // 00:00 EST
    expect(iso(p.end)).toBe('2026-04-01T04:00:00.000Z'); // 00:00 EDT
  });

  it('week is Monday-start', () => {
    const now = new Date('2026-07-08T12:00:00Z'); // a Wednesday
    const p = resolvePeriod('week', 'UTC', now);
    expect(iso(p.start)).toBe('2026-07-06T00:00:00.000Z'); // Monday
    expect(iso(p.end)).toBe('2026-07-13T00:00:00.000Z');
  });

  it('quarter snaps to the calendar quarter', () => {
    const p = resolvePeriod('quarter', 'UTC', new Date('2026-05-15T00:00:00Z'));
    expect(iso(p.start)).toBe('2026-04-01T00:00:00.000Z'); // Q2
    expect(iso(p.end)).toBe('2026-07-01T00:00:00.000Z');
  });

  it('today is the local day', () => {
    const p = resolvePeriod('today', 'UTC', new Date('2026-07-08T12:00:00Z'));
    expect(iso(p.start)).toBe('2026-07-08T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-07-09T00:00:00.000Z');
  });

  it('custom range is inclusive of the `to` day', () => {
    const p = resolvePeriod('custom', 'UTC', new Date(), '2026-01-10', '2026-01-20');
    expect(iso(p.start)).toBe('2026-01-10T00:00:00.000Z');
    expect(iso(p.end)).toBe('2026-01-21T00:00:00.000Z'); // day after `to`
  });

  it('generateBuckets splits a quarter into 3 monthly buckets', () => {
    const period = { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-04-01T00:00:00Z') };
    const buckets = generateBuckets(period, 'month', 'UTC');
    expect(buckets.map((b) => iso(b.start))).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-03-01T00:00:00.000Z',
    ]);
    expect(iso(buckets[2].end)).toBe('2026-04-01T00:00:00.000Z');
  });
});
