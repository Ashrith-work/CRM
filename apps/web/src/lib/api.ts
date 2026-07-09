import {
  API_ROUTES,
  RevenueTrendResponseSchema,
  CohortResponseSchema,
  ClvDistributionResponseSchema,
  ChurnWatchlistResponseSchema,
  MarginResponseSchema,
  AssistantAnswerSchema,
  type AssistantAnswer,
  type RevenueTrendResponse,
  type CohortResponse,
  type ClvDistributionResponse,
  type ChurnWatchlistResponse,
  type MarginResponse,
  MeResponseSchema,
  ActivityListResponseSchema,
  CompanyListResponseSchema,
  CompanySchema,
  ContactListResponseSchema,
  ContactSchema,
  ConvertLeadResponseSchema,
  CustomFieldDefinitionSchema,
  CustomFieldListResponseSchema,
  LeadListResponseSchema,
  LeadSchema,
  NoteListResponseSchema,
  NoteSchema,
  TagListResponseSchema,
  TagSchema,
  type ActivityListResponse,
  type Company,
  type CompanyListResponse,
  type ConvertLeadInput,
  type ConvertLeadResponse,
  type CreateCompanyInput,
  type CreateContactInput,
  type CreateCustomFieldInput,
  type CreateLeadInput,
  type CreateNoteInput,
  type CreateTagInput,
  type CustomFieldDefinition,
  type CustomFieldListResponse,
  type Contact,
  type ContactListResponse,
  type EntityType,
  type Lead,
  type LeadListResponse,
  type LeadStatus,
  type ListQueryInput,
  type MeResponse,
  type Note,
  type NoteListResponse,
  type Tag,
  type TagListResponse,
  type UpdateCompanyInput,
  type UpdateContactInput,
  type UpdateCustomFieldInput,
  type UpdateLeadInput,
  BoardResponseSchema,
  DealListResponseSchema,
  DealSchema,
  PipelineListResponseSchema,
  PipelineSchema,
  StageHistoryListResponseSchema,
  StageSchema,
  type BoardResponse,
  type CreateDealInput,
  type CreatePipelineInput,
  type CreateStageInput,
  type Deal,
  type DealListQueryInput,
  type DealListResponse,
  type Pipeline,
  type PipelineListResponse,
  type ReorderStagesInput,
  type Stage,
  type StageHistoryListResponse,
  type UpdateDealInput,
  type UpdatePipelineInput,
  type UpdateStageInput,
} from '@crm/types';
import {
  AgendaResponseSchema,
  NotificationListResponseSchema,
  NotificationSchema,
  OrgUserListResponseSchema,
  TaskListResponseSchema,
  TaskSchema,
  UnreadCountResponseSchema,
  FunnelResponseSchema,
  SalesTilesSchema,
  TeamResponseSchema,
  TrendsResponseSchema,
  type FunnelResponse,
  type SalesTiles,
  type TeamResponse,
  type TrendsResponse,
  type AgendaResponse,
  type CompleteTaskInput,
  type CreateTaskInput,
  type Notification,
  type NotificationListResponse,
  type OrgUserListResponse,
  type ReassignTaskInput,
  type RescheduleTaskInput,
  type SnoozeTaskInput,
  type Task,
  type TaskListResponse,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
  type UnreadCountResponse,
  type UpdateTaskInput,
} from '@crm/types';
import {
  CallSchema,
  CallListResponseSchema,
  RecordingUrlResponseSchema,
  ConsentSchema,
  ConsentListResponseSchema,
  type Call,
  type CallListQueryInput,
  type CallListResponse,
  type ClickToCallInput,
  type Consent,
  type ConsentListResponse,
  type LogCallInput,
  type RecordingUrlResponse,
  type SetConsentInput,
  type UpdateCallInput,
  IntegrationSchema,
  IntegrationListResponseSchema,
  type Integration,
  type ConnectIntegrationInput,
  type IntegrationListResponse,
} from '@crm/types';
import {
  ShopifyStatusSchema,
  SyncNowResponseSchema,
  MergeResultSchema,
  type ShopifyStatus,
  type ConnectShopifyInput,
  type SyncNowResponse,
  type MergeCustomersInput,
  type MergeResult,
} from '@crm/types';
import {
  CustomerListResponseSchema,
  Customer360Schema,
  TimelineResponseSchema,
  RecentOrdersResponseSchema,
  ExportAsyncResponseSchema,
  ExportStatusResponseSchema,
  type CustomerListResponse,
  type Customer360,
  type TimelineResponse,
  type RecentOrdersResponse,
  type ExportAsyncResponse,
  type ExportStatusResponse,
} from '@crm/types';
import {
  AnalyticsSummarySchema,
  SegmentSchema,
  SegmentListResponseSchema,
  SegmentMembersResponseSchema,
  SegmentPreviewResponseSchema,
  type AnalyticsSummary,
  type RuleGroup,
  type SaveSegmentInput,
  type Segment,
  type SegmentListResponse,
  type SegmentMembersResponse,
  type SegmentPreviewResponse,
} from '@crm/types';
import {
  CampaignListResponseSchema,
  RecoveryStatsSchema,
  EnrollmentListResponseSchema,
  type CampaignListResponse,
  type RecoveryStats,
  type EnrollmentListResponse,
} from '@crm/types';
import { z, type ZodType } from 'zod';

const StageArrayResponseSchema = z.object({ data: z.array(StageSchema) });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Base API origin — used by the Socket.io client to build the notifications URL. */
export function apiBaseUrl(): string {
  return API_URL;
}

/**
 * A function that returns a FRESH Clerk session token. Web supplies
 * `useAuth().getToken`; `{ skipCache: true }` forces a refresh. Clerk session
 * tokens are ~60s-lived, so we call this immediately before every request and
 * never cache the string.
 */
export type TokenGetter = (opts?: { skipCache?: boolean; template?: string }) => Promise<string | null>;

/** Thrown when there is no valid session even after a refresh — the UI should prompt re-auth. */
export class ApiAuthError extends Error {
  constructor(message = 'Your session has expired — please sign in again.') {
    super(message);
    this.name = 'ApiAuthError';
  }
}

/**
 * Core request helper: fetches a fresh bearer token immediately before the call,
 * disables caching, validates the response against a shared zod schema, and —
 * critically — on a 401 refreshes the token (`getToken({ skipCache: true })`)
 * and retries the request EXACTLY ONCE. A still-401 (or a missing token)
 * surfaces as `ApiAuthError` so the UI can prompt a clean re-sign-in.
 * Pass `schema = null` for 204 responses.
 */
async function request<T>(
  getToken: TokenGetter,
  path: string,
  schema: ZodType<T> | null,
  init?: RequestInit,
): Promise<T> {
  const doFetch = async (skipCache: boolean): Promise<Response> => {
    const token = await getToken(skipCache ? { skipCache: true } : undefined);
    if (!token) throw new ApiAuthError();
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
    });
  };

  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true); // one silent refresh + retry

  if (!res.ok) {
    if (res.status === 401) throw new ApiAuthError();
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body?.message) detail = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }

  if (schema === null) return undefined as T;
  return schema.parse(await res.json());
}

/** Build a query string from a partial list query (skips undefined/empty). */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export type ListParams = Partial<
  Pick<ListQueryInput, 'cursor' | 'limit' | 'search' | 'sort' | 'order' | 'tagId' | 'companyId' | 'status'>
>;

// --- Me (kept for compatibility with the existing dashboard) ----------------
export async function fetchMe(getToken: TokenGetter): Promise<MeResponse> {
  return request(getToken, API_ROUTES.me, MeResponseSchema);
}

// --- Contacts ---------------------------------------------------------------
export function listContacts(getToken: TokenGetter, params: ListParams = {}): Promise<ContactListResponse> {
  return request(getToken, `${API_ROUTES.contacts}${qs(params)}`, ContactListResponseSchema);
}
export function getContact(getToken: TokenGetter, id: string): Promise<Contact> {
  return request(getToken, `${API_ROUTES.contacts}/${id}`, ContactSchema);
}
export function createContact(getToken: TokenGetter, body: CreateContactInput): Promise<Contact> {
  return request(getToken, API_ROUTES.contacts, ContactSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateContact(getToken: TokenGetter, id: string, body: UpdateContactInput): Promise<Contact> {
  return request(getToken, `${API_ROUTES.contacts}/${id}`, ContactSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteContact(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.contacts}/${id}`, null, { method: 'DELETE' });
}

// --- Companies --------------------------------------------------------------
export function listCompanies(getToken: TokenGetter, params: ListParams = {}): Promise<CompanyListResponse> {
  return request(getToken, `${API_ROUTES.companies}${qs(params)}`, CompanyListResponseSchema);
}
export function getCompany(getToken: TokenGetter, id: string): Promise<Company> {
  return request(getToken, `${API_ROUTES.companies}/${id}`, CompanySchema);
}
export function createCompany(getToken: TokenGetter, body: CreateCompanyInput): Promise<Company> {
  return request(getToken, API_ROUTES.companies, CompanySchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateCompany(getToken: TokenGetter, id: string, body: UpdateCompanyInput): Promise<Company> {
  return request(getToken, `${API_ROUTES.companies}/${id}`, CompanySchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteCompany(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.companies}/${id}`, null, { method: 'DELETE' });
}

// --- Leads ------------------------------------------------------------------
export function listLeads(getToken: TokenGetter, params: ListParams = {}): Promise<LeadListResponse> {
  return request(getToken, `${API_ROUTES.leads}${qs(params)}`, LeadListResponseSchema);
}
export function getLead(getToken: TokenGetter, id: string): Promise<Lead> {
  return request(getToken, `${API_ROUTES.leads}/${id}`, LeadSchema);
}
export function createLead(getToken: TokenGetter, body: CreateLeadInput): Promise<Lead> {
  return request(getToken, API_ROUTES.leads, LeadSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateLead(getToken: TokenGetter, id: string, body: UpdateLeadInput): Promise<Lead> {
  return request(getToken, `${API_ROUTES.leads}/${id}`, LeadSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function updateLeadStatus(getToken: TokenGetter, id: string, status: LeadStatus): Promise<Lead> {
  return request(getToken, `${API_ROUTES.leads}/${id}/status`, LeadSchema, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
export function convertLead(getToken: TokenGetter, id: string, body: ConvertLeadInput): Promise<ConvertLeadResponse> {
  return request(getToken, `${API_ROUTES.leads}/${id}/convert`, ConvertLeadResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function deleteLead(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.leads}/${id}`, null, { method: 'DELETE' });
}

// --- Tags -------------------------------------------------------------------
export function listTags(getToken: TokenGetter): Promise<TagListResponse> {
  return request(getToken, API_ROUTES.tags, TagListResponseSchema);
}
export function createTag(getToken: TokenGetter, body: CreateTagInput): Promise<Tag> {
  return request(getToken, API_ROUTES.tags, TagSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function assignTag(getToken: TokenGetter, tagId: string, entityType: EntityType, entityId: string): Promise<void> {
  return request(getToken, `${API_ROUTES.tags}/assign`, null, {
    method: 'POST',
    body: JSON.stringify({ tagId, entityType, entityId }),
  });
}
export function unassignTag(getToken: TokenGetter, tagId: string, entityType: EntityType, entityId: string): Promise<void> {
  return request(getToken, `${API_ROUTES.tags}/unassign`, null, {
    method: 'POST',
    body: JSON.stringify({ tagId, entityType, entityId }),
  });
}

// --- Notes ------------------------------------------------------------------
export function listNotes(
  getToken: TokenGetter,
  entityType: EntityType,
  entityId: string,
  cursor?: string,
): Promise<NoteListResponse> {
  return request(getToken, `${API_ROUTES.notes}${qs({ entityType, entityId, cursor })}`, NoteListResponseSchema);
}
export function createNote(getToken: TokenGetter, body: CreateNoteInput): Promise<Note> {
  return request(getToken, API_ROUTES.notes, NoteSchema, { method: 'POST', body: JSON.stringify(body) });
}

// --- Activity ---------------------------------------------------------------
export function listActivity(
  getToken: TokenGetter,
  entityType: EntityType,
  entityId: string,
  cursor?: string,
): Promise<ActivityListResponse> {
  return request(getToken, `${API_ROUTES.activity}${qs({ entityType, entityId, cursor })}`, ActivityListResponseSchema);
}

// --- Custom fields ----------------------------------------------------------
export function listCustomFields(getToken: TokenGetter, entityType?: EntityType): Promise<CustomFieldListResponse> {
  return request(getToken, `${API_ROUTES.customFields}${qs({ entityType })}`, CustomFieldListResponseSchema);
}
export function createCustomField(getToken: TokenGetter, body: CreateCustomFieldInput): Promise<CustomFieldDefinition> {
  return request(getToken, API_ROUTES.customFields, CustomFieldDefinitionSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function updateCustomField(
  getToken: TokenGetter,
  id: string,
  body: UpdateCustomFieldInput,
): Promise<CustomFieldDefinition> {
  return request(getToken, `${API_ROUTES.customFields}/${id}`, CustomFieldDefinitionSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
export function deleteCustomField(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.customFields}/${id}`, null, { method: 'DELETE' });
}

// --- Pipelines (M2) ---------------------------------------------------------
export function listPipelines(getToken: TokenGetter): Promise<PipelineListResponse> {
  return request(getToken, API_ROUTES.pipelines, PipelineListResponseSchema);
}
export function getPipeline(getToken: TokenGetter, id: string): Promise<Pipeline> {
  return request(getToken, `${API_ROUTES.pipelines}/${id}`, PipelineSchema);
}
export function createPipeline(getToken: TokenGetter, body: CreatePipelineInput): Promise<Pipeline> {
  return request(getToken, API_ROUTES.pipelines, PipelineSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updatePipeline(getToken: TokenGetter, id: string, body: UpdatePipelineInput): Promise<Pipeline> {
  return request(getToken, `${API_ROUTES.pipelines}/${id}`, PipelineSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deletePipeline(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.pipelines}/${id}`, null, { method: 'DELETE' });
}

// --- Stages (M2) ------------------------------------------------------------
export function listStages(getToken: TokenGetter, pipelineId: string): Promise<{ data: Stage[] }> {
  return request(getToken, `${API_ROUTES.stages}${qs({ pipelineId })}`, StageArrayResponseSchema);
}
export function createStage(getToken: TokenGetter, body: CreateStageInput): Promise<Stage> {
  return request(getToken, API_ROUTES.stages, StageSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateStage(getToken: TokenGetter, id: string, body: UpdateStageInput): Promise<Stage> {
  return request(getToken, `${API_ROUTES.stages}/${id}`, StageSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteStage(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.stages}/${id}`, null, { method: 'DELETE' });
}
export function reorderStages(getToken: TokenGetter, body: ReorderStagesInput): Promise<{ data: Stage[] }> {
  return request(getToken, `${API_ROUTES.stages}/reorder`, StageArrayResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Deals (M2) -------------------------------------------------------------
export type DealListParams = Partial<
  Pick<
    DealListQueryInput,
    'cursor' | 'limit' | 'search' | 'sort' | 'order' | 'pipelineId' | 'stageId' | 'ownerId' | 'status' | 'contactId' | 'companyId'
  >
>;

export function getBoard(getToken: TokenGetter, pipelineId: string): Promise<BoardResponse> {
  return request(getToken, `${API_ROUTES.pipelines}/${pipelineId}/board`, BoardResponseSchema);
}
export function listDeals(getToken: TokenGetter, params: DealListParams = {}): Promise<DealListResponse> {
  return request(getToken, `${API_ROUTES.deals}${qs(params)}`, DealListResponseSchema);
}
export function getDeal(getToken: TokenGetter, id: string): Promise<Deal> {
  return request(getToken, `${API_ROUTES.deals}/${id}`, DealSchema);
}
export function createDeal(getToken: TokenGetter, body: CreateDealInput): Promise<Deal> {
  return request(getToken, API_ROUTES.deals, DealSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateDeal(getToken: TokenGetter, id: string, body: UpdateDealInput): Promise<Deal> {
  return request(getToken, `${API_ROUTES.deals}/${id}`, DealSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteDeal(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.deals}/${id}`, null, { method: 'DELETE' });
}
export function moveDeal(getToken: TokenGetter, id: string, toStageId: string): Promise<Deal> {
  return request(getToken, `${API_ROUTES.deals}/${id}/move`, DealSchema, {
    method: 'POST',
    body: JSON.stringify({ toStageId }),
  });
}
export function reopenDeal(getToken: TokenGetter, id: string, toStageId?: string): Promise<Deal> {
  return request(getToken, `${API_ROUTES.deals}/${id}/reopen`, DealSchema, {
    method: 'POST',
    body: JSON.stringify(toStageId ? { toStageId } : {}),
  });
}
export function getDealHistory(getToken: TokenGetter, id: string): Promise<StageHistoryListResponse> {
  return request(getToken, `${API_ROUTES.deals}/${id}/history`, StageHistoryListResponseSchema);
}

// --- Tasks (M3) -------------------------------------------------------------
export type TaskListParams = Partial<{
  cursor: string;
  limit: number;
  search: string;
  sort: string;
  order: 'asc' | 'desc';
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  bucket: 'overdue' | 'today' | 'upcoming' | 'all';
  assigneeId: string;
  relatedType: string;
  relatedId: string;
  from: string;
  to: string;
}>;

export function listTasks(getToken: TokenGetter, params: TaskListParams = {}): Promise<TaskListResponse> {
  return request(getToken, `${API_ROUTES.tasks}${qs(params)}`, TaskListResponseSchema);
}
export function getTask(getToken: TokenGetter, id: string): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}`, TaskSchema);
}
export function createTask(getToken: TokenGetter, body: CreateTaskInput): Promise<Task> {
  return request(getToken, API_ROUTES.tasks, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateTask(getToken: TokenGetter, id: string, body: UpdateTaskInput): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}`, TaskSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function completeTask(getToken: TokenGetter, id: string, body: CompleteTaskInput = {}): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}/complete`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function cancelTask(getToken: TokenGetter, id: string): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}/cancel`, TaskSchema, { method: 'POST', body: JSON.stringify({}) });
}
export function rescheduleTask(getToken: TokenGetter, id: string, body: RescheduleTaskInput): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}/reschedule`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function snoozeTask(getToken: TokenGetter, id: string, body: SnoozeTaskInput): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}/snooze`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function reassignTask(getToken: TokenGetter, id: string, body: ReassignTaskInput): Promise<Task> {
  return request(getToken, `${API_ROUTES.tasks}/${id}/reassign`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function deleteTask(getToken: TokenGetter, id: string): Promise<void> {
  return request(getToken, `${API_ROUTES.tasks}/${id}`, null, { method: 'DELETE' });
}
export function getAgenda(
  getToken: TokenGetter,
  params: { assigneeId?: string; type?: TaskType } = {},
): Promise<AgendaResponse> {
  return request(getToken, `${API_ROUTES.agenda}${qs(params)}`, AgendaResponseSchema);
}

// --- Notifications (M3) -----------------------------------------------------
export function listNotifications(
  getToken: TokenGetter,
  params: { cursor?: string; limit?: number; unread?: 'true' } = {},
): Promise<NotificationListResponse> {
  return request(getToken, `${API_ROUTES.notifications}${qs(params)}`, NotificationListResponseSchema);
}
export function getUnreadCount(getToken: TokenGetter): Promise<UnreadCountResponse> {
  return request(getToken, `${API_ROUTES.notifications}/unread-count`, UnreadCountResponseSchema);
}
export function markNotificationRead(getToken: TokenGetter, id: string): Promise<Notification> {
  return request(getToken, `${API_ROUTES.notifications}/${id}/read`, NotificationSchema, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
export function markAllNotificationsRead(getToken: TokenGetter): Promise<{ updated: number }> {
  return request(getToken, `${API_ROUTES.notifications}/read-all`, z.object({ updated: z.number() }), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// --- Users + timezone (M3) --------------------------------------------------
export function listUsers(getToken: TokenGetter): Promise<OrgUserListResponse> {
  return request(getToken, API_ROUTES.users, OrgUserListResponseSchema);
}
export function updateMyTimezone(getToken: TokenGetter, timezone: string): Promise<{ timezone: string }> {
  return request(getToken, `${API_ROUTES.me}/timezone`, z.object({ timezone: z.string() }), {
    method: 'PATCH',
    body: JSON.stringify({ timezone }),
  });
}

// --- Dashboard / reporting (M4) ---------------------------------------------
export type DashboardPeriodParams = {
  period?: 'today' | 'week' | 'month' | 'quarter' | 'custom';
  from?: string;
  to?: string;
};

export function getSalesTiles(
  getToken: TokenGetter,
  params: DashboardPeriodParams & { pipelineId?: string; scope?: 'auto' | 'me' } = {},
): Promise<SalesTiles> {
  return request(getToken, `${API_ROUTES.dashboard}/sales${qs(params)}`, SalesTilesSchema);
}
export function getFunnel(
  getToken: TokenGetter,
  params: DashboardPeriodParams & { pipelineId: string },
): Promise<FunnelResponse> {
  return request(getToken, `${API_ROUTES.dashboard}/funnel${qs(params)}`, FunnelResponseSchema);
}
export function getTeam(getToken: TokenGetter, params: DashboardPeriodParams = {}): Promise<TeamResponse> {
  return request(getToken, `${API_ROUTES.dashboard}/team${qs(params)}`, TeamResponseSchema);
}
export function getTrends(
  getToken: TokenGetter,
  params: DashboardPeriodParams & {
    metric?: 'won' | 'created' | 'revenue';
    interval?: 'week' | 'month';
    pipelineId?: string;
  } = {},
): Promise<TrendsResponse> {
  return request(getToken, `${API_ROUTES.dashboard}/trends${qs(params)}`, TrendsResponseSchema);
}

// --- Calls (M5) -------------------------------------------------------------
export type CallListParams = Partial<
  Pick<
    CallListQueryInput,
    'cursor' | 'limit' | 'search' | 'order' | 'contactId' | 'dealId' | 'agentUserId' | 'direction' | 'status' | 'from' | 'to'
  >
>;

export function listCalls(getToken: TokenGetter, params: CallListParams = {}): Promise<CallListResponse> {
  return request(getToken, `${API_ROUTES.calls}${qs(params)}`, CallListResponseSchema);
}
export function getCall(getToken: TokenGetter, id: string): Promise<Call> {
  return request(getToken, `${API_ROUTES.calls}/${id}`, CallSchema);
}
export function clickToCall(getToken: TokenGetter, body: ClickToCallInput): Promise<Call> {
  return request(getToken, `${API_ROUTES.calls}/click-to-call`, CallSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function logCall(getToken: TokenGetter, body: LogCallInput): Promise<Call> {
  return request(getToken, API_ROUTES.calls, CallSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateCall(getToken: TokenGetter, id: string, body: UpdateCallInput): Promise<Call> {
  return request(getToken, `${API_ROUTES.calls}/${id}`, CallSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function getCallRecording(getToken: TokenGetter, id: string): Promise<RecordingUrlResponse> {
  return request(getToken, `${API_ROUTES.calls}/${id}/recording`, RecordingUrlResponseSchema);
}

// --- Consents (M5) ----------------------------------------------------------
export function listConsents(getToken: TokenGetter, contactId: string): Promise<ConsentListResponse> {
  return request(getToken, `${API_ROUTES.consents}${qs({ contactId })}`, ConsentListResponseSchema);
}
export function setConsent(getToken: TokenGetter, body: SetConsentInput): Promise<Consent> {
  return request(getToken, API_ROUTES.consents, ConsentSchema, { method: 'POST', body: JSON.stringify(body) });
}

// --- Integrations (M0 retrofit) ---------------------------------------------
export function listIntegrations(getToken: TokenGetter): Promise<IntegrationListResponse> {
  return request(getToken, API_ROUTES.integrations, IntegrationListResponseSchema);
}
export function connectIntegration(getToken: TokenGetter, body: ConnectIntegrationInput): Promise<Integration> {
  return request(getToken, `${API_ROUTES.integrations}/connect`, IntegrationSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function disconnectIntegration(getToken: TokenGetter, id: string): Promise<Integration> {
  return request(getToken, `${API_ROUTES.integrations}/${id}/disconnect`, IntegrationSchema, { method: 'POST' });
}


// --- Shopify ingestion (M1) -------------------------------------------------
export function getShopifyStatus(getToken: TokenGetter): Promise<ShopifyStatus> {
  return request(getToken, `${API_ROUTES.ingestion}/shopify/status`, ShopifyStatusSchema);
}
export function connectShopify(getToken: TokenGetter, body: ConnectShopifyInput): Promise<ShopifyStatus> {
  return request(getToken, `${API_ROUTES.ingestion}/shopify/connect`, ShopifyStatusSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function shopifySyncNow(getToken: TokenGetter): Promise<SyncNowResponse> {
  return request(getToken, `${API_ROUTES.ingestion}/shopify/sync-now`, SyncNowResponseSchema, { method: 'POST' });
}
export function mergeCustomers(getToken: TokenGetter, body: MergeCustomersInput): Promise<MergeResult> {
  return request(getToken, API_ROUTES.customersMerge, MergeResultSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// --- Customer 360 (M2) ------------------------------------------------------
export type CustomerListParams = { cursor?: string; limit?: number; search?: string; sort?: string; order?: 'asc' | 'desc' };
export function listCustomers(getToken: TokenGetter, params: CustomerListParams = {}): Promise<CustomerListResponse> {
  return request(getToken, `${API_ROUTES.customers}${qs(params)}`, CustomerListResponseSchema);
}
export function getCustomer360(getToken: TokenGetter, id: string): Promise<Customer360> {
  return request(getToken, `${API_ROUTES.customers}/${id}`, Customer360Schema);
}
export type TimelineParams = { cursor?: string; limit?: number; type?: string };
export function getCustomerTimeline(getToken: TokenGetter, id: string, params: TimelineParams = {}): Promise<TimelineResponse> {
  return request(getToken, `${API_ROUTES.customers}/${id}/timeline${qs(params)}`, TimelineResponseSchema);
}
export type RecentOrdersParams = { limit?: number; from?: string; to?: string; year?: number; month?: number };
export function getRecentOrders(getToken: TokenGetter, id: string, params: RecentOrdersParams = {}): Promise<RecentOrdersResponse> {
  return request(getToken, `${API_ROUTES.customers}/${id}/orders${qs(params)}`, RecentOrdersResponseSchema);
}

/** Fetch a binary .xlsx with the bearer token (one silent 401 refresh + retry). */
async function requestBlob(getToken: TokenGetter, path: string, init?: RequestInit): Promise<Blob> {
  const doFetch = async (skipCache: boolean): Promise<Response> => {
    const token = await getToken(skipCache ? { skipCache: true } : undefined);
    if (!token) throw new ApiAuthError();
    return fetch(`${API_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers }, cache: 'no-store' });
  };
  let res = await doFetch(false);
  if (res.status === 401) res = await doFetch(true);
  if (!res.ok) {
    if (res.status === 401) throw new ApiAuthError();
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.blob();
}

/** Sync single-customer export — the .xlsx workbook (masked per role). */
export function exportCustomer(getToken: TokenGetter, id: string): Promise<Blob> {
  return requestBlob(getToken, `${API_ROUTES.customers}/${id}/export`);
}
export function exportCustomerAsync(getToken: TokenGetter, id: string): Promise<ExportAsyncResponse> {
  return request(getToken, `${API_ROUTES.customers}/${id}/export/async`, ExportAsyncResponseSchema, { method: 'POST' });
}
export function getExportStatus(getToken: TokenGetter, jobId: string): Promise<ExportStatusResponse> {
  return request(getToken, `${API_ROUTES.customers}/exports/${jobId}/status`, ExportStatusResponseSchema);
}
export function downloadExport(getToken: TokenGetter, jobId: string): Promise<Blob> {
  return requestBlob(getToken, `${API_ROUTES.customers}/exports/${jobId}/download`);
}

// --- Analytics + segmentation (M3) ------------------------------------------
export function getAnalyticsSummary(getToken: TokenGetter): Promise<AnalyticsSummary> {
  return request(getToken, `${API_ROUTES.analytics}/summary`, AnalyticsSummarySchema);
}
export function refreshAnalytics(getToken: TokenGetter): Promise<{ refreshed: number }> {
  return request(getToken, `${API_ROUTES.analytics}/refresh`, z.object({ refreshed: z.number() }), { method: 'POST' });
}

// P2.1 deep analytics (view-backed).
export function getRevenueTrend(getToken: TokenGetter): Promise<RevenueTrendResponse> {
  return request(getToken, `${API_ROUTES.analytics}/revenue-trend`, RevenueTrendResponseSchema);
}
export function getCohorts(getToken: TokenGetter): Promise<CohortResponse> {
  return request(getToken, `${API_ROUTES.analytics}/cohorts`, CohortResponseSchema);
}
export function getClvDistribution(getToken: TokenGetter): Promise<ClvDistributionResponse> {
  return request(getToken, `${API_ROUTES.analytics}/clv-distribution`, ClvDistributionResponseSchema);
}
export function getChurnWatchlist(getToken: TokenGetter): Promise<ChurnWatchlistResponse> {
  return request(getToken, `${API_ROUTES.analytics}/churn-watchlist`, ChurnWatchlistResponseSchema);
}
export function getMargin(getToken: TokenGetter): Promise<MarginResponse> {
  return request(getToken, `${API_ROUTES.analytics}/margin`, MarginResponseSchema);
}

// --- Read-only AI assistant (P2.2) ------------------------------------------
/** Ask a grounded, RBAC-scoped question. The answer inherits the asker's role. */
export function askAssistant(getToken: TokenGetter, question: string): Promise<AssistantAnswer> {
  return request(getToken, `${API_ROUTES.assistant}/ask`, AssistantAnswerSchema, {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

export function previewSegment(getToken: TokenGetter, rules: RuleGroup): Promise<SegmentPreviewResponse> {
  return request(getToken, `${API_ROUTES.segments}/preview`, SegmentPreviewResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ rules }),
  });
}
export function saveSegment(getToken: TokenGetter, body: SaveSegmentInput): Promise<Segment> {
  return request(getToken, API_ROUTES.segments, SegmentSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function listSegments(getToken: TokenGetter): Promise<SegmentListResponse> {
  return request(getToken, API_ROUTES.segments, SegmentListResponseSchema);
}
export function getSegment(getToken: TokenGetter, id: string): Promise<Segment> {
  return request(getToken, `${API_ROUTES.segments}/${id}`, SegmentSchema);
}
export function getSegmentMembers(
  getToken: TokenGetter,
  id: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<SegmentMembersResponse> {
  return request(getToken, `${API_ROUTES.segments}/${id}/members${qs(params)}`, SegmentMembersResponseSchema);
}
export function refreshSegment(getToken: TokenGetter, id: string): Promise<Segment> {
  return request(getToken, `${API_ROUTES.segments}/${id}/refresh`, SegmentSchema, { method: 'POST' });
}

// --- Campaigns / abandoned-cart recovery (M4) -------------------------------
export function getCampaigns(getToken: TokenGetter): Promise<CampaignListResponse> {
  return request(getToken, API_ROUTES.campaigns, CampaignListResponseSchema);
}
export function getRecoveryStats(getToken: TokenGetter): Promise<RecoveryStats> {
  return request(getToken, `${API_ROUTES.campaigns}/recovery-stats`, RecoveryStatsSchema);
}
export function getCampaignEnrollments(
  getToken: TokenGetter,
  campaignId: string,
  params: { cursor?: string; limit?: number } = {},
): Promise<EnrollmentListResponse> {
  return request(getToken, `${API_ROUTES.campaigns}/${campaignId}/enrollments${qs(params)}`, EnrollmentListResponseSchema);
}
export function runCampaigns(getToken: TokenGetter): Promise<{ enrolled: number; sent: number }> {
  return request(getToken, `${API_ROUTES.campaigns}/run`, z.object({ enrolled: z.number(), sent: z.number() }), { method: 'POST' });
}
