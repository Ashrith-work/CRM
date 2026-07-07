import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Shopify webhook: HMAC-SHA256 of the RAW body with the shared secret,
 * base64-encoded, constant-time compared to the X-Shopify-Hmac-Sha256 header.
 * Must run BEFORE any parsing or DB touch. Returns false on any missing input.
 */
export function verifyShopifyHmac(
  rawBody: string | Buffer,
  secret: string | undefined,
  headerHmac: string | undefined,
): boolean {
  if (!secret || !headerHmac) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(headerHmac);
  return a.length === b.length && timingSafeEqual(a, b);
}
