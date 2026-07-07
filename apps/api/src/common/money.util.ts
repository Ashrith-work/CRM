/**
 * Parse a money STRING into integer minor units — never via floating point.
 * "1234.50" → 123450 (paise). Splits on the decimal point and does integer math
 * on the parts, so there is no float drift. `decimals` defaults to 2 (paise/cents);
 * pass 0 for JPY-style or 3 for BHD-style currencies.
 */
export function parseMinor(value: string | number | null | undefined, decimals = 2): number {
  if (value == null) return 0;
  const s = String(value).trim();
  if (!s) return 0;

  const m = s.match(/^(-)?(\d+)?(?:\.(\d+))?$/);
  if (!m) return 0;

  const negative = m[1] === '-';
  const intPart = m[2] ?? '0';
  const fracRaw = m[3] ?? '';
  // Pad/truncate the fraction to exactly `decimals` digits (Shopify sends 2).
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);

  const minor = Number(intPart) * 10 ** decimals + Number(frac || '0');
  return negative ? -minor : minor;
}

/** Sum a list of money strings into minor units (e.g. refund transactions). */
export function sumMinor(values: Array<string | number | null | undefined>, decimals = 2): number {
  return values.reduce<number>((acc, v) => acc + parseMinor(v, decimals), 0);
}
