'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { duplicateItemIdentity, planSelection, selectNewPlanItems, unavailablePlanOwnerItems, type ExistingPlanTask } from '@/lib/plan-selection';
import { pastedChecklistLimit } from '@/lib/pasted-checklist';
import { groupPlanHandoff, handoffLabel, type PlanReceiptTask } from '@/lib/plan-receipt';
import { planApprovalHash } from '@/lib/plan-approval-hash';
import { planPrerequisiteDependents, planPrerequisiteLimit, planPrerequisiteLoopSources } from '@/lib/plan-prerequisites';
import { planActivityHref, planTaskHref, teamAccessFromPlanHref } from '@/lib/workspace-task-link';
import { workspaceScheduleDate } from '@/lib/workspace-day';
import type { StarterChecklistPreview } from '@/lib/starter-checklists';
import {AskWeftPanel} from './ask-weft-panel';
import { examplePlanBrief, PlanGuideHint, type PlanGuideStage } from './guide-hint';
import { PlanApprovalImpact } from './approval-impact';
import {taskBreakdownContext, type TaskBreakdownContext} from '@/lib/task-breakdown';
import {
  eventKinds,
  parseBrief,
  parsePlanItems,
  planCategories,
  reviewPlanActivityTime,
  type PlanBrief,
  type PlanScheduleIssue,
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
function savedEditable(brief: PlanBrief, items: ReviewedItem[], eventDate: string) {
  const normalized = parsePlanItems(items, true, true)
    .map(item => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({ brief: parseBrief(brief, eventDate), items: normalized });
}
function existingTaskLink(task: ExistingPlanTask, params: URLSearchParams, guided: boolean) {
  const href = planTaskHref(params, task.id, guided);
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer"
      aria-label={`Open existing task: ${task.title} (opens in a new tab)`}
      className="inline-flex min-h-11 max-w-full items-center gap-1 break-words text-primary underline">
      <span className="min-w-0">{task.title}</span><span aria-hidden="true">↗</span>
    </a>
  ) : <strong className="break-words">{task.title}</strong>;
}
const approvalTimeout = 15_000;
const handoffRefreshTimeout = 15_000;
const replaceHandoffImpact = 'The current handoff will be replaced when the new draft is saved. Tasks already added stay in the project.';
function completedPlanDisclosure(content: ReactNode, disclosure?: {id: string; title: string; description?: string}) {
  if (!disclosure) return content;
  return (
    <details id={disclosure.id} className="mt-4 rounded-lg border p-4">
      <summary className="min-h-11 cursor-pointer content-center font-medium">{disclosure.title}</summary>
      <div className="mt-3">
        {disclosure.description && <p className="mb-4 text-sm text-muted-foreground">{disclosure.description}</p>}
        {content}
      </div>
    </details>
  );
}
type ApprovalCheck = {
  kind: 'uncertain' | 'conflict';
  generation: string;
  hash: string;
  revision: number;
  workspaceRevision: number;
};
const isAccessError = (status: number) => [401, 403, 404].includes(status);
async function api(query: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/plan?' + query, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.event)
    throw Object.assign(
      new Error(
        data?.error ||
          'Could not reach the project. Your edits are still here.',
      ),
      { status: response.status, unreadable: response.ok && !data?.event },
    );
  return data;
}
export function PlanReview({ query, embedded = false, guided = false, receiptTask = '', receiptPlan = '', receiptHandoff = false, starterPreviews }: {
  query: string; embedded?: boolean; guided?: boolean; receiptTask?: string; receiptPlan?: string; receiptHandoff?: boolean;
  starterPreviews?: Readonly<Record<string, StarterChecklistPreview>>;
}) {
  const [data, setData] = useState<any>(null),
    [brief, setBrief] = useState<PlanBrief>(emptyBrief),
    [items, setItems] = useState<ReviewedItem[]>([]);
  const [initial, setInitial] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [approvalCheck, setApprovalCheck] = useState<ApprovalCheck | null>(null);
  const [guidePause, setGuidePause] = useState<{query: string; href: string; revision: number} | null>(null);
  const pending = useRef(false),
    request = useRef<any>(null),
    starterRequest = useRef<any>(null),
    checklistRequest = useRef<{key:string;requestId:string}|null>(null),
    focusNotice = useRef(false),
    focusReceipt = useRef(false),
    handledReceiptReturn = useRef(''),
    handoffLinkFocus = useRef<{id:string; intent:string}|null>(null),
    errorBox = useRef<HTMLParagraphElement>(null),
    noticeBox = useRef<HTMLParagraphElement>(null),
    briefInput = useRef<HTMLTextAreaElement>(null),
    receiptHeading = useRef<HTMLHeadingElement>(null),
    receiptReturnNotice = useRef<HTMLParagraphElement>(null);
  const [checklist,setChecklist]=useState('');
  const checklistTooLong=checklist.length>pastedChecklistLimit;
  const [chatDirty,setChatDirty]=useState(false);
  const [chatSeed,setChatSeed]=useState('');
  const [taskContext,setTaskContext]=useState<TaskBreakdownContext|null>(null);
  const [batchOwner,setBatchOwner]=useState('');
  const [suggestStarterDates,setSuggestStarterDates]=useState(false);
  const [includeStarterActivities,setIncludeStarterActivities]=useState(false);
  const [researchBusy,setResearchBusy]=useState(false);
  const [handoffRefreshing,setHandoffRefreshing]=useState(false);
  const [handoffStatus,setHandoffStatus]=useState('');
  const [chatStartingNew,setChatStartingNew]=useState(false),[chatReset,setChatReset]=useState(0);
  const draftDirty = !!data && editable(brief, items) !== initial;
  const dirty = draftDirty || chatDirty || !!checklist.trim();
  const unresolvedApproval = !!approvalCheck;
  useEffect(() => {
    if (!embedded) return;
    window.parent.postMessage({type:'weft-plan-sidebar', event:'state', dirty:dirty || unresolvedApproval, busy:busy || researchBusy || data?.status === 'generating'}, window.location.origin);
  }, [embedded, dirty, unresolvedApproval, busy, researchBusy, data?.status]);
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
    checkingLocked = busy || waiting || researchBusy,
    locked = checkingLocked || handoffRefreshing || !!approvalCheck,
    applied = !!data?.receipt && !chatStartingNew;
  const completedPlan = applied && !embedded && !assistant && !suggestions;
  const canPasteChecklist = !suggestions && !assistant && (!applied || completedPlan);
  const checklistContextChanged = !completedPlan && !!data?.contextChanged;
  const checklistDraftFull = !completedPlan && items.length >= 24;
  const guideStage: PlanGuideStage = applied ? 'added' : data?.draft ? 'review' :
    !data?.configured ? 'starter' : !request.current && (data.status === 'error' || data.status === 'interrupted') ? 'recover' :
    brief.description.trim() ? 'generate' : 'brief';
  const canUseGuideExample = guideReturn && guideStage === 'brief' && !locked && brief.description === '';
  const guideDraftNeedsRecheck = guideStage === 'review' && !!data?.contextChanged;
  const unsentChecklist = !!checklist.trim();
  const offerGuidePause = guideReturn && !!data && !applied && (draftDirty || unsentChecklist);
  const guideRecovery = data?.draft?.source === 'pasted' ? ['#plan-recheck', 'Recheck your pasted draft'] :
    data?.draft?.source === 'starter' ? ['#plan-recheck', 'Recheck your starter checklist'] :
    !data?.configured ? ['#plan-starter', 'Start a fresh checklist'] :
    ['#plan-generate', 'Generate a new draft'];
  const receiptTasks:PlanReceiptTask[]=applied?data.receiptTasks||[]:[];
  const addedCount:number=applied?data.receipt.taskIds.length:0;
  const unavailableCount=Math.max(0,addedCount-receiptTasks.length);
  const showHandoff=applied&&!assistant&&!suggestions;
  const canReturnToReceipt = receiptHandoff && !embedded && !demo && !assistant && !suggestions && !!params.get('project');
  const receiptReturnTask = canReturnToReceipt ? receiptTask : '';
  const receiptReturnPlan = canReturnToReceipt ? receiptPlan : '';
  const priorReceiptChanged = !!receiptReturnPlan && (!applied || data.receipt.generation !== receiptReturnPlan);
  const returnInReceipt = !!receiptReturnTask && !priorReceiptChanged && applied && Array.isArray(data.receipt.taskIds) &&
    data.receipt.taskIds.includes(receiptReturnTask) === true;
  const returnTaskAvailable = returnInReceipt && receiptTasks.some(task => task.id === receiptReturnTask);
  const receiptReturnMessage = !data ? '' : priorReceiptChanged ? 'That plan handoff is no longer current. You’re viewing the latest plan for this project.' :
    !receiptReturnTask || returnTaskAvailable ? '' : returnInReceipt
    ? 'This task is no longer available in the project.' : 'This task is no longer in the current plan receipt.';
  const handoffGroups = showHandoff ? groupPlanHandoff(receiptTasks) : [];
  const untimedCount = showHandoff ? receiptTasks.filter(task => task.needsStartTime).length : 0;
  function receiptTaskRow({id,title,handoff,needsStartTime,scheduleDay}: PlanReceiptTask) {
    const state=showHandoff?handoff?.state:undefined;
    const review=state==='needs-amendment-review'?'amendment':state==='needs-review'||state==='review-blocked'?'completion':
      !embedded&&(state==='needs-owner'||state==='needs-reassignment')?'owner':'';
    const href = planTaskHref(params,id,guideReturn,review,showHandoff&&canReturnToReceipt);
    const scheduleHref=showHandoff&&needsStartTime&&!embedded&&!demo?planTaskHref(params,id,guideReturn,'schedule',canReturnToReceipt):'';
    const timelineHref = showHandoff && !needsStartTime && !embedded && !demo && workspaceScheduleDate(scheduleDay)
      ? planActivityHref(params, id, guideReturn) : '';
    return <li key={id} className="break-words">
      {href ? <a href={href} data-handoff-task={showHandoff ? id : undefined} target={embedded?'_top':undefined} className="inline-flex min-h-11 items-center text-primary underline">{title}</a> : title}
      {showHandoff && handoff && <span className="block text-muted-foreground">{handoffLabel(handoff)}</span>}
      {timelineHref && <a href={timelineHref} data-handoff-task={id} data-handoff-intent="timeline" aria-label={`Show ${title} in Timeline`}
        className="inline-flex min-h-11 items-center text-primary underline">Show in Timeline</a>}
      {showHandoff && needsStartTime && <span className="flex flex-wrap items-center gap-x-3 font-medium">
        <span>Needs a start time</span>
        {scheduleHref && <a href={scheduleHref} data-handoff-task={id} data-handoff-intent="schedule" aria-label={`Set start time for ${title}`}
          className="inline-flex min-h-11 items-center text-primary underline">Set start time</a>}
      </span>}
    </li>;
  }
  useEffect(()=>{
    if(!applied||!focusReceipt.current)return;
    focusReceipt.current=false;
    receiptHeading.current?.focus();
  },[applied]);
  useEffect(()=>{
    if(!data||(!receiptReturnTask&&!receiptReturnPlan))return;
    const key=JSON.stringify([receiptReturnPlan,receiptReturnTask]);
    if(handledReceiptReturn.current===key)return;
    handledReceiptReturn.current=key;
    if(document.activeElement!==document.body)return;
    const heading=receiptHeading.current;
    const links=returnTaskAvailable ? heading?.closest('section')?.querySelectorAll<HTMLAnchorElement>('a[data-handoff-task]') : undefined;
    const link=links?Array.from(links).find(el=>el.dataset.handoffTask===receiptReturnTask&&!el.dataset.handoffIntent):undefined;
    (priorReceiptChanged || (receiptReturnTask && !returnInReceipt) ? receiptReturnNotice.current : link||heading)?.focus();
  },[!!data,receiptReturnTask,receiptReturnPlan,priorReceiptChanged,returnInReceipt,returnTaskAvailable]);
  useEffect(()=>{
    const previous=handoffLinkFocus.current;
    handoffLinkFocus.current=null;
    const heading=receiptHeading.current;
    if(!previous||!heading||document.activeElement!==document.body)return;
    const links=heading.closest('section')?.querySelectorAll<HTMLAnchorElement>('a[data-handoff-task]');
    const taskLinks=Array.from(links||[]).filter(candidate=>candidate.dataset.handoffTask===previous.id);
    const link=taskLinks.find(candidate=>(candidate.dataset.handoffIntent||'')===previous.intent)||taskLinks[0];
    (link||heading).focus();
  },[data?.receiptTasks]);
  const existingTasks: ExistingPlanTask[] = data?.existingTasks || [];
  const existingById = new Map(existingTasks.map(task => [task.id, task]));
  const {
    selected,
    prerequisites,
    reusable,
    matches,
    missing,
    duplicates,
    possible,
    unresolved,
    invalidReuse,
  } = planSelection(
    items,
    existingTasks,
    data?.draft?.duplicateSuggestions || [],
  );
  const itemNumbers = new Map(items.map((item, index) => [item.id, index + 1]));
  const assignees = ((data?.members || []) as { id: string; name: string; active?: boolean }[]).filter(member => member.active !== false);
  const assigneeIds = new Set(assignees.map(member => member.id));
  const ownerHandoff = handoffGroups.find(group => group.id === 'owner');
  const soloOwnerHandoff = canReturnToReceipt && ownerHandoff && typeof data?.actorId === 'string' && assigneeIds.has(data.actorId) && assigneeIds.size === 1;
  const inviteTask = ownerHandoff?.tasks.some(task => task.id === receiptReturnTask) ? receiptReturnTask :
    ownerHandoff?.tasks.length === 1 ? ownerHandoff.tasks[0].id : '';
  const handoffInviteHref = soloOwnerHandoff ? teamAccessFromPlanHref(params.get('project')!, data.receipt.generation, inviteTask, guideReturn) : '';
  const unavailableOwners = applied ? [] : unavailablePlanOwnerItems(selected, assigneeIds);
  const unavailableOwnerItemIds = new Set(unavailableOwners.map(item => item.id));
  const prerequisiteDependents = planPrerequisiteDependents(items);
  const scheduleIssues = new Map<string, { item: ReviewedItem; issue: PlanScheduleIssue }>();
  let invalidPrivateSchedule = false;
  if (!applied) {
    const selectedIds = new Set(selected.map(item => item.id));
    for (const item of items) {
      if (item.kind !== 'activity') continue;
      const issue = reviewPlanActivityTime(item, data?.event.timeZone || '', selectedIds.has(item.id));
      if (issue) {
        scheduleIssues.set(item.id, { item, issue });
        if (issue.blocksPrivateSave) invalidPrivateSchedule = true;
      }
    }
  }
  const canPauseGuide = offerGuidePause && draftDirty && !locked && !invalidPrivateSchedule && !!brief.description.trim() && !unsentChecklist;
  const missingDependencies = missing.length > 0;
  const mixedDraft = items.some(item=>item.kind==='preparation') && items.some(item=>item.kind==='activity');
  function accept(result: any, restoreActivityPreference = true) {
    setHandoffStatus('');
    checklistRequest.current=null;
    setApprovalCheck(null);
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
  function announceHandoffReplacement(result: any) {
    if (!completedPlan || result.status !== 'ready' || !result.draft || result.receipt) return;
    focusNotice.current = true;
    setNotice('New private AI draft ready to review. Tasks already added have not changed.');
  }
  function handlePlanError(e: unknown) {
    if (isAccessError((e as { status?: number } | null)?.status || 0)) {
      setData(null);
      setBrief(emptyBrief);
      setItems([]);
      setInitial('');
      request.current = null;
      starterRequest.current = null;
      checklistRequest.current=null;
      setChecklist('');
      setApprovalCheck(null);
    }
    setError(e instanceof Error ? e.message : 'Could not save. Your edits are still here.');
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
      handlePlanError(e);
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
    if (!dirty && !unresolvedApproval) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, unresolvedApproval]);
  useEffect(() => {
    if (!guidePause || busy) return;
    setGuidePause(null);
    // Leave only after the confirmed save is rendered and the dirty-page
    // beforeunload listener has been removed by the preceding effect.
    if (guideReturn && guidePause.query === query && !dirty && !unresolvedApproval && data?.revision === guidePause.revision)
      window.location.assign(guidePause.href);
  }, [guidePause, busy, guideReturn, query, dirty, unresolvedApproval, data?.revision]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  useEffect(()=>{
    if(!notice||!focusNotice.current)return;
    focusNotice.current=false;
    noticeBox.current?.focus();
  },[notice]);
  // Recover a running request after refresh; polling only reads, never generates another plan.
  useEffect(() => {
    if (!waiting || busy || error) return;
    const timer = window.setTimeout(
      () => void run(async () => {
        const result = await api(query);
        accept(result);
        announceHandoffReplacement(result);
      }),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [waiting, busy, data?.revision, error, query, completedPlan]);
  const updateBrief = <K extends keyof PlanBrief>(
    key: K,
    value: PlanBrief[K],
  ) => {
    request.current = null;
    starterRequest.current = null;
    setBrief((current) => ({ ...current, [key]: value }));
  };
  function useGuideExample() {
    if (!canUseGuideExample || pending.current) return;
    updateBrief('description', examplePlanBrief);
    briefInput.current?.focus();
  }
  const updateItem = (
    id: string,
    edit: Partial<ReviewedItem> | ((item: ReviewedItem, current: readonly ReviewedItem[]) => Partial<ReviewedItem> | undefined),
  ) => {
    request.current = null;
    starterRequest.current = null;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const patch = typeof edit === 'function' ? edit(item, current) : edit;
        if (!patch) return item;
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
  function togglePrerequisite(itemId: string, prerequisiteId: string, checked: boolean) {
    if (locked || applied || pending.current || itemId === prerequisiteId) return;
    updateItem(itemId, (item, current) => {
      if (checked === item.dependsOn.includes(prerequisiteId)) return;
      if (!checked) return { dependsOn: item.dependsOn.filter(id => id !== prerequisiteId) };
      if (item.dependsOn.length >= planPrerequisiteLimit || !current.some(row => row.id === prerequisiteId) ||
          planPrerequisiteLoopSources(planPrerequisiteDependents(current), itemId).has(prerequisiteId)) return;
      return { dependsOn: [...item.dependsOn, prerequisiteId] };
    });
  }
  function focusDraftScheduleField(itemId: string, name: 'start' | 'end') {
    if (locked || applied || pending.current) return;
    const issue = scheduleIssues.get(itemId)?.issue;
    if (issue?.field !== name && !(name === 'start' && selected.some(item => item.id === itemId && item.kind === 'activity' && !item.start))) return;
    const field = document.getElementById((name === 'start' ? 'date-' : 'end-') + itemId) as HTMLInputElement | null;
    if (field?.localName !== 'input' || field.type !== 'datetime-local') return;
    focusDraftField(field, name === 'start' ? 'details[data-plan-owner-date]' : 'details[data-plan-item-details]');
  }
  function focusDraftOwner(itemId: string) {
    if (locked || applied || pending.current || !unavailableOwnerItemIds.has(itemId)) return;
    const field = document.getElementById('owner-' + itemId);
    if (field?.localName === 'select') focusDraftField(field, 'details[data-plan-owner-date]');
  }
  function focusDraftField(field: HTMLElement, editorSelector: string) {
    if (field.matches(':disabled')) return;
    const editor = field.closest<HTMLDetailsElement>(editorSelector);
    if (!editor) return;
    editor.open = true;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  function editBatch(operation: (current: ReviewedItem[]) => ReviewedItem[]) {
    if (locked || applied || pending.current) return;
    request.current = null;
    starterRequest.current = null;
    setItems(operation);
    setError('');
    setNotice('Private draft updated. Review the items before adding them; shared tasks have not changed.');
  }
  async function save(forApproval = false) {
    const result = await api(query, {
      action: 'save',
      revision: data.revision,
      brief,
      items,
      generation: data.draft?.generation,
    });
    // The save response is a fresh read. Another tab can change the draft after
    // our save commits but before that read. Keep this tab's inputs in that case.
    if (forApproval && (
      result.revision !== data.revision + 1 ||
      !result.draft ||
      result.draft.generation !== data.draft?.generation ||
      result.receipt
    )) {
      throw new Error('The private draft changed while saving. This action did not add any tasks. Your edits are still visible here. Copy what you want to keep, then use Reload saved draft to review the latest version.');
    }
    accept(result, false);
    request.current = null;
    starterRequest.current = null;
    return result;
  }
  async function saveAndReturnToGuide() {
    if (!canPauseGuide || pending.current) return;
    await run(async () => {
      const revision = data.revision + 1;
      const generation = data.draft?.generation;
      const expected = savedEditable(brief, items, data.event.date);
      const result = await api(query, {action:'save', revision:data.revision, brief, items, generation},
        AbortSignal.timeout(approvalTimeout));
      let confirmed = false;
      if (result.revision === revision && !result.receipt && result.status === (data.draft ? 'ready' : 'empty') &&
        (data.draft ? result.draft?.generation === generation && Array.isArray(result.draft.items) : !result.draft)) {
        try { confirmed = savedEditable(result.brief, result.draft?.items || [], data.event.date) === expected; }
        catch { /* An unexpected response cannot confirm this save. */ }
      }
      if (!confirmed) throw new Error('We couldn’t confirm this version was saved. Your edits are still here. Copy anything you want to keep before reloading the saved draft.');
      accept(result, false);
      request.current = null;
      starterRequest.current = null;
      setGuidePause({query, href:projectUrl, revision});
    });
  }
  async function importChecklist() {
    if(locked||!canPasteChecklist||checklistContextChanged||checklistDraftFull||checklistTooLong||!checklist.trim())return;
    const input={
      action:'import-checklist',revision:data.revision,workspaceRevision:data.workspaceRevision,
      generation:data.draft?.generation??null,items:completedPlan?[]:items,text:checklist,
      // Pasting titles for a new handoff does not reuse the previous plan's
      // optional date/time assumptions, which may no longer fit this event.
      brief:{...brief,description:brief.description.trim()||data.event.name||names[brief.kind],
        ...(completedPlan?{endDate:'',startTime:'',endTime:''}:{})},
      ...(completedPlan?{replaceHandoff:true}:{}),
    };
    const key=JSON.stringify(input);
    if(completedPlan&&checklistRequest.current?.key!==key&&
      !window.confirm('Start a new private draft from this pasted checklist? '+replaceHandoffImpact))return;
    await run(async()=>{
      if(checklistRequest.current?.key!==key)checklistRequest.current={key,requestId:crypto.randomUUID()};
      const requestId=checklistRequest.current.requestId;
      const result=await api(query,{...input,requestId});
      const {added,skipped}=result.checklistImportResult;
      if(added){
        if(completedPlan&&(result.receipt||result.status!=='ready'||result.revision!==input.revision+1||
          result.draft?.source!=='pasted'||result.draft.generation!==requestId||!Array.isArray(result.draft.items)||
          result.draft.items.length!==added||result.draft.items.some((item:ReviewedItem)=>item.included!==false)))
          throw new Error('We couldn’t confirm this checklist replaced the handoff. Your pasted text is still here. Retry the same import or reload the saved draft to check what was saved.');
        accept(result);
        setChecklist('');
        request.current=null;
        starterRequest.current=null;
      }
      focusNotice.current=true;
      setNotice((added?`${added} ${added===1?'task added':'tasks added'} unchecked to your private draft.`:'Nothing was added to your draft.')+
        (skipped?` ${skipped} matching ${skipped===1?'line was':'lines were'} skipped.`:'')+
        (added?(completedPlan?' The previous handoff was replaced; existing shared tasks stayed in the project.':'')+
          ' Select what you want to share in Review proposed items. No AI was used.':
          (completedPlan?' This import didn’t replace your handoff.':'')+' Edit the pasted text to try again.'));
    });
  }
  async function recheckChecklist(source: 'pasted' | 'starter') {
    if(locked||applied||data?.draft?.source!==source||!data.contextChanged)return;
    await run(async()=>{
      const signal=AbortSignal.timeout(approvalTimeout),generation=data.draft.generation;
      const current=await api(query,undefined,signal);
      if(current.revision!==data.revision||current.draft?.source!==source||current.draft.generation!==generation||
        current.receipt||!['ready','error','interrupted'].includes(current.status)||
        !Number.isSafeInteger(current.workspaceRevision)||current.workspaceRevision<data.workspaceRevision)
        throw new Error('The saved draft changed or couldn’t be confirmed. Your edits are still here. Reload the saved draft to review it.');
      const expected=savedEditable(brief,items,current.event.date);
      const reviewTiming=source==='starter'&&items.some(item=>item.dueDate||item.start||item.end);
      if(reviewTiming&&!window.confirm(`Review the checklist’s dates and times against the current event (date: ${current.event.date||'not set'}, time zone: ${current.event.timeZone||'not set'}). Rechecking keeps the dates and times as written and saves the draft privately. Nothing will be added. Keep these proposals?`))return;
      const result=await api(query,{action:'recheck-'+source,revision:current.revision,workspaceRevision:current.workspaceRevision,
        generation,brief,items,...(reviewTiming?{reviewTiming:true}:{})},AbortSignal.timeout(approvalTimeout));
      let confirmed=false;
      // The response rereads the saved draft. Another tab might have changed,
      // replaced or applied it after our private save; don't adopt that view.
      if(result.revision===current.revision+1&&result.workspaceRevision===current.workspaceRevision&&result.contextChanged===false&&
        result.status==='ready'&&!result.receipt&&result.draft?.source===source&&result.draft.generation===generation&&Array.isArray(result.draft.items)){
        try{confirmed=savedEditable(result.brief,result.draft.items,result.event.date)===expected;}catch{/* Not proof of the private save. */}
      }
      if(!confirmed)throw new Error('We couldn’t confirm the rechecked checklist. Your edits are still here. This check didn’t add any tasks. Use Reload saved draft to check what was saved.');
      accept(result,false);
      request.current=null;
      starterRequest.current=null;
      focusNotice.current=true;
      setNotice((source==='starter'?'Starter checklist':'Pasted draft')+' kept and checked against the current project. Review matching tasks, required links, and any dates or times before adding items. No shared tasks were added.');
    });
  }
  async function useStarter() {
    const message = completedPlan
      ? 'Start a new private draft from a starter checklist? ' + replaceHandoffImpact
      : 'Replace the saved private draft with a starter checklist? Your existing shared tasks will not change.';
    if (!starterRequest.current && (data.draft || completedPlan) && !window.confirm(message)) return;
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
      focusNotice.current = true;
      setNotice('Starter checklist ready to review. No AI was used; no shared tasks were added.');
    });
  }
  async function generate(nextBrief=brief) {
    const freshRequest = !request.current || JSON.stringify(request.current.brief) !== JSON.stringify(nextBrief);
    if (completedPlan && freshRequest && !window.confirm('Generate a new private AI draft? ' + replaceHandoffImpact)) return false;
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
      announceHandoffReplacement(result);
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
      if (applied && (!Number.isSafeInteger(result.workspaceRevision) || result.workspaceRevision < data.workspaceRevision))
        throw new Error('Could not confirm the latest handoff. Your last loaded task details are still shown. Try again.');
      setData(result);
      request.current = null;
      starterRequest.current = null;
      setNotice(
        result.receipt ? 'Task handoff refreshed from the project.' : result.contextChanged
          ? result.draft?.source==='starter' ? 'Event details or tasks changed. Recheck the starter checklist before adding it.' : result.draft?.source==='pasted' ? 'Event details or tasks changed. Recheck the pasted draft before adding it.' : 'Event details or tasks changed. Generate a new draft before adding it.'
          : 'Project context refreshed. Your draft edits are kept.',
      );
    });
  }
  async function refreshTaskHandoff() {
    if(!showHandoff||locked||pending.current)return;
    pending.current=true;
    setHandoffRefreshing(true);
    setHandoffStatus('Checking for task updates…');
    setError('');
    setNotice('');
    try {
      const signal=AbortSignal.timeout(handoffRefreshTimeout);
      const result=await api(query,undefined,signal);
      signal.throwIfAborted();
      if (result.revision !== data.revision) {
        setHandoffStatus('The saved plan changed. Use Reload saved draft to see it. This handoff is unchanged.');
        return;
      }
      const current=data.receipt, next=result.receipt;
      const currentIds=new Set<string>(current.taskIds);
      const rows=result.receiptTasks;
      if (!next || next.generation!==current.generation || next.approvalHash!==current.approvalHash ||
        !Array.isArray(next.taskIds) || next.taskIds.length!==current.taskIds.length ||
        !current.taskIds.every((id: string,index: number)=>id===next.taskIds[index]) ||
        !Array.isArray(rows) || rows.some(row=>!currentIds.has(row?.id)||typeof row.title!=='string') ||
        new Set(rows.map(row=>row.id)).size!==rows.length ||
        !Number.isSafeInteger(result.workspaceRevision) || result.workspaceRevision<data.workspaceRevision) {
        setHandoffStatus('Could not confirm the latest handoff. Your last loaded task details are still shown. Try again.');
        return;
      }
      const active=document.activeElement;
      if(active?.matches('a[data-handoff-task]') && receiptHeading.current?.closest('section')?.contains(active)){
        const {handoffTask,handoffIntent}=(active as HTMLAnchorElement).dataset;
        if(handoffTask)handoffLinkFocus.current={id:handoffTask,intent:handoffIntent||''};
      }
      // Adopt the verified project metadata together. The private draft
      // revision is unchanged, and locally edited controls are left alone.
      setData(result);
      request.current=null;
      starterRequest.current=null;
      setHandoffStatus('Task handoff refreshed from the project.');
    } catch (e) {
      if (isAccessError((e as {status?: number}|null)?.status || 0)) {
        setHandoffStatus('');
        handlePlanError(e);
      } else setHandoffStatus('Could not refresh the task handoff. Your last loaded task details are still shown. Try again.');
    } finally {
      pending.current=false;
      setHandoffRefreshing(false);
    }
  }
  function matchingReceipt(result: any, attempted: ApprovalCheck) {
    return result.receipt?.generation === attempted.generation &&
      result.receipt.approvalHash === attempted.hash && Array.isArray(result.receipt.taskIds);
  }
  async function checkApproval(attempted: ApprovalCheck) {
    await run(async () => {
      const result = await api(query, undefined, AbortSignal.timeout(approvalTimeout));
      if (matchingReceipt(result, attempted)) {
        focusReceipt.current = true;
        accept(result);
        request.current = null;
        return;
      }
      focusNotice.current = true;
      const sameDraft = !result.receipt && result.revision === attempted.revision &&
        result.draft?.generation === attempted.generation;
      const contextConfirmed = Number.isSafeInteger(result.workspaceRevision) &&
        result.workspaceRevision >= attempted.workspaceRevision &&
        (attempted.kind !== 'conflict' || result.workspaceRevision > attempted.workspaceRevision || result.contextChanged);
      if (sameDraft && contextConfirmed) {
        setData(result);
        setApprovalCheck(null);
        setNotice(result.contextChanged
          ? 'No matching receipt was found. The project changed; review the draft guidance below before adding tasks.'
          : 'No matching receipt was found. Review your selection again before choosing Add selected items.');
      } else if (sameDraft) {
        setNotice('The server still shows the same project version. Your selection is kept. Check again before adding tasks.');
      } else {
        setNotice('We could not confirm this selection was added. The saved draft or project changed. Reload the saved draft to see its current state; this check did not add anything.');
      }
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
        <a href={guideReturn ? projectUrl : '/'} target={embedded ? '_top' : undefined} className={guideReturn ? 'mt-2 inline-flex min-h-11 items-center text-sm text-primary underline' : 'mt-5 block text-sm underline'}>
          {guideReturn ? 'Return to your guide' : 'All projects'}
        </a>
      </section>
    );
  const eventTypeControl = (
    <div className="space-y-2">
      <Label htmlFor="plan-kind">Event type</Label>
      <NativeSelect
        id="plan-kind"
        className={guideReturn ? 'w-full [&_select]:min-h-11 [&_select]:scroll-mt-6' : 'w-full [&_select]:min-h-11'}
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
  );
  const scheduleControls = (
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
  );
  const starterPreview = starterPreviews?.[brief.kind];
  const guideHint = guideReturn && <PlanGuideHint stage={guideStage} locked={locked} draftNeedsRecheck={guideDraftNeedsRecheck}
    onUseExample={canUseGuideExample ? useGuideExample : undefined} />;
  return (
    <section aria-busy={checkingLocked} className={embedded ? 'plan-sidebar-review' : undefined}>
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
        <div className="mb-4 text-sm">
          <p role="status" ref={noticeBox} tabIndex={-1}>{notice}</p>
          {!applied && !assistant && !suggestions && data.draft && <a href="#plan-proposed-items" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Jump to proposed items</a>}
        </div>
      )}
      {approvalCheck && <section aria-labelledby="plan-approval-check-title" className="mb-5 space-y-3 rounded-lg border p-4 text-sm">
        <h2 id="plan-approval-check-title" className="font-semibold">{approvalCheck.kind === 'uncertain' ? 'Adding tasks was not confirmed' : 'This approval needs a fresh review'}</h2>
        <p>Your selection is kept here. Checking the saved result won’t add any tasks or call AI.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="min-h-11" disabled={checkingLocked} onClick={()=>checkApproval(approvalCheck)}>
            {approvalCheck.kind === 'uncertain' ? 'Check what was added' : 'Refresh before adding'}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={checkingLocked} onClick={()=>{
            if(window.confirm('Reload the current saved draft? This replaces the draft view shown here.'))void reload();
          }}>Reload saved draft</Button>
        </div>
      </section>}
      {!embedded && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="min-w-0 break-words font-medium">
          {data.event.name}
          {demo ? ' · Demo' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {offerGuidePause && <Button type="button" variant="outline" className="min-h-11"
            disabled={!canPauseGuide} aria-describedby="guide-pause-help" onClick={saveAndReturnToGuide}>Save and return to guide</Button>}
          <a href={projectUrl} className={guideReturn ? 'inline-flex min-h-11 items-center text-primary underline' : 'text-primary underline'}>
            {guideReturn ? 'Return to your guide' : applied ? 'Open project' : 'Skip / open project'}
          </a>
        </div>
        {offerGuidePause && <p id="guide-pause-help" className="basis-full text-muted-foreground">{unsentChecklist
          ? 'Import or clear your pasted checklist before leaving. It isn’t part of the saved draft yet.'
          : invalidPrivateSchedule ? <>Before saving, <a href="#plan-approval-impact" className="inline-flex min-h-11 items-center font-medium text-primary underline">review the highlighted activity times</a>.</>
          : !brief.description.trim() ? 'Add a short event description before saving.'
          : 'Save your private edits for later. Nothing is added to the project and no AI request is made.'}</p>}
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
      {!completedPlan && guideHint}
      {receiptReturnMessage && <p id="plan-receipt-return-status" ref={receiptReturnNotice} tabIndex={-1} role="status"
        className="mb-4 rounded-lg border p-3 text-sm">{receiptReturnMessage}</p>}
      {applied && (
        <section aria-labelledby="plan-receipt-heading" className="mb-5 space-y-3 rounded-lg border border-primary/40 p-4">
          <h2 id="plan-receipt-heading" ref={receiptHeading} tabIndex={-1} className="scroll-mt-6 font-medium">Plan added to the project</h2>
          <p role="status" className="text-sm">
            {addedCount} {addedCount===1?'task':'tasks'} added to the project.
            {unavailableCount>0&&` ${unavailableCount} ${unavailableCount===1?'is':'are'} no longer available.`}
          </p>
          {untimedCount > 0 && <p className="rounded-lg border p-3 text-sm">
            <strong>{untimedCount === 1 ? '1 activity needs a start time.' : `${untimedCount} activities need start times.`}</strong>{' '}
            Set {untimedCount === 1 ? 'its start time' : 'their start times'} in Timeline before {untimedCount === 1 ? 'it can appear' : 'they can appear'} on the run sheet.
          </p>}
          {!embedded && <nav aria-label="Plan handoff destinations" className="flex flex-wrap gap-x-4 text-sm">
            <a href={projectUrl+'#tasks'} className="inline-flex min-h-11 items-center text-primary underline">Open Shared tasks</a>
            <a href={projectUrl+'#timeline'} className="inline-flex min-h-11 items-center text-primary underline">Open Timeline</a>
          </nav>}
          {showHandoff ? (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">Team handoff</h3>
                <Button type="button" variant="outline" className="min-h-11 aria-disabled:opacity-50" disabled={locked} focusableWhenDisabled
                  aria-describedby="plan-handoff-refresh-status" onClick={refreshTaskHandoff}>Refresh task handoff</Button>
              </div>
              <p id="plan-handoff-refresh-status" role="status" className="text-muted-foreground empty:sr-only">{handoffStatus}</p>
              <p>For tasks added from this draft. Assignment does not record acceptance.</p>
              {handoffGroups.map(group => (
                <section key={group.id} aria-labelledby={'handoff-' + group.id} className="rounded-lg border p-3">
                  <h4 id={'handoff-' + group.id} className="font-medium">{group.title} <span className="text-muted-foreground">· {group.tasks.length}</span></h4>
                  {group.id === 'owner' && handoffInviteHref ? <p className="text-muted-foreground">
                    Open a task to assign it to yourself, or invite a teammate and assign it after they join.
                  </p> : group.help && <p className="text-muted-foreground">{group.help}</p>}
                  {group.id === 'owner' && handoffInviteHref && !locked && <a href={handoffInviteHref}
                    className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Invite a teammate</a>}
                  <ul className="mt-1 space-y-1">{group.tasks.map(receiptTaskRow)}</ul>
                </section>
              ))}
            </div>
          ) : receiptTasks.length > 0 && <ol className="list-decimal space-y-1 ps-5 text-sm">{receiptTasks.map(receiptTaskRow)}</ol>}
        </section>
      )}
      {completedPlan && guideHint}
      {completedPlanDisclosure(<>
      {!assistant && !suggestions && (
        <section className="mb-4" aria-labelledby="plan-starter-title">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <header className="space-y-2">
                <h2 id="plan-starter-title" className="text-xl font-semibold">Starter checklist</h2>
                <p id="plan-starter" tabIndex={-1} className="scroll-mt-6 text-sm text-muted-foreground">Start with a checklist for your event, then edit and select what to add. No AI call or AI quota is used.</p>
              </header>
              <fieldset disabled={locked} className="space-y-4">
                <legend className="sr-only">Starter checklist options</legend>
                {eventTypeControl}
                {starterPreview && <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p role="status" aria-atomic="true" className="font-medium">{starterPreview.preparationCount} preparation tasks · {starterPreview.activityCount} optional event-day activities</p>
                  <p className="text-muted-foreground">Example preparation tasks</p>
                  <ul className="list-disc space-y-1 break-words ps-5">
                    {starterPreview.sampleTitles.map(title => <li key={title}>{title}</li>)}
                  </ul>
                </div>}
                {scheduleControls}
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={suggestStarterDates} disabled={!data.event.date || !data.event.timeZone} onChange={e=>{setSuggestStarterDates(e.target.checked);starterRequest.current=null;}} />
                  <span>Suggest preparation dates from the event date <span className="block text-muted-foreground">{data.event.date && data.event.timeZone ? `${data.event.date} · ${data.event.timeZone}. Editable lead times, not confirmed deadlines. Short-notice items are flagged for review. Activity times stay blank; wrap-up uses the last day when supplied.` : 'Set an event date and time zone in Project settings to use this option.'}</span></span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input id="starter-activities" type="checkbox" className="mt-1" checked={includeStarterActivities} onChange={e=>{setIncludeStarterActivities(e.target.checked);starterRequest.current=null;}} />
                  <span>Add event-day activities <span className="block text-muted-foreground">Give activities start times in the draft to put them on the run sheet, or add them now and set their times later in Timeline.</span></span>
                </label>
                <Button type="button" className="min-h-11" disabled={locked} onClick={()=>void useStarter()}>
                  {starterRequest.current ? 'Retry checklist request' : completedPlan ? 'Start a new checklist' : data.draft ? 'Replace with starter checklist' : 'Use starter checklist'}
                </Button>
                <p className="text-sm text-muted-foreground">Owners start unset; dates stay unset unless you request suggestions. This is not a complete policy or safety checklist.</p>
                {!applied && data.draft?.source === 'starter' && <a href="#plan-proposed-items" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">Review your saved checklist</a>}
              </fieldset>
            </CardContent>
          </Card>
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
          {!suggestions && <header className="space-y-2">
            <h2 className="text-xl font-semibold">Draft with AI (optional)</h2>
            <p className="text-sm text-muted-foreground">Describe what you’re planning to get a draft tailored to your event. This also uses the event type and dates above.</p>
          </header>}
          <fieldset disabled={locked} className="space-y-5">
            <legend className="sr-only">Event brief</legend>
            {suggestions && eventTypeControl}
            <div className="space-y-2">
              <Label htmlFor="plan-brief">{suggestions ? 'What should AI check for?' : 'What are you planning?'}</Label>
              <Textarea
                id="plan-brief"
                ref={briefInput}
                rows={suggestions ? 2 : 4}
                maxLength={4000}
                value={brief.description}
                onChange={(e) => updateBrief('description', e.target.value)}
                placeholder={suggestions ? 'Optional focus: anything missing from our launch evening?' : 'Purpose, activities, constraints, and decisions still to make'}
              />
            </div>
            {suggestions && scheduleControls}
            <p id={guideReturn ? 'plan-generate' : undefined} tabIndex={guideReturn ? -1 : undefined} className="scroll-mt-6 text-sm text-muted-foreground">
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
                  disabled={locked || invalidPrivateSchedule || !brief.description.trim()}
                  aria-describedby={invalidPrivateSchedule ? 'plan-save-schedule-help' : undefined}
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
            {invalidPrivateSchedule && <p id="plan-save-schedule-help" className="text-sm text-muted-foreground">Before saving, <a href="#plan-approval-impact" className="inline-flex min-h-11 items-center font-medium text-primary underline">review the highlighted activity times</a>.</p>}
            {guideReturn && guideStage === 'review' && !locked && <p className="text-sm text-muted-foreground">
              Your draft is private. <a href="#plan-proposed-items" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">Jump to your draft</a>{guideDraftNeedsRecheck ? ' to review it against the current project.' : ' to choose what to add.'}
            </p>}
          </fieldset>
        </CardContent>
      </Card>
      </details>}
      {canPasteChecklist && <details className="mt-4 space-y-3 rounded-lg border p-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-medium">
          <span aria-hidden="true">+</span> Paste a checklist
        </summary>
        <div className="space-y-2 text-sm">
          <Label htmlFor="plan-pasted-checklist">Task titles, one per line</Label>
          <p id="plan-pasted-checklist-help" className="text-muted-foreground">Paste up to 24 task titles. Bullets, numbers and checkboxes are removed. New items start unchecked, without dates or owners. Import saves to your private draft without AI or shared changes.{completedPlan?' Your current handoff stays until a new draft with at least one new title is saved.':''}</p>
          <Textarea id="plan-pasted-checklist" rows={5} value={checklist} disabled={locked}
            aria-invalid={checklistTooLong||undefined} aria-describedby={'plan-pasted-checklist-help'+(checklistTooLong?' plan-pasted-checklist-length':'')}
            onChange={event=>setChecklist(event.target.value)} />
          {checklistTooLong && <p id="plan-pasted-checklist-length" role="status">Shorten the text to 6,000 characters or fewer. Nothing has been imported.</p>}
          <Button type="button" variant="outline" className="min-h-11"
            disabled={locked||checklistContextChanged||checklistDraftFull||checklistTooLong||!checklist.trim()}
            onClick={()=>void importChecklist()}>Import for review</Button>
          {checklistContextChanged ? <p>Review the current project context before importing.</p> :
            checklistDraftFull ? <p>This draft already has 24 items.</p> : null}
        </div>
      </details>}
      </>, completedPlan ? {id: 'plan-draft-again', title: 'Draft another plan', description: replaceHandoffImpact} : undefined)}
      {waiting && (
        <p role="status" className="my-4 text-sm">
          Generating a private draft. You can return later; nothing is added
          automatically.
        </p>
      )}
      {data.draft && !(assistant && (chatStartingNew || data.draft.work)) && completedPlanDisclosure(
        <section className={completedPlan ? 'space-y-4' : 'mt-8 space-y-4'} aria-label={completedPlan ? 'Original draft' : 'Review draft'}>
          {data.draft.source==='starter' && <p className="rounded-lg border p-4 text-sm">Product-authored starter checklist · No AI used.{!completedPlan && ' Not tailored to your brief; review every item, date and owner before adding it.'}</p>}
          {data.draft.source==='pasted' && <p className="rounded-lg border p-4 text-sm">Pasted checklist · No AI used.{!completedPlan && ' Review the titles and select only the tasks you want to share.'}</p>}
          {!applied && data.draft.source==='starter' && data.contextChanged && (
            <div className="space-y-2 rounded-lg border p-4 text-sm">
              <p id={guideReturn ? 'plan-recheck' : undefined} tabIndex={guideReturn ? -1 : undefined} className="scroll-mt-6">The project changed. Recheck to keep your edits and see matching tasks in the current project. Dates and times stay as written for you to review. Nothing is added.</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={()=>void recheckChecklist('starter')}>Recheck starter checklist</Button>
            </div>
          )}
          {!applied && data.draft.source==='pasted' && data.contextChanged && (
            <div className="space-y-2 rounded-lg border p-4 text-sm">
              <p id={guideReturn ? 'plan-recheck' : undefined} tabIndex={guideReturn ? -1 : undefined} className="scroll-mt-6">The project changed. Rechecking saves your private edits and checks them against the current project without adding shared tasks.</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={locked} onClick={()=>void recheckChecklist('pasted')}>Recheck pasted draft</Button>
            </div>
          )}
          {assistant && !items.length && !data.draft.questions?.length && <p role="status" className="rounded-lg border p-4 text-sm">No tasks proposed. Check the assumptions below or describe the task more specifically.</p>}
          {suggestions && !items.length && <p role="status" className="rounded-lg border p-4 text-sm">No additional tasks were supported by this review. Check the questions below or add more context—AI does not guarantee that the plan is complete.</p>}
          {!completedPlan && <div>
            <h2 id="plan-proposed-items" tabIndex={-1} className="scroll-mt-6 text-xl font-semibold">Review proposed items</h2>
            {guideReturn && guideDraftNeedsRecheck && !locked && <p className="mt-2 rounded-lg border p-3 text-sm">
              The project has changed. <a className="inline-flex min-h-11 items-center font-medium text-primary underline" href={guideRecovery[0]}>{guideRecovery[1]}</a> before adding items.
            </p>}
            <p className="mt-1 text-sm text-muted-foreground">
              Adds to your {data.existingTaskCount} existing tasks. Dates,
              owners, and activities below are proposals.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{embedded ? 'Only true prerequisites block completion. Review links under Details.' : 'Required links mean one task needs another task’s output to be completed. Related work can run in parallel. Review and remove any unnecessary prerequisites below.'}</p>
          </div>}
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
                    {assignees.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}
                  </NativeSelect>
                </div>
                <Button type="button" variant="outline" disabled={locked||!selected.length||!assigneeIds.has(batchOwner)} onClick={()=>{
                  if(!assigneeIds.has(batchOwner))return;
                  editBatch(current=>current.map(item=>item.included&&item.duplicateChoice!=='reuse'?{...item,owner:batchOwner}:item));
                }}>Assign selected</Button>
              </div>
              <p className="text-sm text-muted-foreground">Changes only the selected private proposals, including any owners already chosen for them. Excluded and reused items, dates and prerequisites stay unchanged. Nothing is assigned in the shared project until you add the reviewed items.</p>
            </div>}
            {items.map((item, index) => {
              const loopSources = planPrerequisiteLoopSources(prerequisiteDependents, item.id);
              const prerequisiteLimitReached = item.dependsOn.length >= planPrerequisiteLimit;
              const prerequisiteCountId = `required-count-${item.id}`;
              const scheduleIssue = scheduleIssues.get(item.id)?.issue;
              const draftOwner = item.owner.trim();
              const ownerError = unavailableOwnerItemIds.has(item.id) ? `plan-owner-error-${item.id}` : undefined;
              const startError = scheduleIssue?.field === 'start' ? `schedule-start-error-${item.id}` : undefined;
              const endError = scheduleIssue?.field === 'end' ? `schedule-end-error-${item.id}` : undefined;
              const exact = matches.get(item.id) || [];
              const similar = possible.get(item.id);
              const reusedTask = existingById.get(reusable.get(item.id) || '');
              const keepsOtherMatch = reusedTask && !exact.some(task => task.id === reusedTask.id);
              const existingPrerequisites = !applied
                ? (prerequisites.get(item.id) || []).flatMap(target => {
                    if (target.kind !== 'existing') return [];
                    const task = existingById.get(target.taskId);
                    return task ? [{ task, proposalIds: target.proposalIds }] : [];
                  })
                : [];
              return (
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
                  {!applied && similar && !invalidReuse.has(item.id) && (
                    <div
                      className="rounded-lg border p-3 space-y-2 text-sm"
                      role="status"
                    >
                      <p>
                        {item.duplicateChoice === 'reuse'
                          ? 'Using existing task: '
                          : 'Possible duplicate of: '}
                        {existingTaskLink(similar, params, guideReturn)}
                      </p>
                      <p className="text-muted-foreground">
                        {item.duplicateChoice === 'reuse'
                          ? 'This item is excluded from new tasks. Review the existing match before adding the draft; its details stay unchanged.'
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
                            Use existing: {similar.title}
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
                  {!applied && !invalidReuse.has(item.id) && exact.length > 0 && (
                    <div className="space-y-2 text-sm" role="status">
                      <p>
                        {keepsOtherMatch
                          ? 'An exact match also exists, but your earlier choice points to a different task. Review that choice before adding.'
                          : exact.length === 1
                          ? 'Already in project. Leave unchecked to use the existing task for prerequisites. Its details will not change.'
                          : reusable.has(item.id)
                            ? 'Multiple tasks match this title and time. Review the existing task you chose on the dependent proposal.'
                            : 'Multiple tasks match this title and time. No existing task is chosen; remove or change any prerequisite that points here.'}
                      </p>
                      {keepsOtherMatch
                        ? existingTaskLink(reusedTask, params, guideReturn)
                        : exact.length === 1 && existingTaskLink(exact[0], params, guideReturn)}
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
                  {existingPrerequisites.length > 0 && (
                    <div className="rounded-lg border p-3 text-sm">
                      <p className="font-medium">Existing prerequisites</p>
                      <p className="text-muted-foreground">
                        {data.contextChanged
                          ? 'These are the current matches. Recheck the draft before adding tasks.'
                          : 'These shared tasks are matched to this proposal’s required links. Opening a task won’t change the draft.'}
                      </p>
                      <ul aria-label="Existing prerequisites" className="mt-1 divide-y">
                        {existingPrerequisites.map(({ task, proposalIds }) => (
                          <li key={task.id} className="flex flex-wrap items-center justify-between gap-x-3 py-1">
                            <div className="min-w-0">
                              {existingTaskLink(task, params, guideReturn)}
                              {proposalIds.length > 1 && <p className="mb-2 text-muted-foreground">
                                {proposalIds.length} draft references point to this task.{!data.contextChanged && ' One required link will be added.'} Removing the link clears these references from this proposal only.
                              </p>}
                            </div>
                            <Button type="button" variant="outline" className="min-h-11"
                              aria-label={`Remove link to prerequisite: ${task.title}`}
                              onClick={event => {
                                if (document.activeElement === event.currentTarget) {
                                  document.getElementById('include-' + item.id)?.focus({ preventScroll: true });
                                }
                                updateItem(item.id, { dependsOn: item.dependsOn.filter(other => !proposalIds.includes(other)) });
                              }}>
                              Remove link
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
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
                  <details data-plan-owner-date open={!embedded}>
                    <summary className={embedded ? 'cursor-pointer text-xs font-medium' : 'hidden'}>Owner & date</summary>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={'owner-' + item.id}>Owner</Label>
                      <NativeSelect
                        id={'owner-' + item.id}
                        className="w-full"
                        value={draftOwner}
                        aria-invalid={ownerError ? true : undefined}
                        aria-describedby={ownerError}
                        onChange={(e) =>
                          updateItem(item.id, { owner: e.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {assignees.map(member => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                        {draftOwner && !assigneeIds.has(draftOwner) && <option value={draftOwner} disabled>Unavailable owner</option>}
                      </NativeSelect>
                      {ownerError && <p id={ownerError} className="text-sm text-destructive">This owner is no longer available. Choose an active teammate or leave this item unassigned.</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={'date-' + item.id}>
                        {item.kind === 'activity'
                          ? 'Activity start'
                          : 'Preparation due date'}
                      </Label>
                      <Input
                        id={'date-' + item.id}
                        aria-label={item.kind === 'activity' ? `Activity start for ${item.title.trim() || 'Untitled activity'} (item ${index + 1})` : undefined}
                        aria-invalid={startError ? true : undefined}
                        aria-describedby={startError}
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
                      {startError && <p id={startError} className="text-sm text-destructive">{scheduleIssue?.message}</p>}
                    </div>
                  </div>
                  </details>
                  <details data-plan-item-details>
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
                              aria-label={`Activity end for ${item.title.trim() || 'Untitled activity'} (item ${index + 1})`}
                              aria-invalid={endError ? true : undefined}
                              aria-describedby={endError}
                              value={item.end}
                              onChange={(e) =>
                                updateItem(item.id, { end: e.target.value })
                              }
                            />
                            {endError && <p id={endError} className="text-sm text-destructive">{scheduleIssue?.message}</p>}
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
                      <fieldset className="space-y-2" aria-describedby={`required-help-${item.id} ${prerequisiteCountId}`}>
                        <legend className="mb-2 text-sm font-medium">
                          Required before completion
                        </legend>
                        <p id={`required-help-${item.id}`} className="text-sm text-muted-foreground">Keep only links whose results are needed to complete this task. Related work can run in parallel without a required link. Nothing is linked in the shared project until you add the reviewed items.</p>
                        <p id={prerequisiteCountId} className="text-sm text-muted-foreground" role="status">
                          {item.dependsOn.length} of {planPrerequisiteLimit} draft prerequisites selected.{prerequisiteLimitReached && ' Remove one before adding another.'}
                        </p>
                        {items
                          .filter((other) => other.id !== item.id)
                          .map((other) => {
                            const checked = item.dependsOn.includes(other.id);
                            const circular = !checked && loopSources.has(other.id);
                            const checkboxId = `required-${item.id}:${other.id}`;
                            const labelId = `prerequisite-name:${item.id}:${other.id}`;
                            const reasonId = `prerequisite-loop:${item.id}:${other.id}`;
                            return (
                              <label key={other.id} htmlFor={checkboxId} className="flex min-h-11 items-start gap-2 py-2 text-sm">
                                <input
                                  id={checkboxId}
                                  type="checkbox"
                                  className="mt-1 size-4 shrink-0 accent-primary"
                                  checked={checked}
                                  disabled={!checked && (circular || prerequisiteLimitReached)}
                                  aria-labelledby={labelId}
                                  aria-describedby={circular ? reasonId : !checked && prerequisiteLimitReached ? prerequisiteCountId : undefined}
                                  onChange={e => togglePrerequisite(item.id, other.id, e.target.checked)}
                                />
                                <span className="wrap-anywhere">
                                  <span id={labelId}>
                                    {other.title.trim() || 'Untitled draft item'}
                                    {reusable.has(other.id) && !invalidReuse.has(other.id)
                                      ? ' (existing project task)'
                                      : !other.included ? ' (unchecked)' : ''}
                                  </span>
                                  {circular && <span id={reasonId} className="block text-muted-foreground">Would create a loop. This item already depends on this task, directly or through other items.</span>}
                                </span>
                              </label>
                            );
                          })}
                      </fieldset>
                    </div>
                  </details>
                </CardContent>
              </Card>
              );
            })}
          </fieldset>
          {!applied && (
            <div className="rounded-lg border p-5 space-y-3">
              {data.contextChanged && (
                <p role="status" className="text-sm">
                  Project details or tasks changed. {data.draft.source==='starter' ? 'Recheck your starter checklist' : data.draft.source==='pasted' ? 'Recheck your pasted draft' : 'Generate a new draft'} before adding it.
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
              {unavailableOwners.length > 0 && <section aria-labelledby="plan-unavailable-owners-heading" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
                <h3 id="plan-unavailable-owners-heading" className="font-semibold">Review unavailable owners before adding items</h3>
                <p className="text-muted-foreground">Choose an active teammate or leave each affected item unassigned. No shared assignments have changed.</p>
                <ul className="space-y-2">
                  {unavailableOwners.map(item => {
                    const title = item.title.trim() || 'Untitled draft item';
                    const number = itemNumbers.get(item.id);
                    return <li key={item.id} className="flex flex-wrap items-center gap-x-3 wrap-anywhere">
                      <span><strong>{title}</strong> <span className="text-xs text-muted-foreground">Item {number}</span></span>
                      {!locked && <button type="button" aria-label={`Review owner for ${title} (item ${number})`}
                        className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4" onClick={() => focusDraftOwner(item.id)}>Review owner</button>}
                    </li>;
                  })}
                </ul>
              </section>}
              <PlanApprovalImpact selected={selected} itemNumbers={itemNumbers} scheduleIssues={scheduleIssues} onEditSchedule={locked ? undefined : focusDraftScheduleField} />
              <p className="text-sm text-muted-foreground">Nothing will be sent or booked.</p>
              <Button
                className="h-auto min-h-10 whitespace-normal"
                disabled={
                  locked ||
                  !selected.length ||
                  unavailableOwners.length > 0 ||
                  scheduleIssues.size > 0 ||
                  missingDependencies ||
                  duplicates.size > 0 ||
                  unresolved.size > 0 ||
                  invalidReuse.size > 0 ||
                  data.contextChanged
                }
                onClick={() =>
                  run(async () => {
                    const reviewedWorkspaceRevision = data.workspaceRevision;
                    const latest = draftDirty ? await save(true) : data;
                    // Saving a private draft also reads the current project. Do not
                    // use that newer revision as approval the organizer never gave.
                    if (latest.workspaceRevision !== reviewedWorkspaceRevision || latest.contextChanged) {
                      focusNotice.current = true;
                      setNotice(
                        'Your private edits were saved. The project changed; no tasks were added. ' +
                          (latest.contextChanged
                            ? latest.draft?.source === 'starter'
                              ? 'Recheck the starter checklist before adding tasks.'
                              : latest.draft?.source === 'pasted'
                                ? 'Recheck the pasted draft before adding tasks.'
                                : 'Generate a new draft before adding tasks.'
                            : 'Review the selected items, owners, and links again, then choose Add selected items.'),
                      );
                      return;
                    }
                    const approval = {
                      action: 'apply',
                      revision: latest.revision,
                      workspaceRevision: latest.workspaceRevision,
                      generation: latest.draft.generation,
                      items: latest.draft.items,
                      confirm: true,
                    };
                    const attempted: ApprovalCheck = {
                      kind: 'uncertain',
                      generation: approval.generation,
                      hash: await planApprovalHash(approval.generation, approval.items),
                      revision: approval.revision,
                      workspaceRevision: approval.workspaceRevision,
                    };
                    try {
                      const result = await api(query, approval, AbortSignal.timeout(approvalTimeout));
                      if (!matchingReceipt(result, attempted)) {
                        setApprovalCheck(attempted);
                        throw new Error('The response did not confirm what was added. Check the saved result before trying again.');
                      }
                      focusReceipt.current = true;
                      accept(result);
                      request.current = null;
                    } catch (err) {
                      const { status, unreadable } = err as { status?: number; unreadable?: boolean };
                      if (status === 409) setApprovalCheck({ ...attempted, kind: 'conflict' });
                      else if (!status || status === 408 || status >= 500 || unreadable) setApprovalCheck(attempted);
                      throw err;
                    }
                  })
                }
              >
                Add {selected.length} selected items to project
              </Button>
              {offerGuidePause && <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal"
                  disabled={!canPauseGuide} aria-describedby="guide-pause-help" onClick={saveAndReturnToGuide}>Save draft and return to guide</Button>
                <p className="text-sm text-muted-foreground">{invalidPrivateSchedule ? 'Correct the highlighted activity times before saving.' : 'Keep working on this private draft later without sharing it.'}</p>
              </div>}
            </div>
          )}
        </section>,
        completedPlan ? {id:'plan-original-proposals', title:'View original proposals',
          description:'Read-only snapshot from before approval, including proposals you didn’t add. For current details or edits, use Shared tasks.'} : undefined)}
      <details open={!assistant} className="mt-6"><summary className={assistant?'cursor-pointer text-xs text-muted-foreground':'hidden'}>Conversation recovery</summary><nav
        aria-label="Draft navigation"
        className="mt-6 flex flex-wrap gap-4 text-sm"
      >
        {!showHandoff && <button
          type="button"
          disabled={locked}
          onClick={refreshContext}
          className="text-primary underline disabled:opacity-50"
        >
          Refresh project context
        </button>}
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
