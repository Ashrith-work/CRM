import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@clerk/clerk-expo';
import { registerPushToken } from './api';

/**
 * Expo push registration + tap routing. Everything here is best-effort: Expo Go
 * on SDK 53 and simulators can't obtain a push token, so every call is wrapped
 * and degrades to a no-op — the rest of the app must keep working.
 */

// Show a banner/alert when a push arrives while the app is foregrounded.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () =>
      ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        // SDK 53 fields (harmless on older typings via the cast below).
        shouldShowBanner: true,
        shouldShowList: true,
      }) as unknown as Notifications.NotificationBehavior,
  });
} catch {
  // no-op — the handler is best-effort
}

type TapHandler = (taskId: string) => void;
let tapHandler: TapHandler | null = null;

/** Register a callback invoked when a push carrying a taskId is tapped. */
export function setTaskTapHandler(cb: TapHandler | null): void {
  tapHandler = cb;
}

function extractTaskId(data: unknown): string | null {
  if (data && typeof data === 'object' && 'taskId' in data) {
    const v = (data as Record<string, unknown>).taskId;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

async function registerDevice(getToken: () => Promise<string | null>): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators can't get a token
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (!granted) return;

    const eas = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
    const projectId = eas?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const expoToken = resp.data;
    if (!expoToken) return;

    const apiToken = await getToken();
    if (!apiToken) return;
    await registerPushToken(apiToken, {
      token: expoToken,
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
    });
  } catch {
    // best-effort — never crash the app on push failures
  }
}

/** Registers this device for push on sign-in and routes tapped pushes to tasks. */
export function usePushRegistration(): void {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;
    void registerDevice(getToken);

    let sub: { remove: () => void } | undefined;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const taskId = extractTaskId(response.notification.request.content.data);
        if (taskId && tapHandler) tapHandler(taskId);
      });
    } catch {
      // listener best-effort
    }

    // Cold-start: app opened by tapping a push.
    try {
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        const taskId = response ? extractTaskId(response.notification.request.content.data) : null;
        if (taskId && tapHandler) tapHandler(taskId);
      });
    } catch {
      // best-effort
    }

    return () => {
      try {
        sub?.remove();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);
}
