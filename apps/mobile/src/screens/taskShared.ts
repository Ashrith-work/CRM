import type { Task, TaskPriority, TaskType } from '@crm/types';
import { colors } from '../ui';

/** Display helpers shared across the task screens. */

export const TYPE_LABEL: Record<TaskType, string> = {
  TASK: 'Task',
  FOLLOW_UP: 'Follow-up',
  MEETING: 'Meeting',
  CALL: 'Call',
};

export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: colors.muted,
  MEDIUM: colors.brand,
  HIGH: '#dc2626',
};

/** The scheduling anchor shown on a card: the meeting start, else the due date. */
export function taskAnchorIso(task: Pick<Task, 'startAt' | 'dueAt'>): string | null {
  return task.startAt ?? task.dueAt ?? null;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function isOverdue(task: Pick<Task, 'startAt' | 'dueAt' | 'status'>): boolean {
  if (task.status !== 'OPEN') return false;
  const iso = taskAnchorIso(task);
  return iso ? new Date(iso).getTime() < Date.now() : false;
}
