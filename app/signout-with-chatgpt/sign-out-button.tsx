'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';

export function SignOutButton({ returnTo }: { returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function confirmSignOut() {
    setBusy(true);
    setError(false);
    try {
      // Explicit user action + NextAuth's CSRF-protected POST, never a GET side effect.
      await signOut({ callbackUrl: returnTo });
    } catch {
      setBusy(false);
      setError(true);
    }
  }
  return <>
    <button type="button" disabled={busy} onClick={() => void confirmSignOut()} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">Couldn’t sign out. Please try again.</p>}
  </>;
}
