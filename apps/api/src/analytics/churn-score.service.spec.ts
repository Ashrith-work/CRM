import { scoreChurn } from './churn-score.service';

const now = new Date('2026-06-01T00:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('scoreChurn (heuristic, explainable, deterministic)', () => {
  it('Unknown when there is insufficient history (< 2 orders)', () => {
    expect(scoreChurn([], now).band).toBe('Unknown');
    expect(scoreChurn([d('2026-05-01')], now).band).toBe('Unknown');
    expect(scoreChurn([], now).score).toBeNull();
  });

  it('Low when within ~1× the median gap', () => {
    // gap 30d, last order 20d ago → ratio 0.67
    const r = scoreChurn([d('2026-04-12'), d('2026-05-12')], now);
    expect(r.band).toBe('Low');
    expect(r.reason).toMatch(/median gap/);
  });

  it('Medium when 1–2× the median gap', () => {
    // gap 30d, last order 45d ago → ratio 1.5
    expect(scoreChurn([d('2026-03-18'), d('2026-04-17')], now).band).toBe('Medium');
  });

  it('High when > 2× the median gap', () => {
    // gap 30d, last order 92d ago → ratio ~3.1
    const r = scoreChurn([d('2026-01-30'), d('2026-03-01')], now);
    expect(r.band).toBe('High');
    expect(r.score).toBe(1); // clamped
  });

  it('uses the MEDIAN of multiple gaps', () => {
    // gaps: 30, 10, 20 → median 20; last order 20d ago → ratio 1.0 → Low
    const r = scoreChurn([d('2026-03-13'), d('2026-04-12'), d('2026-04-22'), d('2026-05-12')], now);
    expect(r.band).toBe('Low');
  });
});
