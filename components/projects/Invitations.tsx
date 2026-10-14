'use client';
import { useEffect, useRef, useState } from 'react';
import { accountRequest } from '@/lib/account-request';
import { Button } from '@/components/ui/button';
import type { PendingInvitation } from '@/lib/team';
export function Invitations() {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState('');
  const pending = useRef(false),
    epoch = useRef(0);
  async function load() {
    if (pending.current) return;
    const ticket = ++epoch.current;
    try {
      const data = await accountRequest<{ invitations: PendingInvitation[] }>(
        '/api/invitations',
      );
      if (ticket === epoch.current) {
        setInvitations(data.invitations);
        setError('');
      }
    } catch (error) {
      if (ticket === epoch.current)
        setError(
          error instanceof Error ? error.message : 'Invitations did not load.',
        );
    } finally {
      if (ticket === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      epoch.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  async function respond(
    invite: PendingInvitation,
    action: 'accept' | 'decline',
  ) {
    if (pending.current) return;
    pending.current = true;
    epoch.current++;
    setBusy(invite.id);
    setError('');
    try {
      const result = await accountRequest<{ projectId?: string }>(
        '/api/invitations',
        { action, id: invite.id },
      );
      if (action === 'accept' && result.projectId) {
        window.location.assign(
          '/project?project=' + encodeURIComponent(result.projectId),
        );
        return;
      }
      setInvitations((current) =>
        current.filter((item) => item.id !== invite.id),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please retry.');
    } finally {
      pending.current = false;
      setBusy('');
    }
  }
  if (!loading && !error && !invitations.length) return null;
  return (
    <section
      className="mb-7 rounded-xl border bg-card p-5"
      aria-labelledby="invitations-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Invitations
        </h2>
        <Button variant="ghost" disabled={!!busy} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {loading && (
        <p role="status" className="mt-3 text-sm">
          Loading invitations…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {invitations.map((invite) => (
        <div
          key={invite.id}
          className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4"
        >
          <div className="min-w-0">
            <h3 className="break-words font-medium">{invite.name}</h3>
            <p className="break-words text-sm text-muted-foreground">
              Invited by {invite.organizer} · Expires{' '}
              {new Date(invite.expiresAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={!!busy}
              onClick={() => void respond(invite, 'accept')}
            >
              {busy === invite.id ? 'Working…' : 'Join project'}
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => void respond(invite, 'decline')}
            >
              Decline
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
