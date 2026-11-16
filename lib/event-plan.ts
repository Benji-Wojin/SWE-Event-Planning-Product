import { env } from '@/lib/runtime';
import { PLAN_AI_CONSENT_VERSION } from './groq';
import { BREAKDOWN_CONSENT_VERSION, breakdownRequest, breakdownTitleAllowed, generateTaskBreakdown } from './breakdown-generation';
import { workspaceTaskId } from './workspace-task-link';
import { workspaceScheduleDate } from './workspace-day';
import {
  administrator,
  HttpError,
  isAppOwner,
  principal,
  seal,
  unseal,
} from './security';
import { projectUser, projectWriteAccess, accessArgs, type ProjectUser } from './project-access';
import {generateTaskProposal} from './task-assistant';
import {taskConversation} from './task-conversation';
import {starterChecklist} from './starter-checklists';
import {pastedChecklistTitles} from './pasted-checklist';
import { demoPersona, loadDemo } from './demo';
import { loadWorkspace } from './workspace';
import { firstTaskAfterSave } from './onboarding-milestones';
import { taskActivityAfterSave } from './product-activity';
import { duplicateSuggestions, planSelection, planTaskSignature, unavailablePlanOwnerItems } from './plan-selection';
import type { PlanReceiptTask } from './plan-receipt';
import { planApprovalHash } from './plan-approval-hash';
import {
  generateEventPlan,
  planRequestBody,
  parseBrief,
  parsePlanItems,
  PlanProviderError,
  type ReviewedItem,
} from './plan-generation';

const emptyBrief = {
  kind: 'other',
  description: '',
  endDate: '',
  startTime: '',
  endTime: '',
};
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    value,
  );
const exact = (value: any, keys: string[]) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).every((key) => keys.includes(key));
async function hash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
type Context = Awaited<ReturnType<typeof loadContext>>;
const existingPlanTasks = (c: Context) =>
  c.state.tasks.filter((task: any) => !task.archivedAt).map((task: any) => ({
    id: task.id,
    title: task.title,
    start: task.schedule?.start || '',
  }));
async function loadContext(request: Request) {
  const params = new URL(request.url).searchParams,
    demo = params.get('demo') === '1';
  const mode=params.get('mode');
  const purpose = mode==='assistant'||mode==='suggestions'||mode==='breakdown'?mode:'plan';
  if(purpose==='breakdown'&&demo)throw new HttpError(400,'AI task breakdown is only available in a real project.');
  const identity = demo ? await administrator() : await principal();
  const user = demo ? identity : await projectUser(identity, request);
  const projectId = demo ? 'demo:' + user.userId : (user as any).projectId;
  const { row, store } = demo
    ? await loadDemo(user)
    : await loadWorkspace(user, projectId);
  const state = store.getState();
  const memberAssistant = !demo && purpose==='assistant' && user.role==='member' && state.event.membersCanCreateTasks===true;
  if ((!memberAssistant && user.role!=='admin') || (demo && demoPersona(params.get('as'))!=='jack')) throw new HttpError(403,'Only the organizer can review plans. Ask the organizer to enable teammate task creation for the task assistant.');
  const taskId=purpose==='breakdown'&&params.getAll('task').length===1?workspaceTaskId(params.get('task')):'';
  const task=taskId?state.tasks.find((item:any)=>item.id===taskId):null;
  if(purpose==='breakdown'&&(!task||task.status==='done'||task.reportedAt&&task.requiresVerification&&!task.verifiedAt||!breakdownTitleAllowed(task.title)))
    throw new HttpError(404,'Open an unfinished task with a plain, single-line title to draft smaller steps.');
  const breakdown=task?{id:task.id as string,title:task.title as string,revision:task.revision as number}:null;
  const ownerSql = memberAssistant ? `(${projectWriteAccess}) AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND json_extract(data,'$.event.membersCanCreateTasks')=1)` : demo
    ? `EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin') AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND json_extract(data,'$.demoGeneration')=?)`
    : `((?='main' AND EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin')) OR EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=?))`;
  const ownerArgs = memberAssistant ? [...accessArgs(user as ProjectUser),projectId] : demo
    ? [user.userId, projectId, state.demoGeneration]
    : [projectId, user.userId, projectId, user.userId];
  const scope = demo ? projectId + ':' + state.demoGeneration : projectId;
  // Separate review documents; asking for suggestions must never replace a plan draft.
  const id = await hash(purpose === 'plan' ? [scope, user.userId] : [scope, user.userId, purpose,...(breakdown?[breakdown.id]:[])]);
  // Explicitly exclude contacts, emails, files, booking records, progress notes and member identities.
  const source = breakdown?{taskTitle:breakdown.title}:{
    event: Object.fromEntries(
      [
        'name',
        'date',
        'timeZone',
        'location',
        'guestCount',
        'outdoor',
        'transportNeeded',
      ].map((key) => [key, state.event[key]]),
    ),
    existingTasks: state.tasks.filter((task: any) => !task.archivedAt).slice(0, 200).map((task: any) => ({
      title: task.title,
      start: task.schedule?.start || '',
    })),
    feedback: store
      .getSuggestions()
      .filter((item: any) => item.id.startsWith('lesson-'))
      .slice(0, 8)
      .map((item: any) => String(item.body).slice(0, 1000)),
  };
  return {
    user,
    dailyLimit: isAppOwner(identity) ? 25 : 5,
    projectId,
    demo,
    row,
    store,
    state,
    id,
    purpose,
    breakdown,
    memberAssistant,
    ownerSql,
    ownerArgs,
    source,
    contextHash: await hash(breakdown?{title:breakdown.title,revision:breakdown.revision}:source),
  };
}
async function authorized(c: Context) {
  if (
    !(await env.DB.prepare(`SELECT 1 WHERE ${c.ownerSql}`)
      .bind(...c.ownerArgs)
      .first())
  )
    throw new HttpError(403, 'Project access changed. Return to Projects.');
}
const read = (id: string) =>
  env.DB.prepare('SELECT * FROM plan_drafts WHERE id=?').bind(id).first<any>();
const decode = (row: any) =>
  row
    ? unseal(row.payload, 'event-plan:' + row.id)
    : Promise.resolve({ brief: emptyBrief, draft: null, receipt: null });
const issueText: Record<string, string> = {
  context_limit:'This conversation and project context are too long for AI. Start a shorter conversation or add the task manually. Your saved draft is kept.',
  rate_limit:
    'Groq’s free-plan limit was reached. Your saved draft is unchanged. Try again later.',
  credentials: 'AI planning credentials need attention from the app owner.',
  provider:
    'AI could not finish this plan. Your saved draft is unchanged. Try again in a minute.',
  context:
    'The project changed while AI was working. Refresh the project context before generating again.',
};
function planAssignees(c: Context): { id: string; name: string }[] {
  return c.state.members.filter((member: { id: string; active?: boolean; role?: string }) =>
    member.active !== false && (c.demo || !member.role?.includes('· example')) &&
    (!c.memberAssistant || member.id === c.user.actorId));
}

type ChecklistImportConfirmation = {requestId:string; revision:number; workspaceRevision:number; generation:string};

async function snapshot(c: Context, checklistImport?: ChecklistImportConfirmation) {
  const row = await read(c.id),
    data = await decode(row);
  if(c.breakdown){
    await authorized(c);
    const contextChanged=!!data.draft&&data.draft.contextHash!==c.contextHash;
    return {task:c.breakdown,revision:row?.revision||0,workspaceRevision:c.row.revision,configured:!!env.GROQ_API_KEY,
      status:row?.status==='generating'&&row.lease_until<=Date.now()?'interrupted':row?.status||'empty',
      issue:issueText[row?.issue]||'',contextChanged,
      steps:contextChanged?null:data.draft?.breakdownItems??null};
  }
  if (c.purpose === 'suggestions' && !row) {
    const starting = await decode(await read(await hash([c.demo ? c.projectId + ':' + c.state.demoGeneration : c.projectId, c.user.userId])));
    data.brief = starting.brief?.description ? starting.brief : {...emptyBrief, description: c.state.event.name};
  }
  await authorized(c);
  const {lastChecklistImport,...draftView}=data.draft||{};
  // Match the marker on the same read used to build the response. Counts
  // from one import must never describe a newer draft or shared project.
  if (checklistImport && (
    row?.revision !== checklistImport.revision || row.status !== 'ready' || data.receipt ||
    c.row.revision !== checklistImport.workspaceRevision || lastChecklistImport?.requestId !== checklistImport.requestId ||
    draftView.generation !== checklistImport.generation
  )) {
    throw new HttpError(409,'We couldn’t confirm the saved checklist because the project or draft changed. Your pasted text is still here. Copy it before reloading the draft to check what was saved.');
  }
  const members = planAssignees(c);
  const receiptTasks: PlanReceiptTask[]=[];
  if(data.receipt){
    const tasks=new Map<string,any>(c.state.tasks.map((task:any)=>[task.id,task]));
    const owners=c.purpose==='plan'?new Map(members.map(member=>[member.id,member.name])):null;
    const completionStates: Map<string, boolean> | null = owners ? c.store.taskCompletionStates() : null;
    for(const id of data.receipt.taskIds){
      const task=tasks.get(id);
      if(!task)continue;
      const row:PlanReceiptTask={id,title:task.title};
      if(owners){
        const ownerName=owners.get(task.owner);
        // Match Timeline's unscheduled activity list. Preparation tasks and
        // completed activities don't need a start time to finish the handoff.
        if(task.eventActivity===true&&!task.schedule&&!completionStates?.get(id))row.needsStartTime=true;
        const start = task.schedule?.start;
        if (!c.demo && !task.archivedAt && typeof start === 'string' &&
          /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)) {
          const day = workspaceScheduleDate(start.slice(0, 10));
          if (day) row.scheduleDay = day;
        }
        // Match Timeline's saved reconfirmation marker, including a removed
        // slot. Only the current state is needed; don't project the old slot.
        const needsScheduleAcceptance=!!task.owner&&task.scheduleReconfirmation?.owner===task.owner&&
          !task.acceptedAt&&!task.reportedAt&&!task.verifiedAt&&!task.archivedAt&&task.status!=='done';
        const state=task.status==='done'&&task.verifiedAt&&task.completionEvidence&&task.completionEvidenceReviewAt!==task.verifiedAt?'needs-amendment-review'
          :task.status==='done'&&(!task.requiresVerification||task.verifiedAt)?'complete'
          :task.requiresVerification&&(task.reportedAt||task.status==='done')&&!task.verifiedAt
            ? task.reportedAt&&task.dependencies?.some((link:{kind?:string;taskId:string})=>link.kind!=='related'&&
                (!completionStates?.get(link.taskId)||tasks.get(link.taskId)?.archivedAt))
              ? 'review-blocked' : 'needs-review'
          :!task.owner?'needs-owner'
          :!owners.has(task.owner)?'needs-reassignment'
          :task.status!=='done'&&!task.reportedAt&&task.completionReview?'changes-requested'
          :needsScheduleAcceptance?'awaiting-schedule-acceptance'
          :task.acceptedAt&&task.acceptedBy===task.owner?'accepted':'awaiting-acceptance';
        row.handoff={state,...(ownerName?{ownerName}:{})};
      }
      receiptTasks.push(row);
    }
  }
  return {
    revision: row?.revision || 0,
    workspaceRevision: c.row.revision,
    event: c.state.event,
    ...(c.purpose !== 'plan' ? {purpose: c.purpose} : {}),
    members,
    actorId:c.user.actorId,
    suggestionScope:c.purpose==='suggestions'?c.id:undefined,
    contextKey:c.purpose==='suggestions'?c.contextHash:undefined,
    existingTaskCount: c.state.tasks.length,
    existingTasks: existingPlanTasks(c),
    configured: !!env.GROQ_API_KEY,
    brief: data.brief,
    draft: data.draft ? draftView : null,
    receipt: data.receipt,
    ...(data.receipt ? {receiptTasks} : {}),
    status:
      row?.status === 'generating' && row.lease_until <= Date.now()
        ? 'interrupted'
        : row?.status || 'empty',
    issue: issueText[row?.issue] || '',
    contextChanged: !!data.draft && data.draft.contextHash !== c.contextHash,
    retryAfter: row
        ? Math.max(0, Math.ceil((row.started_at + (c.purpose==='assistant'?2000:60000) - Date.now()) / 1000))
      : 0,
  };
}
export async function readEventPlan(request: Request) {
  return snapshot(await loadContext(request));
}
function reviewedItems(items: any, draft: any): ReviewedItem[] {
  const rows = parsePlanItems(items, true, draft.items.length === 0) as ReviewedItem[];
  if (
    rows.length !== draft.items.length ||
    rows.some(
      (item) => !draft.items.some((original: any) => original.id === item.id),
    )
  )
    throw new Error(
      'Keep the original draft items; uncheck items you do not want.',
    );
  return rows;
}
async function saveDraft(c: Context, input: any) {
  if (!exact(input, ['action', 'revision', 'brief', 'items', 'generation']))
    throw new HttpError(400, 'Invalid draft update.');
  const row = await read(c.id),
    data = await decode(row);
  if (
    input.revision !== (row?.revision || 0) ||
    row?.lease_until > Date.now() ||
    data.receipt
  )
    throw new HttpError(409, 'This draft changed. Reload it before saving.');
  try {
    data.brief = parseBrief(input.brief, c.state.event.date);
    if(c.purpose==='assistant')taskConversation(data.brief.description);
    if (data.draft) {
      if (input.generation !== data.draft.generation)
        throw new Error('This draft changed.');
      data.draft.items = reviewedItems(input.items, data.draft);
    } else if (input.items?.length || input.generation)
      throw new Error('Generate a draft first.');
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const payload = await seal(data, 'event-plan:' + c.id);
  const result =
    await env.DB.prepare(`INSERT INTO plan_drafts (id,owner_id,workspace_id,payload) SELECT ?,?,?,? WHERE ?=0 AND ${c.ownerSql}
    ON CONFLICT(id) DO NOTHING`)
      .bind(
        c.id,
        c.user.userId,
        c.projectId,
        payload,
        input.revision,
        ...c.ownerArgs,
      )
      .run();
  if (!result.meta.changes) {
    const saved = await env.DB.prepare(
      `UPDATE plan_drafts SET payload=?,revision=revision+1,lease='',lease_until=0,status=CASE WHEN draft_generation='' THEN 'empty' ELSE 'ready' END,issue='' WHERE id=? AND revision=? AND lease_until<=? AND status!='applied' AND ${c.ownerSql}`,
    )
      .bind(payload, c.id, input.revision, Date.now(), ...c.ownerArgs)
      .run();
    if (saved.meta.changes !== 1)
      throw new HttpError(
        409,
        'The draft changed. Your edits have not replaced it.',
      );
  }
  return snapshot(c);
}
async function createStarter(c: Context, input: any) {
  if (c.purpose !== 'plan') throw new HttpError(400, 'Starter checklists belong in the event plan, not a conversation or suggestions review.');
  if (!exact(input, ['action', 'revision', 'workspaceRevision', 'requestId', 'brief', 'replace', 'suggestDates', 'includeActivities']) || !uuid(input.requestId) || typeof input.replace !== 'boolean' || input.suggestDates !== undefined && typeof input.suggestDates !== 'boolean' || input.includeActivities !== undefined && typeof input.includeActivities !== 'boolean')
    throw new HttpError(400, 'Review the starter checklist request.');
  let brief;
  try {
    brief = parseBrief(input.brief, c.state.event.date);
  } catch (error) { throw new HttpError(400, (error as Error).message); }
  const previous = await read(c.id), oldData = await decode(previous);
  // Keep undated request fingerprints compatible. A retry never recalculates
  // yesterday's reviewed suggestions just because the local day has changed.
  const fingerprint = await hash({action:'starter', version:input.suggestDates ? 2 : 1, source:c.source, brief,
    ...(input.includeActivities ? {includeActivities:true} : {})});
  if (previous?.request_id === input.requestId) {
    if (previous.request_hash !== fingerprint) throw new HttpError(409, 'This request was already used for different event details.');
    return snapshot(c);
  }
  if (input.revision !== (previous?.revision || 0) || input.workspaceRevision !== c.row.revision || previous?.lease_until > Date.now())
    throw new HttpError(409, 'The project or draft changed. Reload before choosing a checklist.');
  if (oldData.draft && !input.replace) throw new HttpError(409, 'Confirm replacing the saved private draft first. Shared tasks will not change.');
  let output;
  try {
    if (input.suggestDates && (!c.state.event.date || !c.state.event.timeZone)) throw new Error('Set an event date and time zone in Project settings before suggesting preparation dates.');
    output = starterChecklist(brief.kind, input.suggestDates ? {
      eventDate:c.state.event.date, endDate:brief.endDate,
      today:(globalThis as any).GatherCalendar.dayKey(new Date(),c.state.event.timeZone),
    } : undefined, input.includeActivities === true);
  } catch (error) { throw new HttpError(400,(error as Error).message); }
  const reviewed = output.items.map(item => ({...item, owner:'', included:true}));
  const {matches} = planSelection(reviewed, existingPlanTasks(c));
  const draft = {
    ...output,
    source:'starter', starterVersion:input.includeActivities ? 5 : input.suggestDates ? 4 : 3,
    ...(input.suggestDates ? {starterDates:{eventDate:c.state.event.date,endDate:brief.endDate || c.state.event.date}} : {}),
    items:reviewed.map(item=>({...item, included:matches.get(item.id)!.length===0})),
    duplicateSuggestions:duplicateSuggestions(reviewed,existingPlanTasks(c).slice(0,200)),
    generation:input.requestId, contextHash:c.contextHash, brief, generatedAt:new Date().toISOString(),
  };
  // One compare-and-swap write. No provider, quota write, lease acquisition or workspace mutation.
  // Preserve started_at on replacement so choosing a checklist cannot reset AI cooldowns.
  const payload = await seal({brief,draft,receipt:null},'event-plan:'+c.id);
  const saved = await env.DB.prepare(`INSERT INTO plan_drafts (id,owner_id,workspace_id,payload,draft_generation,request_id,request_hash,status)
    SELECT ?,?,?,?,?,?,?,'ready' WHERE ${c.ownerSql} AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,draft_generation=excluded.draft_generation,request_id=excluded.request_id,request_hash=excluded.request_hash,status='ready',issue='',lease='',lease_until=0,revision=revision+1
    WHERE plan_drafts.revision=? AND plan_drafts.lease_until<=?`)
    .bind(c.id,c.user.userId,c.projectId,payload,input.requestId,input.requestId,fingerprint,...c.ownerArgs,c.projectId,c.row.revision,input.revision,Date.now()).run();
  if (saved.meta.changes !== 1) {
    await authorized(c);
    const latest = await read(c.id);
    if (latest?.request_id === input.requestId && latest.request_hash === fingerprint) return snapshot(c);
    throw new HttpError(409, 'Another update saved first. Reload the draft before choosing a checklist.');
  }
  return snapshot(c);
}
async function importChecklist(c: Context, input: any) {
  if (c.purpose !== 'plan' ||
    !exact(input, ['action','revision','workspaceRevision','generation','requestId','brief','items','text','replaceHandoff']) ||
    !uuid(input.requestId) || !(input.generation === null || uuid(input.generation)) ||
    (input.replaceHandoff !== undefined && input.replaceHandoff !== true) ||
    !Number.isSafeInteger(input.revision) || input.revision < 0)
    throw new HttpError(400,'Review the pasted checklist request.');

  const row = await read(c.id), data = await decode(row), draft = data.draft;
  const replacing = input.replaceHandoff === true;
  const retrying = draft?.lastChecklistImport?.requestId === input.requestId;
  if (replacing && input.requestId === input.generation)
    throw new HttpError(400,'Use a new request for the next private draft.');
  if (replacing && (!Array.isArray(input.items) || input.items.length))
    throw new HttpError(400,'Start the new checklist without items from the old draft.');
  const matchingHandoff = !!data.receipt && row?.status === 'applied' &&
    data.receipt.generation === input.generation && draft?.generation === input.generation;
  if ((data.receipt ? !replacing || !matchingHandoff : replacing && !retrying) ||
    (!retrying && (draft?.generation ?? null) !== input.generation) ||
    row?.lease_until > Date.now() || c.row.revision !== input.workspaceRevision ||
    !replacing && draft && draft.contextHash !== c.contextHash)
    throw new HttpError(409,'The project or draft changed. Refresh and review it before importing.');

  let titles: string[], brief: ReturnType<typeof parseBrief>;
  try {
    titles = pastedChecklistTitles(input.text);
    brief = parseBrief(input.brief, c.state.event.date);
  } catch (error) { throw new HttpError(400,(error as Error).message); }
  const fingerprint = await hash([input.revision,input.workspaceRevision,input.generation,brief,input.items,titles,
    ...(replacing ? ['replace-handoff'] : [])]);
  const replay = (latestRow: any, latestData: any) => {
    const saved = latestData.draft?.lastChecklistImport;
    if (latestData.receipt || saved?.requestId !== input.requestId) return null;
    if (saved.fingerprint !== fingerprint || latestRow.revision !== input.revision + 1)
      throw new HttpError(409,'This import request was already used. Reload the draft before trying again.');
    return {added:saved.added, skipped:saved.skipped};
  };
  const previous = replay(row,data);
  if (previous) return previous;
  if ((row?.revision ?? 0) !== input.revision)
    throw new HttpError(409,'The draft changed. Reload it before importing.');
  let items: ReviewedItem[] = [];
  try {
    if (draft && !replacing) items = reviewedItems(input.items,draft);
    else if (!Array.isArray(input.items) || input.items.length)
      throw new Error('Start with a checklist or reload your existing draft.');
  } catch (error) { throw new HttpError(400,(error as Error).message); }
  const key = (title: string) => {
    const normalized = planTaskSignature({title,start:''});
    return normalized === '|' ? '|' + title.trim() : normalized;
  };
  const known = new Set([...items,...existingPlanTasks(c)].map(item=>key(item.title)));
  const additions: ReviewedItem[] = [];
  for (const title of titles) {
    const signature = key(title);
    if (known.has(signature)) continue;
    known.add(signature);
    additions.push({
      id:crypto.randomUUID(), title, category:'Program', kind:'preparation',
      owner:'', included:false, note:'', scope:'', dueDate:'', start:'', end:'', location:'', dependsOn:[],
    });
  }
  const outcome = {added:additions.length, skipped:titles.length-additions.length};
  if (!outcome.added) return outcome; // No draft or unsaved edit is changed.
  if (items.length + additions.length > 24)
    throw new HttpError(400,`This draft can fit ${24-items.length} more tasks. Paste fewer new lines; nothing was imported.`);

  const priorDraft = replacing ? null : draft;
  const generation = priorDraft?.generation ?? input.requestId;
  const payload = await seal({brief,receipt:null,draft:{
    ...(priorDraft ?? {source:'pasted',brief,generation,contextHash:c.contextHash,
      generatedAt:new Date().toISOString(),questions:[],assumptions:[]}),
    items:[...items,...additions],
    lastChecklistImport:{requestId:input.requestId,fingerprint,...outcome},
  }},'event-plan:'+c.id);
  // Private draft only. Preserve AI request history and cooldown; pin both
  // revisions and authorization in the same write that imports the titles.
  const saved = await env.DB.prepare(`INSERT INTO plan_drafts (id,owner_id,workspace_id,payload,draft_generation,status)
    SELECT ?,?,?,?,?,'ready' WHERE ${c.ownerSql} AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)
    AND (?=0 OR EXISTS (SELECT 1 FROM plan_drafts WHERE id=?))
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,draft_generation=excluded.draft_generation,
    request_id=CASE WHEN plan_drafts.status='applied' THEN '' ELSE plan_drafts.request_id END,
    request_hash=CASE WHEN plan_drafts.status='applied' THEN '' ELSE plan_drafts.request_hash END,
    status='ready',issue='',lease='',lease_until=0,revision=revision+1
    WHERE plan_drafts.revision=? AND plan_drafts.draft_generation=? AND (plan_drafts.status='applied')=? AND plan_drafts.lease_until<=?`)
    .bind(c.id,c.user.userId,c.projectId,payload,generation,...c.ownerArgs,c.projectId,c.row.revision,input.revision,c.id,
      input.revision,input.generation ?? '',replacing?1:0,Date.now()).run();
  if (saved.meta.changes === 1) return outcome;
  await authorized(c);
  const latest = await read(c.id), retried = replay(latest,await decode(latest));
  if (replacing && retried) {
    const workspace = await env.DB.prepare('SELECT revision FROM workspaces WHERE id=?').bind(c.projectId).first<{revision:number}>();
    if (workspace?.revision !== input.workspaceRevision)
      throw new HttpError(409,'The project changed. Reload the draft to see what was saved.');
  }
  if (retried) return retried;
  throw new HttpError(409,'Another update saved first. Reload the draft before importing.');
}
async function recheckChecklist(c: Context, input: any, source: 'pasted' | 'starter') {
  const starter=source==='starter';
  if (c.purpose!=='plan' || !exact(input,['action','revision','workspaceRevision','generation','brief','items',...(starter?['reviewTiming']:[])]) ||
    (starter && input.reviewTiming!==undefined && input.reviewTiming!==true))
    throw new HttpError(400,starter?'Review the starter checklist request.':'Review the pasted draft request.');
  const row=await read(c.id), data=await decode(row), draft=data.draft;
  if(!row||!draft||draft.source!==source||data.receipt||draft.generation!==input.generation||
    row.revision!==input.revision||row.lease_until>Date.now()||c.row.revision!==input.workspaceRevision)
    throw new HttpError(409,'The project or draft changed. Reload before rechecking.');
  try{
    const items=reviewedItems(input.items,draft);
    if(starter){
      if(items.some(item=>item.existingTaskIndex!=null||item.duplicateChoice))
        throw new Error('Starter checklists use exact title and time matches, not suggested reuse choices.');
      if(items.some(item=>item.dueDate||item.start||item.end)&&input.reviewTiming!==true)
        throw new Error('Review the proposed dates and times against the current event before rechecking.');
      // Starter items never carry provider hints. Resolve exact matches with the
      // current shared tasks on review/apply, not obsolete positional indices.
      draft.duplicateSuggestions=[];
    }
    data.brief=parseBrief(input.brief,c.state.event.date);
    draft.brief=data.brief;
    draft.items=items;
  }catch(error){throw new HttpError(400,(error as Error).message);}
  draft.contextHash=c.contextHash;
  delete draft.lastChecklistImport;
  const payload=await seal(data,'event-plan:'+c.id);
  const saved=await env.DB.prepare(`UPDATE plan_drafts SET payload=?,revision=revision+1,status='ready',issue='',lease='',lease_until=0
    WHERE id=? AND revision=? AND draft_generation=? AND status!='applied' AND lease_until<=? AND ${c.ownerSql}
    AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)`)
    .bind(payload,c.id,row.revision,draft.generation,Date.now(),...c.ownerArgs,c.projectId,c.row.revision).run();
  if(saved.meta.changes!==1)throw new HttpError(409,'The project or draft changed. Reload before rechecking.');
}
async function generate(c: Context, input: any) {
  if (
    !exact(input, [
      'action',
      'revision',
      'workspaceRevision',
      'requestId',
      ...(c.breakdown?['taskRevision']:['brief']),
      'consent',
      'consentVersion',
    ]) ||
    !uuid(input.requestId) ||
    input.consent !== true ||
    input.consentVersion !== (c.breakdown?BREAKDOWN_CONSENT_VERSION:PLAN_AI_CONSENT_VERSION)
  )
    throw new HttpError(400, c.breakdown?'Confirm the displayed task title before sending it to Groq.':'Confirm the event details to send to AI.');
  if(c.breakdown&&input.taskRevision!==c.breakdown.revision)
    throw new HttpError(409,'The task changed. Reopen the task and confirm the title again.');
  let brief;
  try {
    brief = c.breakdown?emptyBrief:parseBrief(input.brief, c.state.event.date);
    if(c.purpose==='assistant')taskConversation(brief.description);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const fingerprint = await hash({ source: c.source, brief, ...(c.breakdown?{taskRevision:c.breakdown.revision}:{}) }),
    previous = await read(c.id);
  if (previous?.request_id === input.requestId) {
    if (previous.request_hash !== fingerprint)
      throw new HttpError(
        409,
        'This request was already used for different event details.',
      );
    return snapshot(c);
  }
  if (
    input.revision !== (previous?.revision || 0) ||
    input.workspaceRevision !== c.row.revision
  )
    throw new HttpError(
      409,
      'The project or draft changed. Refresh before generating.',
    );
  if (!env.GROQ_API_KEY)
    throw new HttpError(
      503,
      'AI planning is not configured. You can save the brief or plan manually.',
    );
  const generationContext = {
    ...c.source,
    ...(c.purpose !== 'plan' ? {purpose: c.purpose} : {}),
    brief,
    today: (globalThis as any).GatherCalendar.dayKey(
      new Date(),
      c.state.event.timeZone,
    ),
  };
  try {
    if(c.breakdown)breakdownRequest(c.breakdown.title);else planRequestBody(generationContext);
  } catch {
    throw new HttpError(
      413,
      'This request is too large for Weft’s AI request-size budget. No Groq request was sent or AI allowance used. Your saved draft is unchanged. Shorten the brief or continue planning manually.',
    );
  }
  const now = Date.now(),
    cooldown = c.purpose==='assistant' ? 2000 : 60000,
    lease = crypto.randomUUID(),
    quota =
      'plan-ai:' +
      c.user.userId +
      ':' +
      new Date(now).toISOString().slice(0, 10);
  const oldData = await decode(previous),
    payload = await seal({ ...oldData, brief }, 'event-plan:' + c.id);
  const reserved = await env.DB.batch([
    env.DB.prepare(`INSERT INTO plan_drafts (id,owner_id,workspace_id,request_id,request_hash,payload,status,lease,lease_until,started_at)
      SELECT ?,?,?,?,?,?,'generating',?,?,? WHERE COALESCE((SELECT count FROM resource_usage WHERE id=?),0)<? AND ${c.ownerSql}
      ${c.breakdown?'AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)':''}
      ON CONFLICT(id) DO UPDATE SET request_id=excluded.request_id,request_hash=excluded.request_hash,payload=excluded.payload,status='generating',issue='',lease=excluded.lease,lease_until=excluded.lease_until,started_at=excluded.started_at,revision=revision+1
      WHERE plan_drafts.revision=? AND plan_drafts.lease_until<=? AND plan_drafts.started_at<=?`).bind(
      c.id,
      c.user.userId,
      c.projectId,
      input.requestId,
      fingerprint,
      payload,
      lease,
      now + 60000,
      now,
      quota,
      c.dailyLimit,
      ...c.ownerArgs,
      ...(c.breakdown?[c.projectId,c.row.revision]:[]),
      input.revision,
      now,
      now - cooldown,
    ),
    env.DB.prepare(
      `INSERT INTO resource_usage (id,count) SELECT ?,1 WHERE EXISTS (SELECT 1 FROM plan_drafts WHERE id=? AND lease=?) ON CONFLICT(id) DO UPDATE SET count=count+1`,
    ).bind(quota, c.id, lease),
  ]);
  if (reserved[0].meta.changes !== 1) {
    await authorized(c);
    const current = await read(c.id);
    if (
      current?.request_id === input.requestId &&
      current.request_hash === fingerprint
    )
      return snapshot(c);
    // A failed reservation can be a race or cooldown, not just an exhausted allowance.
    // Only report a daily limit after checking the account's actual counter.
    const usage = await env.DB.prepare(
      'SELECT count FROM resource_usage WHERE id=?',
    )
      .bind(quota)
      .first<{ count: number }>();
    let reason: string, status: number, message: string;
    const checkedAt = Date.now();
    if ((usage?.count || 0) >= c.dailyLimit) {
      reason = 'daily_limit';
      status = 429;
      message = `Your daily limit is ${c.dailyLimit} AI generation attempts across all projects, including failed attempts. It resets at midnight UTC. You can still save your brief and plan manually.`;
    } else if (current?.lease_until > checkedAt) {
      reason = 'in_progress';
      status = 409;
      message =
        'A plan is already generating. Reload the saved draft to check its progress.';
    } else if ((current?.revision || 0) !== input.revision) {
      reason = 'draft_changed';
      status = 409;
      message =
        'The draft changed while this request was starting. Reload the saved draft before generating again.';
    } else if (current?.started_at + cooldown > checkedAt) {
      reason = 'cooldown';
      status = 429;
      const seconds = Math.ceil(
        (current.started_at + cooldown - checkedAt) / 1000,
      );
      message = `Wait ${seconds} seconds before generating another plan. This request did not use an attempt.`;
    } else {
      reason = 'reservation_changed';
      status = 409;
      message =
        'The draft changed while this request was starting. Reload the saved draft and try again.';
    }
    // Fixed labels only: never log project content, identities, or credentials.
    console.warn('weft_plan_reservation_rejected', { reason });
    throw new HttpError(status, message);
  }
  try {
    const breakdownItems = c.breakdown ? await generateTaskBreakdown(c.breakdown.title,env.GROQ_API_KEY) : null;
    const output = c.breakdown?null:c.purpose==='assistant' ? await generateTaskProposal(generationContext, env.GROQ_API_KEY) : await generateEventPlan(generationContext, env.GROQ_API_KEY);
    const reviewed = (output?.items||[]).map((item) => ({
      ...item,
      owner: '',
      included: true,
    }));
    const existing = c.breakdown ? [] : existingPlanTasks(c);
    const { matches } = planSelection(reviewed, existing);
    const draft = c.breakdown?{breakdownItems,generation:input.requestId,contextHash:c.contextHash}:{
      ...output,
      items: reviewed.map((item) => ({
        ...item,
        owner: '',
        included: matches.get(item.id)!.length === 0,
      })),
      duplicateSuggestions: duplicateSuggestions(reviewed, existing.slice(0, 200)),
      generation: input.requestId,
      contextHash: c.contextHash,
      brief,
      generatedAt: new Date().toISOString(),
    };
    const saved =
      await env.DB.prepare(`UPDATE plan_drafts SET payload=?,draft_generation=?,status='ready',issue='',lease='',lease_until=0,revision=revision+1
      WHERE id=? AND lease=? AND lease_until>? AND ${c.ownerSql} AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=?)`)
        .bind(
          await seal({ brief, draft, receipt: null }, 'event-plan:' + c.id),
          input.requestId,
          c.id,
          lease,
          Date.now(),
          ...c.ownerArgs,
          c.projectId,
          c.row.revision,
        )
        .run();
    if (saved.meta.changes !== 1) {
      await authorized(c);
      throw new HttpError(
        409,
        'The project changed while AI was working. Refresh before generating again.',
      );
    }
  } catch (error) {
    const issue =
      error instanceof PlanProviderError
        ? error.issue
        : error instanceof HttpError && error.status === 409
          ? 'context'
          : 'provider';
    await env.DB.prepare(
      `UPDATE plan_drafts SET status='error',issue=?,lease='',lease_until=0,revision=revision+1 WHERE id=? AND lease=? AND status='generating' AND ${c.ownerSql}`,
    )
      .bind(issue, c.id, lease, ...c.ownerArgs)
      .run();
    await authorized(c);
    if (error instanceof HttpError) throw error;
    return snapshot(c);
  }
  return snapshot(c);
}
async function applyDraft(c: Context, input: any) {
  if (
    !exact(input, [
      'action',
      'revision',
      'workspaceRevision',
      'generation',
      'items',
      'confirm',
    ]) ||
    input.confirm !== true ||
    !uuid(input.generation)
  )
    throw new HttpError(400, 'Review and confirm the selected items first.');
  const row = await read(c.id),
    data = await decode(row),
    approvalHash = await planApprovalHash(input.generation, input.items);
  if (data.receipt?.generation === input.generation) {
    if (data.receipt.approvalHash !== approvalHash)
      throw new HttpError(
        409,
        'This draft was already added with different edits. Open the project to review it.',
      );
    return snapshot(c);
  }
  if (
    !data.draft ||
    data.draft.generation !== input.generation ||
    row.draft_generation !== input.generation ||
    input.revision !== row.revision ||
    row.lease_until > Date.now()
  )
    throw new HttpError(409, 'The draft changed. Reload before adding tasks.');
  if (
    input.workspaceRevision !== c.row.revision ||
    data.draft.contextHash !== c.contextHash
  )
    throw new HttpError(
      409,
      'The project changed. Refresh the project context and review your draft again.',
    );
  let items: ReviewedItem[];
  try {
    items = reviewedItems(input.items, data.draft);
    if(c.purpose==='assistant' && items.some(item=>item.kind!=='preparation' || item.start || item.end || item.location || (c.memberAssistant && item.owner && item.owner!==c.user.actorId))) throw new Error('The task assistant adds unscheduled tasks only. Teammates may choose themselves or Unassigned.');
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const { selected, prerequisites, missing, duplicates, unresolved, invalidReuse } = planSelection(
    items,
    existingPlanTasks(c),
    data.draft.duplicateSuggestions || [],
  );
  if (unresolved.size || invalidReuse.size)
    throw new HttpError(400, 'Review possible duplicates: use the existing task or keep this as separate work. Edited tasks need a fresh review.');
  if (!selected.length)
    throw new HttpError(400, 'Select at least one item to add.');
  if (missing.length)
    throw new HttpError(
      400,
      'A selected task depends on an unchecked item. Include that item or remove the dependency.',
    );
  if (unavailablePlanOwnerItems(selected, new Set(planAssignees(c).map(member => member.id))).length)
    throw new HttpError(400, 'A selected item’s owner is no longer available. Choose an active teammate or leave it unassigned.');
  const selectedById = new Map(selected.map(item => [item.id, item]));
  const ids = new Map<string, string>();
  const createdIds: string[] = [];
  let addedTasks = 0;
  try {
    // Create prerequisite proposals first so each new task can receive its
    // reviewed links under the real creator's authority, including Unassigned
    // teammate proposals. Reused shared tasks are never edited.
    const createReviewed = (item: ReviewedItem): void => {
      if(ids.has(item.id))return;
      const targets = prerequisites.get(item.id)!;
      for (const target of targets) {
        if (target.kind === 'draft' && !ids.has(target.proposalId)) createReviewed(selectedById.get(target.proposalId)!);
      }
      if (duplicates.has(item.id))
        throw new Error(
          'A task named “' +
            item.title +
            '” already exists at this time. Uncheck or rename it.',
        );
      const task = c.store.addTask(
        {
          title: item.title,
          category: item.category,
          owner: item.owner,
          scope: item.scope || '',
          note:
            item.note +
            (!item.start && item.location
              ? '\nLocation: ' + item.location
              : ''),
          dueDate: item.dueDate,
          status: 'todo',
          ...(item.kind === 'activity' ? {eventActivity: true} : {}),
          dependencies: targets.map(target => ({
            taskId: target.kind === 'existing' ? target.taskId : ids.get(target.proposalId)!,
            kind: 'dependency',
            reason: item.note || 'Required output reviewed in the private plan.',
          })),
          ...(item.start
            ? {
                schedule: {
                  start: item.start,
                  end: item.end,
                  location: item.location,
                },
              }
            : {}),
        },
        c.memberAssistant ? c.user.actorId : 'jack',
      );
      addedTasks++;
      ids.set(item.id, task.id);
    };
    for(const item of selected)createReviewed(item);
    createdIds.push(...selected.map(item=>ids.get(item.id)!));
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const marker = input.generation + ':' + approvalHash;
  const workspace = JSON.parse(c.store.exportState());
  workspace.lastPlanApplication = marker;
  const serialized = JSON.stringify(workspace);
  if (new TextEncoder().encode(serialized).length > 1500000)
    throw new HttpError(413, 'This project is full. No plan items were added.');
  const receipt = {
    generation: input.generation,
    approvalHash,
    taskIds: createdIds,
    appliedAt: new Date().toISOString(),
  };
  const payload = await seal(
    { ...data, draft: { ...data.draft, items }, receipt },
    'event-plan:' + c.id,
  );
  // Both writes are one transaction. The marker ensures a zero-row workspace CAS cannot consume a draft.
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=? AND ${c.ownerSql}
      AND EXISTS (SELECT 1 FROM plan_drafts WHERE id=? AND revision=? AND draft_generation=? AND status!='applied' AND lease_until<=?)`).bind(
      serialized,
      c.projectId,
      c.row.revision,
      ...c.ownerArgs,
      c.id,
      row.revision,
      input.generation,
      Date.now(),
    ),
    env.DB.prepare(`UPDATE plan_drafts SET payload=?,status='applied',lease='',lease_until=0,issue='',revision=revision+1 WHERE id=? AND revision=? AND draft_generation=? AND ${c.ownerSql}
      AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=? AND json_extract(data,'$.lastPlanApplication')=?)`).bind(
      payload,
      c.id,
      row.revision,
      input.generation,
      ...c.ownerArgs,
      c.projectId,
      c.row.revision + 1,
      marker,
    ),
    ...(!c.demo && addedTasks ? [taskActivityAfterSave(c.user.userId, addedTasks, 0), firstTaskAfterSave(c.user.userId)] : []),
  ]);
  if (result[0].meta.changes !== 1) {
    const latest = await decode(await read(c.id));
    await authorized(c);
    if (
      latest.receipt?.generation !== input.generation ||
      latest.receipt.approvalHash !== approvalHash
    )
      throw new HttpError(
        409,
        'Another update saved first. Your draft is still here; refresh and review it.',
      );
  }
  return snapshot(c);
}
export async function writeEventPlan(request: Request, input: any) {
  const c = await loadContext(request);
  await authorized(c);
  if(c.breakdown){
    if(input.action!=='generate')throw new HttpError(400,'Review smaller steps in the task before adding related work.');
    return generate(c,input);
  }
  if (input.action === 'save') return saveDraft(c, input);
  if (input.action === 'starter') return createStarter(c, input);
  if (input.action === 'import-checklist') {
    const checklistImportResult=await importChecklist(c,input);
    const confirmation=checklistImportResult.added ? {
      requestId:input.requestId, revision:input.revision+1, workspaceRevision:input.workspaceRevision,
      generation:input.replaceHandoff ? input.requestId : input.generation ?? input.requestId,
    } : undefined;
    return {...await snapshot(await loadContext(request),confirmation),checklistImportResult};
  }
  if (input.action === 'recheck-pasted' || input.action === 'recheck-starter') {
    await recheckChecklist(c,input,input.action==='recheck-starter'?'starter':'pasted');
    return snapshot(await loadContext(request));
  }
  if (input.action === 'generate') return generate(c, input);
  if (input.action === 'apply') {
    await applyDraft(c, input);
    return snapshot(await loadContext(request));
  }
  throw new HttpError(400, 'Choose a supported plan action.');
}
