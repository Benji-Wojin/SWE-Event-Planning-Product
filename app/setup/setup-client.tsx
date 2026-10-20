'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';

type Details = {
  name: string; date: string; location: string; timeZone: string; guestCount: string;
  dietaryOutstanding: string; cateringDeadline: string; outdoor: boolean; transportNeeded: boolean; membersCanCreateTasks: boolean;
};
const values = (event: any): Details => ({
  name: event.name, date: event.date, location: event.location, timeZone: event.timeZone || '',
  guestCount: String(event.guestCount), dietaryOutstanding: String(event.dietaryOutstanding),
  cateringDeadline: event.cateringDeadline, outdoor: Boolean(event.outdoor), transportNeeded: Boolean(event.transportNeeded),
  membersCanCreateTasks: event.membersCanCreateTasks === true,
});
async function workspaceRequest(projectId: string, body?: unknown) {
  const response = await fetch('/api/workspace?project=' + encodeURIComponent(projectId), {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: any = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(result?.error || 'Could not load the project. Please try again.'), { status: response.status });
  if (!result?.state?.event) throw new Error('Could not load the project. Please try again.');
  return result;
}
export function ProjectSetup({ projectId }: { projectId?: string }) {
  const isNew = projectId === undefined;
  const backUrl = isNew ? '/' : '/project?project=' + encodeURIComponent(projectId);
  const requestId = useRef('');
  const [project, setProject] = useState<any>(null), [form, setForm] = useState<Details | null>(null);
  const [initial, setInitial] = useState(''), [error, setError] = useState('');
  const [conflict, setConflict] = useState(false), [busy, setBusy] = useState(false);
  const pending = useRef(false), leaving = useRef(false), errorBox = useRef<HTMLParagraphElement>(null);
  const dirty = Boolean(form && JSON.stringify(form) !== initial);
  async function load() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if (isNew) {
        const next = values({name:'',date:'',location:'',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,guestCount:0,dietaryOutstanding:0,cateringDeadline:'',outdoor:false,transportNeeded:false});
        setProject({setupRequired:true}); setForm(next); setInitial(JSON.stringify(next)); return;
      }
      const result = await workspaceRequest(projectId!);
      if (result.identity.role !== 'admin') throw new Error('Only the organizer can change project setup.');
      const next = values(result.state.event);
      setProject(result); setForm(next); setInitial(JSON.stringify(next)); setConflict(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the project. Please try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !project || pending.current) return;
    const changingScheduleZone = Boolean(project.state?.tasks.some((task: any) => task.schedule) && form.timeZone !== project.state.event.timeZone);
    if (changingScheduleZone && !window.confirm('Change the event time zone? Existing activity dates and clock times will stay the same in the new zone.')) return;
    pending.current = true; setBusy(true); setError(''); setConflict(false);
    try {
      const details = { ...form,
        guestCount: Number(form.guestCount || 0), dietaryOutstanding: Number(form.dietaryOutstanding || 0),
        ...(changingScheduleZone ? {confirmScheduleTimeZone:true} : {}),
      };
      let destination = backUrl;
      if (isNew) {
        requestId.current ||= crypto.randomUUID();
        const response = await fetch('/api/projects', {method:'POST', credentials:'same-origin',headers:{'Content-Type':'application/json','X-Gather-Request':'1'},body:JSON.stringify({requestId:requestId.current,event:details})});
        const result: any = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not create the project. Your details are still here.');
        destination = '/plan?project=' + encodeURIComponent(result.id);
      } else await workspaceRequest(projectId!, { method:'completeSetup', args:[details], revision:project.revision });
      leaving.current = true;
      window.location.assign(destination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Your details are still here.');
      setConflict((e as { status?: number }).status === 409);
      pending.current = false; setBusy(false);
    }
  }
  const update = <K extends keyof Details>(key: K, value: Details[K]) => setForm(current => current ? { ...current, [key]: value } : current);
  const errorMessage = error && <p ref={errorBox} tabIndex={-1} role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  if (!form || !project) return <section aria-busy={busy}>
    {errorMessage || <p role="status" className="text-muted-foreground">Loading project…</p>}
    {error && <Button onClick={load} disabled={busy} variant="outline">Try again</Button>}
    <a href="/" className="mt-6 block text-sm text-primary underline">All projects</a>
  </section>;
  const textField = (name: 'name' | 'date' | 'location' | 'guestCount' | 'dietaryOutstanding' | 'cateringDeadline', label: string, type = 'text', maxLength?: number) => <div className="space-y-2">
    <Label htmlFor={'setup-' + name}>{label}</Label>
    <Input id={'setup-' + name} name={name} type={type} value={form[name]} onChange={e => update(name, e.target.value)}
      required={name === 'name'} maxLength={maxLength} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 100000 : undefined}
      step={type === 'number' ? 1 : undefined} className="h-11 text-base md:text-base" />
  </div>;
  return <>
    <form onSubmit={save} aria-busy={busy}>
      {errorMessage}
      {conflict && <Button type="button" variant="outline" className="mb-5 h-auto min-h-10 whitespace-normal" disabled={busy} onClick={() => {
        if (!dirty || window.confirm('Discard these unsaved details and load the current project setup?')) void load();
      }}>Reload saved details</Button>}
      <Card className="py-6 sm:py-7"><CardContent className="px-5 sm:px-7">
        <fieldset disabled={busy} className="space-y-6">
          <legend className="sr-only">Event details</legend>
          {textField('name', 'Event name', 'text', 160)}
          <div className="grid gap-6 sm:grid-cols-2">
            {textField('date', 'Event date (optional)', 'date')}
            {textField('guestCount', 'Expected guests', 'number')}
          </div>
          {textField('location', 'Location (optional)', 'text', 240)}
          <div className="space-y-2">
            <Label htmlFor="setup-timeZone">Event time zone</Label>
            <Input id="setup-timeZone" name="timeZone" list="event-time-zones" required maxLength={100} value={form.timeZone}
              placeholder="America/Los_Angeles" onChange={e => update('timeZone', e.target.value)} className="h-11 text-base md:text-base" />
            <datalist id="event-time-zones">{['UTC',...Intl.supportedValuesOf('timeZone')].map(zone=><option key={zone} value={zone} />)}</datalist>
            <p className="text-sm text-muted-foreground">Schedule times use this zone for everyone. Changing the event date does not move scheduled activities.</p>
          </div>
          <div className="space-y-5 border-t pt-6">
            <div className="flex items-center justify-between gap-4"><Label htmlFor="setup-outdoor">Outdoor event</Label><Switch id="setup-outdoor" checked={form.outdoor} onCheckedChange={checked => update('outdoor', checked)} /></div>
            <div className="flex items-center justify-between gap-4"><Label htmlFor="setup-transportNeeded">Organized transport needed</Label><Switch id="setup-transportNeeded" checked={form.transportNeeded} onCheckedChange={checked => update('transportNeeded', checked)} /></div>
          </div>
          <div className="border-t pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Label htmlFor="setup-membersCanCreateTasks">Let teammates create tasks</Label>
                <p id="task-creation-help" className="text-sm text-muted-foreground">Invited project members can add tasks for themselves or leave them unassigned. Only you can assign other people, change project settings or add AI-generated plans. Off by default.</p>
              </div>
              <Switch id="setup-membersCanCreateTasks" aria-describedby="task-creation-help" checked={form.membersCanCreateTasks} onCheckedChange={checked => update('membersCanCreateTasks', checked)} />
            </div>
          </div>
          <details className="border-t pt-5">
            <summary className="cursor-pointer text-sm font-medium">Catering details (optional)</summary>
            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              {textField('dietaryOutstanding', 'Dietary responses outstanding', 'number')}
              {textField('cateringDeadline', 'Catering cutoff', 'date')}
            </div>
          </details>
          <div className="border-t pt-5">
            <p className="mb-5 text-sm text-muted-foreground">{isNew ? 'Next: draft a plan with AI or start with an empty project. Your other projects are unchanged.' : 'Changes only this project’s settings.'}</p>
            <Button type="submit" disabled={busy || !form.name.trim()} className="h-auto min-h-11 w-full whitespace-normal px-5 py-2 sm:w-auto">{busy ? 'Saving…' : isNew ? 'Create project' : 'Save & open project'}</Button>
          </div>
        </fieldset>
      </CardContent></Card>
    </form>
    <p className="mt-5 text-sm text-muted-foreground">Manage team invitations in People.</p>
    <nav aria-label="Setup navigation" className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm text-primary underline">
      <a href={backUrl}>{isNew ? 'Cancel' : 'Back to project'}</a>
      <a href="/demo">Try the demo</a>
    </nav>
  </>;
}
