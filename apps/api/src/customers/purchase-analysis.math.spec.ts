import {
  assembleOrderRow,
  fabricsFrom,
  subtotalMinor,
  type LineItemForRow,
  type OrderForRow,
  type ProductMeta,
} from './purchase-analysis.math';

const item = (o: Partial<LineItemForRow>): LineItemForRow => ({
  title: 'Item', variant: null, quantity: 1, priceMinor: 0, productId: null, ...o,
});
const order = (o: Partial<OrderForRow>): OrderForRow => ({
  id: 'o1', orderNumber: '1001', placedAt: new Date('2026-06-15T10:00:00Z'),
  totalMinor: 0, refundedMinor: 0, currency: 'INR', discountCode: null, discountMinor: 0, ...o,
});

describe('purchase-profile math (golden)', () => {
  it('fabricsFrom keeps only fabric-named tags, original casing, deduped', () => {
    expect(fabricsFrom(['Silk Saree', 'cotton', 'Festive', 'SALE'])).toEqual(['Silk Saree', 'cotton']);
    expect(fabricsFrom(['Sale', 'New', 'Gift'])).toEqual([]); // absent → blank, never fabricated
    expect(fabricsFrom([])).toEqual([]);
  });

  it('subtotal = Σ(unit price × qty)', () => {
    expect(subtotalMinor([item({ priceMinor: 10000, quantity: 1 }), item({ priceMinor: 5000, quantity: 2 })])).toBe(20000);
  });

  it('assembles a discounted order: net value, discount code+amount+%, fabrics, product types', () => {
    const items = [
      item({ title: 'Kanjivaram Saree', variant: 'Red', priceMinor: 10000, quantity: 1, productId: 'pA' }),
      item({ title: 'Blouse', variant: 'M', priceMinor: 10000, quantity: 1, productId: 'pB' }),
    ];
    const meta = new Map<string, ProductMeta>([
      ['pA', { productType: 'Sarees', tags: ['Silk', 'Festive'] }],
      ['pB', { productType: 'Blouses', tags: ['Cotton', 'Sale'] }],
    ]);
    // subtotal 20000; 10% off → total 18000, no refund.
    const row = assembleOrderRow(order({ totalMinor: 18000, refundedMinor: 0, discountMinor: 2000, discountCode: 'DIWALI10' }), items, meta, 'Champions');

    expect(row.valueMinor).toBe(18000); // total − refunded
    expect(row.mode).toBeNull(); // reserved, blank
    expect(row.segment).toBe('Champions');
    expect(row.discount).toEqual({ code: 'DIWALI10', amountMinor: 2000, pct: 0.1 }); // 2000/20000
    expect(row.fabrics).toEqual(['Silk', 'Cotton']);
    expect(row.productTypes).toEqual(['Sarees', 'Blouses']);
    expect(row.products).toEqual([
      { title: 'Kanjivaram Saree', variant: 'Red' },
      { title: 'Blouse', variant: 'M' },
    ]);
  });

  it('net value subtracts refunds; no-discount → null; no fabric tag → blank', () => {
    const items = [item({ title: 'Gift Box', priceMinor: 5000, quantity: 1, productId: 'pC' })];
    const meta = new Map<string, ProductMeta>([['pC', { productType: 'Gifting', tags: ['Sale', 'New'] }]]);
    const row = assembleOrderRow(order({ totalMinor: 5000, refundedMinor: 1000, discountMinor: 0, discountCode: null }), items, meta, null);

    expect(row.valueMinor).toBe(4000); // 5000 − 1000 refund
    expect(row.discount).toBeNull(); // "No discount"
    expect(row.fabrics).toEqual([]); // tag absent → blank, not fabricated
    expect(row.productTypes).toEqual(['Gifting']);
    expect(row.segment).toBeNull();
  });

  it('a code with a zero-subtotal order yields a null pct (no divide-by-zero)', () => {
    const row = assembleOrderRow(order({ totalMinor: 0, discountMinor: 500, discountCode: 'FREESHIP' }), [], new Map(), null);
    expect(row.discount).toEqual({ code: 'FREESHIP', amountMinor: 500, pct: null });
    expect(row.fabrics).toEqual([]);
    expect(row.products).toEqual([]);
  });
});
