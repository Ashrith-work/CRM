import type { RfmSegment } from '@crm/types';

/**
 * Deterministic RFM segment matrix. Given the recency/frequency/monetary
 * quintile scores (1–5, higher = better/more-recent), returns a fixed segment
 * label. Pure + total (covers every (r,f,m) combination) so the golden test can
 * assert exact labels. `fm` blends frequency + monetary into a value tier.
 */
export function rfmSegment(r: number, f: number, m: number): RfmSegment {
  const fm = (f + m) / 2;
  if (r >= 4 && fm >= 4) return 'Champions';
  if (r >= 3 && f >= 4) return 'Loyal';
  if (r >= 4 && f <= 2) return 'New';
  if (r >= 3 && fm >= 3) return 'Potential Loyalist';
  if (r >= 3) return 'Promising';
  // r <= 2 from here.
  if (fm >= 4) return 'At Risk';
  if (fm >= 3) return 'Needs Attention';
  if (fm >= 2) return 'About to Sleep';
  if (fm >= 1.5) return 'Hibernating';
  return 'Lost';
}

/** Whole days between `last` and `now` (floored); null when there is no last order. */
export function daysSince(last: Date | null | undefined, now: Date): number | null {
  if (!last) return null;
  return Math.floor((now.getTime() - last.getTime()) / 86_400_000);
}

/** Combined "R5 F4 M3" display code. */
export function rfmCode(r: number, f: number, m: number): string {
  return `R${r} F${f} M${m}`;
}
