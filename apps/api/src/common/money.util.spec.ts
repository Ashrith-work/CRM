import { parseMinor, sumMinor } from './money.util';

describe('parseMinor (string → integer minor units, no float)', () => {
  it('parses standard 2-decimal amounts exactly', () => {
    expect(parseMinor('1234.50')).toBe(123450);
    expect(parseMinor('0.05')).toBe(5);
    expect(parseMinor('1000')).toBe(100000);
    expect(parseMinor('19.99')).toBe(1999);
  });

  it('avoids float drift on classic offenders', () => {
    // 0.1 + 0.2 in float = 0.30000000000000004; string parse is exact.
    expect(parseMinor('0.10') + parseMinor('0.20')).toBe(30);
    expect(parseMinor('35.35')).toBe(3535); // 35.35*100 = 3534.9999… in float
  });

  it('pads a single decimal and truncates extra precision', () => {
    expect(parseMinor('12.5')).toBe(1250);
    expect(parseMinor('12.999')).toBe(1299); // truncates to 2dp
  });

  it('handles negatives, zero, blanks, and junk safely', () => {
    expect(parseMinor('-50.00')).toBe(-5000);
    expect(parseMinor('')).toBe(0);
    expect(parseMinor(null)).toBe(0);
    expect(parseMinor(undefined)).toBe(0);
    expect(parseMinor('abc')).toBe(0);
  });

  it('supports other minor-unit exponents', () => {
    expect(parseMinor('1000', 0)).toBe(1000); // JPY
    expect(parseMinor('1.234', 3)).toBe(1234); // BHD
  });

  it('sumMinor adds without drift', () => {
    expect(sumMinor(['10.10', '20.20', '0.70'])).toBe(3100);
  });
});
