'use client';
/* Full navigations keep platform sign-in/out outside client routing. */
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { accountRequest } from '../team/team-client';
import { PrivacyLinks } from '@/components/privacy-links';
export function AccountClient() {
  const [account, setAccount] = useState<{
      name: string;
      email: string;
      organizer: boolean;
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    accountRequest<NonNullable<typeof account>>('/api/account')
      .then(setAccount)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      {error && <p role="alert">{error}</p>}
      {!account && !error && (
        <output className="block">Loading account…</output>
      )}
      {account && (
        <>
          <div>
            <p className="break-words text-lg font-medium">{account.name}</p>
            <p className="break-all text-sm text-muted-foreground">
              {account.email}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Signed in with Google. Project access is managed by each organizer.
          </p>
          {account.organizer && (
            <div>
              <a className="underline" href="/settings">
                Account settings
              </a>
            </div>
          )}
        </>
      )}
      <div>
        <a href="/signout-with-chatgpt?return_to=%2F" className="underline">
          Sign out
        </a>
      </div>
      <PrivacyLinks />
    </section>
  );
}
