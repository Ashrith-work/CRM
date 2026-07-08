'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import type { Notification } from '@crm/types';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api';
import { Button, ErrorPanel, PageHeader, Spinner, formatDate } from '@/components/crm/ui';
import { relatedHref } from '@/components/crm/taskUi';

function href(n: Notification): string {
  if (n.taskId) return `/dashboard/tasks/${n.taskId}`;
  if (n.relatedType && n.relatedId) return relatedHref(n.relatedType, n.relatedId);
  return '/dashboard/notifications';
}

export default function NotificationsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(
    async (append: boolean) => {
      if (!append) setStatus('loading');
      try {
        const page = await listNotifications(getToken, { limit: 25, cursor: append && cursor ? cursor : undefined });
        setItems((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.nextCursor);
        setStatus('ready');
      } catch (err) {
        setMessage((err as Error).message);
        setStatus('error');
      }
    },
    [getToken, cursor],
  );

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (n: Notification) => {
    if (getToken && !n.readAt) {
      await markNotificationRead(getToken, n.id);
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
    router.push(href(n));
  };

  const markAll = async () => {
    await markAllNotificationsRead(getToken);
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        action={
          <Button variant="secondary" onClick={() => void markAll()}>
            Mark all read
          </Button>
        }
      />
      {status === 'error' ? (
        <ErrorPanel message={message} onRetry={() => void load(false)} />
      ) : status === 'loading' ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">You have no notifications.</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => void open(n)}
                className={`block w-full px-4 py-3 text-left hover:bg-slate-50 ${n.readAt ? '' : 'bg-brand-50/40'}`}
              >
                <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                  {n.title}
                  <span className="ml-auto text-[11px] font-normal text-slate-400">{formatDate(n.createdAt)}</span>
                </p>
                <p className="mt-0.5 text-sm text-slate-500">{n.body}</p>
                {n.deliveredChannels.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">via {n.deliveredChannels.join(', ')}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === 'ready' && cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void load(true)}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
