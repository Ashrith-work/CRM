import { computeWeightedMinor } from './deals.service';

describe('computeWeightedMinor (weighted-value math, integer minor units)', () => {
  it('multiplies sum by probability/100 and rounds to minor units', () => {
    expect(computeWeightedMinor(10_000, 60)).toBe(6_000);
    expect(computeWeightedMinor(4_500_000, 30)).toBe(1_350_000);
  });

  it('returns 0 for a 0% (e.g. LOST) stage and the full sum for 100% (WON)', () => {
    expect(computeWeightedMinor(9_999, 0)).toBe(0);
    expect(computeWeightedMinor(9_999, 100)).toBe(9_999);
  });

  it('rounds half-values to the nearest minor unit (never a float)', () => {
    // 333 * 33 / 100 = 109.89 → 110
    expect(computeWeightedMinor(333, 33)).toBe(110);
    expect(Number.isInteger(computeWeightedMinor(333, 33))).toBe(true);
  });
});
