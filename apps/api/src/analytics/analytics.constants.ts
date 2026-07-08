/** BullMQ queue for the nightly RFM + dynamic-segment refresh. */
export const ANALYTICS_QUEUE = 'analytics';
export const RFM_REFRESH_JOB_ID = 'rfm-refresh-repeat';

export interface AnalyticsRefreshJob {
  type: 'refresh';
}
