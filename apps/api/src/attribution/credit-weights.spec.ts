import { creditWeights } from './attribution.service';

/** Attribution credit distribution per model — the model is labelled in the UI. */
describe('creditWeights', () => {
  it('first_touch gives 100% to the earliest source', () => {
    expect(creditWeights(['meta', 'google', 'email'], 'first_touch')).toEqual([['meta', 1]]);
  });

  it('last_touch gives 100% to the latest source', () => {
    expect(creditWeights(['meta', 'google', 'email'], 'last_touch')).toEqual([['email', 1]]);
  });

  it('linear splits evenly across touchpoints (folded by source)', () => {
    const w = new Map(creditWeights(['meta', 'google'], 'linear'));
    expect(w.get('meta')).toBeCloseTo(0.5, 6);
    expect(w.get('google')).toBeCloseTo(0.5, 6);
  });

  it('time_decay weights later touchpoints more (sums to 1)', () => {
    const w = creditWeights(['meta', 'google'], 'time_decay');
    const total = w.reduce((s, [, x]) => s + x, 0);
    expect(total).toBeCloseTo(1, 6);
    const byS = new Map(w);
    expect(byS.get('google')!).toBeGreaterThan(byS.get('meta')!); // later > earlier
  });

  it('empty history yields no credit', () => {
    expect(creditWeights([], 'first_touch')).toEqual([]);
  });
});
