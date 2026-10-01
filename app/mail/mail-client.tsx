'use client';
import { useEffect, useState, useRef } from 'react';
import { gmailRequest } from '../settings/settings-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
export function MailInbox({ projectId }: { projectId: string }) {
  const projectUrl = '/project?project=' + encodeURIComponent(projectId);
  const [projectName, setProjectName] = useState('');
  const [automatic, setAutomatic] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const epoch = useRef(0);
  const saving = useRef(false);
  const dirty = useRef(false);
  const [messages, setMessages] = useState<any[]>([]),
    [tasks, setTasks] = useState<any[]>([]),
    [selected, setSelected] = useState(''),
    [notice, setNotice] = useState('Loading private messages…'),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  async function refresh(afterMove = false) {
    const ticket = ++epoch.current;
    const value = await gmailRequest('messages', undefined, projectId);
    if (ticket !== epoch.current || document.hidden || dirty.current || (saving.current && !afterMove)) return;
    setMessages(value.messages);
    setSelected(previous => value.messages.some((m: any) => m.id === previous) ? previous : value.messages[0]?.id || '');
    setConfirmed(false);
    setAutomatic(value.automatic);
    setProjects(value.projects || []);
    setTasks(value.tasks || []);
    setProjectName(value.projectName || '');
    setNotice(
      value.messages.length
        ? ''
        : 'No project emails found yet. Enable automatic detection in Gmail settings.',
    );
  }
  useEffect(() => {
    refresh().catch((e) => setNotice(e.message));
    const hide = () => {
      if (document.hidden) {
        epoch.current++;
        dirty.current = false;
        setMessages([]);
        setSelected('');
        setConfirmed(false);
        setNotice('Private messages hidden and unsaved summaries cleared. Reload to view messages.');
      } else {
        refresh().catch(e => setNotice(e.message));
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    const leave = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (saving.current || (dirty.current && !window.confirm('Discard your unsaved summary?'))) { event.preventDefault(); return; }
      dirty.current = false;
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', leave);
    const timer = window.setInterval(() => {
      if (!document.hidden && !dirty.current && !saving.current) refresh().catch(e => setNotice(e.message));
    }, 30000);
    return () => {
      epoch.current++;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', leave);
    };
  }, []);
  const groups = [...messages.reduce((map: Map<string, any>, m) => {
    const key = m.taskId ? 'task:' + m.taskId : 'thread:' + m.threadKey;
    if (!map.has(key)) map.set(key, { key, title: m.taskTitle || m.subject || '(No subject)', messages: [] });
    map.get(key).messages.push(m);
    return map;
  }, new Map()).values()];
  const group = groups.find((g) => g.messages.some((m: any) => m.id === selected)) || groups[0];
  const message = group?.messages.find((m: any) => m.id === selected) || group?.messages.find((m: any) => !m.reviewed) || group?.messages[0];
  function chooseMessage(id: string) {
    if (saving.current || id === message?.id) return;
    if (dirty.current && !window.confirm('Discard your unsaved summary?')) return;
    dirty.current = false;
    setSelected(id);
    setConfirmed(false);
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-base">Summaries for <strong>{projectName || 'Loading project…'}</strong></p>
        <Button variant="outline" disabled={busy} onClick={() => { if (!dirty.current) refresh().catch(e => setNotice(e.message)); else setNotice('Save or discard your draft before refreshing.'); }}>Refresh</Button></div>
      {automatic?.issue && <p role="status" className="mb-3 text-sm">{automatic.issue} <a className="underline" href={'/settings?project=' + encodeURIComponent(projectId)}>Gmail settings</a></p>}
      <p role="status" className="mb-5 text-sm">
        {notice}
      </p>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Imported task conversations" className="space-y-2">
          {groups.map((g) => (
            <Button
              key={g.key}
              variant={group?.key === g.key ? 'secondary' : 'outline'}
              className="h-auto w-full justify-start whitespace-normal px-4 py-4 text-left"
              disabled={busy}
              onClick={() => {
                if (group?.key === g.key) return;
                chooseMessage((g.messages.find((m: any) => !m.reviewed) || g.messages[0]).id);
              }}
            >
              <span className="block min-w-0">
                <strong className="block break-words">
                  {g.title}
                </strong>
                <span className="mt-1 block break-all text-sm font-normal text-muted-foreground">
                  {g.messages.length} emails
                </span>
                <span className="mt-2 block text-xs">
                  {g.messages.filter((m: any) => !m.reviewed).length} need review
                </span>
              </span>
            </Button>
          ))}
        </nav>
        {message && (
          <Card key={message.id}>
            <CardContent className="space-y-5 pt-2">
              <div className="flex flex-wrap gap-2" aria-label="Emails in this conversation">
                {group.messages.map((m: any, index: number) => <Button key={m.id} variant={m.id === message.id ? 'secondary' : 'outline'} size="sm" disabled={busy} onClick={() => chooseMessage(m.id)}>
                  Email {group.messages.length - index} · {m.reviewed ? 'Summary saved' : 'Needs review'}
                </Button>)}
              </div>
              <div className="border-b pb-4">
                <p className="text-sm text-muted-foreground">
                  {message.ai?.relevance === 'possible' ? 'Possible match · ' : 'Private email · '}
                  {new Date(message.receivedAt).toLocaleString()}
                </p>
                <h2 className="my-2 break-words text-xl font-semibold">
                  {message.subject}
                </h2>
                <p className="break-all text-sm">{message.sender}</p>
              </div>
              {message.ai && <section className="space-y-2 rounded-lg bg-secondary p-4"><h3 className="font-medium">{message.ai.title}</h3><p className="whitespace-pre-wrap break-words text-base">{message.ai.summary}</p>
                <details className="text-sm"><summary className="cursor-pointer">Why this was suggested</summary><p className="mt-2">{message.ai.reason}</p></details>
                <p className="text-sm text-muted-foreground">AI draft. Review before sharing.</p></section>}
              {message.ai && projects.length > 1 && <details className="text-sm"><summary className="cursor-pointer">Wrong project?</summary>
                <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={event => {
                  event.preventDefault();
                  if (saving.current || (dirty.current && !window.confirm('Discard your unsaved summary and move this email?'))) return;
                  const destination = String(new FormData(event.currentTarget).get('destination') || '');
                  saving.current = true; setBusy(true);
                  gmailRequest('move', { id: message.id, projectId: destination }, projectId).then(async () => {
                    dirty.current = false; setSelected(''); setConfirmed(false); await refresh(true); setNotice('Private email moved. Previously shared summaries are unchanged.');
                  }).catch(e => setNotice(e.message)).finally(() => { saving.current = false; setBusy(false); });
                }}>
                  <label className="space-y-2">Move private email to<select name="destination" className="block w-full rounded-md border bg-background p-2" required disabled={busy} defaultValue="">
                    <option value="" disabled>Choose a project</option>{projects.filter(p => p.id !== projectId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select></label><Button type="submit" variant="outline" disabled={busy}>Move</Button>
                </form><p className="mt-2 text-muted-foreground">Only this private email moves. Saved shared summaries stay where they are.</p>
              </details>}
              <details><summary className="cursor-pointer text-sm font-medium">View original email</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-base leading-relaxed">
                {message.body}
              </pre></details>
              <p className="text-sm text-muted-foreground">
                Text preview, up to 24,000 characters. HTML-only emails may show
                only a short snippet; attachments are not imported. Check Gmail
                for the complete message. Showing the 100 most recent imports.
              </p>
              {message.reviewed ? (
                <p className="rounded-lg bg-secondary p-4 text-base">
                  <a className="underline" href={projectUrl + '&message=' + encodeURIComponent(message.sharedMessageId)}>Review briefing →</a>
                </p>
              ) : (
                <form
                  className="space-y-4 rounded-xl bg-muted p-5"
                  aria-busy={busy}
                  onChangeCapture={() => { dirty.current = true; }}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (saving.current) return;
                    saving.current = true;
                    const ticket = epoch.current;
                    const form = event.currentTarget;
                    const data = Object.fromEntries(new FormData(form));
                    setBusy(true);
                    try {
                      const result = await gmailRequest('review', {
                        ...data,
                        id: message.id,
                        confirmShared: confirmed,
                      }, projectId);
                      if (ticket !== epoch.current || document.hidden) return;
                      dirty.current = false;
                      saving.current = false;
                      window.location.href = projectUrl + '&message=' + encodeURIComponent(result.id);
                    } catch (e) {
                      setNotice(
                        e instanceof Error ? e.message : 'Please retry.',
                      );
                    } finally {
                      saving.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <h3 className="text-lg font-semibold">
                    Shared update
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="relatedTask">Related task</Label>
                    <Select name="taskId" defaultValue={message.taskId || ''} disabled={busy} onValueChange={() => { dirty.current = true; }}>
                      <SelectTrigger id="relatedTask" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="">Suggest from summary</SelectItem>{tasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="summaryTitle">Task or topic</Label>
                    <Input
                      id="summaryTitle"
                      name="title"
                      disabled={busy}
                      maxLength={200}
                      required
                      placeholder="Confirm speaker transport"
                      defaultValue={message.ai?.title || ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="safeSummary">
                      Shareable summary
                    </Label>
                    <Textarea
                      id="safeSummary"
                      name="summary"
                      disabled={busy}
                      rows={4}
                      maxLength={3000}
                      required
                      placeholder="Write a short summary. Do not include booking codes, private links, or personal information."
                      defaultValue={message.ai?.summary || ''}
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="confirmShared"
                      disabled={busy}
                      checked={confirmed}
                      onCheckedChange={(value) => { dirty.current = true; setConfirmed(value); }}
                    />
                    <Label htmlFor="confirmShared" className="leading-relaxed">
                      I reviewed these fields and they are safe to include in
                      the shared plan.
                    </Label>
                  </div>
                  <Button type="submit" disabled={busy || !confirmed}>
                    {busy ? 'Saving…' : 'Review briefing →'}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Only the title and summary above are copied. The original
                    stays private, and no task changes until you approve it in
                    the email briefing.
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
