'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { accountRequest } from '@/lib/account-request';
import { invitationProjectHref } from '@/lib/invitation-project-link';
import type { InviteView } from '@/lib/team';
export function JoinClient({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteView | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const navigating = useRef(false);
  useEffect(() => {
    let active = true;
    function load() {
      setInvite(null);
      setError('');
      accountRequest<InviteView>('/api/join?invite=' + encodeURIComponent(token))
        .then(value => { if (active) setInvite(value); })
        .catch(e => { if (active) setError(e.message); });
    }
    function restore(event: PageTransitionEvent) {
      if (!event.persisted || !navigating.current) return;
      navigating.current = pending.current = false;
      setBusy(false);
      load();
    }
    load();
    window.addEventListener('pageshow', restore);
    return () => { active = false; window.removeEventListener('pageshow', restore); };
  }, [token]);
  async function accept() {
    if (!invite || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await accountRequest<{ projectId: string }>('/api/join', {
        token,
      });
      if (typeof result?.projectId !== 'string' || !result.projectId)
        throw new Error('Could not confirm project access. Reload to check before trying again.');
      window.location.assign(invitationProjectHref(result.projectId, !invite.joined));
      navigating.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!navigating.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="space-y-5 rounded-xl border bg-card p-5">
      {error && <p role="alert">{error}</p>}
      {!invite && !error && (
        <output className="block">Checking invitation…</output>
      )}
      {invite && (
        <>
          <h2 className="text-xl font-semibold">{invite.name}</h2>
          <p className="break-all text-sm text-muted-foreground">
            Signed in as {invite.email}
          </p>
          <p className="text-sm">
            You can claim tasks, report progress, comment, and contribute event
            information. Only the organizer can change the plan or view private
            bookings.
          </p>
          <Button disabled={busy} onClick={accept}>
            {busy
              ? 'Joining…'
              : invite.joined
                ? 'Open project'
                : 'Join project'}
          </Button>
        </>
      )}
      <div>
        <a
          className="text-sm underline"
          href={
            '/signout-with-chatgpt?return_to=' +
            encodeURIComponent('/join?invite=' + encodeURIComponent(token))
          }
        >
          Use another account
        </a>
      </div>
    </section>
  );
}
