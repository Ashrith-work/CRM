import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { META_GRAPH_VERSION_DEFAULT } from './ads.constants';

const MAX_RETRIES = 6;

export interface MetaConn {
  adAccountId: string; // act_<id>
  businessId: string | null;
  accessToken: string;
  apiVersion: string;
}

type Graph = Record<string, unknown>;

/**
 * Meta Marketing (Graph) API client. Isolates all provider I/O behind a system-
 * user access token pinned to a Graph version. Like the Shopify client, "mock /
 * not_connected mode" = `connection()` returns null when the token/account is
 * unset, and callers degrade gracefully (no fake data). Handles cursor
 * pagination and backs off on HTTP 429/5xx and Graph throttling error codes.
 */
@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  apiVersion(): string {
    return this.config.get('META_GRAPH_VERSION', { infer: true }) || META_GRAPH_VERSION_DEFAULT;
  }

  /** Resolve the connection from Integration config (adAccountId/businessId) + env token. */
  connection(cfg?: { adAccountId?: string | null; businessId?: string | null }): MetaConn | null {
    const rawAccount = cfg?.adAccountId || this.config.get('META_AD_ACCOUNT_ID', { infer: true });
    const accessToken = this.config.get('META_ACCESS_TOKEN', { infer: true });
    if (!rawAccount || !accessToken) return null;
    const adAccountId = rawAccount.startsWith('act_') ? rawAccount : `act_${rawAccount}`;
    return {
      adAccountId,
      businessId: cfg?.businessId || this.config.get('META_BUSINESS_ID', { infer: true }) || null,
      accessToken,
      apiVersion: this.apiVersion(),
    };
  }

  /** Cheap credential check — the ad account name/currency/status. */
  async getAdAccount(conn: MetaConn): Promise<{ id: string; name: string; currency: string; status: string }> {
    const json = (await this.get(conn, conn.adAccountId, { fields: 'name,currency,account_status' })) as Graph;
    return {
      id: conn.adAccountId,
      name: (json.name as string) ?? conn.adAccountId,
      currency: (json.currency as string) ?? 'INR',
      status: String(json.account_status ?? ''),
    };
  }

  /** List a hierarchy edge (campaigns/adsets/ads/adcreatives) under the account. */
  async listEdge(conn: MetaConn, edge: 'campaigns' | 'adsets' | 'ads' | 'adcreatives', fields: string): Promise<Graph[]> {
    return this.paginate(conn, `${conn.adAccountId}/${edge}`, { fields, limit: '200' });
  }

  /**
   * Daily Insights for a level (campaign/adset/ad), one row per entity per day.
   * `since`/`until` are YYYY-MM-DD in the account timezone.
   */
  async insights(conn: MetaConn, level: 'campaign' | 'adset' | 'ad', since: string, until: string): Promise<Graph[]> {
    return this.paginate(conn, `${conn.adAccountId}/insights`, {
      level,
      time_increment: '1',
      time_range: JSON.stringify({ since, until }),
      fields: `${level}_id,spend,impressions,clicks,actions`,
      limit: '200',
    });
  }

  /** Lead-Ads submissions for a form (leads_retrieval). */
  async formLeads(conn: MetaConn, formId: string): Promise<Graph[]> {
    return this.paginate(conn, `${formId}/leads`, { fields: 'id,created_time,field_data,campaign_id,adset_id,ad_id,form_id', limit: '200' });
  }

  /** Lead-gen forms on the account (to enumerate before pulling leads). */
  async leadForms(conn: MetaConn): Promise<Graph[]> {
    return this.paginate(conn, `${conn.adAccountId}/leadgen_forms`, { fields: 'id,name', limit: '200' });
  }

  /** Create a Custom or Suppression (same object; used as exclusion) audience. */
  async createCustomAudience(conn: MetaConn, name: string, description: string): Promise<string> {
    const json = (await this.post(conn, `${conn.adAccountId}/customaudiences`, {
      name,
      description,
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
    })) as Graph;
    return String(json.id);
  }

  /**
   * Upload hashed users to an audience. `schema` names the identifier columns
   * (e.g. ['EMAIL_SHA256','PHONE_SHA256']); `data` rows are already SHA-256 hex.
   */
  async addUsers(conn: MetaConn, audienceId: string, schema: string[], data: string[][]): Promise<void> {
    await this.post(conn, `${audienceId}/users`, {
      payload: JSON.stringify({ schema, data }),
    });
  }

  // ----- HTTP core --------------------------------------------------------
  private base(conn: MetaConn): string {
    return `https://graph.facebook.com/${conn.apiVersion}`;
  }

  private async get(conn: MetaConn, path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${this.base(conn)}/${path}?${new URLSearchParams({ ...params, access_token: conn.accessToken }).toString()}`;
    return this.request(url, { method: 'GET' });
  }

  private async post(conn: MetaConn, path: string, body: Record<string, string>): Promise<unknown> {
    const url = `${this.base(conn)}/${path}`;
    const form = new URLSearchParams({ ...body, access_token: conn.accessToken });
    return this.request(url, { method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  }

  /** Follow `paging.next` cursors, collecting every `data[]` row. */
  private async paginate(conn: MetaConn, path: string, params: Record<string, string>): Promise<Graph[]> {
    let url: string | null = `${this.base(conn)}/${path}?${new URLSearchParams({ ...params, access_token: conn.accessToken }).toString()}`;
    const out: Graph[] = [];
    for (let page = 0; page < 10_000 && url; page++) {
      const json = (await this.request(url, { method: 'GET' })) as { data?: Graph[]; paging?: { next?: string } };
      if (Array.isArray(json.data)) out.push(...json.data);
      url = json.paging?.next ?? null;
    }
    return out;
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON */
      }
      const graphError = (json as { error?: { code?: number; message?: string } } | null)?.error;
      const throttled = res.status === 429 || res.status >= 500 || (graphError?.code != null && THROTTLE_CODES.has(graphError.code));

      if (throttled) {
        if (attempt === MAX_RETRIES) throw new Error(`Meta ${res.status}/${graphError?.code ?? ''} after ${MAX_RETRIES} retries`);
        const retryAfter = Number(res.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        this.logger.warn(`Meta throttle (${res.status}/${graphError?.code ?? ''}) — backing off ${backoff}ms (attempt ${attempt + 1})`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok || graphError) throw new Error(`Meta ${res.status}: ${graphError?.message ?? text.slice(0, 200)}`);
      return json;
    }
    throw new Error('Meta request exhausted retries');
  }
}

/** Graph API rate-limit / transient error codes worth retrying. */
const THROTTLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
