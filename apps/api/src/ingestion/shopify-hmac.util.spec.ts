import { createHmac } from 'node:crypto';
import { verifyShopifyHmac } from './shopify-hmac.util';

const SECRET = 'shpss_test_secret';
const body = JSON.stringify({ id: 555, total_price: '1234.50' });
const validHmac = createHmac('sha256', SECRET).update(body).digest('base64');

describe('verifyShopifyHmac', () => {
  it('accepts a valid signature over the raw body', () => {
    expect(verifyShopifyHmac(body, SECRET, validHmac)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = JSON.stringify({ id: 555, total_price: '9999.99' });
    expect(verifyShopifyHmac(tampered, SECRET, validHmac)).toBe(false);
  });

  it('rejects a wrong secret and a garbage/missing signature', () => {
    expect(verifyShopifyHmac(body, 'wrong_secret', validHmac)).toBe(false);
    expect(verifyShopifyHmac(body, SECRET, 'not-a-real-hmac')).toBe(false);
    expect(verifyShopifyHmac(body, SECRET, undefined)).toBe(false);
    expect(verifyShopifyHmac(body, undefined, validHmac)).toBe(false);
  });
});
