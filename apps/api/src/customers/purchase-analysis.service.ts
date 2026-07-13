import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomerSuggestion,
  LookupResponse,
  PurchaseProfile,
  PurchaseOrderRow,
} from '@crm/types';
import { Prisma, type Customer as CustomerRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomerPiiService } from './customer-pii.service';
import { maskEmail, maskPhone } from '../common/pii.util';
import { assembleOrderRow, type LineItemForRow, type ProductMeta } from './purchase-analysis.math';

// Name/phone search can't push down to SQL over encrypted columns — scan a bounded
// candidate set and filter on the decrypted value (same cap as the customer list).
const SEARCH_SCAN_CAP = 1000;
const PAID = ['PAID', 'FULFILLED'] as const;

/**
 * Purchase Analysis Dashboard reads: look up a customer by phone / email / name
 * (typeahead), and assemble their last + 2nd-last order profile. Reuses the
 * encrypted-PII + match-hash patterns; all PII masked unless the caller has
 * pii:read. Never recomputes RFM — reads CustomerFeatures.
 */
@Injectable()
export class PurchaseAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pii: CustomerPiiService,
    private readonly audit: AuditService,
  ) {}

  // ----- Typeahead --------------------------------------------------------
  /** Suggestions as the user types: email → hash exact; phone → hash exact; else
   *  a bounded decrypt-scan on the name. RBAC-scoped + PII-masked. */
  async suggest(organizationId: string, q: string, unmasked: boolean, limit: number): Promise<CustomerSuggestion[]> {
    const term = q.trim();
    if (!term) return [];

    let rows: CustomerRow[];
    const emailHash = term.includes('@') ? this.pii.emailHashOf(term) : null;
    const phoneHash = !emailHash && looksLikePhone(term) ? this.pii.phoneHashOf(term) : null;
    if (emailHash) {
      rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { emailHash }), take: limit });
    } else if (phoneHash) {
      rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { phoneHash }), take: limit });
    } else {
      rows = (await this.nameMatches(organizationId, term)).slice(0, limit);
    }
    return this.toSuggestions(organizationId, rows, unmasked);
  }

  // ----- Lookup (resolve to one customer or a disambiguation list) ---------
  async lookup(organizationId: string, q: string, unmasked: boolean): Promise<LookupResponse> {
    const term = q.trim();
    const emailHash = term.includes('@') ? this.pii.emailHashOf(term) : null;
    if (emailHash) {
      const rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { emailHash }), take: 10 });
      const suggestions = await this.toSuggestions(organizationId, rows, unmasked);
      return { matchedBy: 'email', match: suggestions[0] ?? null, candidates: suggestions.length > 1 ? suggestions : [] };
    }
    if (looksLikePhone(term)) {
      const phoneHash = this.pii.phoneHashOf(term);
      if (phoneHash) {
        const rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { phoneHash }), take: 10 });
        const suggestions = await this.toSuggestions(organizationId, rows, unmasked);
        return { matchedBy: 'phone', match: suggestions[0] ?? null, candidates: suggestions.length > 1 ? suggestions : [] };
      }
    }
    // Name: decrypt-scan → exact-one resolves, several disambiguate, none = no match.
    const matches = (await this.nameMatches(organizationId, term)).slice(0, 25);
    const suggestions = await this.toSuggestions(organizationId, matches, unmasked);
    if (suggestions.length === 1) return { matchedBy: 'name', match: suggestions[0], candidates: [] };
    if (suggestions.length > 1) return { matchedBy: 'name', match: null, candidates: suggestions };
    return { matchedBy: 'none', match: null, candidates: [] };
  }

  // ----- Purchase profile (last + 2nd-last order) -------------------------
  async profile(organizationId: string, id: string, unmasked: boolean, actorUserId?: string): Promise<PurchaseProfile> {
    const customer = await this.resolveSurvivor(organizationId, id);
    const features = await this.prisma.customerFeatures.findUnique({
      where: { organizationId_customerId: { organizationId, customerId: customer.id } },
    });

    const orders = await this.prisma.order.findMany({
      where: { organizationId, customerId: customer.id, deletedAt: null, status: { in: [...PAID] } },
      include: { items: { select: { title: true, variant: true, quantity: true, priceMinor: true, productId: true } } },
      orderBy: { placedAt: 'desc' },
      take: 2, // last + 2nd-last
    });

    // Product metadata (type + tags) for the fabric/product-type fields.
    const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId).filter((v): v is string => !!v)))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, productType: true, tags: true } })
      : [];
    const meta = new Map<string, ProductMeta>(products.map((p) => [p.id, { productType: p.productType, tags: p.tags }]));

    const segment = features?.rSegment ?? null;
    const rows: PurchaseOrderRow[] = orders.map((o) =>
      assembleOrderRow(o, o.items as LineItemForRow[], meta, segment),
    );

    const revealed = this.pii.reveal(customer);
    if (unmasked) {
      await this.audit.record({
        organizationId,
        actorUserId: actorUserId ?? null,
        action: 'customer.pii.reveal',
        entity: 'Customer',
        entityId: customer.id,
        after: { surface: 'purchase-analysis', fields: ['email', 'phone', 'name'] },
      });
    }
    const name = (this.pii.revealName(customer) ?? '') || (unmasked ? revealed.email : maskEmail(revealed.email)) || customer.externalId || customer.id;

    return {
      customer: {
        id: customer.id,
        name,
        email: unmasked ? revealed.email : maskEmail(revealed.email),
        phone: unmasked ? revealed.phone : maskPhone(revealed.phone),
        externalId: customer.externalId,
        totalOrders: features?.orderCount ?? 0,
        netRevenueMinor: features?.netRevenueMinor ?? 0,
        currency: features?.currency ?? null,
        segment,
        clvMinor: features?.clvMinor ?? null,
        clvBand: features?.clvBand ?? null,
        lastOrderAt: features?.lastOrderAt ? features.lastOrderAt.toISOString() : null,
        masked: !unmasked,
      },
      orders: rows,
    };
  }

  // ----- helpers ----------------------------------------------------------
  private baseWhere(organizationId: string, extra: Prisma.CustomerWhereInput = {}): Prisma.CustomerWhereInput {
    return { organizationId, deletedAt: null, mergedIntoId: null, ...extra };
  }

  /**
   * Name matches over encrypted names: encrypted columns can't be SQL-searched, so
   * we scan a bounded candidate set and filter on the decrypted name. We prioritise
   * the customers most likely to be looked up — BUYERS, highest-value first (the
   * indexed CustomerFeatures.netRevenueMinor) — so Champions/active customers fall
   * inside the window. Customers with no orders (no features) aren't relevant here.
   * NOTE: still a bounded scan; a match beyond the cap can be missed — use email or
   * phone (exact hash match) for a guaranteed resolve.
   */
  private async nameMatches(organizationId: string, term: string): Promise<CustomerRow[]> {
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId },
      orderBy: { netRevenueMinor: 'desc' },
      take: SEARCH_SCAN_CAP,
      select: { customerId: true },
    });
    const customers = await this.prisma.customer.findMany({
      where: this.baseWhere(organizationId, { id: { in: feats.map((f) => f.customerId) } }),
    });
    // Preserve the value-desc order from features.
    const rank = new Map(feats.map((f, i) => [f.customerId, i]));
    customers.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    const needle = term.toLowerCase();
    return customers.filter((c) => (this.pii.revealName(c) ?? '').toLowerCase().includes(needle));
  }

  private async toSuggestions(organizationId: string, rows: CustomerRow[], unmasked: boolean): Promise<CustomerSuggestion[]> {
    if (!rows.length) return [];
    const feats = await this.prisma.customerFeatures.findMany({
      where: { organizationId, customerId: { in: rows.map((r) => r.id) } },
      select: { customerId: true, orderCount: true },
    });
    const orderCountById = new Map(feats.map((f) => [f.customerId, f.orderCount]));
    return rows.map((c) => {
      const { email } = this.pii.reveal(c);
      const maskedEmail = unmasked ? email : maskEmail(email);
      // Name is shown for identification (as in the customer list); email masked
      // per role. Never let an unmasked email leak through the name fallback.
      const name = (this.pii.revealName(c) ?? '') || maskedEmail || c.externalId || c.id;
      return { id: c.id, name, email: maskedEmail, externalId: c.externalId, orderCount: orderCountById.get(c.id) ?? 0 };
    });
  }

  /** Follow a merged customer to its survivor. */
  private async resolveSurvivor(organizationId: string, id: string): Promise<CustomerRow> {
    const first = await this.prisma.customer.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!first) throw new NotFoundException('Customer not found');
    let current = first;
    let guard = 0;
    while (current.mergedIntoId && guard++ < 20) {
      const next = await this.prisma.customer.findFirst({ where: { id: current.mergedIntoId, organizationId } });
      if (!next) break;
      current = next;
    }
    return current;
  }
}

/** Heuristic: a phone-ish query (digits + separators, ≥7 digits). */
function looksLikePhone(q: string): boolean {
  const digits = q.replace(/\D/g, '');
  return /^[+\d][\d\s\-()]{6,}$/.test(q.trim()) && digits.length >= 7;
}
