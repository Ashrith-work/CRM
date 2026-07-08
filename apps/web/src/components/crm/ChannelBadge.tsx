'use client';

import type { CampaignSendStatus, MessageChannel } from '@crm/types';

/** A small badge for a message channel. Extensible — WhatsApp/SMS slot in later. */
export function ChannelBadge({ channel }: { channel: MessageChannel }) {
  const map: Record<MessageChannel, string> = { EMAIL: '✉ Email' };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {map[channel] ?? channel}
    </span>
  );
}

const STATUS_STYLES: Record<CampaignSendStatus, { label: string; cls: string }> = {
  QUEUED: { label: 'Queued', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
  SENT: { label: 'Sent', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  DELIVERED: { label: 'Delivered', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200' },
  OPENED: { label: 'Opened', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  CLICKED: { label: 'Clicked', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  BOUNCED: { label: 'Bounced', cls: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  FAILED: { label: 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  BLOCKED: { label: 'Blocked', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  DELAYED: { label: 'Delayed', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
};

export function SendStatusBadge({ status }: { status: CampaignSendStatus }) {
  const s = STATUS_STYLES[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

const ENROLLMENT_STYLES: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
  CONVERTED: { label: 'Recovered', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  HALTED: { label: 'Halted', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  COMPLETED: { label: 'Completed', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

export function EnrollmentStatusBadge({ status }: { status: string }) {
  const s = ENROLLMENT_STYLES[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

/** Humanize a step delay in minutes: 60→"1h", 1440→"1d", 4320→"3d". */
export function humanizeDelay(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
