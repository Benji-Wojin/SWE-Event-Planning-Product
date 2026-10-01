'use client';
import { useRef, useState } from 'react';

const areas = ['Projects', 'Tasks', 'Email', 'Guests and files', 'Team access', 'Other'];
const control = 'mt-2 w-full rounded-lg border border-border bg-background p-3 text-foreground';
type Draft = { kind: string; area: string; title: string; details: string; steps: string; expected: string };
const empty: Draft = { kind: 'bug', area: 'Tasks', title: '', details: '', steps: '', expected: '' };
export function FeedbackForm() {
  const [draft, setDraft] = useState<Draft>({ ...empty });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [receipt, setReceipt] = useState('');
  const pending = useRef<{ id: string; payload: string } | null>(null);
  const inFlight = useRef(false);
  function edit(key: keyof Draft, value: string) { setDraft(current => ({ ...current, [key]: value, ...(key === 'kind' && value === 'request' ? { steps: '' } : {}) })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    const payload = JSON.stringify(draft);
    if (!pending.current || pending.current.payload !== payload) pending.current = { id: crypto.randomUUID(), payload };
    const id = pending.current.id;
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Gather-Request': '1' },
        body: JSON.stringify({ id, ...draft }), signal: AbortSignal.timeout(20000),
      });
      const data = await response.json() as { saved?: boolean; id?: string; error?: string };
      if (!response.ok || data.saved !== true || data.id !== id) throw new Error(data.error || 'The report could not be saved. Please retry.');
      setReceipt(data.id); pending.current = null;
    } catch (reason) {
      setError(reason instanceof Error && reason.name !== 'TimeoutError' ? reason.message : 'The connection timed out. Retry to confirm your report was saved.');
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (receipt) return <section role="status" className="rounded-xl border border-border bg-card p-6">
    <h2 className="text-xl font-semibold">Report received</h2>
    <p className="mt-2 text-muted-foreground">The owner will review it before any work begins.</p>
    <p className="mt-4 break-all text-sm text-muted-foreground">Reference: {receipt}</p>
    <button type="button" className="mt-5 rounded-lg bg-primary px-5 py-3 text-primary-foreground" onClick={() => { setReceipt(''); setDraft({ ...empty }); }}>Send another report</button>
  </section>;
  return <form onSubmit={submit} className="space-y-5">
    <fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium">Type<select className={control} value={draft.kind} onChange={event => edit('kind', event.target.value)}><option value="bug">Bug</option><option value="error">Error message</option><option value="request">Feature request</option></select></label>
        <label className="block text-sm font-medium">Where in Weft?<select className={control} value={draft.area} onChange={event => edit('area', event.target.value)}>{areas.map(area => <option key={area}>{area}</option>)}</select></label>
      </div>
      <label className="block text-sm font-medium">Short summary<input required maxLength={120} className={control} value={draft.title} onChange={event => edit('title', event.target.value)} placeholder="For example: A task disappears after I save" /></label>
      <label className="block text-sm font-medium">{draft.kind === 'request' ? 'What would you like to do?' : 'What happened?'}<textarea required maxLength={1500} rows={5} className={control} value={draft.details} onChange={event => edit('details', event.target.value)} /></label>
      {draft.kind !== 'request' && <label className="block text-sm font-medium">Steps to reproduce (optional)<textarea maxLength={1000} rows={3} className={control} value={draft.steps} onChange={event => edit('steps', event.target.value)} placeholder="1. Open a task…" /></label>}
      <label className="block text-sm font-medium">{draft.kind === 'request' ? 'How would this help? (optional)' : 'What did you expect? (optional)'}<textarea maxLength={500} rows={2} className={control} value={draft.expected} onChange={event => edit('expected', event.target.value)} /></label>
      <p className="text-sm text-muted-foreground">Include only details you want to share for troubleshooting. Don’t paste private emails, guest information, booking codes or passwords. No project content is attached automatically.</p>
      <button className="rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground disabled:opacity-60" type="submit">{busy ? 'Sending…' : 'Send feedback'}</button>
    </fieldset>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error} Your draft is still here.</p>}
  </form>;
}
