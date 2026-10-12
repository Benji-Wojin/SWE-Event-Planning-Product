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
    <button type="button" disabled={busy} onClick={() => void beginSignIn()} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
      {busy ? 'Connecting…' : 'Continue with Google'}
    </button>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">Couldn’t connect. Please try again.</p>}
  </>;
}
