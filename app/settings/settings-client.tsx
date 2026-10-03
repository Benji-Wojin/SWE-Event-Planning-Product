'use client';
import { useEffect, useRef, useState } from 'react';
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
  projectId?: string,
): Promise<any> {
  const response = await fetch('/api/gmail/' + action + (projectId !== undefined ? '?project=' + encodeURIComponent(projectId) : ''), {
    method: body ? 'POST' : 'GET',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data: any = await response.json().catch(() => {
    throw new Error(response.status === 401 ? 'Your sign-in expired. Sign in again to continue.' : 'Could not reach Gmail settings. Reload and try again.');
  });
  if (!response.ok) throw new Error(data.error || 'Gmail request failed.');
  return data;
}
export function GmailSettings({ projectId }: { projectId?: string }) {
  const pending = useRef(false);
  const [status, setStatus] = useState<any>(null),
    [labels, setLabels] = useState<any[]>([]),
    [label, setLabel] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loadFailed, setLoadFailed] = useState(false);
  async function refresh() {
    setLoadFailed(false);
    try {
      const value = await gmailRequest('status');
      setStatus(value);
      setLabel(value.labelId);
      setLabels([]);
      if (value.connected) {
        const choices = await gmailRequest('labels');
        setLabels(choices.labels);
      }
    } catch (error) {
      setLoadFailed(true);
      throw error;
    }
  }
  useEffect(() => {
    refresh().catch((e) => setNotice(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Please retry.');
    } finally {
      pending.current = false;
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
              ? status.automatic?.enabled ? 'Gmail connected. Automatic detection enabled.' : 'Gmail connected.'
              : 'Gmail not connected.')}
      </p>
      {loadFailed && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        await refresh();
      })}>Retry connection check</Button>}
      <a className="inline-block text-sm underline" href={'/team?project=' + encodeURIComponent(projectId || 'main')}>Invitation sender settings</a>
      {status?.connected && <AutomaticControls key={status.account} status={status} busy={busy} projectId={projectId} run={run} refresh={refresh} setNotice={setNotice} />}
      <details open={!status?.configured} className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">Google connection setup</summary>
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
              and add the Gmail accounts you will connect as test users. For imports, add gmail.readonly.
              For invitations, add gmail.send, openid and email. Each connection requests only its own access.
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
            Read-only authorization covers mailbox reading. Automatic checks
            require separate approval below; Google access alone does not enable them.
            Testing-mode access may expire after seven days and need
            reconnecting.
          </p>
          {!status?.connected && !status?.senderConnected ? (
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
                  disabled={busy}
                  required
                  placeholder="…apps.googleusercontent.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Google client secret</Label>
                <Input
                  id="clientSecret"
                  name="clientSecret"
                  disabled={busy}
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
              : 'Sign in to Google and approve read-only import access. This connection cannot send email or change your mailbox. Invitation sending is connected separately in Team access.'}
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
      </details>
      {status?.connected && (
        <details className="space-y-4"><summary className="cursor-pointer text-sm font-medium">Manual label import and disconnect</summary>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              3. Import label
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-base">
            <p>
              Create a Gmail label and apply it to messages you want to import.
              {' '}This import setting applies across all your projects.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="project-label">Gmail import label (account-wide)</Label>
                <NativeSelect
                  id="project-label"
                  value={label}
                  disabled={busy}
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
                disabled={busy || !label || label === status.labelId}
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
            {label !== status.labelId && <p role="status" className="text-sm text-muted-foreground">Save the selected label before syncing.</p>}
            {!labels.length && !busy && !loadFailed && (
              <p className="text-sm">
                No custom labels found. Create one in Gmail, then refresh this
                page.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy || !status.labelId || label !== status.labelId}
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
                  disabled={busy || label !== status.labelId}
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
              <a className="rounded-lg border px-3 py-2 text-sm" href={projectId ? '/mail?project=' + encodeURIComponent(projectId) : '/'}>
                {projectId ? 'Private Gmail imports' : 'Choose a project for imports'}
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              This optional label import is manual. Original
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
        </details>
      )}
    </div>
  );
}

function AutomaticControls({ status, busy, projectId, run, refresh, setNotice }: {
  status: any; busy: boolean; projectId?: string;
  run: (fn: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>; setNotice: (value: string) => void;
}) {
  const automatic = status.automatic;
  const [chosen, setChosen] = useState<string[]>(automatic?.projectIds?.length ? automatic.projectIds : projectId ? [projectId] : []);
  const [consent, setConsent] = useState(false);
  const availableIds = status.projects.map((project: any) => project.id).sort().join('|');
  useEffect(() => {
    const available = new Set(availableIds.split('|'));
    setChosen(previous => previous.filter(id => available.has(id)));
    setConsent(false);
  }, [availableIds, automatic?.consentRequired]);
  const changed = [...chosen].sort().join('|') !== [...(automatic?.projectIds || [])].sort().join('|');
  return <Card><CardHeader><CardTitle className="text-xl">Project email detection</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm">Weft looks for project emails and drafts private summaries. No labels required.</p>
      <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 text-sm font-medium">Projects to check</legend>
        {status.projects.map((project: any) => <label key={project.id} className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={chosen.includes(project.id)} onChange={event => {
            setChosen(previous => event.target.checked ? [...previous, project.id] : previous.filter(id => id !== project.id)); setConsent(false);
          }} /><span className="break-words">{project.name}</span>
        </label>)}
        {!status.projects.length && <a className="text-sm underline" href="/setup">Create a project first</a>}
      </fieldset>
      {chosen.length > 10 && <p role="alert" className="text-sm">Select no more than ten projects.</p>}
      {(!automatic.enabled || changed) && <label className="flex items-start gap-3 text-sm leading-relaxed">
        <input type="checkbox" className="mt-1" disabled={busy} checked={consent} onChange={event => setConsent(event.target.checked)} />
        <span>Allow Weft to send email text, selected project/task names, and event dates and locations to Groq for relevance checks, including while I’m away. New connections start with the last 7 days; existing checks resume from saved progress. Matches stay private until I approve a summary. Attachments are not read. I can pause at any time.</span>
      </label>}
      <div className="flex flex-wrap gap-3">
        {(!automatic.enabled || changed) && <Button disabled={busy || !automatic.configured || !chosen.length || chosen.length > 10 || !consent}
          onClick={() => void run(async () => { await gmailRequest('automatic', { enabled: true, projectIds: chosen, consent, consentVersion: 'groq-email-v1' }); await refresh(); setConsent(false); setNotice('Automatic detection enabled. Existing checks resume from saved progress; new connections start with the last 7 days.'); })}>
          {automatic.enabled ? 'Save projects' : 'Enable detection'}
        </Button>}
        {automatic.enabled && <><Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const result = await gmailRequest('check', {}); await refresh();
          setNotice(result.status === 'not_due' ? 'A check is already running or was recently completed.' : result.status === 'checked' || result.status === 'catching_up'
            ? `${result.imported} project emails found. ${result.status === 'catching_up' ? 'More emails will be checked on the next run.' : 'No shared tasks changed.'}`
            : 'The check is delayed. See the connection status below.');
        })}>Check now</Button>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await gmailRequest('automatic', { enabled: false }); await refresh(); setConsent(false); setNotice('Automatic checks paused. Existing private summaries are kept.'); })}>Pause</Button></>}
        {projectId && <a className="self-center text-sm underline" href={'/mail?project=' + encodeURIComponent(projectId)}>Review email summaries</a>}
      </div>
      <p role="status" className="text-sm text-muted-foreground">{automatic.issue || (!automatic.configured ? 'Email suggestions need a server API key.'
        : !automatic.backgroundReady ? 'Background scheduling is not active yet. Use Check now after enabling detection.'
        : automatic.enabled ? 'Background checks are configured for every 5 minutes.' : 'Detection is paused.')}
        {automatic.lastCheck && ` Last successful check: ${new Date(automatic.lastCheck).toLocaleString()}.`}
        {automatic.catchingUp && ' Catching up on older emails.'}
      </p>
      {automatic.recovery && <p className="text-sm">Gmail’s history expired. Weft is rechecking the last 7 days; older emails from the gap may need manual import.</p>}
      <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">Privacy and limits</summary>
        <p className="mt-2">Up to 250 emails per day, 10 projects and the first 60 active task names per project. Clearly unrelated emails are not saved. AI can miss or misclassify messages. Summaries are drafts, not task changes. Pausing or disconnecting stops new checks but keeps imported messages and approved summaries.</p>
      </details>
    </CardContent></Card>;
}
