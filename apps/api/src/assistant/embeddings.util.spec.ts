import { EMBEDDING_DIM, cosineSim, embedText, toPgVector } from './embeddings.util';

describe('embeddings.util', () => {
  it('produces a unit vector of the fixed dimension', () => {
    const v = embedText('customer lifetime value by band');
    expect(v).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic (stable cache keys + tests)', () => {
    expect(embedText('churn risk')).toEqual(embedText('churn risk'));
  });

  it('cosine of a vector with itself is 1; unrelated text is lower', () => {
    const churn = embedText('churn risk overdue customers');
    const revenue = embedText('daily net revenue trend');
    expect(cosineSim(churn, churn)).toBeCloseTo(1, 5);
    expect(cosineSim(churn, revenue)).toBeLessThan(cosineSim(churn, churn));
  });

  it('handles empty text without NaN', () => {
    const v = embedText('');
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });

  it('formats a pgvector literal', () => {
    expect(toPgVector([0.5, -0.25])).toBe('[0.500000,-0.250000]');
  });
});
