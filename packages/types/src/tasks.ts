import { z } from 'zod';
import { ActorSchema, EntityTypeSchema, SortOrderSchema } from './crm';

/**
 * Milestone 3 — activity tasks + reminders. A single unified Task type covers
 * TASK / FOLLOW_UP / MEETING / CALL, optionally linked to an M1/M2 record
 * (contact/company/lead/deal via relatedType + relatedId). All datetimes are
 * absolute UTC ISO strings on the wire; clients render them in the viewer's
 * (or the assignee's) local timezone.
 */

// ---------------------------------------------------------------------------
// Enums (kept in lock-step with the Prisma enums of the same name).
// ---------------------------------------------------------------------------
export const TASK_TYPES = ['TASK', 'FOLLOW_UP', 'MEETING', 'CALL'] as const;
export const TaskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const REMINDER_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export const ReminderChannelSchema = z.enum(REMINDER_CHANNELS);
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;

export const REMINDER_STATUSES = ['SCHEDULED', 'SENT', 'CANCELLED'] as const;
export const ReminderStatusSchema = z.enum(REMINDER_STATUSES);
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;

/** A task can relate to any of the CRM entity types (contact/company/lead/deal). */
export const RelatedTypeSchema = EntityTypeSchema;
export type RelatedType = z.infer<typeof RelatedTypeSchema>;

/** Default channels applied to a reminder offset when the caller omits them. */
export const DEFAULT_REMINDER_CHANNELS: ReminderChannel[] = ['IN_APP', 'EMAIL', 'PUSH'];

// ---------------------------------------------------------------------------
// Reminder.
// ---------------------------------------------------------------------------
export const ReminderSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  taskId: z.string(),
  remindAt: z.string(),
  channels: z.array(ReminderChannelSchema),
  status: ReminderStatusSchema,
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Reminder = z.infer<typeof ReminderSchema>;

/**
 * A reminder request on create/edit: fire `minutesBefore` the task's anchor
 * (startAt for meetings, else dueAt), on the given channels. The server turns
 * each offset into a concrete remindAt = anchor − minutesBefore.
 */
export const ReminderOffsetInput = z.object({
  minutesBefore: z.number().int().min(0).max(60 * 24 * 30),
  channels: z.array(ReminderChannelSchema).min(1).optional(),
});
export type ReminderOffsetInput = z.infer<typeof ReminderOffsetInput>;

// ---------------------------------------------------------------------------
// Task.
// ---------------------------------------------------------------------------
/** Lightweight reference to the related CRM record, resolved for display. */
export const RelatedRefSchema = z.object({
  type: RelatedTypeSchema,
  id: z.string(),
  label: z.string(),
});
export type RelatedRef = z.infer<typeof RelatedRefSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: TaskTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  dueAt: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  location: z.string().nullable(),
  meetingUrl: z.string().nullable(),
  assigneeId: z.string(),
  assignee: ActorSchema.nullable(),
  createdById: z.string(),
  createdBy: ActorSchema.nullable(),
  relatedType: RelatedTypeSchema.nullable(),
  relatedId: z.string().nullable(),
  related: RelatedRefSchema.nullable(),
  completedAt: z.string().nullable(),
  outcome: z.string().nullable(),
  reminders: z.array(ReminderSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

const relatedFields = {
  relatedType: RelatedTypeSchema.optional().nullable(),
  relatedId: z.string().optional().nullable(),
};

export const CreateTaskInput = z
  .object({
    type: TaskTypeSchema.optional().default('TASK'),
    title: z.string().min(1).max(200),
    description: z.string().max(10_000).optional(),
    priority: TaskPrioritySchema.optional().default('MEDIUM'),
    dueAt: z.string().datetime({ offset: true }).optional().nullable(),
    startAt: z.string().datetime({ offset: true }).optional().nullable(),
    endAt: z.string().datetime({ offset: true }).optional().nullable(),
    location: z.string().max(300).optional(),
    meetingUrl: z.string().max(1000).optional(),
    /** Defaults to the creator when omitted. */
    assigneeId: z.string().optional(),
    ...relatedFields,
    reminders: z.array(ReminderOffsetInput).max(10).optional(),
  })
  .refine((v) => (v.relatedType == null) === (v.relatedId == null), {
    message: 'relatedType and relatedId must be provided together',
    path: ['relatedId'],
  })
  .refine((v) => !(v.startAt && v.endAt) || v.endAt >= v.startAt, {
    message: 'endAt must be at or after startAt',
    path: ['endAt'],
  });
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

/**
 * Partial update of a task's core fields. Passing `reminders` replaces the
 * task's SCHEDULED reminders (recomputed from the new anchor); omit it to leave
 * them untouched. Status transitions go through /complete, /cancel, /reschedule,
 * /snooze, /reassign — never here.
 */
export const UpdateTaskInput = z
  .object({
    type: TaskTypeSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(10_000).nullable().optional(),
    priority: TaskPrioritySchema.optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    startAt: z.string().datetime({ offset: true }).nullable().optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    location: z.string().max(300).nullable().optional(),
    meetingUrl: z.string().max(1000).nullable().optional(),
    ...relatedFields,
    reminders: z.array(ReminderOffsetInput).max(10).optional(),
  })
  .refine((v) => v.relatedType === undefined || v.relatedId !== undefined, {
    message: 'relatedType and relatedId must be provided together',
    path: ['relatedId'],
  });
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;

/** Complete a task; optionally record an outcome note. */
export const CompleteTaskInput = z.object({
  outcome: z.string().max(10_000).optional(),
});
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;

/** Move a task's due date (and reschedule its reminders relative to it). */
export const RescheduleTaskInput = z.object({
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type RescheduleTaskInput = z.infer<typeof RescheduleTaskInput>;

/** Snooze: push the reminder(s) out to a new absolute time. */
export const SnoozeTaskInput = z.object({
  remindAt: z.string().datetime({ offset: true }),
});
export type SnoozeTaskInput = z.infer<typeof SnoozeTaskInput>;

/** Reassign to another user; reminders/notifications redirect to them. */
export const ReassignTaskInput = z.object({
  assigneeId: z.string().min(1),
});
export type ReassignTaskInput = z.infer<typeof ReassignTaskInput>;

// ---------------------------------------------------------------------------
// List + agenda queries.
// ---------------------------------------------------------------------------
export const TASK_BUCKETS = ['overdue', 'today', 'upcoming', 'all'] as const;
export const TaskBucketSchema = z.enum(TASK_BUCKETS);
export type TaskBucket = z.infer<typeof TaskBucketSchema>;

export const TaskListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  search: z.string().optional(),
  sort: z.string().optional(),
  order: SortOrderSchema.optional().default('asc'),
  type: TaskTypeSchema.optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  bucket: TaskBucketSchema.optional(),
  /** Filter by assignee; 'me' resolves to the current user server-side. */
  assigneeId: z.string().optional(),
  relatedType: RelatedTypeSchema.optional(),
  relatedId: z.string().optional(),
  /** Inclusive UTC window for calendar queries (ISO datetimes). */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
export type TaskListQueryInput = z.infer<typeof TaskListQueryInput>;

export const TaskListResponseSchema = z.object({
  data: z.array(TaskSchema),
  nextCursor: z.string().nullable(),
});
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;

/** Agenda buckets, each computed in the assignee's local timezone. */
export const AgendaQueryInput = z.object({
  assigneeId: z.string().optional(),
  type: TaskTypeSchema.optional(),
});
export type AgendaQueryInput = z.infer<typeof AgendaQueryInput>;

export const AgendaResponseSchema = z.object({
  timezone: z.string(),
  overdue: z.array(TaskSchema),
  today: z.array(TaskSchema),
  upcoming: z.array(TaskSchema),
});
export type AgendaResponse = z.infer<typeof AgendaResponseSchema>;
