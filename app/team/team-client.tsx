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
    throw new Error('Could not reach Gather. Reload and try again.');
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
    [notice, setNotice] = useState(''),
    [copiedLink, setCopiedLink] = useState('');
  const pending = useRef(false),
    requestId = useRef('');
  const endpoint = '/api/team?project=' + encodeURIComponent(projectId);
  async function reload() {
    setError('');
    try {
      setTeam(await accountRequest<TeamView>(endpoint));
    } catch (e) {
      setTeam(null);
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    accountRequest<TeamView>(endpoint)
      .then((value) => {
        if (active) setTeam(value);
      })
      .catch((e) => {
        if (active) {
          setTeam(null);
          setError((e as Error).message);
        }
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  async function change(input: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    setCopiedLink('');
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
  async function copy(link: string) {
    const full = new URL(link, location.origin).href;
    try {
      await navigator.clipboard.writeText(full);
      setNotice('Invitation link copied.');
      setCopiedLink('');
    } catch {
      setCopiedLink(full);
      setNotice('Copy the invitation link below.');
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
      {copiedLink && (
        <Input
          aria-label="Invitation link"
          readOnly
          value={copiedLink}
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {!team && !error && <output className="block">Loading team…</output>}
      {team && (
        <>
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
                    'Invitation created. Copy its link and share it with your teammate.',
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
                  Create invitation
                </Button>
              </div>
            </form>
            <p className="text-sm text-muted-foreground">
              Links expire in 7 days and only work for the invited email. No
              email is sent automatically.
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer">Private site access</summary>
              <p className="mt-2 text-muted-foreground">
                Also share access to this private site with your teammate in the
                site’s sharing settings. The project invitation does not change
                who can open the site.
              </p>
            </details>
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
            <h2 className="text-lg font-semibold">Pending invitations</h2>
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
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => copy(invite.link)}
                  >
                    Copy link
                  </Button>
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
