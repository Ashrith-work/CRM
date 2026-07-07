'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Notification } from '@crm/types';
import { useNotificationSocket } from './useNotificationSocket';
import { relatedHref } from './taskUi';
import { formatDate } from './ui';

/** Where a notification navigates when clicked. */
function notificationHref(n: Notification): string {
  if (n.taskId) return `/dashboard/tasks/${n.taskId}`;
  if (n.relatedType && n.relatedId) return relatedHref(n.relatedType, n.relatedId);
  return '/dashboard/notifications';
}

/** Header bell with a live unread badge (Socket.io) and a recent-notifications dropdown. */
export function NotificationBell() {
  const router = useRouter();
  const { unreadCount, recent, markRead, markAll } = useNotificationSocket(10);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const openNotification = async (n: Notification) => {
    setOpen(false);
    if (!n.readAt) await markRead(n.id);
    router.push(notificationHref(n));
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={() => void markAll()} className="text-xs font-medium text-brand-600 hover:underline">
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {recent.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No notifications</li>
            ) : (
              recent.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => void openNotification(n)}
                    className={`block w-full px-3 py-2.5 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/40'}`}
                  >
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                      {n.title}
                    </p>
                    <p className="truncate text-xs text-slate-500">{n.body}</p>
                    <p className="text-[11px] text-slate-400">{formatDate(n.createdAt)}</p>
                  </button>
                </li>
              ))
            )}
          </ul>
          <Link
            href="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-slate-100 px-3 py-2 text-center text-sm font-medium text-brand-600 hover:bg-slate-50"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
