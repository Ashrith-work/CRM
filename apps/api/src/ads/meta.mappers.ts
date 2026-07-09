import type { AdEntityType } from '@prisma/client';
import { parseMinor } from '../common/money.util';
import { normalizeEmail } from '../ingestion/shopify.mappers';
import { normalizeE164 } from '../common/phone.util';

/**
 * Meta Graph → CRM field mappers. PURE + unit-tested. Spend is a decimal STRING
 * from Meta → integer minor units via parseMinor (same as Shopify). Conversions
 * are summed from purchase-type `actions` (Meta-REPORTED; over-reports).
 */

type Graph = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

export interface MappedMetric {
  entityType: AdEntityType;
  entityId: string;
  date: Date;
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/** Action types that count as a conversion/purchase for our purposes. */
const CONVERSION_ACTIONS = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
  'web_in_store_purchase',
]);

export function sumConversions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions as Graph[]) {
    if (CONVERSION_ACTIONS.has(String(a.action_type))) total += Math.round(Number(a.value ?? 0));
  }
  return total;
}

/** Map one daily Insights row for a level to an AdMetricDaily record. */
export function mapInsight(level: 'campaign' | 'adset' | 'ad', raw: Graph): MappedMetric | null {
  const entityId = str(raw[`${level}_id`]);
  const dateStr = str(raw.date_start);
  if (!entityId || !dateStr) return null;
  return {
    entityType: level as AdEntityType,
    entityId,
    date: new Date(`${dateStr}T00:00:00.000Z`),
    spendMinor: parseMinor(raw.spend as string),
    impressions: Math.round(Number(raw.impressions ?? 0)),
    clicks: Math.round(Number(raw.clicks ?? 0)),
    conversions: sumConversions(raw.actions),
  };
}

export interface MappedEntity {
  externalId: string;
  name: string;
  status: string | null;
  objective?: string | null;
  accountExternalId?: string | null;
  campaignExternalId?: string | null;
  adsetExternalId?: string | null;
  creativeExternalId?: string | null;
  thumbnailUrl?: string | null;
}

export function mapCampaign(raw: Graph): MappedEntity {
  return { externalId: String(raw.id), name: (raw.name as string) ?? String(raw.id), status: str(raw.status), objective: str(raw.objective) };
}
export function mapAdSet(raw: Graph): MappedEntity {
  return { externalId: String(raw.id), name: (raw.name as string) ?? String(raw.id), status: str(raw.status), campaignExternalId: str(raw.campaign_id) };
}
export function mapAd(raw: Graph): MappedEntity {
  const creative = raw.creative as Graph | undefined;
  return {
    externalId: String(raw.id),
    name: (raw.name as string) ?? String(raw.id),
    status: str(raw.status),
    adsetExternalId: str(raw.adset_id),
    creativeExternalId: str(creative?.id),
  };
}
export function mapCreative(raw: Graph): MappedEntity {
  return { externalId: String(raw.id), name: (raw.name as string) ?? String(raw.id), status: null, thumbnailUrl: str(raw.thumbnail_url) };
}

export interface MappedLead {
  externalId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  formId: string | null;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  occurredAt: Date;
}

/** Map a Lead-Ads submission (field_data is [{name, values:[...]}]). */
export function mapLead(raw: Graph): MappedLead {
  const fields = new Map<string, string>();
  for (const f of (raw.field_data as Graph[]) ?? []) {
    const name = String(f.name ?? '').toLowerCase();
    const value = Array.isArray(f.values) ? String((f.values as unknown[])[0] ?? '') : '';
    if (name && value) fields.set(name, value);
  }
  const name = (fields.get('full_name') ?? [fields.get('first_name'), fields.get('last_name')].filter(Boolean).join(' ')) || null;
  return {
    externalId: String(raw.id),
    name,
    email: normalizeEmail(fields.get('email')),
    phone: normalizeE164(fields.get('phone_number') ?? fields.get('phone') ?? null),
    formId: str(raw.form_id),
    campaign: str(raw.campaign_id),
    adset: str(raw.adset_id),
    ad: str(raw.ad_id),
    occurredAt: parseTime(raw.created_time as string) ?? new Date(),
  };
}

function parseTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}
