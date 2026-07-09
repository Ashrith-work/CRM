import { extractShopifyAttribution, firstTouchSource, normalizeSource } from './utm.util';

describe('UTM capture from Shopify cart attributes', () => {
  it('reads UTMs from note_attributes', () => {
    const attrs = extractShopifyAttribution({
      note_attributes: [
        { name: 'utm_source', value: 'facebook' },
        { name: 'utm_medium', value: 'cpc' },
        { name: 'utm_campaign', value: 'spring_sale' },
      ],
      landing_site: '/products/tee',
    });
    expect(attrs?.utm).toEqual({ source: 'facebook', medium: 'cpc', campaign: 'spring_sale' });
  });

  it('falls back to UTMs embedded in the landing URL', () => {
    const attrs = extractShopifyAttribution({ landing_site: '/?utm_source=google&utm_medium=organic' });
    expect(attrs?.utm?.source).toBe('google');
  });

  it('returns null when there is no attribution signal at all', () => {
    expect(extractShopifyAttribution({})).toBeNull();
  });

  it('buckets first-touch source, collapsing Meta-family UTMs to "meta"', () => {
    expect(firstTouchSource({ utm: { source: 'Facebook' } })).toBe('meta');
    expect(firstTouchSource({ utm: { source: 'instagram' } })).toBe('meta');
    expect(firstTouchSource({ utm: { source: 'google' } })).toBe('google');
  });

  it('NEVER fabricates a source — absent UTM is "unknown"', () => {
    expect(firstTouchSource(null)).toBe('unknown');
    expect(firstTouchSource({})).toBe('unknown');
    expect(normalizeSource(undefined)).toBe('unknown');
    expect(normalizeSource('')).toBe('unknown');
  });
});
