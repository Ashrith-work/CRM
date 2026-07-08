import {
  API_ROUTES,
  ActivityListResponseSchema,
  CompanyListResponseSchema,
  CompanySchema,
  ContactListResponseSchema,
  ContactSchema,
  ConvertLeadResponseSchema,
  LeadListResponseSchema,
  LeadSchema,
  MeResponseSchema,
  NoteListResponseSchema,
  NoteSchema,
  type ActivityListResponse,
  type Company,
  type CompanyListResponse,
  type Contact,
  type ContactListResponse,
  type ConvertLeadInput,
  type ConvertLeadResponse,
  type CreateContactInput,
  type CreateLeadInput,
  type Lead,
  type LeadListResponse,
  type LeadStatus,
  type MeResponse,
  type Note,
  type NoteListResponse,
  BoardResponseSchema,
  DealListResponseSchema,
  DealSchema,
  PipelineListResponseSchema,
  PipelineSchema,
  type BoardResponse,
  type CreateDealInput,
  type Deal,
  type DealListResponse,
  type MoveDealInput,
  type Pipeline,
  type PipelineListResponse,
  type ReopenDealInput,
  type UpdateDealInput,
  // Milestone 3 — tasks, reminders, notifications, push, users.
  TaskSchema,
  TaskListResponseSchema,
  AgendaResponseSchema,
  NotificationSchema,
  NotificationListResponseSchema,
  UnreadCountResponseSchema,
  PushTokenSchema,
  OrgUserListResponseSchema,
  // Milestone 4 — dashboard.
  SalesTilesSchema,
  type SalesTiles,
  // Milestone 5 — calls, recordings, consent.
  CallSchema,
  CallListResponseSchema,
  RecordingUrlResponseSchema,
  ConsentSchema,
  ConsentListResponseSchema,
  type Call,
  type CallListResponse,
  type ClickToCallInput,
  type LogCallInput,
  type UpdateCallInput,
  type RecordingUrlResponse,
  type Consent,
  type ConsentListResponse,
  type SetConsentInput,
  type Task,
  type TaskListResponse,
  type AgendaResponse,
  type CreateTaskInput,
  type UpdateTaskInput,
  type CompleteTaskInput,
  type SnoozeTaskInput,
  type ReassignTaskInput,
  type Notification,
  type NotificationListResponse,
  type UnreadCountResponse,
  type PushToken,
  type RegisterPushTokenInput,
  type OrgUserListResponse,
} from '@crm/types';
import type { ZodSchema } from 'zod';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Base API URL (used by the Socket.io client + push registration). */
export function apiBaseUrl(): string {
  return API_URL;
}

/**
 * Fetches a FRESH Clerk token immediately before each request. Callers pass the
 * Clerk SDK's `getToken` (never a pre-fetched string) so tokens are never cached
 * and auto-refresh after idle. `getToken({ skipCache: true })` forces a refresh.
 */
export type TokenGetter = (opts?: { skipCache?: boolean; template?: string }) => Promise<string | null>;

/** Thrown when there is no valid session even after a refresh — prompt re-auth. */
export class ApiAuthError extends Error {
  constructor(message = 'Your session has expired — please sign in again.') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

// ---------------------------------------------------------------------------
// Shared request core. Fresh token per request; on a 401, refresh the token
// (skipCache) and retry EXACTLY ONCE before surfacing ApiAuthError.
// ---------------------------------------------------------------------------
async function requestWithRetry(getToken: TokenGetter, path: string, init: RequestInit): Promise<Response> {
  const doFetch = async (skipCache: boolean): Promise<Response> => {
    const token = await getToken(skipCache ? { skipCache: true } : undefined);
    if (!token) throw new ApiAuthError();
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  };
  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true); // one silent refresh + retry
  if (res.status === 401) throw new ApiAuthError();
  return res;
}

async function authedGet<T>(getToken: TokenGetter, path: string, schema: ZodSchema<T>): Promise<T> {
  const res = await requestWithRetry(getToken, path, {});
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

async function authedSend<T>(
  getToken: TokenGetter,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  schema: ZodSchema<T>,
): Promise<T> {
  const res = await requestWithRetry(getToken, path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

/** DELETE that tolerates a 204/empty body (no response parsing). */
async function authedDelete(getToken: TokenGetter, path: string, body?: unknown): Promise<void> {
  const res = await requestWithRetry(getToken, path, {
    method: 'DELETE',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export interface ListParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

function listQuery(params: ListParams): string {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// Me (unchanged).
// ---------------------------------------------------------------------------
export function fetchMe(getToken: TokenGetter): Promise<MeResponse> {
  return authedGet(getToken, API_ROUTES.me, MeResponseSchema);
}

// ---------------------------------------------------------------------------
// Contacts.
// ---------------------------------------------------------------------------
export function listContacts(getToken: TokenGetter, params: ListParams = {}): Promise<ContactListResponse> {
  return authedGet(getToken, `${API_ROUTES.contacts}${listQuery(params)}`, ContactListResponseSchema);
}
export function getContact(getToken: TokenGetter, id: string): Promise<Contact> {
  return authedGet(getToken, `${API_ROUTES.contacts}/${id}`, ContactSchema);
}
export function createContact(getToken: TokenGetter, body: CreateContactInput): Promise<Contact> {
  return authedSend(getToken, API_ROUTES.contacts, 'POST', body, ContactSchema);
}

// ---------------------------------------------------------------------------
// Companies.
// ---------------------------------------------------------------------------
export function listCompanies(getToken: TokenGetter, params: ListParams = {}): Promise<CompanyListResponse> {
  return authedGet(getToken, `${API_ROUTES.companies}${listQuery(params)}`, CompanyListResponseSchema);
}
export function getCompany(getToken: TokenGetter, id: string): Promise<Company> {
  return authedGet(getToken, `${API_ROUTES.companies}/${id}`, CompanySchema);
}

// ---------------------------------------------------------------------------
// Leads.
// ---------------------------------------------------------------------------
export function listLeads(getToken: TokenGetter, params: ListParams = {}): Promise<LeadListResponse> {
  return authedGet(getToken, `${API_ROUTES.leads}${listQuery(params)}`, LeadListResponseSchema);
}
export function getLead(getToken: TokenGetter, id: string): Promise<Lead> {
  return authedGet(getToken, `${API_ROUTES.leads}/${id}`, LeadSchema);
}
export function createLead(getToken: TokenGetter, body: CreateLeadInput): Promise<Lead> {
  return authedSend(getToken, API_ROUTES.leads, 'POST', body, LeadSchema);
}
export function updateLeadStatus(getToken: TokenGetter, id: string, status: LeadStatus): Promise<Lead> {
  return authedSend(getToken, `${API_ROUTES.leads}/${id}/status`, 'PATCH', { status }, LeadSchema);
}
export function convertLead(
  getToken: TokenGetter,
  id: string,
  body: ConvertLeadInput = {},
): Promise<ConvertLeadResponse> {
  return authedSend(getToken, `${API_ROUTES.leads}/${id}/convert`, 'POST', body, ConvertLeadResponseSchema);
}

// ---------------------------------------------------------------------------
// Notes + Activity (entity-scoped feeds).
// ---------------------------------------------------------------------------
export function listNotes(
  getToken: TokenGetter,
  entityType: string,
  entityId: string,
  cursor?: string,
): Promise<NoteListResponse> {
  const q = new URLSearchParams({ entityType, entityId });
  if (cursor) q.set('cursor', cursor);
  return authedGet(getToken, `${API_ROUTES.notes}?${q.toString()}`, NoteListResponseSchema);
}
export function createNote(
  getToken: TokenGetter,
  body: { entityType: string; entityId: string; body: string },
): Promise<Note> {
  return authedSend(getToken, API_ROUTES.notes, 'POST', body, NoteSchema);
}
export function listActivity(
  getToken: TokenGetter,
  entityType: string,
  entityId: string,
  cursor?: string,
): Promise<ActivityListResponse> {
  const q = new URLSearchParams({ entityType, entityId });
  if (cursor) q.set('cursor', cursor);
  return authedGet(getToken, `${API_ROUTES.activity}?${q.toString()}`, ActivityListResponseSchema);
}

// ---------------------------------------------------------------------------
// Milestone 2 — pipelines, board, deals. Money is integer minor units.
// ---------------------------------------------------------------------------
export interface DealListParams extends ListParams {
  pipelineId?: string;
  stageId?: string;
  contactId?: string;
  companyId?: string;
}

function dealQuery(params: DealListParams): string {
  const q = new URLSearchParams();
  if (params.search) q.set('search', params.search);
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.pipelineId) q.set('pipelineId', params.pipelineId);
  if (params.stageId) q.set('stageId', params.stageId);
  if (params.contactId) q.set('contactId', params.contactId);
  if (params.companyId) q.set('companyId', params.companyId);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function listPipelines(getToken: TokenGetter): Promise<PipelineListResponse> {
  return authedGet(getToken, API_ROUTES.pipelines, PipelineListResponseSchema);
}
export function getPipeline(getToken: TokenGetter, id: string): Promise<Pipeline> {
  return authedGet(getToken, `${API_ROUTES.pipelines}/${id}`, PipelineSchema);
}
export function getBoard(getToken: TokenGetter, pipelineId: string): Promise<BoardResponse> {
  return authedGet(getToken, `${API_ROUTES.pipelines}/${pipelineId}/board`, BoardResponseSchema);
}

export function listDeals(getToken: TokenGetter, params: DealListParams = {}): Promise<DealListResponse> {
  return authedGet(getToken, `${API_ROUTES.deals}${dealQuery(params)}`, DealListResponseSchema);
}
export function getDeal(getToken: TokenGetter, id: string): Promise<Deal> {
  return authedGet(getToken, `${API_ROUTES.deals}/${id}`, DealSchema);
}
export function createDeal(getToken: TokenGetter, body: CreateDealInput): Promise<Deal> {
  return authedSend(getToken, API_ROUTES.deals, 'POST', body, DealSchema);
}
export function updateDeal(getToken: TokenGetter, id: string, body: UpdateDealInput): Promise<Deal> {
  return authedSend(getToken, `${API_ROUTES.deals}/${id}`, 'PATCH', body, DealSchema);
}
export function moveDeal(getToken: TokenGetter, id: string, body: MoveDealInput): Promise<Deal> {
  return authedSend(getToken, `${API_ROUTES.deals}/${id}/move`, 'POST', body, DealSchema);
}
export function reopenDeal(getToken: TokenGetter, id: string, body: ReopenDealInput = {}): Promise<Deal> {
  return authedSend(getToken, `${API_ROUTES.deals}/${id}/reopen`, 'POST', body, DealSchema);
}

/** Format integer minor units as major currency (assumes 2 decimal places). */
export function formatMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return `${currency} ${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse a decimal major-unit string (e.g. "45000.50") into integer minor units. */
export function parseAmountToMinor(text: string): number {
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------------------------------------------------------------------------
// Milestone 3 — tasks, agenda, reminders (server-side), notifications, push.
// ---------------------------------------------------------------------------
export interface TaskListParams {
  search?: string;
  cursor?: string;
  limit?: number;
  type?: string;
  status?: string;
  priority?: string;
  bucket?: 'overdue' | 'today' | 'upcoming' | 'all';
  assigneeId?: string;
  relatedType?: string;
  relatedId?: string;
  from?: string;
  to?: string;
}

function taskQuery(params: TaskListParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function listTasks(getToken: TokenGetter, params: TaskListParams = {}): Promise<TaskListResponse> {
  return authedGet(getToken, `${API_ROUTES.tasks}${taskQuery(params)}`, TaskListResponseSchema);
}
export function getTask(getToken: TokenGetter, id: string): Promise<Task> {
  return authedGet(getToken, `${API_ROUTES.tasks}/${id}`, TaskSchema);
}
export function getAgenda(
  getToken: TokenGetter,
  params: { assigneeId?: string; type?: string } = {},
): Promise<AgendaResponse> {
  const q = new URLSearchParams();
  if (params.assigneeId) q.set('assigneeId', params.assigneeId);
  if (params.type) q.set('type', params.type);
  const s = q.toString();
  return authedGet(getToken, `${API_ROUTES.agenda}${s ? `?${s}` : ''}`, AgendaResponseSchema);
}
export function createTask(getToken: TokenGetter, body: CreateTaskInput): Promise<Task> {
  return authedSend(getToken, API_ROUTES.tasks, 'POST', body, TaskSchema);
}
export function updateTask(getToken: TokenGetter, id: string, body: UpdateTaskInput): Promise<Task> {
  return authedSend(getToken, `${API_ROUTES.tasks}/${id}`, 'PATCH', body, TaskSchema);
}
export function completeTask(getToken: TokenGetter, id: string, body: CompleteTaskInput = {}): Promise<Task> {
  return authedSend(getToken, `${API_ROUTES.tasks}/${id}/complete`, 'POST', body, TaskSchema);
}
export function snoozeTask(getToken: TokenGetter, id: string, body: SnoozeTaskInput): Promise<Task> {
  return authedSend(getToken, `${API_ROUTES.tasks}/${id}/snooze`, 'POST', body, TaskSchema);
}
export function reassignTask(getToken: TokenGetter, id: string, body: ReassignTaskInput): Promise<Task> {
  return authedSend(getToken, `${API_ROUTES.tasks}/${id}/reassign`, 'POST', body, TaskSchema);
}

// --- Notifications ----------------------------------------------------------
export function listNotifications(
  getToken: TokenGetter,
  params: { cursor?: string; limit?: number; unread?: 'true' } = {},
): Promise<NotificationListResponse> {
  const q = new URLSearchParams();
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.unread) q.set('unread', params.unread);
  const s = q.toString();
  return authedGet(getToken, `${API_ROUTES.notifications}${s ? `?${s}` : ''}`, NotificationListResponseSchema);
}
export function getUnreadCount(getToken: TokenGetter): Promise<UnreadCountResponse> {
  return authedGet(getToken, `${API_ROUTES.notifications}/unread-count`, UnreadCountResponseSchema);
}
export function markNotificationRead(getToken: TokenGetter, id: string): Promise<Notification> {
  return authedSend(getToken, `${API_ROUTES.notifications}/${id}/read`, 'POST', {}, NotificationSchema);
}
export async function markAllNotificationsRead(getToken: TokenGetter): Promise<void> {
  const res = await requestWithRetry(getToken, `${API_ROUTES.notifications}/read-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`POST read-all failed: ${res.status}`);
}

// --- Push tokens ------------------------------------------------------------
export function registerPushToken(getToken: TokenGetter, body: RegisterPushTokenInput): Promise<PushToken> {
  return authedSend(getToken, API_ROUTES.pushTokens, 'POST', body, PushTokenSchema);
}
export function unregisterPushToken(getToken: TokenGetter, deviceToken: string): Promise<void> {
  return authedDelete(getToken, API_ROUTES.pushTokens, { token: deviceToken });
}

// --- Users (assignee directory) --------------------------------------------
export function listUsers(getToken: TokenGetter): Promise<OrgUserListResponse> {
  return authedGet(getToken, API_ROUTES.users, OrgUserListResponseSchema);
}

// --- Dashboard (M4) ---------------------------------------------------------
export interface SalesTilesParams {
  period?: 'today' | 'week' | 'month' | 'quarter';
  /** 'me' forces own-scope regardless of role (the "My performance" glance). */
  scope?: 'me';
}

/** Personal sales tiles for the mobile glance (always own-scoped). */
export function getSalesTiles(getToken: TokenGetter, params: SalesTilesParams = {}): Promise<SalesTiles> {
  const q = new URLSearchParams();
  if (params.period) q.set('period', params.period);
  if (params.scope) q.set('scope', params.scope);
  const s = q.toString();
  return authedGet(getToken, `${API_ROUTES.dashboard}/sales${s ? `?${s}` : ''}`, SalesTilesSchema);
}

// ---------------------------------------------------------------------------
// Milestone 5 — calls, recordings (consent-gated), DPDP consent.
// ---------------------------------------------------------------------------
export interface CallListParams {
  cursor?: string;
  limit?: number;
  search?: string;
  order?: 'asc' | 'desc';
  contactId?: string;
  dealId?: string;
  /** 'me' resolves to the current agent. */
  agentUserId?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  status?: string;
  from?: string;
  to?: string;
}

function callQuery(params: CallListParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function listCalls(getToken: TokenGetter, params: CallListParams = {}): Promise<CallListResponse> {
  return authedGet(getToken, `${API_ROUTES.calls}${callQuery(params)}`, CallListResponseSchema);
}
export function getCall(getToken: TokenGetter, id: string): Promise<Call> {
  return authedGet(getToken, `${API_ROUTES.calls}/${id}`, CallSchema);
}
export function clickToCall(getToken: TokenGetter, body: ClickToCallInput): Promise<Call> {
  return authedSend(getToken, `${API_ROUTES.calls}/click-to-call`, 'POST', body, CallSchema);
}
export function logCall(getToken: TokenGetter, body: LogCallInput): Promise<Call> {
  return authedSend(getToken, API_ROUTES.calls, 'POST', body, CallSchema);
}
export function updateCall(getToken: TokenGetter, id: string, body: UpdateCallInput): Promise<Call> {
  return authedSend(getToken, `${API_ROUTES.calls}/${id}`, 'PATCH', body, CallSchema);
}
/** A short-lived signed recording URL — consent-gated (url is null when blocked). */
export function getCallRecording(getToken: TokenGetter, id: string): Promise<RecordingUrlResponse> {
  return authedGet(getToken, `${API_ROUTES.calls}/${id}/recording`, RecordingUrlResponseSchema);
}

export function listConsents(getToken: TokenGetter, contactId: string): Promise<ConsentListResponse> {
  return authedGet(getToken, `${API_ROUTES.consents}?contactId=${encodeURIComponent(contactId)}`, ConsentListResponseSchema);
}
export function setConsent(getToken: TokenGetter, body: SetConsentInput): Promise<Consent> {
  return authedSend(getToken, API_ROUTES.consents, 'POST', body, ConsentSchema);
}

/** Humanize a call duration in seconds, e.g. "3m 05s" / "45s" / "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
