import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, SignUpButton } from '@clerk/nextjs';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-3xl font-bold sm:text-4xl">CRM</h1>
      <p className="max-w-md text-slate-600">
        Internal CRM foundation. Sign in to view your account, organization, and role.
      </p>

      <SignedOut>
        <div className="flex items-center gap-3">
          <SignInButton mode="modal">
            <button className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-lg border border-brand-600 px-5 py-2.5 font-medium text-brand-600 hover:bg-brand-50">
              Sign up
            </button>
          </SignUpButton>
        </div>
      </SignedOut>

      <SignedIn>
        <Link
          href="/dashboard"
          className="rounded-lg bg-brand-600 px-5 py-2.5 font-medium text-white hover:bg-brand-700"
        >
          Go to dashboard
        </Link>
      </SignedIn>
    </main>
  );
}
