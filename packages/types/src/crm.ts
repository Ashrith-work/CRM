import { z } from 'zod';

/**
 * Milestone 1 — CRM contracts. Single source of truth for both clients and the
 * API. Response schemas describe the wire shape (dates are ISO strings after
 * JSON serialization); *Input schemas validate incoming request bodies.
 */

// ---------------------------------------------------------------------------
// Enums (kept in lock-step with the Prisma enums of the same name).
// ---------------------------------------------------------------------------
export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'CONVERTED'] as const;
export const LeadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const ENTITY_TYPES = ['CONTACT', 'COMPANY', 'LEAD', 'DEAL'] as const;
export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'] as const;
export const CustomFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES);
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const ACTIVITY_EVENT_TYPES = [
  'CREATED',
  'UPDATED',
  'NOTE_ADDED',
  'TAG_ADDED',
  'STATUS_CHANGED',
  'CONVERTED',
  'STAGE_CHANGED',
  'WON',
  'LOST',
  'REOPENED',
] as const;
export const ActivityEventTypeSchema = z.enum(ACTIVITY_EVENT_TYPES);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

// ---------------------------------------------------------------------------
// Shared building blocks.
// ---------------------------------------------------------------------------
/** Free-form custom field values, keyed by CustomFieldDefinition.key. */
export const CustomFieldValuesSchema = z.record(z.string(), z.unknown());
export type CustomFieldValues = z.infer<typeof CustomFieldValuesSchema>;

export const AddressSchema = z
  .object({
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    country: z.string(),
  })
  .partial();
export type Address = z.infer<typeof AddressSchema>;

/** Lightweight actor/author reference embedded in notes and activity. */
export const ActorSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
});
export type Actor = z.infer<typeof ActorSchema>;

/** Cursor-paginated list envelope. `total` is intentionally omitted from list
 * responses (no COUNT on the hot path) so large lists stay under the P95 budget. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

// ---------------------------------------------------------------------------
// Tag.
// ---------------------------------------------------------------------------
export const TagSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  color: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Tag = z.infer<typeof TagSchema>;

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;
export const CreateTagInput = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(HEX_COLOR, 'color must be a #RRGGBB hex string'),
});
export type CreateTagInput = z.infer<typeof CreateTagInput>;

export const UpdateTagInput = CreateTagInput.partial();
export type UpdateTagInput = z.infer<typeof UpdateTagInput>;

/** Assign/unassign a tag to any entity. */
export const TagAssignmentInput = z.object({
  tagId: z.string().min(1),
  entityType: EntityTypeSchema,
  entityId: z.string().min(1),
});
export type TagAssignmentInput = z.infer<typeof TagAssignmentInput>;

export const TagListResponseSchema = z.object({ data: z.array(TagSchema) });
export type TagListResponse = z.infer<typeof TagListResponseSchema>;

// ---------------------------------------------------------------------------
// Custom fields.
// ---------------------------------------------------------------------------
export const CustomFieldDefinitionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  entityType: EntityTypeSchema,
  key: z.string(),
  label: z.string(),
  fieldType: CustomFieldTypeSchema,
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  order: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

const FIELD_KEY = /^[a-z][a-z0-9_]*$/;
export const CreateCustomFieldInput = z
  .object({
    entityType: EntityTypeSchema,
    key: z.string().regex(FIELD_KEY, 'key must be snake_case starting with a letter').max(50),
    label: z.string().min(1).max(80),
    fieldType: CustomFieldTypeSchema,
    options: z.array(z.string().min(1)).optional(),
    required: z.boolean().optional().default(false),
    order: z.number().int().optional().default(0),
  })
  .refine((v) => v.fieldType !== 'SELECT' || (v.options?.length ?? 0) > 0, {
    message: 'SELECT fields require a non-empty options array',
    path: ['options'],
  });
export type CreateCustomFieldInput = z.infer<typeof CreateCustomFieldInput>;

/** entityType and key are immutable once created; only presentation/validation
 * attributes can change. */
export const UpdateCustomFieldInput = z.object({
  label: z.string().min(1).max(80).optional(),
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
  order: z.number().int().optional(),
});
export type UpdateCustomFieldInput = z.infer<typeof UpdateCustomFieldInput>;

export const CustomFieldListResponseSchema = z.object({
  data: z.array(CustomFieldDefinitionSchema),
});
export type CustomFieldListResponse = z.infer<typeof CustomFieldListResponseSchema>;

// ---------------------------------------------------------------------------
// Note.
// ---------------------------------------------------------------------------
export const NoteSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  entityType: EntityTypeSchema,
  entityId: z.string(),
  authorId: z.string(),
  author: ActorSchema.nullable(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Note = z.infer<typeof NoteSchema>;

export const CreateNoteInput = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().min(1),
  body: z.string().min(1).max(10_000),
});
export type CreateNoteInput = z.infer<typeof CreateNoteInput>;

export const NoteListResponseSchema = paginated(NoteSchema);
export type NoteListResponse = z.infer<typeof NoteListResponseSchema>;

// ---------------------------------------------------------------------------
// Activity.
// ---------------------------------------------------------------------------
export const ActivityEventSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  entityType: EntityTypeSchema,
  entityId: z.string(),
  actorId: z.string().nullable(),
  actor: ActorSchema.nullable(),
  eventType: ActivityEventTypeSchema,
  metadata: z.unknown().nullable(),
  source: z.string().nullable(),
  createdAt: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const ActivityListResponseSchema = paginated(ActivityEventSchema);
export type ActivityListResponse = z.infer<typeof ActivityListResponseSchema>;

// ---------------------------------------------------------------------------
// Company.
// ---------------------------------------------------------------------------
export const CompanySchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  size: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  address: AddressSchema.nullable(),
  ownerId: z.string().nullable(),
  customFields: CustomFieldValuesSchema,
  tags: z.array(TagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Company = z.infer<typeof CompanySchema>;

export const CreateCompanyInput = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(255).optional(),
  industry: z.string().max(100).optional(),
  size: z.string().max(50).optional(),
  website: z.string().max(255).optional(),
  phone: z.string().max(50).optional(),
  address: AddressSchema.optional(),
  ownerId: z.string().optional(),
  customFields: CustomFieldValuesSchema.optional(),
  tagIds: z.array(z.string()).optional(),
});
export type CreateCompanyInput = z.infer<typeof CreateCompanyInput>;

export const UpdateCompanyInput = CreateCompanyInput.partial();
export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInput>;

export const CompanyListResponseSchema = paginated(CompanySchema);
export type CompanyListResponse = z.infer<typeof CompanyListResponseSchema>;

// ---------------------------------------------------------------------------
// Contact.
// ---------------------------------------------------------------------------
/** Slim company reference embedded in a contact so detail views can link out
 * without a second request. */
export const CompanyRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type CompanyRef = z.infer<typeof CompanyRefSchema>;

export const ContactSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  jobTitle: z.string().nullable(),
  companyId: z.string().nullable(),
  company: CompanyRefSchema.nullable(),
  ownerId: z.string().nullable(),
  customFields: CustomFieldValuesSchema,
  tags: z.array(TagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactInput = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  jobTitle: z.string().max(120).optional(),
  companyId: z.string().optional().nullable(),
  ownerId: z.string().optional(),
  customFields: CustomFieldValuesSchema.optional(),
  tagIds: z.array(z.string()).optional(),
});
export type CreateContactInput = z.infer<typeof CreateContactInput>;

export const UpdateContactInput = CreateContactInput.partial();
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

export const ContactListResponseSchema = paginated(ContactSchema);
export type ContactListResponse = z.infer<typeof ContactListResponseSchema>;

// ---------------------------------------------------------------------------
// Lead.
// ---------------------------------------------------------------------------
export const LeadSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string().nullable(),
  status: LeadStatusSchema,
  ownerId: z.string().nullable(),
  convertedContactId: z.string().nullable(),
  customFields: CustomFieldValuesSchema,
  tags: z.array(TagSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const CreateLeadInput = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  source: z.string().max(120).optional(),
  status: LeadStatusSchema.optional(),
  ownerId: z.string().optional(),
  customFields: CustomFieldValuesSchema.optional(),
  tagIds: z.array(z.string()).optional(),
});
export type CreateLeadInput = z.infer<typeof CreateLeadInput>;

export const UpdateLeadInput = CreateLeadInput.partial();
export type UpdateLeadInput = z.infer<typeof UpdateLeadInput>;

/** Status-only transition (mobile + web lead controls). */
export const UpdateLeadStatusInput = z.object({ status: LeadStatusSchema });
export type UpdateLeadStatusInput = z.infer<typeof UpdateLeadStatusInput>;

export const LeadListResponseSchema = paginated(LeadSchema);
export type LeadListResponse = z.infer<typeof LeadListResponseSchema>;

/** Convert a lead into a contact (dedup by email), optionally creating/linking
 * a company. */
export const ConvertLeadInput = z
  .object({
    companyId: z.string().optional(),
    companyName: z.string().min(1).max(200).optional(),
  })
  .refine((v) => !(v.companyId && v.companyName), {
    message: 'Provide either companyId or companyName, not both',
    path: ['companyName'],
  });
export type ConvertLeadInput = z.infer<typeof ConvertLeadInput>;

export const ConvertLeadResponseSchema = z.object({
  lead: LeadSchema,
  contact: ContactSchema,
  company: CompanySchema.nullable(),
  contactCreated: z.boolean(),
});
export type ConvertLeadResponse = z.infer<typeof ConvertLeadResponseSchema>;

// ---------------------------------------------------------------------------
// List query params (shared across contacts/companies/leads).
// ---------------------------------------------------------------------------
export const SortOrderSchema = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof SortOrderSchema>;

/**
 * Query params for the list endpoints. All optional. `coerce` is used so the
 * raw query-string values (always strings) become the right runtime types.
 */
export const ListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: SortOrderSchema.optional().default('desc'),
  tagId: z.string().optional(),
  ownerId: z.string().optional(),
  // Contacts only.
  companyId: z.string().optional(),
  // Leads only.
  status: LeadStatusSchema.optional(),
});
export type ListQueryInput = z.infer<typeof ListQueryInput>;

/** Query params for the notes/activity feeds (entity-scoped). */
export const FeedQueryInput = z.object({
  entityType: EntityTypeSchema,
  entityId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type FeedQueryInput = z.infer<typeof FeedQueryInput>;
