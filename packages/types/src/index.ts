export * from './permissions';
export * from './schemas';
export * from './crm';
export * from './deals';
export * from './tasks';
export * from './notifications';
export * from './users';
export * from './dashboard';
export * from './calls';
export * from './integrations';
export * from './commerce';
export * from './customer360';
export * from './glossary';
export * from './analytics';
export * from './campaigns';
export * from './assistant';
export * from './ads';

/** Shared API constants so clients never hardcode the version prefix. */
export const API_PREFIX = 'api/v1';
export const API_ROUTES = {
  health: `/${API_PREFIX}/health`,
  me: `/${API_PREFIX}/me`,
  // Milestone 1 — CRM. Collection roots; append `/:id` and query strings client-side.
  contacts: `/${API_PREFIX}/contacts`,
  companies: `/${API_PREFIX}/companies`,
  leads: `/${API_PREFIX}/leads`,
  tags: `/${API_PREFIX}/tags`,
  notes: `/${API_PREFIX}/notes`,
  activity: `/${API_PREFIX}/activity`,
  customFields: `/${API_PREFIX}/custom-fields`,
  // Milestone 2 — revenue layer.
  pipelines: `/${API_PREFIX}/pipelines`,
  stages: `/${API_PREFIX}/stages`,
  deals: `/${API_PREFIX}/deals`,
  // Milestone 3 — activity, reminders, notifications.
  tasks: `/${API_PREFIX}/tasks`,
  agenda: `/${API_PREFIX}/tasks/agenda`,
  notifications: `/${API_PREFIX}/notifications`,
  pushTokens: `/${API_PREFIX}/push-tokens`,
  users: `/${API_PREFIX}/users`,
  // Milestone 4 — dashboard + reporting (read-only aggregates).
  dashboard: `/${API_PREFIX}/dashboard`,
  // Milestone 5 — call management.
  calls: `/${API_PREFIX}/calls`,
  consents: `/${API_PREFIX}/consents`,
  myoperatorWebhook: `/${API_PREFIX}/webhooks/myoperator`,
  // M0 retrofit — integrations.
  integrations: `/${API_PREFIX}/integrations`,
  // M1 commerce — Shopify ingestion.
  ingestion: `/${API_PREFIX}/ingestion`,
  shopifyWebhook: `/${API_PREFIX}/webhooks/shopify`,
  customersMerge: `/${API_PREFIX}/customers/merge`,
  // M2 Customer 360.
  customers: `/${API_PREFIX}/customers`,
  // M3 analytics + segmentation.
  analytics: `/${API_PREFIX}/analytics`,
  segments: `/${API_PREFIX}/segments`,
  // M4 abandoned-cart recovery.
  campaigns: `/${API_PREFIX}/campaigns`,
  resendWebhook: `/${API_PREFIX}/webhooks/resend`,
  // P2.2 read-only AI assistant.
  assistant: `/${API_PREFIX}/assistant`,
  // P2.3 Meta ads + attribution + audiences.
  ads: `/${API_PREFIX}/ads`,
  attribution: `/${API_PREFIX}/attribution`,
  audiences: `/${API_PREFIX}/audiences`,
  // P2.1 deep analytics (revenue/cohorts/clv/churn/margin) share /analytics.
} as const;
