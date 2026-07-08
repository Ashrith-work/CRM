import { z } from 'zod';
import { RelatedTypeSchema } from './tasks';

/**
 * Milestone 3 — notifications + push tokens. A Notification is the durable
 * in-app record fanned out across channels (in-app / email / push). The in-app
 * row always persists so an offline user sees it on next load; email/push are
 * best-effort side channels.
 */

// ---------------------------------------------------------------------------
// Notification.
// ---------------------------------------------------------------------------
export const NOTIFICATION_TYPES = ['REMINDER', 'ASSIGNMENT', 'MENTION', 'SYSTEM'] as const;
export const NotificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH'] as const;
export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  relatedType: RelatedTypeSchema.nullable(),
  relatedId: z.string().nullable(),
  /** For deep-linking to the source task (nullable for non-task notifications). */
  taskId: z.string().nullable(),
  readAt: z.string().nullable(),
  deliveredChannels: z.array(NotificationChannelSchema),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListQueryInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  /** When "true", only unread notifications. */
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type NotificationListQueryInput = z.infer<typeof NotificationListQueryInput>;

export const NotificationListResponseSchema = z.object({
  data: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int(),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const UnreadCountResponseSchema = z.object({ count: z.number().int() });
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

// ---------------------------------------------------------------------------
// Push tokens (Expo).
// ---------------------------------------------------------------------------
export const PUSH_PLATFORMS = ['IOS', 'ANDROID'] as const;
export const PushPlatformSchema = z.enum(PUSH_PLATFORMS);
export type PushPlatform = z.infer<typeof PushPlatformSchema>;

export const RegisterPushTokenInput = z.object({
  token: z.string().min(1),
  platform: PushPlatformSchema,
});
export type RegisterPushTokenInput = z.infer<typeof RegisterPushTokenInput>;

export const UnregisterPushTokenInput = z.object({
  token: z.string().min(1),
});
export type UnregisterPushTokenInput = z.infer<typeof UnregisterPushTokenInput>;

export const PushTokenSchema = z.object({
  id: z.string(),
  userId: z.string(),
  token: z.string(),
  platform: PushPlatformSchema,
  lastSeenAt: z.string(),
  createdAt: z.string(),
});
export type PushToken = z.infer<typeof PushTokenSchema>;

// ---------------------------------------------------------------------------
// Realtime (Socket.io) contract.
// ---------------------------------------------------------------------------
/** Socket.io namespace clients connect to for live notifications. */
export const NOTIFICATIONS_NAMESPACE = '/notifications';

/** Server → client event names. */
export const SOCKET_EVENTS = {
  /** A newly created Notification row (payload: Notification). */
  notification: 'notification',
  /** The recipient's current unread count (payload: { count }). */
  unreadCount: 'unread_count',
} as const;

/** Payload emitted on SOCKET_EVENTS.unreadCount. */
export const UnreadCountEventSchema = z.object({ count: z.number().int() });
export type UnreadCountEvent = z.infer<typeof UnreadCountEventSchema>;
