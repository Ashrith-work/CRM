import { z } from 'zod';
import {
  ActorSchema,
  CompanyRefSchema,
  CustomFieldValuesSchema,
  SortOrderSchema,
  TagSchema,
} from './crm';

/**
 * Milestone 2 — revenue layer contracts. Money is ALWAYS integer minor units
 * (`amountMinor`, e.g. cents/paise) plus an ISO-4217 `currency`; never a float.
 */

// ---------------------------------------------------------------------------
// Enums (in lock-step with the Prisma enums).
// ---------------------------------------------------------------------------
export const STAGE_TYPES = ['OPEN', 'WON', 'LOST'] as const;
export const StageTypeSchema = z.enum(STAGE_TYPES);
export type StageType = z.infer<typeof StageTypeSchema>;

export const DEAL_STATUSES = ['OPEN', 'WON', 'LOST'] as const;
export const DealStatusSchema = z.enum(DEAL_STATUSES);
export type DealStatus = z.infer<typeof DealStatusSchema>;

// ---------------------------------------------------------------------------
// Stage.
// ---------------------------------------------------------------------------
export const StageSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  pipelineId: z.string(),
  name: z.string(),
  position: z.number().int(),
  probability: z.number().int().min(0).max(100),
  type: StageTypeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Stage = z.infer<typeof StageSchema>;

export const CreateStageInput = z.object({
  pipelineId: z.string().min(1),
  name: z.string().min(1).max(80),
  position: z.number().int().min(0).optional(),
  probability: z.number().int().min(0).max(100).optional().default(0),
  type: StageTypeSchema.optional().default('OPEN'),
});
export type CreateStageInput = z.infer<typeof CreateStageInput>;

export const UpdateStageInput = z.object({
  name: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  type: StageTypeSchema.optional(),
});
export type UpdateStageInput = z.infer<typeof UpdateStageInput>;

/** Reorder a pipeline's stages; server rewrites positions to stay contiguous. */
export const ReorderStagesInput = z.object({
  pipelineId: z.string().min(1),
  stageIds: z.array(z.string().min(1)).min(1),
});
export type ReorderStagesInput = z.infer<typeof ReorderStagesInput>;

// ---------------------------------------------------------------------------
// Pipeline.
// ---------------------------------------------------------------------------
export const PipelineSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  position: z.number().int(),
  stages: z.array(StageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

export const CreatePipelineInput = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreatePipelineInput = z.infer<typeof CreatePipelineInput>;

export const UpdatePipelineInput = CreatePipelineInput.partial();
export type UpdatePipelineInput = z.infer<typeof UpdatePipelineInput>;

export const PipelineListResponseSchema = z.object({ data: z.array(PipelineSchema) });
export type PipelineListResponse = z.infer<typeof PipelineListResponseSchema>;

// ---------------------------------------------------------------------------
// Deal.
// ---------------------------------------------------------------------------
/** Contact reference embedded in a deal — carries email/phone for mobile
 * tap-to-call / tap-to-email. */
export const DealContactRefSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type DealContactRef = z.infer<typeof DealContactRefSchema>;

export const DealSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  pipelineId: z.string(),
  stageId: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  expectedCloseDate: z.string().nullable(),
  ownerId: z.string().nullable(),
  contactId: z.string().nullable(),
  contact: DealContactRefSchema.nullable(),
  companyId: z.string().nullable(),
  company: CompanyRefSchema.nullable(),
  status: DealStatusSchema,
  closedAt: z.string().nullable(),
  customFields: CustomFieldValuesSchema,
  tags: z.array(TagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Deal = z.infer<typeof DealSchema>;

const currencyField = z.string().length(3).toUpperCase();

export const CreateDealInput = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string().min(1),
  stageId: z.string().optional(), // defaults to the pipeline's first stage
  amountMinor: z.number().int().min(0).optional().default(0),
  currency: currencyField.optional().default('USD'),
  expectedCloseDate: z.string().optional(),
  ownerId: z.string().optional(),
  contactId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  customFields: CustomFieldValuesSchema.optional(),
  tagIds: z.array(z.string()).optional(),
});
export type CreateDealInput = z.infer<typeof CreateDealInput>;

/** Update core deal fields. Stage changes go through /move; status through
 * /move, /won, /lost, /reopen — never here. */
export const UpdateDealInput = z.object({
  name: z.string().min(1).max(200).optional(),
  amountMinor: z.number().int().min(0).optional(),
  currency: currencyField.optional(),
  expectedCloseDate: z.string().nullable().optional(),
  ownerId: z.string().optional(),
  contactId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  customFields: CustomFieldValuesSchema.optional(),
  tagIds: z.array(z.string()).optional(),
});
export type UpdateDealInput = z.infer<typeof UpdateDealInput>;

export const MoveDealInput = z.object({ toStageId: z.string().min(1) });
export type MoveDealInput = z.infer<typeof MoveDealInput>;

/** Reopen a WON/LOST deal; optionally land it in a specific stage (defaults to
 * the pipeline's first OPEN stage). */
export const ReopenDealInput = z.object({ toStageId: z.string().optional() });
export type ReopenDealInput = z.infer<typeof ReopenDealInput>;

export const DealListResponseSchema = z.object({
  data: z.array(DealSchema),
  nextCursor: z.string().nullable(),
});
export type DealListResponse = z.infer<typeof DealListResponseSchema>;

export const DealListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: SortOrderSchema.optional().default('desc'),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  ownerId: z.string().optional(),
  status: DealStatusSchema.optional(),
  // For the "Deals" section on a contact/company detail page.
  contactId: z.string().optional(),
  companyId: z.string().optional(),
});
export type DealListQueryInput = z.infer<typeof DealListQueryInput>;

// ---------------------------------------------------------------------------
// Stage history.
// ---------------------------------------------------------------------------
export const StageHistorySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  dealId: z.string(),
  fromStageId: z.string().nullable(),
  fromStageName: z.string().nullable(),
  toStageId: z.string(),
  toStageName: z.string().nullable(),
  changedById: z.string(),
  changedBy: ActorSchema.nullable(),
  changedAt: z.string(),
  secondsInPreviousStage: z.number().int().nullable(),
});
export type StageHistory = z.infer<typeof StageHistorySchema>;

export const StageHistoryListResponseSchema = z.object({ data: z.array(StageHistorySchema) });
export type StageHistoryListResponse = z.infer<typeof StageHistoryListResponseSchema>;

// ---------------------------------------------------------------------------
// Board (deals grouped by stage + per-stage totals).
// ---------------------------------------------------------------------------
export const BoardTotalsSchema = z.object({
  count: z.number().int(),
  /** Sum of amountMinor across ALL (not just the loaded page) open deals in the stage. */
  sumMinor: z.number().int(),
  /** sum(amountMinor) * probability / 100, rounded to minor units. */
  weightedMinor: z.number().int(),
});
export type BoardTotals = z.infer<typeof BoardTotalsSchema>;

export const BoardColumnSchema = z.object({
  stage: StageSchema,
  totals: BoardTotalsSchema,
  deals: z.array(DealSchema),
  nextCursor: z.string().nullable(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

export const BoardResponseSchema = z.object({
  pipeline: PipelineSchema,
  columns: z.array(BoardColumnSchema),
  /** Whole-pipeline rollups. */
  totals: BoardTotalsSchema,
});
export type BoardResponse = z.infer<typeof BoardResponseSchema>;
