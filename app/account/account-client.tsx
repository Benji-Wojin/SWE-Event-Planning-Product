'use client';
/* Full navigations keep platform sign-in/out outside client routing. */
/* oxlint-disable next/no-html-link-for-pages */
import { useEffect, useState } from 'react';
import { accountRequest } from '@/lib/account-request';
import { PrivacyLinks } from '@/components/privacy-links';
export function AccountClient({name,email}:{name:string;email:string}) {
  const [account, setAccount] = useState<{
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
      <div>
        <p className="break-words text-lg font-medium">{name}</p>
        <dl className="mt-3 text-sm">
          <dt className="font-medium">Connected Google email</dt>
          <dd className="mt-1 break-all text-muted-foreground">{email}</dd>
        </dl>
      </div>
      <p className="text-sm text-muted-foreground">
        This is the address you use to sign in. Project access is managed by each organizer.
      </p>
      {error && <p role="alert">{error}</p>}
      {account?.organizer && (
        <div><a className="underline" href="/settings">Account settings</a></div>
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
