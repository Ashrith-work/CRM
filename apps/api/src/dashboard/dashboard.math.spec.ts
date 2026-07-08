import {
  computeFunnel,
  computeSalesTiles,
  computeTrends,
  sumByCurrency,
  weightedByCurrency,
  winRate,
  type ClosedDealRow,
  type OpenDealRow,
  type StageEntry,
  type StageRef,
} from './dashboard.math';
import type { Period } from './dashboard.period';

// ===========================================================================
// GOLDEN DATASET — hand-computed. Every dashboard number is asserted exactly.
// ===========================================================================
describe('dashboard golden dataset', () => {
  // --- Deals used for the sales tiles ------------------------------------
  // OPEN deals (pipeline value + weighted). Probabilities from their stage.
  const openDeals: OpenDealRow[] = [
    { amountMinor: 100_000, currency: 'USD', probability: 40 }, // Qualified
    { amountMinor: 200_000, currency: 'USD', probability: 70 }, // Proposal
    { amountMinor: 50_000, currency: 'EUR', probability: 10 }, // New (multi-currency)
  ];
  // Deals CLOSED within the period.
  const closedDeals: ClosedDealRow[] = [
    { amountMinor: 120_000, currency: 'USD', status: 'WON' },
    { amountMinor: 80_000, currency: 'USD', status: 'WON' },
    { amountMinor: 60_000, currency: 'EUR', status: 'WON' },
    { amountMinor: 40_000, currency: 'USD', status: 'LOST' },
    { amountMinor: 30_000, currency: 'USD', status: 'LOST' },
  ];

  it('computes every sales tile exactly (multi-currency, integer minor units)', () => {
    const tiles = computeSalesTiles({
      openDeals,
      closedDeals,
      dealsCreated: 7,
      activitiesLogged: 5,
      tasksOverdue: 2,
      tasksDone: 4,
    });

    // Pipeline value = Σ open amounts per currency (never summed across).
    expect(tiles.pipelineValue).toEqual([
      { currency: 'EUR', amountMinor: 50_000 },
      { currency: 'USD', amountMinor: 300_000 },
    ]);
    // Weighted = round(Σ(amount×prob)/100) per currency.
    // USD: (100000·40 + 200000·70)/100 = 18,000,000/100 = 180,000. EUR: 50000·10/100 = 5,000.
    expect(tiles.weightedPipeline).toEqual([
      { currency: 'EUR', amountMinor: 5_000 },
      { currency: 'USD', amountMinor: 180_000 },
    ]);
    expect(tiles.dealsWon).toBe(3);
    expect(tiles.revenueWon).toEqual([
      { currency: 'EUR', amountMinor: 60_000 },
      { currency: 'USD', amountMinor: 200_000 },
    ]);
    expect(tiles.dealsLost).toBe(2);
    expect(tiles.winRate).toBeCloseTo(0.6, 10); // 3 / (3 + 2)
    // avg = revenue / won count, per currency: USD 200000/2=100000, EUR 60000/1=60000.
    expect(tiles.avgDealSize).toEqual([
      { currency: 'EUR', amountMinor: 60_000 },
      { currency: 'USD', amountMinor: 100_000 },
    ]);
    expect(tiles.dealsCreated).toBe(7);
    expect(tiles.activitiesLogged).toBe(5);
    expect(tiles.tasksOverdue).toBe(2);
    expect(tiles.tasksDone).toBe(4);
  });

  // --- Funnel from stage history -----------------------------------------
  const stages: StageRef[] = [
    { id: 'new', name: 'New', position: 0 },
    { id: 'qual', name: 'Qualified', position: 1 },
    { id: 'prop', name: 'Proposal', position: 2 },
    { id: 'won', name: 'Won', position: 3 },
    { id: 'lost', name: 'Lost', position: 4 },
  ];
  // Paths (each entry is a stage a deal ENTERED). dE is reopened (New twice) —
  // proves DISTINCT counting: it must count once in New.
  const entries: StageEntry[] = [
    { dealId: 'dA', toStageId: 'new' }, { dealId: 'dA', toStageId: 'qual' }, { dealId: 'dA', toStageId: 'prop' }, { dealId: 'dA', toStageId: 'won' },
    { dealId: 'dB', toStageId: 'new' }, { dealId: 'dB', toStageId: 'qual' }, { dealId: 'dB', toStageId: 'lost' },
    { dealId: 'dC', toStageId: 'new' }, { dealId: 'dC', toStageId: 'qual' },
    { dealId: 'dD', toStageId: 'new' },
    { dealId: 'dE', toStageId: 'new' }, { dealId: 'dE', toStageId: 'qual' }, { dealId: 'dE', toStageId: 'new' },
  ];

  it('funnel counts DISTINCT deals passing through each stage + stage conversions', () => {
    const { stages: fs, overallConversion } = computeFunnel(stages, entries);
    expect(fs.map((s) => s.dealsEntered)).toEqual([5, 4, 1, 1, 1]); // New,Qual,Prop,Won,Lost
    expect(fs[0].conversionFromPrev).toBeNull(); // first stage
    expect(fs[1].conversionFromPrev).toBeCloseTo(4 / 5, 10); // 0.8
    expect(fs[2].conversionFromPrev).toBeCloseTo(1 / 4, 10); // 0.25
    expect(fs[3].conversionFromPrev).toBeCloseTo(1 / 1, 10);
    expect(overallConversion).toBeCloseTo(1 / 5, 10); // last(Lost)=1 / first(New)=5
  });

  // --- Trends -------------------------------------------------------------
  it('buckets won deals into a monthly series with per-currency value', () => {
    const buckets: Period[] = [
      { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-02-01T00:00:00Z') },
      { start: new Date('2026-02-01T00:00:00Z'), end: new Date('2026-03-01T00:00:00Z') },
      { start: new Date('2026-03-01T00:00:00Z'), end: new Date('2026-04-01T00:00:00Z') },
    ];
    const points = computeTrends(buckets, [
      { when: new Date('2026-01-15T00:00:00Z'), amountMinor: 100, currency: 'USD' },
      { when: new Date('2026-01-20T00:00:00Z'), amountMinor: 50, currency: 'EUR' },
      { when: new Date('2026-02-10T00:00:00Z'), amountMinor: 200, currency: 'USD' },
    ]);
    expect(points[0].count).toBe(2);
    expect(points[0].valueByCurrency).toEqual([
      { currency: 'EUR', amountMinor: 50 },
      { currency: 'USD', amountMinor: 100 },
    ]);
    expect(points[1].count).toBe(1);
    expect(points[1].valueByCurrency).toEqual([{ currency: 'USD', amountMinor: 200 }]);
    expect(points[2].count).toBe(0);
    expect(points[2].valueByCurrency).toEqual([]);
  });
});

// ===========================================================================
// UNIT tests — the individual guarantees.
// ===========================================================================
describe('dashboard math units', () => {
  it('winRate = won/(won+lost), null when nothing closed', () => {
    expect(winRate(3, 1)).toBeCloseTo(0.75, 10);
    expect(winRate(0, 4)).toBe(0);
    expect(winRate(0, 0)).toBeNull(); // division-by-zero guard
  });

  it('weightedByCurrency = round(Σ(amount×prob)/100) and never sums across currencies', () => {
    expect(
      weightedByCurrency([
        { amountMinor: 333, currency: 'USD', probability: 33 }, // 333·33/100 = 109.89
        { amountMinor: 1000, currency: 'EUR', probability: 50 }, // 500
      ]),
    ).toEqual([
      { currency: 'EUR', amountMinor: 500 },
      { currency: 'USD', amountMinor: 110 }, // rounded
    ]);
  });

  it('sumByCurrency groups by currency', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amountMinor: 100 },
        { currency: 'EUR', amountMinor: 30 },
        { currency: 'USD', amountMinor: 25 },
      ]),
    ).toEqual([
      { currency: 'EUR', amountMinor: 30 },
      { currency: 'USD', amountMinor: 125 },
    ]);
  });

  it('empty dataset → zeros / empty arrays / null rate (no NaN, no throw)', () => {
    const tiles = computeSalesTiles({
      openDeals: [],
      closedDeals: [],
      dealsCreated: 0,
      activitiesLogged: 0,
      tasksOverdue: 0,
      tasksDone: 0,
    });
    expect(tiles.pipelineValue).toEqual([]);
    expect(tiles.weightedPipeline).toEqual([]);
    expect(tiles.revenueWon).toEqual([]);
    expect(tiles.avgDealSize).toEqual([]);
    expect(tiles.winRate).toBeNull();
    expect(tiles.dealsWon).toBe(0);
  });

  it('funnel with no entrants → zeros and null conversions (no division by zero)', () => {
    const { stages, overallConversion } = computeFunnel(
      [
        { id: 'a', name: 'A', position: 0 },
        { id: 'b', name: 'B', position: 1 },
      ],
      [],
    );
    expect(stages.map((s) => s.dealsEntered)).toEqual([0, 0]);
    expect(stages[1].conversionFromPrev).toBeNull(); // prev entrants = 0 → guard
    expect(overallConversion).toBeNull();
  });
});
