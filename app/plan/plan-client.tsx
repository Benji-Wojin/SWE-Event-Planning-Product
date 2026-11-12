'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { duplicateItemIdentity, planSelection, selectNewPlanItems } from '@/lib/plan-selection';
import { pastedChecklistLimit } from '@/lib/pasted-checklist';
import { handoffLabel, type PlanReceiptTask } from '@/lib/plan-receipt';
import { planReceiptTaskHref } from '@/lib/workspace-task-link';
import {AskWeftPanel} from './ask-weft-panel';
import {taskBreakdownContext, type TaskBreakdownContext} from '@/lib/task-breakdown';
import {
  eventKinds,
  planCategories,
  type PlanBrief,
  type ReviewedItem,
} from '@/lib/plan-generation';

const names: Record<string, string> = {
  school: 'School event',
  corporate: 'Corporate event',
  offsite: 'Team off-site',
  trip: 'Trip',
  party: 'Party',
  anniversary: 'Anniversary',
  other: 'Other',
};
const emptyBrief: PlanBrief = {
  kind: 'other',
  description: '',
  endDate: '',
  startTime: '',
  endTime: '',
};
const editable = (brief: PlanBrief, items: ReviewedItem[]) =>
  JSON.stringify({ brief, items });
async function api(query: string, body?: unknown) {
  const response = await fetch('/api/plan?' + query, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.event)
    throw Object.assign(
      new Error(
        data?.error ||
          'Could not reach the project. Your edits are still here.',
      ),
      { status: response.status },
    );
  return data;
}
export function PlanReview({ query, embedded = false, guided = false }: { query: string; embedded?: boolean; guided?: boolean }) {
  const [data, setData] = useState<any>(null),
    [brief, setBrief] = useState<PlanBrief>(emptyBrief),
    [items, setItems] = useState<ReviewedItem[]>([]);
  const [initial, setInitial] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false),
    request = useRef<any>(null),
    starterRequest = useRef<any>(null),
    checklistRequest = useRef<{key:string;requestId:string}|null>(null),
    focusImportNotice = useRef(false),
    focusReceipt = useRef(false),
    errorBox = useRef<HTMLParagraphElement>(null),
    noticeBox = useRef<HTMLParagraphElement>(null),
    receiptHeading = useRef<HTMLHeadingElement>(null);
  const [checklist,setChecklist]=useState('');
  const checklistTooLong=checklist.length>pastedChecklistLimit;
  const [chatDirty,setChatDirty]=useState(false);
  const [chatSeed,setChatSeed]=useState('');
  const [taskContext,setTaskContext]=useState<TaskBreakdownContext|null>(null);
  const [batchOwner,setBatchOwner]=useState('');
  const [suggestStarterDates,setSuggestStarterDates]=useState(false);
  const [includeStarterActivities,setIncludeStarterActivities]=useState(false);
  const [researchBusy,setResearchBusy]=useState(false);
  const [chatStartingNew,setChatStartingNew]=useState(false),[chatReset,setChatReset]=useState(0);
  const draftDirty = !!data && editable(brief, items) !== initial;
  const dirty = draftDirty || chatDirty || !!checklist.trim();
  useEffect(() => {
    if (!embedded) return;
    window.parent.postMessage({type:'weft-plan-sidebar', event:'state', dirty, busy:busy || researchBusy || data?.status === 'generating'}, window.location.origin);
  }, [embedded, dirty, busy, researchBusy, data?.status]);
  useEffect(() => {
    if (!embedded) return;
    const root = document.getElementById('embeddedPlan');
    if (!root) return;
    const measure = () => window.parent.postMessage({type:'weft-plan-sidebar', event:'height', height:Math.ceil(root.getBoundingClientRect().height) + 12}, window.location.origin);
    const observer = new ResizeObserver(measure);
    observer.observe(root); measure();
    return () => observer.disconnect();
  }, [embedded]);
  useEffect(() => {
    if (embedded && data?.receipt) window.parent.postMessage({type:'weft-plan-sidebar', event:'applied'}, window.location.origin);
  }, [embedded, data?.receipt]);
  const params = new URLSearchParams(query),
    demo = params.get('demo') === '1';
  const suggestions = params.get('mode') === 'suggestions';
  const assistant = params.get('mode') === 'assistant';
  useEffect(()=>{
    if(!embedded||!assistant)return;
    const receive=(event:MessageEvent)=>{
      const context=taskBreakdownContext(event,window.parent,window.location.origin);
      if(!context)return;
      setTaskContext(context);
      window.parent.postMessage({type:'weft-task-breakdown-received',requestId:context.requestId},window.location.origin);
    };
    window.addEventListener('message',receive);
    window.parent.postMessage({type:'weft-task-breakdown-ready'},window.location.origin);
    return ()=>window.removeEventListener('message',receive);
  },[embedded,assistant]);
  const projectParams = new URLSearchParams(query); projectParams.delete('mode');
  const guideReturn = guided && !demo && !embedded && !suggestions && !assistant;
  if (guideReturn) projectParams.set('guide','1');
  const projectUrl = demo ? '/demo?as=jack' : '/project?' + projectParams;
  const waiting = data?.status === 'generating',
    locked = busy || waiting || researchBusy,
    applied = !!data?.receipt && !chatStartingNew;
  const receiptTasks:PlanReceiptTask[]=applied?data.receiptTasks||[]:[];
  const addedCount:number=applied?data.receipt.taskIds.length:0;
  const unavailableCount=Math.max(0,addedCount-receiptTasks.length);
  const showHandoff=applied&&!assistant&&!suggestions;
  const handoffCounts={owner:0,acceptance:0,review:0};
  for(const {handoff} of receiptTasks){
    if(handoff?.state==='needs-owner'||handoff?.state==='needs-reassignment')handoffCounts.owner++;
    else if(handoff?.state==='awaiting-acceptance')handoffCounts.acceptance++;
    else if(handoff&&['needs-review','needs-amendment-review','changes-requested'].includes(handoff.state))handoffCounts.review++;
  }
  useEffect(()=>{
    if(!applied||!focusReceipt.current)return;
    focusReceipt.current=false;
    receiptHeading.current?.focus();
  },[applied]);
  const {
    selected,
    reusable,
    matches,
    missing,
    duplicates,
    possible,
    unresolved,
    invalidReuse,
  } = planSelection(
    items,
    data?.existingTasks || [],
    data?.draft?.duplicateSuggestions || [],
  );
  const missingDependencies = missing.length > 0;
  const mixedDraft = items.some(item=>item.kind==='preparation') && items.some(item=>item.kind==='activity');
  function accept(result: any, restoreActivityPreference = true) {
    checklistRequest.current=null;
    setChatStartingNew(false);
    setData(result);
    setBrief(result.brief);
    setItems(result.draft?.items || []);
    setBatchOwner('');
    setSuggestStarterDates(!!result.draft?.starterDates && !!result.event.date && !!result.event.timeZone);
    // Starter version 5 opted into event-day activities, even if their rows were later edited.
    if (restoreActivityPreference) {
      setIncludeStarterActivities(result.draft?.source==='starter' && result.draft.starterVersion===5);
    }
    setInitial(editable(result.brief, result.draft?.items || []));
  }
  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      if ([401, 403, 404].includes((e as { status?: number }).status || 0)) {
        setData(null);
        setBrief(emptyBrief);
        setItems([]);
        setInitial('');
        request.current = null;
        starterRequest.current = null;
        checklistRequest.current=null;
        setChecklist('');
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save. Your edits are still here.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    await run(async () => {
      accept(await api(query));
      request.current = null;
      starterRequest.current = null;
    });
  }
  useEffect(() => {
    setChecklist('');
    checklistRequest.current=null;
    void reload();
  }, [query]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  useEffect(()=>{
    if(!notice||!focusImportNotice.current)return;
    focusImportNotice.current=false;
    noticeBox.current?.focus();
  },[notice]);
  // Recover a running request after refresh; polling only reads, never generates another plan.
  useEffect(() => {
    if (!waiting || busy || error) return;
    const timer = window.setTimeout(
      () => void run(async () => accept(await api(query))),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [waiting, busy, data?.revision, error]);
  const updateBrief = <K extends keyof PlanBrief>(
    key: K,
    value: PlanBrief[K],
  ) => {
    request.current = null;
    starterRequest.current = null;
    setBrief((current) => ({ ...current, [key]: value }));
  };
  const updateItem = (id: string, patch: Partial<ReviewedItem>) => {
    request.current = null;
    starterRequest.current = null;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (duplicateItemIdentity(next) !== duplicateItemIdentity(item)) {
          delete next.duplicateChoice;
          if (item.duplicateChoice === 'reuse') next.included = true;
        } else if (
          patch.included === true &&
          item.duplicateChoice === 'reuse'
        ) {
          delete next.duplicateChoice;
        }
        return next;
      }),
    );
  };
  function editBatch(operation: (current: ReviewedItem[]) => ReviewedItem[]) {
    if (locked || applied || pending.current) return;
    request.current = null;
    starterRequest.current = null;
    setItems(operation);
    setError('');
    setNotice('Private draft updated. Review the items before adding them; shared tasks have not changed.');
  }
  async function save() {
    const result = await api(query, {
      action: 'save',
      revision: data.revision,
      brief,
      items,
      generation: data.draft?.generation,
    });
    accept(result, false);
    request.current = null;
    starterRequest.current = null;
    return result;
  }
  async function importChecklist() {
    if(locked||applied||data.contextChanged||items.length>=24||checklistTooLong||!checklist.trim())return;
    await run(async()=>{
      const input={
        action:'import-checklist',revision:data.revision,workspaceRevision:data.workspaceRevision,
        generation:data.draft?.generation??null,items,text:checklist,
        brief:{...brief,description:brief.description.trim()||data.event.name||names[brief.kind]},
      };
      const key=JSON.stringify(input);
      if(checklistRequest.current?.key!==key)checklistRequest.current={key,requestId:crypto.randomUUID()};
      const result=await api(query,{...input,requestId:checklistRequest.current.requestId});
      const {added,skipped}=result.checklistImportResult;
      if(added){
        accept(result);
        setChecklist('');
        request.current=null;
        starterRequest.current=null;
      }
      focusImportNotice.current=true;
      setNotice((added?`${added} ${added===1?'task added':'tasks added'} unchecked to your private draft.`:'Nothing was added to your draft.')+
        (skipped?` ${skipped} matching ${skipped===1?'line was':'lines were'} skipped.`:'')+
        (added?' Select what you want to share in Review proposed items. No AI was used.':' Edit the pasted text to try again.'));
    });
  }
  async function recheckPasted() {
    await run(async()=>{
      const current=await api(query);
      if(current.revision!==data.revision||current.draft?.source!=='pasted')
        throw new Error('The saved draft changed. Reload it before rechecking. Your local edits have not been replaced.');
      accept(await api(query,{action:'recheck-pasted',revision:current.revision,
        workspaceRevision:current.workspaceRevision,generation:current.draft.generation,brief,items}));
      setNotice('Draft kept and checked against the current project. Review any matching tasks or dates before adding items.');
    });
  }
  async function useStarter() {
    if (!starterRequest.current && data.draft && !window.confirm('Replace the saved private draft with a starter checklist? Your existing shared tasks will not change.')) return;
    await run(async () => {
      request.current = null;
      if (!starterRequest.current) {
        // Save edited work first; a failed replacement must leave the old draft recoverable.
        const latest = draftDirty && data.draft && !applied ? await save() : data;
        starterRequest.current = {
          action:'starter', revision:latest.revision, workspaceRevision:latest.workspaceRevision,
          requestId:crypto.randomUUID(), replace:!!latest.draft,
          suggestDates:suggestStarterDates,
          ...(includeStarterActivities ? {includeActivities:true} : {}),
          brief:{...brief,description:brief.description.trim() || data.event.name || names[brief.kind]},
        };
      }
      accept(await api(query,starterRequest.current));
      starterRequest.current = null;
      setNotice('Starter checklist ready to review. No AI was used; no shared tasks were added.');
    });
  }
  async function generate(nextBrief=brief) {
    let accepted=false;
    await run(async () => {
      starterRequest.current = null;
      if(request.current && JSON.stringify(request.current.brief)!==JSON.stringify(nextBrief))request.current=null;
      if (!request.current) {
        // Preserve edited drafts before regeneration so a provider failure cannot discard them.
        const latest = draftDirty && !applied ? await save() : data;
        request.current = {
          action: 'generate',
          revision: latest.revision,
          workspaceRevision: latest.workspaceRevision,
          requestId: crypto.randomUUID(),
          brief:nextBrief,
          consent: true,
          consentVersion: 'groq-plan-v1',
        };
      }
      const result = await api(query, request.current);
      accept(result);
      accepted=result.status !== 'error' && result.status !== 'interrupted';
      request.current = null;
    });
    return accepted;
  }
  async function refreshContext() {
    await run(async () => {
      const result = await api(query);
      if (result.revision !== data.revision)
        throw new Error(
          'The saved draft changed. Use Reload saved draft to review it; your local edits have not been replaced.',
        );
      setData(result);
      request.current = null;
      starterRequest.current = null;
      setNotice(
        result.receipt ? 'Task handoff refreshed from the project.' : result.contextChanged
          ? result.draft?.source==='starter' ? 'Event details or tasks changed. Choose a fresh starter checklist before adding it.' : result.draft?.source==='pasted' ? 'Event details or tasks changed. Recheck the pasted draft before adding it.' : 'Event details or tasks changed. Generate a new draft before adding it.'
          : 'Project context refreshed. Your draft edits are kept.',
      );
    });
  }
  const alert = error && (
    <p
      role="alert"
      tabIndex={-1}
      ref={errorBox}
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
    >
      {error}
    </p>
  );
  if (!data)
    return (
      <section aria-busy={busy}>
        {alert || <p role="status">Loading project…</p>}
        {error && (
          <Button onClick={reload} disabled={busy}>
            Try again
          </Button>
        )}
        <a href={guideReturn ? projectUrl : '/'} target={embedded ? '_top' : undefined} className="mt-5 block text-sm underline">
          {guideReturn ? 'Return to your guide' : 'All projects'}
        </a>
      </section>
    );
  return (
    <section aria-busy={locked} className={embedded ? 'plan-sidebar-review' : undefined}>
      {alert}
      {error && waiting && (
        <Button
          variant="outline"
          className="mb-4"
          disabled={busy}
          onClick={reload}
        >
          Check request status
        </Button>
      )}
      {notice && (
        <p role="status" ref={noticeBox} tabIndex={-1} className="mb-4 text-sm">
          {notice}
        </p>
      )}
      {!embedded && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="min-w-0 break-words font-medium">
          {data.event.name}
          {demo ? ' · Demo' : ''}
        </p>
        <a href={projectUrl} className="text-primary underline">
          {guideReturn ? 'Return to your guide' : applied ? 'Open project' : 'Skip / open project'}
        </a>
      </div>}
      {data.issue && (
        <p role="status" className="mb-4 rounded-lg border p-4 text-sm">
          {data.issue}
        </p>
      )}
      {data.status === 'interrupted' && (
        <p role="status" className="mb-4 text-sm">
          The last request did not finish. Your saved draft is kept. You can try
          again.
        </p>
      )}
      {applied && (
        <section aria-labelledby="plan-receipt-heading" className="mb-5 space-y-3 rounded-lg border border-primary/40 p-4">
          <h2 id="plan-receipt-heading" ref={receiptHeading} tabIndex={-1} className="font-medium">Plan added to the project</h2>
          <p role="status" className="text-sm">
            {addedCount} {addedCount===1?'task':'tasks'} added to the project.
            {unavailableCount>0&&` ${unavailableCount} ${unavailableCount===1?'is':'are'} no longer available.`}
          </p>
          {showHandoff && (
            <div className="space-y-1 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Team handoff</h3>
                <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={refreshContext}>Refresh task handoff</Button>
              </div>
              <p>For tasks added from this draft. Assignment does not record acceptance.</p>
              <p>Need an active owner: {handoffCounts.owner} · Awaiting acceptance: {handoffCounts.acceptance} · Need completion review: {handoffCounts.review}</p>
            </div>
          )}
          {receiptTasks.length>0 && <ol className="list-decimal space-y-1 ps-5 text-sm">
            {receiptTasks.map(({id,title,handoff})=>{
              const href=planReceiptTaskHref(params,id,guideReturn);
              return <li key={id} className="break-words">
                {href?<a href={href} target={embedded?'_top':undefined} className="inline-flex min-h-11 items-center text-primary underline">{title}</a>:title}
                {showHandoff&&handoff&&<span className="block text-muted-foreground">{handoffLabel(handoff)}</span>}
              </li>;
            })}
          </ol>}
          {!embedded && <a
            href={projectUrl}
            className="mt-2 inline-block text-sm text-primary underline"
          >
            View tasks and schedule
          </a>}
        </section>
      )}
      {assistant ? <AskWeftPanel query={query} onBusy={setResearchBusy} key={chatReset} initialMessage={chatSeed} taskContextTitle={taskContext?.title} onDismissTaskContext={()=>setTaskContext(null)} brief={brief} replyAt={data.draft?.generatedAt} proposalCount={data.draft?.items?.length||0} proposalTitles={data.draft?.items?.map((item:ReviewedItem)=>item.title)||[]} question={chatStartingNew?undefined:data.draft?.questions?.[0]} reply={chatStartingNew?undefined:data.draft?.work?.content} work={chatStartingNew?undefined:data.draft?.work} applied={applied} locked={locked} configured={data.configured} failed={!!data.issue && !chatStartingNew} onSend={generate} onDirty={setChatDirty} onNew={(seed='')=>{
        if(locked||pending.current)return;
        if(dirty&&!window.confirm('Discard the unsaved message and draft edits to start a new conversation? The saved draft remains until you replace it.'))return;
        request.current=null;setChatStartingNew(true);setChatReset(value=>value+1);setChatSeed(seed);setTaskContext(null);setChatDirty(!!seed.trim());setBrief(emptyBrief);setItems([]);setInitial(editable(emptyBrief,[]));setError('');setNotice(seed?'Review the new message before sending. The original task is unchanged; the earlier saved draft is not replaced until you send.':'Start a new request. The earlier saved draft is not replaced until you send it.');
      }}/> : <details open={!embedded || !data.draft} className={embedded ? 'sidebar-brief' : undefined}>
        <summary className={embedded ? 'cursor-pointer text-sm font-medium' : 'hidden'}>Review focus & event details</summary>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <fieldset disabled={locked} className="space-y-5">
            <legend className="sr-only">Event brief</legend>
            <div className="space-y-2">
              <Label htmlFor="plan-kind">Event type</Label>
              <NativeSelect
                id="plan-kind"
                className="w-full"
                value={brief.kind}
                onChange={(e) => updateBrief('kind', e.target.value)}
              >
                {eventKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {names[kind]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-brief">{suggestions ? 'What should AI check for?' : 'What are you planning?'}</Label>
              <Textarea
                id="plan-brief"
                rows={suggestions ? 2 : 4}
                maxLength={4000}
                value={brief.description}
                onChange={(e) => updateBrief('description', e.target.value)}
                placeholder={suggestions ? 'Optional focus: anything missing from our launch evening?' : 'Purpose, activities, constraints, and decisions still to make'}
              />
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Dates and activity hours
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                {data.event.date || 'No event date'} ·{' '}
                {data.event.timeZone || 'No time zone'}.{' '}
                {demo ? (
                  'Edit event details in the demo.'
                ) : (
                  <a href={'/setup?' + query} target={embedded ? '_top' : undefined} className="underline">
                    Project settings
                  </a>
                )}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ['endDate', 'Last day (optional)', 'date'],
                    ['startTime', 'Daily start (optional)', 'time'],
                    ['endTime', 'Daily end (optional)', 'time'],
                  ] as const
                ).map(([key, label, type]) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={'brief-' + key}>{label}</Label>
                    <Input
                      id={'brief-' + key}
                      type={type}
                      min={
                        key === 'endDate'
                          ? data.event.date || undefined
                          : undefined
                      }
                      value={brief[key]}
                      onChange={(e) => updateBrief(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Without a date, time zone, and start time, activities stay
                unscheduled. Daily end must be later than start; leave it blank
                for overnight activities and set the last day.
              </p>
            </details>
            <p className="text-sm text-muted-foreground">
              Generate sends this brief, event details, task names, and relevant
              saved feedback to Groq. Emails, guest lists, files, and private
              bookings are not included.
            </p>
            {!data.configured && (
              <p className="text-sm text-muted-foreground">
                AI is not configured. You can use a starter checklist, save this brief, or add tasks manually.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={
                  locked || !brief.description.trim() || !data.configured
                }
                onClick={()=>void generate()}
              >
                {waiting
                  ? 'Generating…'
                  : request.current
                    ? 'Retry request'
                    : data.draft
                      ? suggestions ? 'Refresh suggestions' : 'Generate another draft'
                      : suggestions ? 'Find next steps with AI' : 'Generate draft'}
              </Button>
              {!applied && (
                <Button
                  variant="outline"
                  disabled={locked || !brief.description.trim()}
                  onClick={() =>
                    void run(async () => {
                      await save();
                      setNotice('Draft saved.');
                    })
                  }
                >
                  Save {data.draft ? 'draft' : 'brief'}
                </Button>
              )}
            </div>
            {!suggestions && <div className="space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">Prefer a starting checklist? Choose the event type above, then edit and assign only the items you need. No AI call or AI quota is used. Owners start unset; dates stay unset unless you request suggestions. This is not a complete policy or safety checklist.</p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={suggestStarterDates} disabled={!data.event.date || !data.event.timeZone} onChange={e=>{setSuggestStarterDates(e.target.checked);starterRequest.current=null;}} />
                <span>Suggest preparation dates from the event date <span className="block text-muted-foreground">{data.event.date && data.event.timeZone ? `${data.event.date} · ${data.event.timeZone}. Editable lead times, not confirmed deadlines. Short-notice items are flagged for review. Activity times stay blank; wrap-up uses the last day when supplied.` : 'Set an event date and time zone in Project settings to use this option.'}</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input id="starter-activities" type="checkbox" className="mt-1" checked={includeStarterActivities} onChange={e=>{setIncludeStarterActivities(e.target.checked);starterRequest.current=null;}} />
                <span>Add event-day activities <span className="block text-muted-foreground">Give activities start times in the draft to put them on the run sheet, or add them now and set their times later in Timeline.</span></span>
              </label>
              <Button variant="outline" disabled={locked} onClick={()=>void useStarter()}>
                {starterRequest.current ? 'Retry checklist request' : data.draft ? 'Replace with starter checklist' : 'Use starter checklist'}
              </Button>
            </div>}
          </fieldset>
        </CardContent>
      </Card>
      </details>}
      {!applied && !suggestions && !assistant && <details className="mt-4 space-y-3 rounded-lg border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
          <span aria-hidden="true">+</span> Paste a checklist
        </summary>
        <div className="space-y-2 text-sm">
          <Label htmlFor="plan-pasted-checklist">Task titles, one per line</Label>
          <p id="plan-pasted-checklist-help" className="text-muted-foreground">Paste up to 24 task titles. Bullets, numbers and checkboxes are removed. New items start unchecked, without dates or owners. Import saves to your private draft without AI or shared changes.</p>
          <Textarea id="plan-pasted-checklist" rows={5} value={checklist} disabled={locked}
            aria-invalid={checklistTooLong||undefined} aria-describedby={'plan-pasted-checklist-help'+(checklistTooLong?' plan-pasted-checklist-length':'')}
            onChange={event=>setChecklist(event.target.value)} />
          {checklistTooLong && <p id="plan-pasted-checklist-length" role="status">Shorten the text to 6,000 characters or fewer. Nothing has been imported.</p>}
          <Button type="button" variant="outline" className="min-h-11"
            disabled={locked||!!data.contextChanged||items.length>=24||checklistTooLong||!checklist.trim()}
            onClick={()=>void importChecklist()}>Import for review</Button>
          {data.contextChanged ? <p>Review the current project context before importing.</p> :
            items.length>=24 ? <p>This draft already has 24 items.</p> : null}
        </div>
      </details>}
      {waiting && (
        <p role="status" className="my-4 text-sm">
          Generating a private draft. You can return later; nothing is added
          automatically.
        </p>
      )}
      {data.draft && !(assistant && (chatStartingNew || data.draft.work)) && (
        <section className="mt-8 space-y-4" aria-label="Review draft">
          {data.draft.source==='starter' && <p className="rounded-lg border p-4 text-sm">Product-authored starter checklist · No AI used. Not tailored to your brief; review every item, date and owner before adding it.</p>}
          {data.draft.source==='pasted' && <p className="rounded-lg border p-4 text-sm">Pasted checklist · No AI used. Review the titles and select only the tasks you want to share.</p>}
          {!applied && data.draft.source==='pasted' && data.contextChanged && (
            <div className="space-y-2 rounded-lg border p-4 text-sm">
              <p>The project changed. Rechecking saves your private edits and checks them against the current project without adding shared tasks.</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={()=>void recheckPasted()}>Recheck pasted draft</Button>
            </div>
          )}
          {assistant && !items.length && !data.draft.questions?.length && <p role="status" className="rounded-lg border p-4 text-sm">No tasks proposed. Check the assumptions below or describe the task more specifically.</p>}
          {suggestions && !items.length && <p role="status" className="rounded-lg border p-4 text-sm">No additional tasks were supported by this review. Check the questions below or add more context—AI does not guarantee that the plan is complete.</p>}
          <div>
            <h2 className="text-xl font-semibold">Review proposed items</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adds to your {data.existingTaskCount} existing tasks. Dates,
              owners, and activities below are proposals.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{embedded ? 'Only true prerequisites block completion. Review links under Details.' : 'Required links mean one task needs another task’s output to be completed. Related work can run in parallel. Review and remove any unnecessary prerequisites below.'}</p>
          </div>
          {data.draft.scheduleWarnings?.length > 0 && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Dates to review ({data.draft.scheduleWarnings.length})
              </summary>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {data.draft.scheduleWarnings.map(
                  (warning: string, i: number) => (
                    <li key={i}>{warning}</li>
                  ),
                )}
              </ul>
            </details>
          )}
          {JSON.stringify(data.draft.brief) !== JSON.stringify(brief) && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                This draft uses an earlier brief
              </summary>
              <p className="mt-3 whitespace-pre-wrap">
                {data.draft.brief.description}
              </p>
              <p className="mt-2">
                {names[data.draft.brief.kind]} ·{' '}
                {data.draft.brief.endDate || data.event.date || 'Dates not set'}{' '}
                · {data.draft.brief.startTime || 'Unscheduled'}{' '}
                {data.draft.brief.endTime && '– ' + data.draft.brief.endTime}
              </p>
            </details>
          )}
          {(data.draft.questions.length > 0 ||
            data.draft.assumptions.length > 0) && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Questions & assumptions (
                {data.draft.questions.length + data.draft.assumptions.length})
              </summary>
              {(['questions', 'assumptions'] as const).map(
                (key) =>
                  data.draft[key].length > 0 && (
                    <div key={key} className="mt-4">
                      <h3 className="font-medium">
                        {key === 'questions'
                          ? 'Decisions to make'
                          : 'Assumptions to check'}
                      </h3>
                      <ul className="mt-2 list-disc space-y-2 pl-5">
                        {data.draft[key].map((text: string, i: number) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </details>
          )}
          <fieldset disabled={locked || applied} className="space-y-4">
            <legend className="sr-only">Proposed tasks and activities</legend>
            {items.length > 1 && !applied && <div className="space-y-3 rounded-lg border p-4" role="group" aria-label="Draft selection and assignment">
              <p className="text-sm" role="status">{selected.length} of {items.length} proposals selected.</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" disabled={locked} onClick={()=>editBatch(current=>selectNewPlanItems(current,data.existingTasks||[]))}>Select all new items</Button>
                {mixedDraft && <>
                  <Button type="button" variant="outline" disabled={locked} onClick={()=>editBatch(current=>selectNewPlanItems(current,data.existingTasks||[],'preparation'))}>Select preparation only</Button>
                  <Button type="button" variant="outline" disabled={locked} onClick={()=>editBatch(current=>selectNewPlanItems(current,data.existingTasks||[],'activity'))}>Select activities only</Button>
                </>}
                <Button type="button" variant="outline" disabled={locked||!selected.length} onClick={()=>editBatch(current=>current.map(item=>({...item,included:false})))}>Select none</Button>
              </div>
              <p className="text-sm text-muted-foreground">Exact matches already in the project and repeated title/time matches are skipped. Possible duplicates still need your review; saved reuse choices are kept.</p>
              {mixedDraft && <p className="text-sm text-muted-foreground">Selecting one group replaces your selection. Review any required links to unchecked tasks before adding items.</p>}
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Label htmlFor="batch-owner">Owner for selected items</Label>
                  <NativeSelect id="batch-owner" className="w-full" value={batchOwner} onChange={e=>setBatchOwner(e.target.value)}>
                    <option value="" disabled>Choose an owner</option>
                    {data.members.filter((member:any)=>member.active!==false).map((member:any)=><option key={member.id} value={member.id}>{member.name}</option>)}
                  </NativeSelect>
                </div>
                <Button type="button" variant="outline" disabled={locked||!selected.length||!batchOwner||!data.members.some((member:any)=>member.id===batchOwner&&member.active!==false)} onClick={()=>{
                  if(!batchOwner||!data.members.some((member:any)=>member.id===batchOwner&&member.active!==false))return;
                  editBatch(current=>current.map(item=>item.included&&item.duplicateChoice!=='reuse'?{...item,owner:batchOwner}:item));
                }}>Assign selected</Button>
              </div>
              <p className="text-sm text-muted-foreground">Changes only the selected private proposals, including any owners already chosen for them. Excluded and reused items, dates and prerequisites stay unchanged. Nothing is assigned in the shared project until you add the reviewed items.</p>
            </div>}
            {items.map((item, index) => (
              <Card key={item.id}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-start gap-3">
                    <input
                      id={'include-' + item.id}
                      type="checkbox"
                      aria-label={
                        'Include ' + (item.title || 'item ' + (index + 1))
                      }
                      checked={item.included}
                      onChange={(e) =>
                        updateItem(item.id, { included: e.target.checked })
                      }
                      className="mt-1 size-5 shrink-0 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={'include-' + item.id}
                        className="text-sm font-medium"
                      >
                        {embedded ? item.title : `${index + 1}. ${item.kind === 'activity' ? 'Activity' : 'Preparation'}`}
                      </label>
                      <Label className="sr-only" htmlFor={'title-' + item.id}>
                        Title for item {index + 1}
                      </Label>
                      {!embedded && <Input
                        id={'title-' + item.id}
                        className="mt-2"
                        maxLength={180}
                        value={item.title}
                        onChange={(e) =>
                          updateItem(item.id, { title: e.target.value })
                        }
                      />}
                      {embedded && <p className="sidebar-item-note mt-2 text-xs text-muted-foreground">{item.note}</p>}
                      {item.scope?.trim() && <p className="mt-2 break-words text-sm text-muted-foreground"><strong>Proposed Done when:</strong> {item.scope}</p>}
                    </div>
                  </div>
                  {!applied && possible.has(item.id) && (
                    <div
                      className="rounded-lg border p-3 space-y-2 text-sm"
                      role="status"
                    >
                      <p>
                        {item.duplicateChoice === 'reuse'
                          ? 'Using existing task: '
                          : 'Possible duplicate of: '}
                        <strong>{possible.get(item.id)!.title}</strong>
                      </p>
                      <p className="text-muted-foreground">
                        {item.duplicateChoice === 'reuse'
                          ? 'This item will not be added. Prerequisites will link to the existing task; its details stay unchanged.'
                          : item.duplicateChoice === 'keep'
                            ? 'Kept as separate work.'
                            : 'AI found similar work. Choose whether it is the same task.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {item.duplicateChoice !== 'reuse' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                            onClick={() =>
                              updateItem(item.id, {
                                included: false,
                                duplicateChoice: 'reuse',
                              })
                            }
                          >
                            Use existing: {possible.get(item.id)!.title}
                          </Button>
                        )}
                        {item.duplicateChoice !== 'keep' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                            onClick={() =>
                              updateItem(item.id, {
                                included: true,
                                duplicateChoice: 'keep',
                              })
                            }
                          >
                            Keep separate: {item.title}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {!applied && invalidReuse.has(item.id) && (
                    <div role="status" className="text-sm space-y-2">
                      <p>
                        The existing-task match changed. Review this item again.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateItem(item.id, {
                            included: true,
                            duplicateChoice: 'keep',
                          })
                        }
                      >
                        Keep separate: {item.title}
                      </Button>
                    </div>
                  )}
                  {!applied && !!matches.get(item.id)?.length && (
                    <div className="space-y-2 text-sm" role="status">
                      <p>
                        {matches.get(item.id)!.length === 1
                          ? 'Already in project. Leave unchecked to use the existing task for prerequisites. Its details will not change.'
                          : 'Multiple matching tasks exist. Leave unchecked, then review any prerequisite links below.'}
                      </p>
                      {item.included && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                          onClick={() =>
                            updateItem(item.id, { included: false })
                          }
                        >
                          Skip existing task: {item.title}
                        </Button>
                      )}
                    </div>
                  )}
                  {duplicates.has(item.id) && !matches.get(item.id)?.length && (
                    <p role="status" className="text-sm">
                      Another selected draft item has this title and time.
                      Uncheck or rename this item.
                    </p>
                  )}
                  {missing
                    .filter((link) => link.itemId === item.id)
                    .map((link) => {
                      const prerequisite = items.find(
                        (other) => other.id === link.prerequisiteId,
                      )!;
                      return (
                        <div
                          key={link.prerequisiteId}
                          className="rounded-lg border p-3 space-y-2 text-sm"
                          role="status"
                        >
                          <p>
                            “{item.title}” depends on unchecked “
                            {prerequisite.title}”.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {!matches.get(prerequisite.id)?.length && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                                onClick={() =>
                                  updateItem(prerequisite.id, {
                                    included: true,
                                  })
                                }
                              >
                                Include prerequisite: {prerequisite.title}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                              onClick={() =>
                                updateItem(item.id, {
                                  dependsOn: item.dependsOn.filter(
                                    (id) => id !== prerequisite.id,
                                  ),
                                })
                              }
                            >
                              Remove link: {item.title} → {prerequisite.title}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  <details open={!embedded}>
                    <summary className={embedded ? 'cursor-pointer text-xs font-medium' : 'hidden'}>Owner & date</summary>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={'owner-' + item.id}>Owner</Label>
                      <NativeSelect
                        id={'owner-' + item.id}
                        className="w-full"
                        value={item.owner}
                        onChange={(e) =>
                          updateItem(item.id, { owner: e.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {data.members.map((member: any) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                        {item.owner &&
                          !data.members.some(
                            (member: any) => member.id === item.owner,
                          ) && (
                            <option value={item.owner}>
                              Former teammate — choose another owner
                            </option>
                          )}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={'date-' + item.id}>
                        {item.kind === 'activity'
                          ? 'Activity start'
                          : 'Preparation due date'}
                      </Label>
                      <Input
                        id={'date-' + item.id}
                        type={
                          item.kind === 'activity' ? 'datetime-local' : 'date'
                        }
                        value={
                          item.kind === 'activity' ? item.start : item.dueDate
                        }
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            item.kind === 'activity'
                              ? {
                                  start: e.target.value,
                                  ...(!e.target.value ? { end: '' } : {}),
                                }
                              : { dueDate: e.target.value },
                          )
                        }
                      />
                    </div>
                  </div>
                  </details>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Details
                      {item.dependsOn.length
                        ? ' · ' + item.dependsOn.length + ' prerequisites'
                        : ''}
                    </summary>
                    <div className="mt-4 space-y-4">
                      {embedded && <div className="space-y-2"><Label htmlFor={'title-' + item.id}>Task title</Label><Input id={'title-' + item.id} maxLength={180} value={item.title} onChange={e=>updateItem(item.id,{title:e.target.value})}/></div>}
                      <div className="space-y-2">
                        <Label htmlFor={'scope-' + item.id}>Done when (optional)</Label>
                        <Textarea id={'scope-' + item.id} rows={2} maxLength={3000} value={item.scope || ''} onChange={e=>updateItem(item.id,{scope:e.target.value})} aria-describedby={'scope-help-' + item.id}/>
                        <p id={'scope-help-' + item.id} className="text-sm text-muted-foreground">Review the proposed result before adding it. This becomes the shared task’s agreed outcome, not evidence that the work is complete. Leave blank if it is not agreed yet.</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={'note-' + item.id}>
                          What needs to be done
                        </Label>
                        <Textarea
                          id={'note-' + item.id}
                          rows={3}
                          maxLength={2000}
                          value={item.note}
                          onChange={(e) =>
                            updateItem(item.id, { note: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={'category-' + item.id}>Category</Label>
                        <NativeSelect
                          id={'category-' + item.id}
                          className="w-full"
                          value={item.category}
                          onChange={(e) =>
                            updateItem(item.id, { category: e.target.value })
                          }
                        >
                          {planCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </NativeSelect>
                      </div>
                      {item.kind === 'activity' && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={'end-' + item.id}>
                              Activity end (optional)
                            </Label>
                            <Input
                              id={'end-' + item.id}
                              type="datetime-local"
                              value={item.end}
                              onChange={(e) =>
                                updateItem(item.id, { end: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={'location-' + item.id}>
                              Location (optional)
                            </Label>
                            <Input
                              id={'location-' + item.id}
                              maxLength={240}
                              value={item.location}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  location: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm font-medium">
                          Required before completion
                        </legend>
                        <p className="text-sm text-muted-foreground">Keep only links whose results are needed to complete this task. Related work can run in parallel without a required link. Nothing is linked in the shared project until you add the reviewed items.</p>
                        {items
                          .filter((other) => other.id !== item.id)
                          .map((other) => (
                            <label
                              key={other.id}
                              className="flex items-start gap-2 text-sm"
                            >
                              <input
                                id={'required-'+item.id+':'+other.id}
                                type="checkbox"
                                className="mt-1 size-4 shrink-0 accent-primary"
                                checked={item.dependsOn.includes(other.id)}
                                onChange={(e) =>
                                  updateItem(item.id, {
                                    dependsOn: e.target.checked
                                      ? [...item.dependsOn, other.id]
                                      : item.dependsOn.filter(
                                          (id) => id !== other.id,
                                        ),
                                  })
                                }
                              />
                              <span className="break-words">
                                {other.title}
                                {reusable.has(other.id)
                                  ? ' (existing project task)'
                                  : !other.included
                                    ? ' (unchecked)'
                                    : ''}
                              </span>
                            </label>
                          ))}
                      </fieldset>
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </fieldset>
          {!applied && (
            <div className="rounded-lg border p-5 space-y-3">
              {data.contextChanged && (
                <p role="status" className="text-sm">
                  Project details or tasks changed. {data.draft.source==='starter' ? 'Choose a fresh starter checklist' : data.draft.source==='pasted' ? 'Recheck your pasted draft' : 'Generate a new draft'} before adding it.
                </p>
              )}
              {missingDependencies && (
                <p role="status" className="text-sm">
                  Resolve the unchecked prerequisites shown beside each affected
                  task.
                </p>
              )}
              {(unresolved.size > 0 || invalidReuse.size > 0) && (
                <p role="status" className="text-sm">
                  Review the possible duplicates above: use an existing task or
                  keep separate work.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Only selected items will be added, all as incomplete. Nothing
                will be sent or booked.
              </p>
              <Button
                className="h-auto min-h-10 whitespace-normal"
                disabled={
                  locked ||
                  !selected.length ||
                  missingDependencies ||
                  duplicates.size > 0 ||
                  unresolved.size > 0 ||
                  invalidReuse.size > 0 ||
                  data.contextChanged
                }
                onClick={() =>
                  void run(async () => {
                    const latest = draftDirty ? await save() : data;
                    const result = await api(query, {
                      action: 'apply',
                      revision: latest.revision,
                      workspaceRevision: latest.workspaceRevision,
                      generation: latest.draft.generation,
                      items: latest.draft.items,
                      confirm: true,
                    });
                    focusReceipt.current=!!result.receipt;
                    accept(result);
                    request.current = null;
                  })
                }
              >
                Add {selected.length} selected items to project
              </Button>
            </div>
          )}
        </section>
      )}
      <details open={!assistant} className="mt-6"><summary className={assistant?'cursor-pointer text-xs text-muted-foreground':'hidden'}>Conversation recovery</summary><nav
        aria-label="Draft navigation"
        className="mt-6 flex flex-wrap gap-4 text-sm"
      >
        <button
          type="button"
          disabled={locked}
          onClick={refreshContext}
          className="text-primary underline disabled:opacity-50"
        >
          Refresh project context
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                'Discard unsaved edits and reload the saved draft?',
              )
            )
              {setChecklist('');void reload();}
          }}
          className="text-primary underline disabled:opacity-50"
        >
          Reload saved draft
        </button>
        {!embedded && <a href={projectUrl} className="text-primary underline">
          Open project
        </a>}
      </nav></details>
    </section>
  );
}
