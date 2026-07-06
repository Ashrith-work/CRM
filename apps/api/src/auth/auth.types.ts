import type { Request } from 'express';

/** Raw identity extracted from a verified Clerk token. */
export interface RequestAuth {
  clerkUserId: string;
  clerkOrgId: string | null;
  sessionId?: string;
}

/** Fully resolved application context for the current request. */
export interface UserContext {
  user: {
    id: string;
    clerkUserId: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  organization: { id: string; name: string; slug: string };
  team: { id: string; name: string } | null;
  role: { id: string; name: string; permissions: string[] };
  /** Flattened permission keys for O(1) checks in the RBAC guard. */
  permissions: string[];
}

/** Express request augmented by the auth pipeline. */
export interface AuthenticatedRequest extends Request {
  auth?: RequestAuth;
  userContext?: UserContext;
}

/** Subset of Clerk JWT claims we rely on. */
export interface ClerkClaims {
  sub: string;
  org_id?: string;
  org_role?: string;
  org_slug?: string;
  sid?: string;
  [key: string]: unknown;
}
