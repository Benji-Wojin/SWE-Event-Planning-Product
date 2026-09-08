'use client';
import { useEffect, useState, useRef } from 'react';
import { gmailRequest } from '../settings/settings-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
export function MailInbox() {
  const epoch = useRef(0);
  const [messages, setMessages] = useState<any[]>([]),
    [selected, setSelected] = useState(''),
    [notice, setNotice] = useState('Loading private messages…'),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  async function refresh() {
    const ticket = ++epoch.current;
    const value = await gmailRequest('messages');
    if (ticket !== epoch.current || document.hidden) return;
    setMessages(value.messages);
    setNotice(
      value.messages.length
        ? ''
        : 'No Gmail messages imported yet. Connect Gmail and sync your project label in settings.',
    );
  }
  useEffect(() => {
    refresh().catch((e) => setNotice(e.message));
    const hide = () => {
      if (document.hidden) {
        epoch.current++;
        setMessages([]);
        setSelected('');
        setConfirmed(false);
        setNotice('Private messages hidden. Reload to view them again.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      epoch.current++;
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  const message = messages.find((m) => m.id === selected) || messages[0];
  return (
    <>
      <p role="status" className="mb-5 text-sm">
        {notice}
      </p>
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Imported Gmail messages" className="space-y-2">
          {messages.map((m) => (
            <Button
              key={m.id}
              variant={message?.id === m.id ? 'secondary' : 'outline'}
              className="h-auto w-full justify-start whitespace-normal px-4 py-4 text-left"
              onClick={() => {
                setSelected(m.id);
                setConfirmed(false);
              }}
            >
              <span className="block min-w-0">
                <strong className="block break-words">
                  {m.subject || '(No subject)'}
                </strong>
                <span className="mt-1 block break-all text-sm font-normal text-muted-foreground">
                  {m.sender}
                </span>
                <span className="mt-2 block text-xs">
                  {m.reviewed
                    ? 'Summary staged in shared inbox'
                    : 'Private · needs review'}
                </span>
              </span>
            </Button>
          ))}
        </nav>
        {message && (
          <Card key={message.id}>
            <CardContent className="space-y-5 pt-2">
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
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-base leading-relaxed">
                {message.body}
              </pre>
              <p className="text-sm text-muted-foreground">
                Text preview, up to 24,000 characters. HTML-only emails may show
                only a short snippet; attachments are not imported. Check Gmail
                for the complete message. Showing the 100 most recent imports.
              </p>
              {message.reviewed ? (
                <p className="rounded-lg bg-secondary p-4 text-base">
                  A safe summary is in the shared email inbox. Open the shared
                  plan to review its task changes.
                </p>
              ) : (
                <form
                  className="space-y-4 rounded-xl bg-muted p-5"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    const data = Object.fromEntries(new FormData(form));
                    setBusy(true);
                    try {
                      await gmailRequest('review', {
                        ...data,
                        id: message.id,
                        confirmShared: confirmed,
                      });
                      form.reset();
                      setConfirmed(false);
                      await refresh();
                      setNotice(
                        'Safe summary staged in the shared inbox. Review its task, owner, and status before applying.',
                      );
                    } catch (e) {
                      setNotice(
                        e instanceof Error ? e.message : 'Please retry.',
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <h3 className="text-lg font-semibold">
                    Prepare a shareable update
                  </h3>
                  <div className="space-y-2">
                    <Label htmlFor="summaryTitle">Task or topic</Label>
                    <Input
                      id="summaryTitle"
                      name="title"
                      maxLength={200}
                      required
                      placeholder="For example, confirm speaker transport"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="safeSummary">
                      What should the planning team know?
                    </Label>
                    <Textarea
                      id="safeSummary"
                      name="summary"
                      rows={4}
                      maxLength={3000}
                      required
                      placeholder="Write a short summary. Do not include booking codes, private links, or personal information."
                    />
                  </div>
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="confirmShared"
                      checked={confirmed}
                      onCheckedChange={(value) => setConfirmed(value)}
                    />
                    <Label htmlFor="confirmShared" className="leading-relaxed">
                      I reviewed these fields and they are safe to include in
                      the shared plan.
                    </Label>
                  </div>
                  <Button type="submit" disabled={busy || !confirmed}>
                    {busy ? 'Saving…' : 'Stage summary for task review'}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Only the title and summary above are copied. The original
                    stays private, and no task changes until you approve it in
                    the shared inbox.
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
