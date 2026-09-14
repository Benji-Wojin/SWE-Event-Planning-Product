import { env } from 'cloudflare:workers';
import { model } from './workspace';
import { HttpError, type administrator } from './security';

// Demo personas are a presentation tool for the authenticated owner, not logins.
export function demoPersona(value: unknown) {
  const persona = value || 'jack';
  if (typeof persona !== 'string' || !['jack', 'maya', 'jules', 'dev'].includes(persona))
    throw new HttpError(400, 'Choose one of the four demo profiles.');
  return persona;
}
function seedDemo() {
  const state = model().getState();
  state.event.name = 'Field Day · team demo';
  state.tasks.find((task: any) => task.id === 'bus').requiresVerification = true;
  state.tasks.find((task: any) => task.id === 'catering').requiresVerification = true;
  return model(JSON.stringify(state));
}
export async function loadDemo(user: Awaited<ReturnType<typeof administrator>>) {
  const id = 'demo:' + user.userId;
  let row = await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(id).first<any>();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id,data,revision) VALUES (?,?,1)')
      .bind(id, seedDemo().exportState()).run();
    row = await env.DB.prepare('SELECT * FROM workspaces WHERE id=?').bind(id).first<any>();
  }
  return { id, row, store: model(row.data) };
}
export function demoSnapshot(store: any, revision: number, actor: string) {
  const state = store.getState();
  return {
    demo: true, revision, actor,
    event: state.event, members: state.members, tasks: state.tasks, activity: state.activity.slice(0, 40),
    privateDetails: actor === 'jack' ? [
      { title: 'Speaker flight', detail: 'Sample Air · SFO → PDX · October 2', reference: 'DEMO-FLIGHT-24' },
      { title: 'Northstar bus booking', detail: 'Two buses · 9:00 AM pickup', reference: 'DEMO-BUS-08' },
    ] : [],
  };
}
export async function mutateDemo(user: Awaited<ReturnType<typeof administrator>>, actor: string, input: any) {
  if (Object.keys(input).some(key => !['action', 'taskId', 'values', 'revision', 'confirmReset'].includes(key)))
    throw new HttpError(400, 'Unsupported demo request field.');
  const { id, row, store } = await loadDemo(user);
  if (input.revision !== row.revision)
    throw new HttpError(409, 'Someone updated this demo. Refresh the task and review your changes before saving.');
  const admin = actor === 'jack';
  const task = store.getState().tasks.find((item: any) => item.id === input.taskId);
  const values = input.values || {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'Invalid task update.');
  if (input.action !== 'reset' && !task) throw new HttpError(404, 'Demo task not found.');
  if (['update', 'accept', 'complete'].includes(input.action) && !admin && task.owner !== actor)
    throw new HttpError(403, 'In this demo, teammates can update only their own tasks.');
  let next = store;
  try {
    switch (input.action) {
      case 'update': {
        const allowed = admin ? ['owner', 'status', 'note'] : ['status', 'note'];
        if (Object.keys(values).some(key => !allowed.includes(key)))
          throw new HttpError(403, 'Only Jack can assign tasks; other task details are fixed in this demo.');
        if (values.status === 'done') throw new HttpError(400, 'Use Report complete so the completion is recorded correctly.');
        store.updateTask(task.id, values, actor);
        break;
      }
      case 'comment': store.addComment(task.id, values.text, actor); break;
      case 'accept': store.acceptTask(task.id, actor); break;
      case 'complete': store.reportCompletion(task.id, values.note, actor); break;
      case 'verify':
        if (!admin) throw new HttpError(403, 'Only Jack can verify completion.');
        store.verifyTask(task.id, actor); break;
      case 'reset':
        if (!admin) throw new HttpError(403, 'Switch to Jack to restart the demo.');
        if (input.confirmReset !== true) throw new HttpError(400, 'Confirm that you want to restart the demo.');
        next = seedDemo(); break;
      default: throw new HttpError(400, 'Unsupported demo action.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, error instanceof Error ? error.message : 'Check your update.');
  }
  const serialized = next.exportState();
  if (new TextEncoder().encode(serialized).length > 500000)
    throw new HttpError(413, 'This demo is full. Switch to Jack and restart it.');
  const result = await env.DB.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(serialized, id, row.revision).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'Another profile saved first. Refresh and try again.');
  return demoSnapshot(next, row.revision + 1, actor);
}
