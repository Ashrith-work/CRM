import {
  mapCustomer,
  mapOrder,
  mapOrderStatus,
  mapProduct,
  recomputeFinancialStatus,
  sumRefunds,
} from './shopify.mappers';

describe('shopify.mappers', () => {
  it('mapCustomer normalizes email (trim+lowercase) and phone (E.164 IN)', () => {
    expect(mapCustomer({ id: 123, email: '  Jane@Nerige.CO  ', phone: '098765 43210', first_name: 'Jane', last_name: 'Doe' })).toEqual({
      externalId: '123',
      email: 'jane@nerige.co',
      phone: '+919876543210',
      firstName: 'Jane',
      lastName: 'Doe',
      acceptsMarketing: null,
    });
    expect(mapCustomer(null)).toBeNull();
  });

  it('mapCustomer reads marketing consent (new consent object + legacy boolean)', () => {
    expect(mapCustomer({ id: 1, email: 'a@b.co', email_marketing_consent: { state: 'subscribed' } })?.acceptsMarketing).toBe(true);
    expect(mapCustomer({ id: 2, email: 'c@d.co', email_marketing_consent: { state: 'unsubscribed' } })?.acceptsMarketing).toBe(false);
    expect(mapCustomer({ id: 3, email: 'e@f.co', accepts_marketing: true })?.acceptsMarketing).toBe(true);
    expect(mapCustomer({ id: 4, email: 'g@h.co' })?.acceptsMarketing).toBeNull(); // unknown → null
  });

  it('mapOrder captures first-touch UTMs from cart note_attributes', () => {
    const order = mapOrder({
      id: 5, created_at: '2026-03-01T00:00:00Z', total_price: '10.00', currency: 'INR', financial_status: 'paid',
      note_attributes: [{ name: 'utm_source', value: 'facebook' }, { name: 'utm_campaign', value: 'spring' }],
      line_items: [],
    });
    expect(order.attributes?.utm).toEqual({ source: 'facebook', campaign: 'spring' });
  });

  it('mapProduct takes id→externalId, title, first image', () => {
    expect(mapProduct({ id: 9, title: 'Tee', images: [{ src: 'https://img/1.jpg' }] })).toEqual({
      externalId: '9',
      title: 'Tee',
      imageUrl: 'https://img/1.jpg',
    });
  });

  it('mapOrder maps money to minor units, currency, discount, refunds, items, UTC', () => {
    const order = mapOrder({
      id: 555,
      order_number: 1042,
      created_at: '2026-03-01T10:30:00Z',
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: '1234.50',
      currency: 'INR',
      total_discounts: '100.00',
      discount_codes: [{ code: 'DIWALI10' }],
      customer: { id: 7, email: 'A@B.com' },
      line_items: [{ product_id: 9, title: 'Tee', variant_title: 'M / Black', quantity: 2, price: '567.25' }],
      refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '234.50' }] }],
    });
    expect(order.externalId).toBe('555');
    expect(order.orderNumber).toBe('1042');
    expect(order.totalMinor).toBe(123450);
    expect(order.discountMinor).toBe(10000);
    expect(order.discountCode).toBe('DIWALI10');
    expect(order.refundedMinor).toBe(23450);
    expect(order.currency).toBe('INR');
    expect(order.status).toBe('FULFILLED');
    expect(order.financialStatus).toBe('PAID');
    expect(order.placedAt.toISOString()).toBe('2026-03-01T10:30:00.000Z');
    expect(order.items[0]).toEqual({ productExternalId: '9', title: 'Tee', variant: 'M / Black', quantity: 2, priceMinor: 56725 });
    expect(order.customer?.email).toBe('a@b.com');
  });

  it('mapOrderStatus prioritizes cancelled > refunded > fulfilled > paid > pending', () => {
    expect(mapOrderStatus({ cancelled_at: '2026-01-01', financial_status: 'paid' })).toBe('CANCELLED');
    expect(mapOrderStatus({ financial_status: 'refunded' })).toBe('REFUNDED');
    expect(mapOrderStatus({ fulfillment_status: 'fulfilled', financial_status: 'paid' })).toBe('FULFILLED');
    expect(mapOrderStatus({ financial_status: 'paid' })).toBe('PAID');
    expect(mapOrderStatus({ financial_status: 'pending' })).toBe('PENDING');
  });

  it('sumRefunds sums successful refund transactions only', () => {
    expect(
      sumRefunds([
        { transactions: [{ kind: 'refund', status: 'success', amount: '100.00' }, { kind: 'sale', amount: '999.00' }] },
        { transactions: [{ kind: 'refund', status: 'success', amount: '50.50' }] },
      ]),
    ).toBe(15050);
    expect(sumRefunds([])).toBe(0);
  });

  it('recomputeFinancialStatus reflects partial vs full refund (order not zeroed)', () => {
    expect(recomputeFinancialStatus(10000, 0)).toBe('PAID');
    expect(recomputeFinancialStatus(10000, 4000)).toBe('PARTIALLY_REFUNDED');
    expect(recomputeFinancialStatus(10000, 10000)).toBe('REFUNDED');
  });
});
