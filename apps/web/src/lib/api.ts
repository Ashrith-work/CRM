import {
  API_ROUTES,
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
import { z, type ZodType } from 'zod';

const StageArrayResponseSchema = z.object({ data: z.array(StageSchema) });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Base API origin — used by the Socket.io client to build the notifications URL. */
export function apiBaseUrl(): string {
  return API_URL;
}

/**
 * Core request helper: adds the Clerk bearer token, disables caching, throws a
 * readable error on non-2xx, and validates the response against a shared zod
 * schema (the single source of truth). Pass `schema = null` for 204 responses.
 */
async function request<T>(
  token: string,
  path: string,
  schema: ZodType<T> | null,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
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
export async function fetchMe(token: string): Promise<MeResponse> {
  return request(token, API_ROUTES.me, MeResponseSchema);
}

// --- Contacts ---------------------------------------------------------------
export function listContacts(token: string, params: ListParams = {}): Promise<ContactListResponse> {
  return request(token, `${API_ROUTES.contacts}${qs(params)}`, ContactListResponseSchema);
}
export function getContact(token: string, id: string): Promise<Contact> {
  return request(token, `${API_ROUTES.contacts}/${id}`, ContactSchema);
}
export function createContact(token: string, body: CreateContactInput): Promise<Contact> {
  return request(token, API_ROUTES.contacts, ContactSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateContact(token: string, id: string, body: UpdateContactInput): Promise<Contact> {
  return request(token, `${API_ROUTES.contacts}/${id}`, ContactSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteContact(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.contacts}/${id}`, null, { method: 'DELETE' });
}

// --- Companies --------------------------------------------------------------
export function listCompanies(token: string, params: ListParams = {}): Promise<CompanyListResponse> {
  return request(token, `${API_ROUTES.companies}${qs(params)}`, CompanyListResponseSchema);
}
export function getCompany(token: string, id: string): Promise<Company> {
  return request(token, `${API_ROUTES.companies}/${id}`, CompanySchema);
}
export function createCompany(token: string, body: CreateCompanyInput): Promise<Company> {
  return request(token, API_ROUTES.companies, CompanySchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateCompany(token: string, id: string, body: UpdateCompanyInput): Promise<Company> {
  return request(token, `${API_ROUTES.companies}/${id}`, CompanySchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteCompany(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.companies}/${id}`, null, { method: 'DELETE' });
}

// --- Leads ------------------------------------------------------------------
export function listLeads(token: string, params: ListParams = {}): Promise<LeadListResponse> {
  return request(token, `${API_ROUTES.leads}${qs(params)}`, LeadListResponseSchema);
}
export function getLead(token: string, id: string): Promise<Lead> {
  return request(token, `${API_ROUTES.leads}/${id}`, LeadSchema);
}
export function createLead(token: string, body: CreateLeadInput): Promise<Lead> {
  return request(token, API_ROUTES.leads, LeadSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateLead(token: string, id: string, body: UpdateLeadInput): Promise<Lead> {
  return request(token, `${API_ROUTES.leads}/${id}`, LeadSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function updateLeadStatus(token: string, id: string, status: LeadStatus): Promise<Lead> {
  return request(token, `${API_ROUTES.leads}/${id}/status`, LeadSchema, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
export function convertLead(token: string, id: string, body: ConvertLeadInput): Promise<ConvertLeadResponse> {
  return request(token, `${API_ROUTES.leads}/${id}/convert`, ConvertLeadResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function deleteLead(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.leads}/${id}`, null, { method: 'DELETE' });
}

// --- Tags -------------------------------------------------------------------
export function listTags(token: string): Promise<TagListResponse> {
  return request(token, API_ROUTES.tags, TagListResponseSchema);
}
export function createTag(token: string, body: CreateTagInput): Promise<Tag> {
  return request(token, API_ROUTES.tags, TagSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function assignTag(token: string, tagId: string, entityType: EntityType, entityId: string): Promise<void> {
  return request(token, `${API_ROUTES.tags}/assign`, null, {
    method: 'POST',
    body: JSON.stringify({ tagId, entityType, entityId }),
  });
}
export function unassignTag(token: string, tagId: string, entityType: EntityType, entityId: string): Promise<void> {
  return request(token, `${API_ROUTES.tags}/unassign`, null, {
    method: 'POST',
    body: JSON.stringify({ tagId, entityType, entityId }),
  });
}

// --- Notes ------------------------------------------------------------------
export function listNotes(
  token: string,
  entityType: EntityType,
  entityId: string,
  cursor?: string,
): Promise<NoteListResponse> {
  return request(token, `${API_ROUTES.notes}${qs({ entityType, entityId, cursor })}`, NoteListResponseSchema);
}
export function createNote(token: string, body: CreateNoteInput): Promise<Note> {
  return request(token, API_ROUTES.notes, NoteSchema, { method: 'POST', body: JSON.stringify(body) });
}

// --- Activity ---------------------------------------------------------------
export function listActivity(
  token: string,
  entityType: EntityType,
  entityId: string,
  cursor?: string,
): Promise<ActivityListResponse> {
  return request(token, `${API_ROUTES.activity}${qs({ entityType, entityId, cursor })}`, ActivityListResponseSchema);
}

// --- Custom fields ----------------------------------------------------------
export function listCustomFields(token: string, entityType?: EntityType): Promise<CustomFieldListResponse> {
  return request(token, `${API_ROUTES.customFields}${qs({ entityType })}`, CustomFieldListResponseSchema);
}
export function createCustomField(token: string, body: CreateCustomFieldInput): Promise<CustomFieldDefinition> {
  return request(token, API_ROUTES.customFields, CustomFieldDefinitionSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function updateCustomField(
  token: string,
  id: string,
  body: UpdateCustomFieldInput,
): Promise<CustomFieldDefinition> {
  return request(token, `${API_ROUTES.customFields}/${id}`, CustomFieldDefinitionSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
export function deleteCustomField(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.customFields}/${id}`, null, { method: 'DELETE' });
}

// --- Pipelines (M2) ---------------------------------------------------------
export function listPipelines(token: string): Promise<PipelineListResponse> {
  return request(token, API_ROUTES.pipelines, PipelineListResponseSchema);
}
export function getPipeline(token: string, id: string): Promise<Pipeline> {
  return request(token, `${API_ROUTES.pipelines}/${id}`, PipelineSchema);
}
export function createPipeline(token: string, body: CreatePipelineInput): Promise<Pipeline> {
  return request(token, API_ROUTES.pipelines, PipelineSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updatePipeline(token: string, id: string, body: UpdatePipelineInput): Promise<Pipeline> {
  return request(token, `${API_ROUTES.pipelines}/${id}`, PipelineSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deletePipeline(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.pipelines}/${id}`, null, { method: 'DELETE' });
}

// --- Stages (M2) ------------------------------------------------------------
export function listStages(token: string, pipelineId: string): Promise<{ data: Stage[] }> {
  return request(token, `${API_ROUTES.stages}${qs({ pipelineId })}`, StageArrayResponseSchema);
}
export function createStage(token: string, body: CreateStageInput): Promise<Stage> {
  return request(token, API_ROUTES.stages, StageSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateStage(token: string, id: string, body: UpdateStageInput): Promise<Stage> {
  return request(token, `${API_ROUTES.stages}/${id}`, StageSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteStage(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.stages}/${id}`, null, { method: 'DELETE' });
}
export function reorderStages(token: string, body: ReorderStagesInput): Promise<{ data: Stage[] }> {
  return request(token, `${API_ROUTES.stages}/reorder`, StageArrayResponseSchema, {
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

export function getBoard(token: string, pipelineId: string): Promise<BoardResponse> {
  return request(token, `${API_ROUTES.pipelines}/${pipelineId}/board`, BoardResponseSchema);
}
export function listDeals(token: string, params: DealListParams = {}): Promise<DealListResponse> {
  return request(token, `${API_ROUTES.deals}${qs(params)}`, DealListResponseSchema);
}
export function getDeal(token: string, id: string): Promise<Deal> {
  return request(token, `${API_ROUTES.deals}/${id}`, DealSchema);
}
export function createDeal(token: string, body: CreateDealInput): Promise<Deal> {
  return request(token, API_ROUTES.deals, DealSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateDeal(token: string, id: string, body: UpdateDealInput): Promise<Deal> {
  return request(token, `${API_ROUTES.deals}/${id}`, DealSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function deleteDeal(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.deals}/${id}`, null, { method: 'DELETE' });
}
export function moveDeal(token: string, id: string, toStageId: string): Promise<Deal> {
  return request(token, `${API_ROUTES.deals}/${id}/move`, DealSchema, {
    method: 'POST',
    body: JSON.stringify({ toStageId }),
  });
}
export function reopenDeal(token: string, id: string, toStageId?: string): Promise<Deal> {
  return request(token, `${API_ROUTES.deals}/${id}/reopen`, DealSchema, {
    method: 'POST',
    body: JSON.stringify(toStageId ? { toStageId } : {}),
  });
}
export function getDealHistory(token: string, id: string): Promise<StageHistoryListResponse> {
  return request(token, `${API_ROUTES.deals}/${id}/history`, StageHistoryListResponseSchema);
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

export function listTasks(token: string, params: TaskListParams = {}): Promise<TaskListResponse> {
  return request(token, `${API_ROUTES.tasks}${qs(params)}`, TaskListResponseSchema);
}
export function getTask(token: string, id: string): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}`, TaskSchema);
}
export function createTask(token: string, body: CreateTaskInput): Promise<Task> {
  return request(token, API_ROUTES.tasks, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function updateTask(token: string, id: string, body: UpdateTaskInput): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}`, TaskSchema, { method: 'PATCH', body: JSON.stringify(body) });
}
export function completeTask(token: string, id: string, body: CompleteTaskInput = {}): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}/complete`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function cancelTask(token: string, id: string): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}/cancel`, TaskSchema, { method: 'POST', body: JSON.stringify({}) });
}
export function rescheduleTask(token: string, id: string, body: RescheduleTaskInput): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}/reschedule`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function snoozeTask(token: string, id: string, body: SnoozeTaskInput): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}/snooze`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function reassignTask(token: string, id: string, body: ReassignTaskInput): Promise<Task> {
  return request(token, `${API_ROUTES.tasks}/${id}/reassign`, TaskSchema, { method: 'POST', body: JSON.stringify(body) });
}
export function deleteTask(token: string, id: string): Promise<void> {
  return request(token, `${API_ROUTES.tasks}/${id}`, null, { method: 'DELETE' });
}
export function getAgenda(
  token: string,
  params: { assigneeId?: string; type?: TaskType } = {},
): Promise<AgendaResponse> {
  return request(token, `${API_ROUTES.agenda}${qs(params)}`, AgendaResponseSchema);
}

// --- Notifications (M3) -----------------------------------------------------
export function listNotifications(
  token: string,
  params: { cursor?: string; limit?: number; unread?: 'true' } = {},
): Promise<NotificationListResponse> {
  return request(token, `${API_ROUTES.notifications}${qs(params)}`, NotificationListResponseSchema);
}
export function getUnreadCount(token: string): Promise<UnreadCountResponse> {
  return request(token, `${API_ROUTES.notifications}/unread-count`, UnreadCountResponseSchema);
}
export function markNotificationRead(token: string, id: string): Promise<Notification> {
  return request(token, `${API_ROUTES.notifications}/${id}/read`, NotificationSchema, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
export function markAllNotificationsRead(token: string): Promise<{ updated: number }> {
  return request(token, `${API_ROUTES.notifications}/read-all`, z.object({ updated: z.number() }), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// --- Users + timezone (M3) --------------------------------------------------
export function listUsers(token: string): Promise<OrgUserListResponse> {
  return request(token, API_ROUTES.users, OrgUserListResponseSchema);
}
export function updateMyTimezone(token: string, timezone: string): Promise<{ timezone: string }> {
  return request(token, `${API_ROUTES.me}/timezone`, z.object({ timezone: z.string() }), {
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
  token: string,
  params: DashboardPeriodParams & { pipelineId?: string; scope?: 'auto' | 'me' } = {},
): Promise<SalesTiles> {
  return request(token, `${API_ROUTES.dashboard}/sales${qs(params)}`, SalesTilesSchema);
}
export function getFunnel(
  token: string,
  params: DashboardPeriodParams & { pipelineId: string },
): Promise<FunnelResponse> {
  return request(token, `${API_ROUTES.dashboard}/funnel${qs(params)}`, FunnelResponseSchema);
}
export function getTeam(token: string, params: DashboardPeriodParams = {}): Promise<TeamResponse> {
  return request(token, `${API_ROUTES.dashboard}/team${qs(params)}`, TeamResponseSchema);
}
export function getTrends(
  token: string,
  params: DashboardPeriodParams & {
    metric?: 'won' | 'created' | 'revenue';
    interval?: 'week' | 'month';
    pipelineId?: string;
  } = {},
): Promise<TrendsResponse> {
  return request(token, `${API_ROUTES.dashboard}/trends${qs(params)}`, TrendsResponseSchema);
}
