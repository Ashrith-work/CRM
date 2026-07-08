import { GLOSSARY_REGISTRY, GLOSSARY_VERSION, resolveGlossary } from '@crm/types';

describe('glossary registry (single source of truth for metric meaning)', () => {
  it('resolves a known metric to its plain-language + formula + window', () => {
    const net = resolveGlossary('net_revenue');
    expect(net).not.toBeNull();
    expect(net!.plainLanguage).toMatch(/after refunds/i);
    expect(net!.formula).toContain('refundedMinor');
    expect(net!.dataWindow).toBe('lifetime');
  });

  it('returns null for an unknown metric', () => {
    expect(resolveGlossary('does_not_exist')).toBeNull();
  });

  it('every registry entry is self-consistent (metricKey matches its key) and versioned', () => {
    expect(GLOSSARY_VERSION).toBeGreaterThanOrEqual(1);
    for (const [key, entry] of Object.entries(GLOSSARY_REGISTRY)) {
      expect(entry.metricKey).toBe(key);
      expect(entry.plainLanguage.length).toBeGreaterThan(0);
    }
  });
});
