'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
export async function gmailRequest(
  action: string,
  body?: unknown,
): Promise<any> {
  const response = await fetch('/api/gmail/' + action, {
    method: body ? 'POST' : 'GET',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(data.error || 'Gmail request failed.');
  return data;
}
export function GmailSettings() {
  const [status, setStatus] = useState<any>(null),
    [labels, setLabels] = useState<any[]>([]),
    [label, setLabel] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const value = await gmailRequest('status');
    setStatus(value);
    setLabel(value.labelId);
    if (value.connected) {
      const choices = await gmailRequest('labels');
      setLabels(choices.labels);
    }
  }
  useEffect(() => {
    refresh().catch((e) => setNotice(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <p role="status" className="rounded-lg bg-secondary p-3 text-sm">
        {notice ||
          (!status
            ? 'Checking your connection…'
            : status.connected
              ? 'Gmail connected. Only your selected label is imported when you sync.'
              : 'Gmail not connected.')}
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">1. Google OAuth client</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 text-base">
          <p>
            Google requires an OAuth client for this private pilot. Create it in
            your own Google Cloud project; never send the client secret in chat.
          </p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              Enable the{' '}
              <a
                className="underline"
                href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                target="_blank"
                rel="noreferrer"
              >
                Gmail API
              </a>
              .
            </li>
            <li>
              In Google Auth Platform, set the audience to External / Testing
              and add your Gmail account as a test user. Add the Gmail read-only
              scope.
            </li>
            <li>
              Create an OAuth client of type <strong>Web application</strong>.
              Add this exact authorized redirect URI:
            </li>
          </ol>
          <code className="block break-all rounded-lg bg-muted p-4 text-sm">
            {status?.redirectUri || 'Loading your private site address…'}
          </code>
          <p className="text-sm text-muted-foreground">
            Read-only authorization covers mailbox reading; the project label
            restricts what Gather imports, not what Google technically permits.
            Testing-mode access may expire after seven days and need
            reconnecting.
          </p>
          {!status?.connected ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                void run(async () => {
                  await gmailRequest('configure', data);
                  form.reset();
                  await refresh();
                  setNotice(
                    'Google client saved securely. You can now authorize Gmail.',
                  );
                });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="clientId">Google client ID</Label>
                <Input
                  id="clientId"
                  name="clientId"
                  required
                  placeholder="…apps.googleusercontent.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Google client secret</Label>
                <Input
                  id="clientSecret"
                  name="clientSecret"
                  type="password"
                  required
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={busy || !status} size="lg">
                {status?.configured
                  ? 'Replace Google client'
                  : 'Save Google client'}
              </Button>
            </form>
          ) : (
            <p className="rounded-lg border p-3 text-sm">
              Google client configured. Its secret is encrypted on the server
              and never returned to this page.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            2. Gmail access
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-base">
          <p>
            {status?.connected
              ? `Connected account: ${status.account}`
              : 'Sign in to Google and approve read-only access. Gather never sends email or changes your mailbox.'}
          </p>
          <Button
            disabled={busy || !status?.configured}
            size="lg"
            onClick={() =>
              void run(async () => {
                const data = await gmailRequest('connect', {});
                window.location.assign(data.url);
              })
            }
          >
            {status?.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
          </Button>
        </CardContent>
      </Card>
      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              3. Import label
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-base">
            <p>
              Create a Gmail label and apply it to messages you want to import.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="project-label">Project label</Label>
                <NativeSelect
                  id="project-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                >
                  <NativeSelectOption value="">
                    Choose a Gmail label
                  </NativeSelectOption>
                  {labels.map((l) => (
                    <NativeSelectOption key={l.id} value={l.id}>
                      {l.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button
                disabled={busy || !label}
                onClick={() =>
                  void run(async () => {
                    await gmailRequest('label', { labelId: label });
                    await refresh();
                    setNotice(
                      'Label saved. Sync to import messages.',
                    );
                  })
                }
              >
                Save label
              </Button>
            </div>
            {!labels.length && (
              <p className="text-sm">
                No custom labels found. Create one in Gmail, then refresh this
                page.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || !status.labelId}
                onClick={() =>
                  void run(async () => {
                    const result = await gmailRequest('sync', {});
                    await refresh();
                    setNotice(
                      `${result.imported} new messages imported privately. No task changed.`,
                    );
                  })
                }
              >
                {busy ? 'Working…' : 'Sync latest 20 messages'}
              </Button>
              {status.hasMore && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await gmailRequest('sync', {
                        nextPage: true,
                      });
                      await refresh();
                      setNotice(
                        `${result.imported} older messages imported privately.`,
                      );
                    })
                  }
                >
                  Load next 20
                </Button>
              )}
              <a className="rounded-lg border px-3 py-2 text-sm" href="/mail">
                Private inbox →
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Sync is manual in this pilot, not background monitoring. Original
              messages stay in an organizer-only inbox. You choose what can
              enter the shared plan.{' '}
              {status.lastSync &&
                `Last synced: ${new Date(status.lastSync).toLocaleString()}.`}
            </p>
            <details className="border-t pt-4">
              <summary className="cursor-pointer text-sm">
                Disconnect Gmail
              </summary>
              <p className="my-3 text-sm">
                Revokes Google access for this OAuth application. Already
                imported private emails and approved task updates remain stored.
              </p>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await gmailRequest('disconnect', {});
                    await refresh();
                    setNotice(
                      'Gmail access revoked. Existing imported records were kept.',
                    );
                  })
                }
              >
                Revoke access &amp; disconnect
              </Button>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
