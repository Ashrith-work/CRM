export * from './permissions';
export * from './schemas';

/** Shared API constants so clients never hardcode the version prefix. */
export const API_PREFIX = 'api/v1';
export const API_ROUTES = {
  health: `/${API_PREFIX}/health`,
  me: `/${API_PREFIX}/me`,
} as const;
