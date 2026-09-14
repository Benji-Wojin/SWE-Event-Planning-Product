'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, LockKeyhole, MessageSquare, RotateCcw, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';

const profiles = [
  { id: 'jack', name: 'Jack Morgan', role: 'Organizer', initials: 'JM' },
  { id: 'maya', name: 'Maya Singh', role: 'Guests & catering', initials: 'MS' },
  { id: 'jules', name: 'Jules Miller', role: 'Transport & logistics', initials: 'JL' },
  { id: 'dev', name: 'Dev Kim', role: 'Activities & volunteers', initials: 'DK' },
];
const statusNames: Record<string, string> = { todo: 'To do', progress: 'In progress', blocked: 'Blocked', done: 'Done' };
const shortName = (id: string) => profiles.find(p => p.id === id)?.name.split(' ')[0] || 'Unassigned';
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const date = (value: string) => value ? new Date(value + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No due date';
function Status({ task }: { task: any }) {
  const awaiting = task.requiresVerification && task.reportedAt && !task.verifiedAt;
  return <span className={'demo-status ' + (awaiting ? 'awaiting' : task.status)}>{awaiting ? 'Awaiting Jack’s check' : statusNames[task.status]}</span>;
}

export function DemoWorkspace({ actor }: { actor: string }) {
  const profile = profiles.find(p => p.id === actor)!;
  const admin = actor === 'jack';
  const [snapshot, setSnapshot] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [syncState, setSyncState] = useState('Connecting…');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<string>(admin ? 'all' : 'mine');
  const [edit, setEdit] = useState<any>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const latest = useRef<any>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const request = async (payload?: any) => {
    const response = await fetch('/api/demo?as=' + actor, {
      method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: payload ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'Could not connect to the demo.');
    return data;
  };
  const publish = (data: any) => {
    if (!mounted.current || data.actor !== actor || data.revision < (latest.current?.revision || 0)) return;
    latest.current = data;
    setSnapshot(data);
    setSyncState('Live · synced ' + time(new Date().toISOString()));
  };
  async function refresh() {
    if (pending.current || document.hidden) return;
    const ticket = generation.current;
    try { const data = await request(); if (ticket === generation.current) publish(data); }
    catch (error) { if (mounted.current) setSyncState(error instanceof Error ? error.message : 'Connection interrupted.'); }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => { mounted.current = false; generation.current++; clearInterval(interval); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); };
  }, [actor]);
  async function mutate(action: string, taskId = '', values: any = {}, revision = latest.current?.revision) {
    if (pending.current || !latest.current) return false;
    pending.current = true; generation.current++; setBusy(true); setNotice('');
    try {
      const result = await request({ action, taskId, values, revision, ...(action === 'reset' ? { confirmReset: true } : {}) });
      publish(result);
      if (mounted.current) setNotice(action === 'reset' ? 'Demo restarted for all four profiles. Your real project is unchanged.' : 'Saved as ' + profile.name.split(' ')[0] + '.');
      return true;
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : 'Could not save your update.');
      return false;
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const tasks = snapshot?.tasks || [];
  const mine = tasks.filter((task: any) => task.owner === actor);
  const completed = tasks.filter((task: any) => task.status === 'done').length;
  const awaiting = tasks.filter((task: any) => task.requiresVerification && task.reportedAt && !task.verifiedAt);
  const stale = edit && snapshot && edit.revision !== snapshot.revision;
  const openTask = (task: any) => { setNotice(''); setEdit({ task, revision: snapshot.revision }); };
  const taskList = (items: any[]) => <div className="demo-task-list">{items.map(task => <button key={task.id} className="demo-task" onClick={() => openTask(task)}>
    <span className={'demo-task-check ' + task.status}>{task.status === 'done' ? <CheckCircle2 size={20} /> : <span />}</span>
    <span className="demo-task-copy"><strong>{task.title}</strong><span>{task.note}</span><small>{shortName(task.owner)} · Due {date(task.dueDate)}{task.acceptedAt ? ' · Ownership accepted' : ''}</small></span>
    <Status task={task} /><ArrowUpRight size={17} aria-hidden="true" />
  </button>)}{!items.length && <p className="demo-empty">No tasks.</p>}</div>;

  return <div className="demo-app">
    <header className="demo-topbar"><a href="/" className="demo-logo">gather<span>●</span></a><span className="demo-label"><Users size={15} /> Four-person demo</span><a href="/" className="demo-back">Back to real workspace ↗</a></header>
    <main className="demo-main">
      <section className="demo-launcher" aria-label="Four demo profiles">
        <div className="demo-section-heading"><h1>Demo profiles</h1></div>
        <div className="demo-profiles">{profiles.map(p => <div key={p.id} className={'demo-profile ' + (actor === p.id ? 'active' : '')}>
          <a href={'/demo?as=' + p.id} aria-current={actor === p.id ? 'page' : undefined} className="demo-profile-main"><span className={'demo-avatar ' + p.id}>{p.initials}</span><span><strong>{p.name.split(' ')[0]} {actor === p.id && <small>Viewing</small>}</strong><span>{p.role}</span></span></a>
          <a className="demo-open-tab" href={'/demo?as=' + p.id} target="_blank" rel="noopener noreferrer" aria-label={'Open ' + p.name + ' in a new tab'} title={'Open ' + p.name + ' in a new tab'}><ArrowUpRight size={20} /></a>
        </div>)}</div>
        <p className="demo-safety">Simulated profiles. Separate demo data; no Gmail or real bookings.</p>
      </section>
      <section className="demo-project">
        <div><p className="demo-eyebrow">REDWOOD GROVE · OCT 3</p><h2>Field Day</h2></div>
        <div className="demo-progress"><span><strong>{completed} / {tasks.length || '—'}</strong> tasks complete</span><Progress value={tasks.length ? completed / tasks.length * 100 : 0} aria-label="Event tasks completed" /><p role="status">{syncState}</p></div>
      </section>
      <div className="demo-message" role="status" hidden={!notice}>{notice}</div>
      <details className="demo-walkthrough"><summary>Demo instructions</summary><ol><li>Open Jules and Jack in separate tabs. In Jules’s view, open “Confirm final bus count” and report it complete.</li><li>In Jack’s view, open the task under “Needs verification” and verify it. Both views show the same saved result.</li><li>As Jack, assign “Confirm wayfinding signs” to Dev. Open Dev’s view to accept it. Switch to Maya to show her different task list.</li><li>Compare Jack’s sample booking details with the teammate view. Restart the demo as Jack when you’re ready to present again.</li></ol></details>
      {!snapshot ? <div className="demo-loading"><p>{syncState}</p><Button variant="outline" onClick={() => void refresh()}>Retry connection</Button><a href="/signin-with-chatgpt?return_to=%2Fdemo" target="_top">Sign in again</a></div> : <div className="demo-workspace">
        <section className="demo-work-panel">
          <div className="demo-panel-heading"><div><span className={'demo-avatar small ' + actor}>{profile.initials}</span><h3>{profile.name.split(' ')[0]}’s workspace</h3></div><span className="demo-role">{admin ? 'Organizer access' : 'Teammate access'}</span></div>
          <Tabs value={tab} onValueChange={value => setTab(String(value))}>
            <TabsList variant="line" className="demo-tabs"><TabsTrigger value="mine">My tasks · {mine.length}</TabsTrigger><TabsTrigger value="all">All tasks · {tasks.length}</TabsTrigger>{admin && <TabsTrigger value="checks">Needs verification · {awaiting.length}</TabsTrigger>}</TabsList>
            <TabsContent value="mine">{taskList(mine)}</TabsContent><TabsContent value="all">{taskList(tasks)}</TabsContent>{admin && <TabsContent value="checks">{taskList(awaiting)}</TabsContent>}
          </Tabs>
          <p className="demo-permission-note">{admin ? 'Organizer: edit, assign, and verify tasks.' : 'Report on your tasks; comment on any task. Only Jack can assign or verify.'}</p>
        </section>
        <aside className="demo-context">
          <section className="demo-activity"><h3><Clock3 size={18} /> Team activity</h3><div>{snapshot.activity.slice(0,10).map((item: any) => <article key={item.id}><span className={'demo-avatar small ' + item.actor}>{profiles.find(p => p.id === item.actor)?.initials || '?'}</span><div><p><strong>{shortName(item.actor)}</strong> {item.text}</p><time>{time(item.at)}</time></div></article>)}</div></section>
          <section className="demo-private"><h3><LockKeyhole size={18} /> Organizer-only details</h3>{admin ? <><p>Fictional booking examples. Never real credentials.</p>{snapshot.privateDetails.map((item: any) => <div key={item.reference}><strong>{item.title}</strong><span>{item.detail}</span><code>{item.reference}</code></div>)}</> : <p>Booking codes are visible only to Jack.</p>}</section>
        </aside>
      </div>}
      <footer className="demo-footer"><span>Demo changes sync across tabs.</span>{admin && <Button variant="ghost" disabled={!snapshot || busy} onClick={() => setResetOpen(true)}><RotateCcw size={15} /> Restart demo</Button>}</footer>
    </main>
    <Dialog open={!!edit} onOpenChange={open => { if (!open && !busy) setEdit(null); }}>
      <DialogContent className="demo-task-dialog" showCloseButton={!busy}>
        {edit && <><DialogHeader><DialogTitle className="text-xl pr-6">{edit.task.title}</DialogTitle><DialogDescription>Viewing as {profile.name}.</DialogDescription></DialogHeader>
          <div className="demo-dialog-meta"><Status task={snapshot.tasks.find((t: any) => t.id === edit.task.id) || edit.task} /><span>Owner: {shortName(edit.task.owner)}</span><span>Due {date(edit.task.dueDate)}</span></div>
          <section className="demo-task-context"><h4>Latest update</h4><p>{edit.task.note || 'No update yet.'}</p></section>
          {notice && <p className="demo-message" role="status">{notice}</p>}
          {stale && <div className="demo-stale"><p>The project changed while this task was open. Refresh before saving; your unsaved text will be discarded.</p><Button type="button" variant="outline" disabled={busy} onClick={() => openTask(snapshot.tasks.find((t: any) => t.id === edit.task.id))}>Refresh task & discard edits</Button></div>}
          {edit.task.requiresVerification && edit.task.reportedAt && !edit.task.verifiedAt && <div className="demo-verification"><p>{edit.task.reportedBy} reported this complete. Waiting for Jack’s verification.</p>{admin && <Button disabled={busy || stale} onClick={async () => { if (await mutate('verify',edit.task.id,{},edit.revision)) setEdit(null); }}><CheckCircle2 size={16} /> Verify completion</Button>}</div>}
          {edit.task.owner === actor && edit.task.status !== 'done' ? <section className="demo-task-report"><h4>Your update</h4><form key={'report:' + edit.task.id + ':' + edit.revision} className="demo-edit-form" onSubmit={async event => {
            event.preventDefault();
            const response = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
            const note = String(new FormData(event.currentTarget).get('note') || '').trim();
            if (!note) { setNotice('Add a short note so the team knows what happened.'); return; }
            if (!['complete', 'blocked', 'progress'].includes(response || '')) { setNotice('Choose Report complete, Report blocked, or Share progress.'); return; }
            if (await mutate(response === 'complete' ? 'complete' : 'update', edit.task.id, response === 'complete' ? {note} : {status:response,note}, edit.revision)) setEdit(null);
          }}>
            <Label htmlFor="demo-report-note" className="sr-only">What happened or what is blocking you?</Label><Textarea id="demo-report-note" name="note" placeholder="What’s finished? What’s blocking you?" rows={3} maxLength={3000} required />
            <div className="demo-dialog-actions"><Button type="submit" name="response" value="complete" disabled={busy || stale || !!edit.task.reportedAt}>Report complete</Button><Button type="submit" name="response" value="blocked" variant="outline" disabled={busy || stale}>Report blocked</Button><Button type="submit" name="response" value="progress" variant="ghost" disabled={busy || stale}>Share progress</Button></div>
            <p className="demo-permission-note">{edit.task.reportedAt ? 'Reporting a blocker or new progress replaces your pending completion report.' : edit.task.requiresVerification ? 'Your completion report will wait for Jack’s verification.' : 'Reporting complete marks this task done and records your name.'}</p>
          </form>{!edit.task.acceptedAt && <Button variant="ghost" disabled={busy || stale} onClick={async () => { if (await mutate('accept',edit.task.id,{},edit.revision)) setEdit(null); }}>Accept responsibility</Button>}</section> : !admin && edit.task.owner !== actor ? <p className="demo-permission-note">{shortName(edit.task.owner)} reports progress on this task. You can join the conversation below.</p> : null}
          <section className="demo-comments"><h4><MessageSquare size={16} /> Comments</h4>{(snapshot.tasks.find((t: any) => t.id === edit.task.id)?.comments || []).map((comment: any) => <article key={comment.id}><strong>{shortName(comment.actor)} <time>{time(comment.at)}</time></strong><p>{comment.text}</p></article>)}
            <form onSubmit={async event => { event.preventDefault(); const form=event.currentTarget; const text=String(new FormData(form).get('text') || ''); if (await mutate('comment',edit.task.id,{text},edit.revision)) setEdit(null); }}><Label htmlFor="demo-comment">Add a comment</Label><Textarea id="demo-comment" name="text" placeholder="Comment…" maxLength={5000} required rows={2} /><Button variant="outline" disabled={busy || stale} type="submit">Post as {profile.name.split(' ')[0]}</Button></form>
          </section>
          {admin && <details className="demo-organizer"><summary>Edit task details <span>Organizer only</span></summary><form key={'organizer:' + edit.task.id + ':' + edit.revision} className="demo-edit-form" onSubmit={async event => {
            event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
            if (await mutate('update', edit.task.id, data, edit.revision)) setEdit(null);
          }}>
            <div className="space-y-2"><Label htmlFor="demo-owner">Assigned to</Label><Select name="owner" defaultValue={edit.task.owner || ''}><SelectTrigger id="demo-owner" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">Unassigned</SelectItem>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
            {edit.task.status !== 'done' && <div className="space-y-2"><Label htmlFor="demo-status">Status</Label><Select name="status" defaultValue={edit.task.status}><SelectTrigger id="demo-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{['todo','progress','blocked'].map(value => <SelectItem key={value} value={value}>{statusNames[value]}</SelectItem>)}</SelectContent></Select></div>}
            <div className="space-y-2"><Label htmlFor="demo-note">Latest update</Label><Textarea id="demo-note" name="note" defaultValue={edit.task.note} rows={3} maxLength={3000} /></div>
            <Button type="submit" disabled={busy || stale}>{busy ? 'Saving…' : 'Save task details'}</Button>
          </form></details>}
        </>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={resetOpen} onOpenChange={open => { if (!busy) setResetOpen(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restart all four demo views?</AlertDialogTitle><AlertDialogDescription>This removes your demo edits and restores the sample event for every profile. Your real workspace, Gmail, and private bookings are untouched.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setResetOpen(false)}>Keep demo</Button><Button disabled={busy} onClick={async () => { if (await mutate('reset')) setResetOpen(false); }}>{busy ? 'Restarting…' : 'Restart demo'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
