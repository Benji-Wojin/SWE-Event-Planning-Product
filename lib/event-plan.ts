import { env } from '@/lib/runtime';
import { PLAN_AI_CONSENT_VERSION } from './groq';
import {
  administrator,
  HttpError,
  isAppOwner,
  principal,
  seal,
  unseal,
} from './security';
import { projectUser } from './project-access';
import { demoPersona, loadDemo } from './demo';
import { loadWorkspace } from './workspace';
import { duplicateSuggestions, planSelection } from './plan-selection';
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
  c.state.tasks.map((task: any) => ({
    id: task.id,
    title: task.title,
    start: task.schedule?.start || '',
  }));
async function loadContext(request: Request) {
  const params = new URL(request.url).searchParams,
    demo = params.get('demo') === '1';
  const identity = demo ? await administrator() : await principal();
  const user = demo ? identity : await projectUser(identity, request);
  if (
    user.role !== 'admin' ||
    (demo && demoPersona(params.get('as')) !== 'jack')
  )
    throw new HttpError(403, 'Only the organizer can review starting plans.');
  const projectId = demo ? 'demo:' + user.userId : (user as any).projectId;
  const { row, store } = demo
    ? await loadDemo(user)
    : await loadWorkspace(user, projectId);
  const state = store.getState();
  const ownerSql = demo
    ? `EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin') AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND json_extract(data,'$.demoGeneration')=?)`
    : `((?='main' AND EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin')) OR EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=?))`;
  const ownerArgs = demo
    ? [user.userId, projectId, state.demoGeneration]
    : [projectId, user.userId, projectId, user.userId];
  const scope = demo ? projectId + ':' + state.demoGeneration : projectId;
  const id = await hash([scope, user.userId]);
  // Explicitly exclude contacts, emails, files, booking records, progress notes and member identities.
  const source = {
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
    existingTasks: state.tasks.slice(0, 200).map((task: any) => ({
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
    ownerSql,
    ownerArgs,
    source,
    contextHash: await hash(source),
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
  rate_limit:
    'Groq’s free-plan limit was reached. Your saved draft is unchanged. Try again later.',
  credentials: 'AI planning credentials need attention from the app owner.',
  provider:
    'AI could not finish this plan. Your saved draft is unchanged. Try again in a minute.',
  context:
    'The project changed while AI was working. Refresh the project context before generating again.',
};
async function snapshot(c: Context) {
  const row = await read(c.id),
    data = await decode(row);
  await authorized(c);
  return {
    revision: row?.revision || 0,
    workspaceRevision: c.row.revision,
    event: c.state.event,
    members: c.state.members.filter((m: any) => m.active !== false),
    existingTaskCount: c.state.tasks.length,
    existingTasks: existingPlanTasks(c),
    configured: !!env.GROQ_API_KEY,
    brief: data.brief,
    draft: data.draft,
    receipt: data.receipt,
    status:
      row?.status === 'generating' && row.lease_until <= Date.now()
        ? 'interrupted'
        : row?.status || 'empty',
    issue: issueText[row?.issue] || '',
    contextChanged: !!data.draft && data.draft.contextHash !== c.contextHash,
    retryAfter: row
      ? Math.max(0, Math.ceil((row.started_at + 60000 - Date.now()) / 1000))
      : 0,
  };
}
export async function readEventPlan(request: Request) {
  return snapshot(await loadContext(request));
}
function reviewedItems(items: any, draft: any): ReviewedItem[] {
  const rows = parsePlanItems(items, true) as ReviewedItem[];
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
async function generate(c: Context, input: any) {
  if (
    !exact(input, [
      'action',
      'revision',
      'workspaceRevision',
      'requestId',
      'brief',
      'consent',
      'consentVersion',
    ]) ||
    !uuid(input.requestId) ||
    input.consent !== true ||
    input.consentVersion !== PLAN_AI_CONSENT_VERSION
  )
    throw new HttpError(400, 'Confirm the event details to send to AI.');
  let brief;
  try {
    brief = parseBrief(input.brief, c.state.event.date);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const fingerprint = await hash({ source: c.source, brief }),
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
    brief,
    today: (globalThis as any).GatherCalendar.dayKey(
      new Date(),
      c.state.event.timeZone,
    ),
  };
  try {
    planRequestBody(generationContext);
  } catch {
    throw new HttpError(
      413,
      'This brief and project context exceed the free-plan request budget. Shorten the brief or continue planning manually. Your saved draft is unchanged.',
    );
  }
  const now = Date.now(),
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
      input.revision,
      now,
      now - 60000,
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
    } else if (current?.started_at + 60000 > checkedAt) {
      reason = 'cooldown';
      status = 429;
      const seconds = Math.ceil(
        (current.started_at + 60000 - checkedAt) / 1000,
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
    const output = await generateEventPlan(generationContext, env.GROQ_API_KEY);
    const reviewed = output.items.map((item) => ({
      ...item,
      owner: '',
      included: true,
    }));
    const { matches } = planSelection(reviewed, existingPlanTasks(c));
    const draft = {
      ...output,
      items: reviewed.map((item) => ({
        ...item,
        owner: '',
        included: matches.get(item.id)!.length === 0,
      })),
      duplicateSuggestions: duplicateSuggestions(reviewed, existingPlanTasks(c).slice(0, 200)),
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
    approvalHash = await hash({
      generation: input.generation,
      items: input.items,
    });
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
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const { selected, reusable, missing, duplicates, unresolved, invalidReuse } = planSelection(
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
  const ids = new Map<string, string>(reusable);
  const createdIds: string[] = [];
  try {
    for (const item of selected) {
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
          note:
            item.note +
            (!item.start && item.location
              ? '\nLocation: ' + item.location
              : ''),
          dueDate: item.dueDate,
          status: 'todo',
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
        'jack',
      );
      ids.set(item.id, task.id);
      createdIds.push(task.id);
    }
    for (const item of selected)
      for (const prerequisite of item.dependsOn)
        c.store.addDependency(
          ids.get(item.id),
          { taskId: ids.get(prerequisite) },
          'jack',
        );
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
  if (input.action === 'save') return saveDraft(c, input);
  if (input.action === 'generate') return generate(c, input);
  if (input.action === 'apply') {
    await applyDraft(c, input);
    return snapshot(await loadContext(request));
  }
  throw new HttpError(400, 'Choose a supported plan action.');
}
