'use client';
import { useRef, useState } from 'react';
import { accountRequest } from '@/lib/account-request';
import { Button } from '@/components/ui/button';
export function CreateAccountButton({ returnTo }: { returnTo: string }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function create() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await accountRequest('/api/signup', {});
      window.location.assign(returnTo);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not create your account. Please retry.',
      );
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Button className="w-full" disabled={busy} onClick={() => void create()}>
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
