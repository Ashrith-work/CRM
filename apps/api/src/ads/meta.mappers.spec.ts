import { mapInsight, mapLead, sumConversions } from './meta.mappers';

describe('Meta mappers', () => {
  it('parses spend decimal string into integer minor units (paise)', () => {
    const m = mapInsight('campaign', { campaign_id: '123', date_start: '2026-07-01', spend: '1234.50', impressions: '1000', clicks: '40' });
    expect(m).not.toBeNull();
    expect(m!.spendMinor).toBe(123450);
    expect(m!.impressions).toBe(1000);
    expect(m!.clicks).toBe(40);
    expect(m!.entityType).toBe('campaign');
    expect(m!.date.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('sums only purchase-type actions as conversions (Meta-reported)', () => {
    const conversions = sumConversions([
      { action_type: 'purchase', value: '3' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
      { action_type: 'landing_page_view', value: '99' }, // ignored
    ]);
    expect(conversions).toBe(5);
  });

  it('drops an insight row with no entity id or date', () => {
    expect(mapInsight('ad', { spend: '1.00' })).toBeNull();
  });

  it('maps a Lead-Ads submission field_data to name/email/phone', () => {
    const lead = mapLead({
      id: 'lead_1',
      created_time: '2026-07-01T10:00:00+0000',
      form_id: 'form_9',
      campaign_id: 'c1',
      field_data: [
        { name: 'full_name', values: ['Priya Sharma'] },
        { name: 'email', values: ['Priya@Shop.IN'] },
        { name: 'phone_number', values: ['+91 98765 43210'] },
      ],
    });
    expect(lead.name).toBe('Priya Sharma');
    expect(lead.email).toBe('priya@shop.in'); // normalized
    expect(lead.phone).toBe('+919876543210');
    expect(lead.campaign).toBe('c1');
  });
});
