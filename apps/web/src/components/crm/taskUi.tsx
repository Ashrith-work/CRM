'use client';

import type { RelatedType, Task, TaskType } from '@crm/types';

/** Presentational helpers shared by the task screens. */

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  TASK: 'Task',
  FOLLOW_UP: 'Follow-up',
  MEETING: 'Meeting',
  CALL: 'Call',
};

export const PRIORITY_BADGE: Record<string, string> = {
  LOW: 'bg-slate-100 text-slate-600',
  MEDIUM: 'bg-amber-50 text-amber-700',
  HIGH: 'bg-red-50 text-red-700',
};

export const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-brand-50 text-brand-700',
  DONE: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

/** The scheduling anchor shown in lists/calendars: meeting start else due date. */
export function taskAnchorIso(task: Pick<Task, 'startAt' | 'dueAt'>): string | null {
  return task.startAt ?? task.dueAt ?? null;
}

/** An OPEN task whose anchor is in the past. */
export function isOverdue(task: Task): boolean {
  if (task.status !== 'OPEN') return false;
  const iso = taskAnchorIso(task);
  return !!iso && new Date(iso).getTime() < Date.now();
}

const RELATED_PATH: Record<RelatedType, string> = {
  CONTACT: 'contacts',
  COMPANY: 'companies',
  LEAD: 'leads',
  DEAL: 'deals',
};

/** Link to the related CRM record's detail page. */
export function relatedHref(type: RelatedType, id: string): string {
  return `/dashboard/${RELATED_PATH[type]}/${id}`;
}
