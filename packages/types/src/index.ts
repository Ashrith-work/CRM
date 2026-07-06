export * from './permissions';
export * from './schemas';
export * from './crm';
export * from './deals';

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
} as const;
