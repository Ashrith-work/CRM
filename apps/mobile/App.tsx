import { ClerkLoaded, ClerkProvider, SignedIn, SignedOut } from '@clerk/clerk-expo';
import { StatusBar } from 'expo-status-bar';
import { SignInScreen } from './src/SignInScreen';
import { HomeScreen } from './src/HomeScreen';
import { tokenCache } from './src/tokenCache';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

export default function App() {
  if (!publishableKey) {
    throw new Error('Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env.');
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <SignedIn>
          <HomeScreen />
        </SignedIn>
        <SignedOut>
          <SignInScreen />
        </SignedOut>
      </ClerkLoaded>
      <StatusBar style="auto" />
    </ClerkProvider>
  );
}
