import { env } from 'cloudflare:workers';
import '@/legacy/store.js';
import { HttpError, principal } from './security';
const api = (globalThis as any).GatherStore;
export function model(data?: string) {
  let raw = data || null;
  return api.createStore({
    storage: {
      getItem: (key: string) => (key === api.STORAGE_KEY ? raw : null),
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    },
  });
}
export async function loadWorkspace(
  user: Awaited<ReturnType<typeof principal>>,
) {
  let row = await env.DB.prepare('SELECT * FROM workspaces WHERE id=?')
    .bind('main')
    .first<any>();
  if (!row) {
    const seed = model();
    await env.DB.prepare(
      'INSERT OR IGNORE INTO workspaces (id,data,revision) VALUES (?,?,1)',
    )
      .bind('main', seed.exportState())
      .run();
    row = await env.DB.prepare('SELECT * FROM workspaces WHERE id=?')
      .bind('main')
      .first<any>();
  }
  const state = JSON.parse(row.data);
  const owner = state.members.find((m: any) => m.id === user.actorId);
  if (owner) {
    owner.name = user.displayName;
    owner.initials = user.displayName
      .split(/\s+/)
      .map((x) => x[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    owner.role = 'Organizer · signed in';
  }
  for (const member of state.members)
    if (member.id !== user.actorId && !member.role.includes('example'))
      member.role += ' · example';
  return { row, store: model(JSON.stringify(state)) };
}
export function snapshot(
  store: any,
  revision: number,
  user: Awaited<ReturnType<typeof principal>>,
  result?: unknown,
) {
  const state = store.getState();
  state.persistence = 'saved';
  return {
    state,
    exportState: JSON.parse(store.exportState()),
    suggestions: store.getSuggestions(),
    revision,
    identity: {
      actorId: user.actorId,
      name: user.displayName,
      role: user.role,
    },
    result,
  };
}
const arity: Record<string, number> = {
  resolveHandoff: 3,
  addDependency: 2,
  removeDependency: 2,
  resumeTask: 1,
  claimTask: 1,
  addTask: 1,
  updateTask: 2,
  addComment: 2,
  saveDraft: 2,
  addMessage: 1,
  applyMessage: 2,
  refreshProposal: 2,
  ignoreMessage: 1,
  acceptTask: 1,
  reportCompletion: 2,
  verifyTask: 1,
  recordFollowup: 2,
  updateEvent: 1,
  addMemory: 1,
  updateMemory: 2,
  acceptSuggestion: 1,
  dismissSuggestion: 1,
};
export function applyWorkspaceAction(store: any, user: { actorId: string; role: string }, input: any) {
  const method = String(input.method);
  if (
    !Object.hasOwn(arity, method) ||
    !Array.isArray(input.args) ||
    input.args.length !== arity[method]
  )
    throw new HttpError(400, 'Unsupported workspace action.');
  if (user.role !== 'admin' && !['claimTask', 'acceptTask', 'reportCompletion', 'updateTask', 'addComment', 'addDependency', 'removeDependency', 'resumeTask', 'resolveHandoff'].includes(method))
    throw new HttpError(
      403,
      'Only the organizer can make this change.',
    );
  const [a, b, c] = input.args;
  if (user.role !== 'admin' && ['acceptTask', 'reportCompletion', 'updateTask', 'addDependency', 'removeDependency', 'resumeTask', 'resolveHandoff'].includes(method)) {
    const task = store.getState().tasks.find((task: any) => task.id === a);
    if (!task || task.owner !== user.actorId) throw new HttpError(403, 'Only the assigned owner can report on this task.');
    if (method === 'resolveHandoff' && c?.action === 'create' && c.owner && c.owner !== user.actorId)
      throw new HttpError(403, 'Only the organizer can assign another teammate.');
    if (method === 'updateTask' && (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(key => !['status', 'note'].includes(key))))
      throw new HttpError(403, 'Only the organizer can edit task details.');
    if (method === 'updateTask' && (task.status === 'done' || !['progress', 'blocked'].includes(b.status) || !String(b.note || '').trim()))
      throw new HttpError(400, 'Report progress or a blocker on an open task with a short note.');
  }
  let result;
  try {
    switch (method) {
      case 'resolveHandoff':
        result = store.resolveHandoff(a, b, c, user.actorId);
        break;
      case 'addDependency':
        result = store.addDependency(a, b, user.actorId);
        break;
      case 'removeDependency':
        result = store.removeDependency(a, b, user.actorId);
        break;
      case 'resumeTask':
        result = store.resumeTask(a, user.actorId);
        break;
      case 'claimTask':
        result = store.claimTask(a, user.actorId);
        break;
      case 'addTask':
        result = store.addTask(a, user.actorId);
        break;
      case 'updateTask':
        result = store.updateTask(a, b, user.actorId);
        break;
      case 'addComment':
        result = store.addComment(a, b, user.actorId);
        break;
      case 'saveDraft':
        result = store.saveDraft(a, b, user.actorId);
        break;
      case 'addMessage':
        result = store.addMessage(a, user.actorId);
        break;
      case 'applyMessage':
        result = store.applyMessage(a, b, user.actorId);
        break;
      case 'refreshProposal':
        result = store.refreshProposal(a, b);
        break;
      case 'ignoreMessage':
        result = store.ignoreMessage(a, user.actorId);
        break;
      case 'acceptTask':
        result = store.acceptTask(a, user.actorId);
        break;
      case 'reportCompletion':
        result = store.reportCompletion(a, b, user.actorId);
        break;
      case 'verifyTask':
        result = store.verifyTask(a, user.actorId);
        break;
      case 'recordFollowup':
        result = store.recordFollowup(a, b, user.actorId);
        break;
      case 'updateEvent':
        result = store.updateEvent(a, user.actorId);
        break;
      case 'addMemory':
        result = store.addMemory(a, user.actorId);
        break;
      case 'updateMemory':
        result = store.updateMemory(a, b, user.actorId);
        break;
      case 'acceptSuggestion':
        result = store.acceptSuggestion(a, user.actorId);
        break;
      case 'dismissSuggestion':
        result = store.dismissSuggestion(a);
        break;
    }
  } catch (e) {
    throw new HttpError(
      400,
      e instanceof Error ? e.message : 'Check this update.',
    );
  }
  return result;
}
export async function mutateWorkspace(
  user: Awaited<ReturnType<typeof principal>>,
  input: any,
) {
  const { row, store } = await loadWorkspace(user);
  if (Object.keys(input).some(key => !['method', 'args', 'revision'].includes(key)))
    throw new HttpError(400, 'Unsupported workspace request field.');
  if (input.revision !== row.revision)
    throw new HttpError(409, 'The plan changed in another tab. Reload this page, review the latest plan, and retry.');
  const result = applyWorkspaceAction(store, user, input);
  const serialized = store.exportState();
  if (new TextEncoder().encode(serialized).length > 1500000)
    throw new HttpError(
      413,
      'This pilot workspace is full. Export your plan before adding more content.',
    );
  const write = await env.DB.prepare(
    'UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?',
  )
    .bind(serialized, 'main', row.revision)
    .run();
  if (write.meta.changes !== 1)
    throw new HttpError(
      409,
      'Another tab saved first. Reload and review your update.',
    );
  return snapshot(store, row.revision + 1, user, result);
}
