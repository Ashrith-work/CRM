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

// ---------------------------------------------------------------------------
// Shared request helpers. The caller (a screen) always passes the Clerk token;
// every response is validated against the matching shared zod schema.
// ---------------------------------------------------------------------------
async function authedGet<T>(token: string, path: string, schema: ZodSchema<T>): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

async function authedSend<T>(
  token: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  schema: ZodSchema<T>,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return schema.parse(await res.json());
}

/** DELETE that tolerates a 204/empty body (no response parsing). */
async function authedDelete(token: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
export function fetchMe(token: string): Promise<MeResponse> {
  return authedGet(token, API_ROUTES.me, MeResponseSchema);
}

// ---------------------------------------------------------------------------
// Contacts.
// ---------------------------------------------------------------------------
export function listContacts(token: string, params: ListParams = {}): Promise<ContactListResponse> {
  return authedGet(token, `${API_ROUTES.contacts}${listQuery(params)}`, ContactListResponseSchema);
}
export function getContact(token: string, id: string): Promise<Contact> {
  return authedGet(token, `${API_ROUTES.contacts}/${id}`, ContactSchema);
}
export function createContact(token: string, body: CreateContactInput): Promise<Contact> {
  return authedSend(token, API_ROUTES.contacts, 'POST', body, ContactSchema);
}

// ---------------------------------------------------------------------------
// Companies.
// ---------------------------------------------------------------------------
export function listCompanies(token: string, params: ListParams = {}): Promise<CompanyListResponse> {
  return authedGet(token, `${API_ROUTES.companies}${listQuery(params)}`, CompanyListResponseSchema);
}
export function getCompany(token: string, id: string): Promise<Company> {
  return authedGet(token, `${API_ROUTES.companies}/${id}`, CompanySchema);
}

// ---------------------------------------------------------------------------
// Leads.
// ---------------------------------------------------------------------------
export function listLeads(token: string, params: ListParams = {}): Promise<LeadListResponse> {
  return authedGet(token, `${API_ROUTES.leads}${listQuery(params)}`, LeadListResponseSchema);
}
export function getLead(token: string, id: string): Promise<Lead> {
  return authedGet(token, `${API_ROUTES.leads}/${id}`, LeadSchema);
}
export function createLead(token: string, body: CreateLeadInput): Promise<Lead> {
  return authedSend(token, API_ROUTES.leads, 'POST', body, LeadSchema);
}
export function updateLeadStatus(token: string, id: string, status: LeadStatus): Promise<Lead> {
  return authedSend(token, `${API_ROUTES.leads}/${id}/status`, 'PATCH', { status }, LeadSchema);
}
export function convertLead(
  token: string,
  id: string,
  body: ConvertLeadInput = {},
): Promise<ConvertLeadResponse> {
  return authedSend(token, `${API_ROUTES.leads}/${id}/convert`, 'POST', body, ConvertLeadResponseSchema);
}

// ---------------------------------------------------------------------------
// Notes + Activity (entity-scoped feeds).
// ---------------------------------------------------------------------------
export function listNotes(
  token: string,
  entityType: string,
  entityId: string,
  cursor?: string,
): Promise<NoteListResponse> {
  const q = new URLSearchParams({ entityType, entityId });
  if (cursor) q.set('cursor', cursor);
  return authedGet(token, `${API_ROUTES.notes}?${q.toString()}`, NoteListResponseSchema);
}
export function createNote(
  token: string,
  body: { entityType: string; entityId: string; body: string },
): Promise<Note> {
  return authedSend(token, API_ROUTES.notes, 'POST', body, NoteSchema);
}
export function listActivity(
  token: string,
  entityType: string,
  entityId: string,
  cursor?: string,
): Promise<ActivityListResponse> {
  const q = new URLSearchParams({ entityType, entityId });
  if (cursor) q.set('cursor', cursor);
  return authedGet(token, `${API_ROUTES.activity}?${q.toString()}`, ActivityListResponseSchema);
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

export function listPipelines(token: string): Promise<PipelineListResponse> {
  return authedGet(token, API_ROUTES.pipelines, PipelineListResponseSchema);
}
export function getPipeline(token: string, id: string): Promise<Pipeline> {
  return authedGet(token, `${API_ROUTES.pipelines}/${id}`, PipelineSchema);
}
export function getBoard(token: string, pipelineId: string): Promise<BoardResponse> {
  return authedGet(token, `${API_ROUTES.pipelines}/${pipelineId}/board`, BoardResponseSchema);
}

export function listDeals(token: string, params: DealListParams = {}): Promise<DealListResponse> {
  return authedGet(token, `${API_ROUTES.deals}${dealQuery(params)}`, DealListResponseSchema);
}
export function getDeal(token: string, id: string): Promise<Deal> {
  return authedGet(token, `${API_ROUTES.deals}/${id}`, DealSchema);
}
export function createDeal(token: string, body: CreateDealInput): Promise<Deal> {
  return authedSend(token, API_ROUTES.deals, 'POST', body, DealSchema);
}
export function updateDeal(token: string, id: string, body: UpdateDealInput): Promise<Deal> {
  return authedSend(token, `${API_ROUTES.deals}/${id}`, 'PATCH', body, DealSchema);
}
export function moveDeal(token: string, id: string, body: MoveDealInput): Promise<Deal> {
  return authedSend(token, `${API_ROUTES.deals}/${id}/move`, 'POST', body, DealSchema);
}
export function reopenDeal(token: string, id: string, body: ReopenDealInput = {}): Promise<Deal> {
  return authedSend(token, `${API_ROUTES.deals}/${id}/reopen`, 'POST', body, DealSchema);
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

export function listTasks(token: string, params: TaskListParams = {}): Promise<TaskListResponse> {
  return authedGet(token, `${API_ROUTES.tasks}${taskQuery(params)}`, TaskListResponseSchema);
}
export function getTask(token: string, id: string): Promise<Task> {
  return authedGet(token, `${API_ROUTES.tasks}/${id}`, TaskSchema);
}
export function getAgenda(
  token: string,
  params: { assigneeId?: string; type?: string } = {},
): Promise<AgendaResponse> {
  const q = new URLSearchParams();
  if (params.assigneeId) q.set('assigneeId', params.assigneeId);
  if (params.type) q.set('type', params.type);
  const s = q.toString();
  return authedGet(token, `${API_ROUTES.agenda}${s ? `?${s}` : ''}`, AgendaResponseSchema);
}
export function createTask(token: string, body: CreateTaskInput): Promise<Task> {
  return authedSend(token, API_ROUTES.tasks, 'POST', body, TaskSchema);
}
export function updateTask(token: string, id: string, body: UpdateTaskInput): Promise<Task> {
  return authedSend(token, `${API_ROUTES.tasks}/${id}`, 'PATCH', body, TaskSchema);
}
export function completeTask(token: string, id: string, body: CompleteTaskInput = {}): Promise<Task> {
  return authedSend(token, `${API_ROUTES.tasks}/${id}/complete`, 'POST', body, TaskSchema);
}
export function snoozeTask(token: string, id: string, body: SnoozeTaskInput): Promise<Task> {
  return authedSend(token, `${API_ROUTES.tasks}/${id}/snooze`, 'POST', body, TaskSchema);
}
export function reassignTask(token: string, id: string, body: ReassignTaskInput): Promise<Task> {
  return authedSend(token, `${API_ROUTES.tasks}/${id}/reassign`, 'POST', body, TaskSchema);
}

// --- Notifications ----------------------------------------------------------
export function listNotifications(
  token: string,
  params: { cursor?: string; limit?: number; unread?: 'true' } = {},
): Promise<NotificationListResponse> {
  const q = new URLSearchParams();
  if (params.cursor) q.set('cursor', params.cursor);
  if (params.limit) q.set('limit', String(params.limit));
  if (params.unread) q.set('unread', params.unread);
  const s = q.toString();
  return authedGet(token, `${API_ROUTES.notifications}${s ? `?${s}` : ''}`, NotificationListResponseSchema);
}
export function getUnreadCount(token: string): Promise<UnreadCountResponse> {
  return authedGet(token, `${API_ROUTES.notifications}/unread-count`, UnreadCountResponseSchema);
}
export function markNotificationRead(token: string, id: string): Promise<Notification> {
  return authedSend(token, `${API_ROUTES.notifications}/${id}/read`, 'POST', {}, NotificationSchema);
}
export async function markAllNotificationsRead(token: string): Promise<void> {
  const res = await fetch(`${API_URL}${API_ROUTES.notifications}/read-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`POST read-all failed: ${res.status}`);
}

// --- Push tokens ------------------------------------------------------------
export function registerPushToken(token: string, body: RegisterPushTokenInput): Promise<PushToken> {
  return authedSend(token, API_ROUTES.pushTokens, 'POST', body, PushTokenSchema);
}
export function unregisterPushToken(token: string, deviceToken: string): Promise<void> {
  return authedDelete(token, API_ROUTES.pushTokens, { token: deviceToken });
}

// --- Users (assignee directory) --------------------------------------------
export function listUsers(token: string): Promise<OrgUserListResponse> {
  return authedGet(token, API_ROUTES.users, OrgUserListResponseSchema);
}
