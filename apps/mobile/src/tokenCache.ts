import * as SecureStore from 'expo-secure-store';

interface TokenCache {
  getToken: (key: string) => Promise<string | undefined | null>;
  saveToken: (key: string, token: string) => Promise<void>;
  clearToken?: (key: string) => void;
}

/**
 * Persists the Clerk session token in the device secure store. This is what
 * lets the session survive an app relaunch — on next launch Clerk restores it
 * and refreshes the token automatically.
 */
export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // ignore write failures
    }
  },
};
