'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TeamView } from '@/lib/team';
export async function accountRequest<T>(
  path: string,
  input?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: input ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: input
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: input ? JSON.stringify(input) : undefined,
  });
  const data: unknown = await response.json().catch(() => {
    throw new Error('Could not reach Weft. Reload and try again.');
  });
  if (!response.ok)
    throw new Error(
      data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof data.error === 'string'
        ? data.error
        : 'Please try again.',
    );
  return data as T;
}
export function TeamClient({ projectId }: { projectId: string }) {
  const [team, setTeam] = useState<TeamView | null>(null),
    [error, setError] = useState(''),
    [email, setEmail] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const pending = useRef(false),
    requestId = useRef(''),
    readEpoch = useRef(0);
  const endpoint = '/api/team?project=' + encodeURIComponent(projectId);
  async function reload() {
    const epoch = ++readEpoch.current;
    setError('');
    try {
      const value = await accountRequest<TeamView>(endpoint);
      if (epoch === readEpoch.current) setTeam(value);
    } catch (e) {
      if (epoch === readEpoch.current) {
        setTeam(null);
        setError((e as Error).message);
      }
    }
  }
  useEffect(() => {
    let active = true;
    const epoch = ++readEpoch.current;
    accountRequest<TeamView>(endpoint)
      .then((value) => {
        if (active && epoch === readEpoch.current) setTeam(value);
      })
      .catch((e) => {
        if (active && epoch === readEpoch.current) {
          setTeam(null);
          setError((e as Error).message);
        }
      });
    return () => {
      active = false;
      ++readEpoch.current;
    };
  }, [endpoint]);
  const sending = team?.invitations.some(
    (invite) => invite.delivery.status === 'sending',
  );
  useEffect(() => {
    if (!sending) return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (pending.current || polling) return;
      polling = true;
      const epoch = ++readEpoch.current;
      accountRequest<TeamView>(endpoint)
        .then((value) => {
          if (active && epoch === readEpoch.current && !pending.current)
            setTeam(value);
        })
        .catch((e) => {
          if (active && epoch === readEpoch.current && !pending.current)
            setError(e.message);
        })
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sending, endpoint]);
  useEffect(() => {
    const result = new URLSearchParams(location.search).get('sender');
    if (result === 'connected')
      setNotice(
        'Invitation sender connected. No invitations have been sent yet.',
      );
    if (result === 'cancelled')
      setNotice(
        'Google connection cancelled. Your existing sender is unchanged.',
      );
  }, []);
  async function change(input: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true;
    ++readEpoch.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setTeam(await accountRequest<TeamView>(endpoint, input));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function senderAction(action: 'connect' | 'disconnect') {
    if (pending.current) return;
    pending.current = true;
    ++readEpoch.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await accountRequest<{ url?: string }>(
        '/api/sender?project=' + encodeURIComponent(projectId),
        { action },
      );
      if (result.url) {
        location.assign(result.url);
        return;
      }
      await reload();
      setNotice(
        'Invitation sender disconnected from Weft. Already-sent invitations still work.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <a
        className="text-sm underline"
        href={'/project?project=' + encodeURIComponent(projectId)}
      >
        Back to project
      </a>
      {error && (
        <div role="alert" className="rounded-xl border border-destructive p-4">
          <p>{error}</p>
          <Button
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={reload}
          >
            Reload team
          </Button>
        </div>
      )}
      {notice && <output className="block text-sm">{notice}</output>}
      {!team && !error && <output className="block">Loading team…</output>}
      {team && (
        <>
          <details className="space-y-3 rounded-xl border bg-card p-5">
            <summary className="cursor-pointer font-medium">Optional email delivery</summary>
            <p className="break-all text-sm">
              {team.sender.connected
                ? 'Sending from ' + team.sender.email
                : 'In-app invitations work without Gmail. Connect a separate sender only if you also want to send invitation emails.'}
            </p>
            <p className="text-sm text-muted-foreground">
              Used for invitations across your projects. Separate from your
              email imports.
            </p>
            {!team.sender.configured ? (
              <a
                className="inline-block text-sm underline"
                href={'/settings?project=' + encodeURIComponent(projectId)}
              >
                Email delivery is not configured
              </a>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  variant={team.sender.connected ? 'outline' : 'default'}
                  onClick={() => void senderAction('connect')}
                >
                  {team.sender.connected
                    ? 'Change or reconnect Gmail'
                    : 'Connect invitation Gmail'}
                </Button>
                {team.sender.connected && (
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          'Disconnect this email sender? In-app invitations will still work. An email already being sent may still go out.',
                        )
                      )
                        void senderAction('disconnect');
                    }}
                  >
                    Disconnect sender
                  </Button>
                )}
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer">One-time setup</summary>
              <p className="mt-2 text-muted-foreground">
                Create a separate Gmail account, then connect it here. In your
                Google Cloud app, enable Gmail API, add this account as a test
                user, and add the gmail.send, openid and email scopes. Your
                existing Google client and callback URL can be reused. You
                approve sending access; no Gmail password is stored in Weft.
              </p>
              <p className="mt-2 text-muted-foreground">
                Google testing-mode authorization may need reconnecting after
                seven days. Disconnect removes Weft’s stored tokens; you can
                also revoke access in your Google account.
              </p>
            </details>
          </details>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-semibold">Invite to {team.name}</h2>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                requestId.current ||= crypto.randomUUID();
                if (
                  await change({
                    action: 'invite',
                    email,
                    requestId: requestId.current,
                  })
                ) {
                  setEmail('');
                  requestId.current = '';
                  setNotice(
                    'Invitation created. They can accept it from their Projects page when signed in with that email.',
                  );
                }
              }}
            >
              <Label htmlFor="invite-email">Teammate’s sign-in email</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="invite-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  disabled={busy}
                  className="min-w-0 flex-1 basis-52"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    requestId.current = '';
                  }}
                />
                <Button disabled={busy} type="submit">
                  {busy ? 'Working…' : 'Invite teammate'}
                </Button>
              </div>
            </form>
            <p className="text-sm text-muted-foreground">
              Appears on their Projects page. They can sign up with this email
              if they do not have an account yet. Expires in 7 days. No email is sent automatically.
            </p>
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="text-lg font-semibold">People</h2>
            <div>
              <p className="font-medium break-words">
                {team.owner.name}{' '}
                <span className="text-sm text-muted-foreground">
                  · Organizer
                </span>
              </p>
              <p className="break-all text-sm text-muted-foreground">
                {team.owner.email}
              </p>
            </div>
            {team.members.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium">{member.name}</p>
                  <p className="break-all text-sm text-muted-foreground">
                    {member.email}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        'Remove ' +
                          member.name +
                          ' from this project? Their tasks and comments will be kept.',
                      )
                    )
                      void change({
                        action: 'removeMember',
                        id: member.id,
                        revision: member.revision,
                      });
                  }}
                >
                  Remove access
                </Button>
              </div>
            ))}
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Pending invitations</h2>
              <Button variant="ghost" disabled={busy} onClick={reload}>
                Refresh status
              </Button>
            </div>
            {!team.invitations.length && (
              <p className="text-sm text-muted-foreground">
                No pending invitations.
              </p>
            )}
            {team.invitations.map((invite) => (
              <div key={invite.id} className="space-y-3 border-t pt-4">
                <div>
                  <p className="break-all font-medium">{invite.email}</p>
                  <p className="text-sm text-muted-foreground">
                    Expires {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                  <p className="mt-1 text-sm" role="status">
                    {invite.delivery.status === 'sent'
                      ? 'Sent via Gmail · ' +
                        new Date(invite.delivery.sentAt).toLocaleString()
                      : invite.delivery.status === 'sending'
                        ? 'Sending…'
                        : invite.delivery.status === 'unknown'
                          ? 'Sending not confirmed'
                          : invite.delivery.status === 'failed'
                            ? 'Not sent'
                            : 'Available in Weft'}
                  </p>
                  {invite.delivery.issue && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {invite.delivery.issue}
                    </p>
                  )}
                  {invite.delivery.status === 'sent' && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      From {invite.delivery.sender}. Gmail accepted it; inbox
                      delivery is not guaranteed.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {invite.delivery.canRetry && team.sender.connected && (
                    <Button
                      variant="outline"
                      disabled={busy || !team.sender.connected}
                      onClick={() =>
                        void change({
                          action: 'sendExistingInvite',
                          id: invite.id,
                          senderEmail: team.sender.email,
                        })
                      }
                    >
                      {invite.delivery.status === 'failed'
                        ? 'Retry sending'
                        : 'Also send email'}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          'Revoke the invitation for ' + invite.email + '?',
                        )
                      )
                        void change({ action: 'revokeInvite', id: invite.id });
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
