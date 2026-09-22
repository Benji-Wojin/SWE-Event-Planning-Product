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
export function MailInbox() {
  const epoch = useRef(0);
  const saving = useRef(false);
  const dirty = useRef(false);
  const [messages, setMessages] = useState<any[]>([]),
    [tasks, setTasks] = useState<any[]>([]),
    [selected, setSelected] = useState(''),
    [notice, setNotice] = useState('Loading private messages…'),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  async function refresh() {
    const ticket = ++epoch.current;
    const value = await gmailRequest('messages');
    if (ticket !== epoch.current || document.hidden) return;
    setMessages(value.messages);
    setTasks(value.tasks || []);
    setNotice(
      value.messages.length
        ? ''
        : 'No imported messages. Connect and sync Gmail in settings.',
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
    return () => {
      epoch.current++;
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
                  Private text preview ·{' '}
                  {new Date(message.receivedAt).toLocaleString()}
                </p>
                <h2 className="my-2 break-words text-xl font-semibold">
                  {message.subject}
                </h2>
                <p className="break-all text-sm">{message.sender}</p>
              </div>
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
                  <a className="underline" href={'/?message=' + encodeURIComponent(message.sharedMessageId)}>Review briefing →</a>
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
                      });
                      if (ticket !== epoch.current || document.hidden) return;
                      dirty.current = false;
                      saving.current = false;
                      window.location.href = '/?message=' + encodeURIComponent(result.id);
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
