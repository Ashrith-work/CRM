/**
 * First-touch UTM capture (Part 9). Shopify does NOT persist UTMs on the order,
 * so a theme/checkout snippet writes the landing UTMs into CART ATTRIBUTES
 * (`note_attributes`) → they arrive on the order payload. We read them here; if
 * absent, the source is honestly "unknown" (never fabricated).
 */

export interface OrderAttributes {
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  landingSite?: string | null;
  referringSite?: string | null;
}

type Raw = Record<string, unknown>;

/** Extract {utm, landingSite, referringSite} from a Shopify order/checkout payload. */
export function extractShopifyAttribution(raw: Raw): OrderAttributes | null {
  const utm: NonNullable<OrderAttributes['utm']> = {};
  const noteAttrs = (raw.note_attributes as Array<{ name?: unknown; value?: unknown }>) ?? [];
  for (const a of noteAttrs) {
    const key = String(a?.name ?? '').toLowerCase();
    const value = a?.value == null ? '' : String(a.value);
    if (!value) continue;
    if (key === 'utm_source') utm.source = value;
    else if (key === 'utm_medium') utm.medium = value;
    else if (key === 'utm_campaign') utm.campaign = value;
    else if (key === 'utm_content') utm.content = value;
    else if (key === 'utm_term') utm.term = value;
  }

  const landingSite = raw.landing_site == null ? null : String(raw.landing_site);
  const referringSite = raw.referring_site == null ? null : String(raw.referring_site);

  // Fall back to UTMs embedded in the landing URL's query string.
  if (!utm.source && landingSite) {
    const q = queryOf(landingSite);
    if (q.get('utm_source')) utm.source = q.get('utm_source')!;
    if (q.get('utm_medium')) utm.medium = q.get('utm_medium')!;
    if (q.get('utm_campaign')) utm.campaign = q.get('utm_campaign')!;
  }

  const hasUtm = Object.keys(utm).length > 0;
  if (!hasUtm && !landingSite && !referringSite) return null;
  return { ...(hasUtm ? { utm } : {}), landingSite, referringSite };
}

/**
 * Bucket a first-touch source from stored order attributes. Meta-family UTM
 * sources collapse to "meta" so they line up with Meta spend; anything else
 * keeps its utm_source; absent → "unknown".
 */
export function firstTouchSource(attributes: unknown): string {
  const attrs = attributes as OrderAttributes | null;
  const raw = attrs?.utm?.source?.trim().toLowerCase();
  return normalizeSource(raw);
}

const META_SOURCES = new Set(['facebook', 'fb', 'meta', 'instagram', 'ig', 'fb_ig', 'facebook_instagram']);

export function normalizeSource(source: string | null | undefined): string {
  if (!source) return 'unknown';
  const s = source.trim().toLowerCase();
  if (!s) return 'unknown';
  if (META_SOURCES.has(s)) return 'meta';
  return s;
}

function queryOf(url: string): URLSearchParams {
  try {
    // Landing site may be a path ("/products/x?utm_source=..") — give it a base.
    return new URL(url, 'https://shop.local').searchParams;
  } catch {
    return new URLSearchParams();
  }
}
