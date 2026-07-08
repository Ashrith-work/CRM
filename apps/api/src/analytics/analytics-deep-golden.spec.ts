import { PrismaClient } from '@prisma/client';
import { RfmRefreshService } from './rfm-refresh.service';
import type { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(90_000); // DB-backed; runs the real materialized views.

/**
 * GOLDEN DATASET for the P2.1 views — hand-computed CLV bands, cohort retention %
 * (incl. period-0 boundary), and contribution margin BOTH with COGS (real) and
 * without (estimate). Runs the actual materialized views against Postgres.
 */
const prisma = new PrismaClient();
const rfm = new RfmRefreshService(prisma as unknown as PrismaService);

const SLUGS = ['p21-clv', 'p21-cohort', 'p21-margin-est', 'p21-margin-real'];
const ids: Record<string, string> = {};
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function org(slug: string, hasCogs = false) {
  const o = await prisma.organization.create({ data: { name: slug, slug, timezone: 'UTC', hasCogs } });
  ids[slug] = o.id;
  return o.id;
}
async function order(orgId: string, ext: string, customerId: string | null, totalMinor: number, placedAt: Date, refundedMinor = 0) {
  return prisma.order.create({ data: { organizationId: orgId, externalId: ext, customerId, status: 'PAID', financialStatus: 'PAID', totalMinor, refundedMinor, currency: 'INR', placedAt } });
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { in: SLUGS } } });

  // --- CLV: 5 customers netting 1000..5000 → tertiles Low/Low/Mid/Mid/High ---
  const clv = await org('p21-clv');
  const nets = { A: 1000, B: 2000, C: 3000, D: 4000, E: 5000 };
  for (const [c, net] of Object.entries(nets)) {
    await prisma.customer.create({ data: { id: `${clv}_${c}`, organizationId: clv, externalId: `c_${c}` } });
    await order(clv, `o_${c}`, `${clv}_${c}`, net, d('2026-03-01'));
  }

  // --- Cohort: X (Jan,Feb,Mar), Y (Jan,Feb), Z (Jan) → Jan cohort of 3 ---
  const co = await org('p21-cohort');
  for (const c of ['X', 'Y', 'Z']) await prisma.customer.create({ data: { id: `${co}_${c}`, organizationId: co, externalId: `c_${c}` } });
  await order(co, 'x0', `${co}_X`, 1000, d('2026-01-15'));
  await order(co, 'x1', `${co}_X`, 1000, d('2026-02-15'));
  await order(co, 'x2', `${co}_X`, 1000, d('2026-03-15'));
  await order(co, 'y0', `${co}_Y`, 1000, d('2026-01-20'));
  await order(co, 'y1', `${co}_Y`, 1000, d('2026-02-20'));
  await order(co, 'z0', `${co}_Z`, 1000, d('2026-01-25'));

  // --- Margin estimate (no COGS): net 1000 → margin 1000, is_estimate=true ---
  const est = await org('p21-margin-est', false);
  await order(est, 'e0', null, 1000, d('2026-04-01'));

  // --- Margin real (COGS): total 1000, 2 items @ cost 300 → margin 400 ---
  const real = await org('p21-margin-real', true);
  const prod = await prisma.product.create({ data: { organizationId: real, externalId: 'p1', title: 'Tee', costMinor: 300 } });
  const ro = await order(real, 'r0', null, 1000, d('2026-04-01'));
  await prisma.orderItem.createMany({
    data: [
      { organizationId: real, orderId: ro.id, productId: prod.id, title: 'Tee', quantity: 1, priceMinor: 500 },
      { organizationId: real, orderId: ro.id, productId: prod.id, title: 'Tee', quantity: 1, priceMinor: 500 },
    ],
  });

  await rfm.refreshAnalyticsViews();
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { slug: { in: SLUGS } } });
  await prisma.$disconnect();
});

describe('customer_clv bands (tertiles)', () => {
  it('bands 5 customers Low/Low/Mid/Mid/High by ascending CLV', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ customer_id: string; clv_minor: bigint; clv_band: string }>>(
      `SELECT customer_id, clv_minor, clv_band FROM customer_clv WHERE organization_id = '${ids['p21-clv']}'`,
    );
    const band = Object.fromEntries(rows.map((r) => [r.customer_id.split('_').pop(), r.clv_band]));
    expect(band).toEqual({ A: 'Low', B: 'Low', C: 'Mid', D: 'Mid', E: 'High' });
    expect(rows.find((r) => r.customer_id.endsWith('_E'))!.clv_minor).toBe(5000n);
  });
});

describe('cohort_retention', () => {
  it('Jan cohort of 3: period 0 = 100%, period 1 = 66.67%, period 2 = 33.33%', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ period_number: number; cohort_size: number; active_customers: number; retention_pct: string }>>(
      `SELECT period_number, cohort_size, active_customers, retention_pct FROM cohort_retention WHERE organization_id = '${ids['p21-cohort']}' ORDER BY period_number`,
    );
    expect(rows.map((r) => r.period_number)).toEqual([0, 1, 2]);
    expect(rows.every((r) => r.cohort_size === 3)).toBe(true);
    expect(rows.map((r) => Number(r.retention_pct))).toEqual([100, 66.67, 33.33]);
    expect(rows.map((r) => r.active_customers)).toEqual([3, 2, 1]);
  });
});

describe('contribution_margin (real vs estimate)', () => {
  it('estimate org (no COGS): margin = net revenue, is_estimate = true', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ margin_minor: bigint; cogs_minor: bigint; is_estimate: boolean }>>(
      `SELECT margin_minor, cogs_minor, is_estimate FROM contribution_margin WHERE organization_id = '${ids['p21-margin-est']}'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].margin_minor)).toBe(1000);
    expect(Number(rows[0].cogs_minor)).toBe(0);
    expect(rows[0].is_estimate).toBe(true);
  });

  it('real org (COGS): margin = net − COGS (1000 − 600 = 400), is_estimate = false', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ margin_minor: bigint; cogs_minor: bigint; is_estimate: boolean }>>(
      `SELECT margin_minor, cogs_minor, is_estimate FROM contribution_margin WHERE organization_id = '${ids['p21-margin-real']}'`,
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].cogs_minor)).toBe(600);
    expect(Number(rows[0].margin_minor)).toBe(400);
    expect(rows[0].is_estimate).toBe(false);
  });
});
