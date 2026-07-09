/** The Meta provider key for the Integration row. */
export const META_PROVIDER = 'meta';

/** Pinned Graph API version — bump deliberately, never float. */
export const META_GRAPH_VERSION_DEFAULT = 'v21.0';

/** BullMQ queue: daily metrics pull, Lead-Ads import, attribution view refresh,
 * and the nightly audience re-sync (so withdrawn consent propagates). */
export const ADS_QUEUE = 'meta-ads';

export const META_METRICS_JOB_ID = 'meta-metrics-repeat';
export const META_LEADS_JOB_ID = 'meta-leads-repeat';
export const ADS_REFRESH_JOB_ID = 'ads-refresh-repeat';
export const AUDIENCE_RESYNC_JOB_ID = 'audience-resync-repeat';

/** Ads worker job discriminants. */
export type AdsJob =
  | { type: 'metrics'; organizationId?: string }
  | { type: 'leads'; organizationId?: string }
  | { type: 'refresh' }
  | { type: 'audiences' };
