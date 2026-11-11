'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { workspaceSignInReturn } from '@/lib/workspace-return';

export function SignInButton({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function beginSignIn() {
    setBusy(true);
    setError(false);
    try {
      // NextAuth obtains the CSRF token and submits the provider sign-in POST.
      await signIn('google', { callbackUrl: workspaceSignInReturn(returnTo, window.location.hash) });
    } catch {
      setBusy(false);
      setError(true);
    }
  }
  return <>
    <button type="button" disabled={busy} aria-busy={busy} onClick={() => void beginSignIn()}
      className="flex min-h-11 w-full items-center justify-center gap-2.5 rounded-md border border-[#747775] bg-white px-3 py-2 text-sm font-medium text-[#1f1f1f] hover:bg-[#f2f2f2] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:opacity-60">
      <span aria-hidden="true" className="size-5 shrink-0 bg-[url('/google-signin-mark.svg')] bg-contain bg-no-repeat" />
      <span>{busy ? 'Connecting…' : 'Continue with Google'}</span>
    </button>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">Couldn’t connect. Please try again.</p>}
  </>;
}
