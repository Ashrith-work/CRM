import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CustomerSuggestion,
  LookupResponse,
  PurchaseProfile,
  PurchaseOrderRow,
} from '@crm/types';
import { Prisma, type Customer as CustomerRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { CustomerPiiService } from './customer-pii.service';
import { maskEmail, maskPhone } from '../common/pii.util';
import { assembleOrderRow, type LineItemForRow, type ProductMeta } from './purchase-analysis.math';

/** Name search shortest useful query (trigram indexes want ≥ this). */
const MIN_QUERY_LEN = 2;
/** Cap of index-matched name rows we rank before returning. */
const NAME_MATCH_CAP = 60;
const PAID = ['PAID', 'FULFILLED'] as const;
const SUGGEST_TTL = 30; // s — typeahead payload
const PROFILE_TTL = 60; // s — masked profile (unmasked is never cached; it audits)

/**
 * Purchase Analysis Dashboard reads: look up a customer by phone / email / name
 * (typeahead), and assemble their last + 2nd-last order profile. Reuses the
 * encrypted-PII + match-hash patterns; all PII masked unless the caller has
 * pii:read. Name search uses the pg_trgm-indexed `nameSearch` column (one query,
 * no decrypt-scan). Payloads are Redis-cached (short TTL). Never recomputes RFM.
 */
@Injectable()
export class PurchaseAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly pii: CustomerPiiService,
    private readonly audit: AuditService,
  ) {}

  // ----- Typeahead --------------------------------------------------------
  /** Suggestions as the user types: email/phone → hash exact; name → indexed
   *  `nameSearch ILIKE`. RBAC-scoped + PII-masked. Cached (short TTL). */
  async suggest(organizationId: string, q: string, unmasked: boolean, limit: number): Promise<CustomerSuggestion[]> {
    const term = q.trim();
    if (term.length < MIN_QUERY_LEN) return [];

    const cacheKey = `pa:suggest:${organizationId}:${unmasked ? 'u' : 'm'}:${limit}:${term.toLowerCase()}`;
    const cached = await this.redis.cacheGet<CustomerSuggestion[]>(cacheKey);
    if (cached) return cached;

    let rows: CustomerRow[];
    const emailHash = term.includes('@') ? this.pii.emailHashOf(term) : null;
    const phoneHash = !emailHash && looksLikePhone(term) ? this.pii.phoneHashOf(term) : null;
    if (emailHash) {
      rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { emailHash }), take: limit });
    } else if (phoneHash) {
      rows = await this.prisma.customer.findMany({ where: this.baseWhere(organizationId, { phoneHash }), take: limit });
    } else {
      rows = await this.nameMatchRows(organizationId, term, NAME_MATCH_CAP);
    }
    // Rank by order count (buyers first) among the matches, then cap.
    const suggestions = (await this.toSuggestions(organizationId, rows, unmasked))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, limit);
    await this.redis.cacheSet(cacheKey, suggestions, SUGGEST_TTL);
    return suggestions;
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
    if (term.length < MIN_QUERY_LEN) return { matchedBy: 'none', match: null, candidates: [] };
    // Name: indexed match → exact-one resolves, several disambiguate, none = no match.
    const rows = await this.nameMatchRows(organizationId, term, 25);
    const suggestions = (await this.toSuggestions(organizationId, rows, unmasked)).sort((a, b) => b.orderCount - a.orderCount);
    if (suggestions.length === 1) return { matchedBy: 'name', match: suggestions[0], candidates: [] };
    if (suggestions.length > 1) return { matchedBy: 'name', match: null, candidates: suggestions };
    return { matchedBy: 'none', match: null, candidates: [] };
  }

  // ----- Purchase profile (last + 2nd-last order) -------------------------
  async profile(organizationId: string, id: string, unmasked: boolean, actorUserId?: string): Promise<PurchaseProfile> {
    // Only the masked payload is cached; the unmasked read is rebuilt each time so
    // raw PII never rests in Redis and every access audits (matches Customer 360).
    const cacheKey = `pa:profile:${organizationId}:${id}:m`;
    if (!unmasked) {
      const cached = await this.redis.cacheGet<PurchaseProfile>(cacheKey);
      if (cached) return cached;
    }

    const customer = await this.resolveSurvivor(organizationId, id);

    // features + orders are independent → fetch in parallel (fewer round trips).
    const [features, orders] = await Promise.all([
      this.prisma.customerFeatures.findUnique({
        where: { organizationId_customerId: { organizationId, customerId: customer.id } },
        select: { rSegment: true, orderCount: true, netRevenueMinor: true, currency: true, clvMinor: true, clvBand: true, lastOrderAt: true },
      }),
      this.prisma.order.findMany({
        where: { organizationId, customerId: customer.id, deletedAt: null, status: { in: [...PAID] } },
        select: {
          id: true, orderNumber: true, placedAt: true, totalMinor: true, refundedMinor: true, currency: true, discountCode: true, discountMinor: true,
          items: { select: { title: true, variant: true, quantity: true, priceMinor: true, productId: true } },
        },
        orderBy: { placedAt: 'desc' },
        take: 2, // last + 2nd-last only
      }),
    ]);

    const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId).filter((v): v is string => !!v)))];
    const products = productIds.length
      ? await this.prisma.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, productType: true, tags: true } })
      : [];
    const meta = new Map<string, ProductMeta>(products.map((p) => [p.id, { productType: p.productType, tags: p.tags }]));

    const segment = features?.rSegment ?? null;
    const rows: PurchaseOrderRow[] = orders.map((o) => assembleOrderRow(o, o.items as LineItemForRow[], meta, segment));

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

    const payload: PurchaseProfile = {
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
    if (!unmasked) await this.redis.cacheSet(cacheKey, payload, PROFILE_TTL);
    return payload;
  }

  // ----- helpers ----------------------------------------------------------
  private baseWhere(organizationId: string, extra: Prisma.CustomerWhereInput = {}): Prisma.CustomerWhereInput {
    return { organizationId, deletedAt: null, mergedIntoId: null, ...extra };
  }

  /**
   * Index-backed name match: `nameSearch ILIKE '%q%'` over the pg_trgm GIN index —
   * one query, no decrypt-scan. `nameSearch` is normalized lowercase, so we lower
   * the needle and use a case-sensitive `contains` (still hits the trigram index).
   */
  private async nameMatchRows(organizationId: string, term: string, cap: number): Promise<CustomerRow[]> {
    return this.prisma.customer.findMany({
      where: this.baseWhere(organizationId, { nameSearch: { contains: term.toLowerCase() } }),
      take: cap,
    });
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
      // Name shown for identification (as in the customer list); email masked per
      // role. Never let an unmasked email leak through the name fallback.
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
