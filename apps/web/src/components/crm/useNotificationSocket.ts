'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { io, type Socket } from 'socket.io-client';
import { NOTIFICATIONS_NAMESPACE, SOCKET_EVENTS, type Notification } from '@crm/types';
import { apiBaseUrl, getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api';

/**
 * Live notification feed. Seeds recent notifications + the unread count over
 * REST, then keeps both current via the Socket.io `/notifications` namespace
 * (SOCKET_EVENTS.notification / .unreadCount). Reconnects with a fresh Clerk
 * token; disconnects on unmount.
 */
export function useNotificationSocket(recentLimit = 10): {
  unreadCount: number;
  recent: Notification[];
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
} {
  const { getToken } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [recent, setRecent] = useState<Notification[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const reload = useCallback(async () => {
    const [list, count] = await Promise.all([
      listNotifications(getToken, { limit: recentLimit }),
      getUnreadCount(getToken),
    ]);
    setRecent(list.data);
    setUnreadCount(count.count);
  }, [getToken, recentLimit]);

  const markRead = useCallback(
    async (id: string) => {
      await markNotificationRead(getToken, id);
      setRecent((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    },
    [getToken],
  );

  const markAll = useCallback(async () => {
    await markAllNotificationsRead(getToken);
    setRecent((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    void reload();

    void (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      const socket = io(`${apiBaseUrl()}${NOTIFICATIONS_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
      });
      socketRef.current = socket;

      socket.on(SOCKET_EVENTS.notification, (n: Notification) => {
        setRecent((prev) => [n, ...prev].slice(0, recentLimit));
      });
      socket.on(SOCKET_EVENTS.unreadCount, (payload: { count: number }) => {
        setUnreadCount(payload.count);
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, recentLimit]);

  return { unreadCount, recent, reload, markRead, markAll };
}
