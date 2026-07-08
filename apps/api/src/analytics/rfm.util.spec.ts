import { daysSince, rfmCode, rfmSegment } from './rfm.util';

describe('rfmSegment (deterministic matrix)', () => {
  it('labels the canonical segments', () => {
    expect(rfmSegment(5, 5, 5)).toBe('Champions');
    expect(rfmSegment(4, 4, 5)).toBe('Champions');
    expect(rfmSegment(3, 5, 5)).toBe('Loyal'); // r mid, f high
    expect(rfmSegment(5, 1, 1)).toBe('New'); // recent, few orders
    expect(rfmSegment(3, 3, 3)).toBe('Potential Loyalist');
    expect(rfmSegment(3, 1, 1)).toBe('Promising'); // r>=3 leftover
    expect(rfmSegment(1, 5, 5)).toBe('At Risk'); // lapsed but valuable
    expect(rfmSegment(2, 3, 3)).toBe('Needs Attention');
    expect(rfmSegment(2, 2, 2)).toBe('About to Sleep');
    expect(rfmSegment(1, 2, 1)).toBe('Hibernating'); // fm=1.5
    expect(rfmSegment(1, 1, 1)).toBe('Lost');
  });

  it('is total — every (r,f,m) in 1..5 yields a label', () => {
    for (let r = 1; r <= 5; r++)
      for (let f = 1; f <= 5; f++)
        for (let m = 1; m <= 5; m++) expect(typeof rfmSegment(r, f, m)).toBe('string');
  });

  it('daysSince floors whole days; null with no last order', () => {
    const now = new Date('2026-07-08T00:00:00Z');
    expect(daysSince(new Date('2026-07-01T00:00:00Z'), now)).toBe(7);
    expect(daysSince(new Date('2026-07-07T12:00:00Z'), now)).toBe(0);
    expect(daysSince(null, now)).toBeNull();
  });

  it('rfmCode formats the combined display', () => {
    expect(rfmCode(5, 4, 3)).toBe('R5 F4 M3');
  });
});
