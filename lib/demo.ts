import { env } from 'cloudflare:workers';
import { model, applyWorkspaceAction } from './workspace';
import { HttpError, seal, unseal, type administrator } from './security';
import { bookingRecord } from './bookings';

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
  state.demoGeneration = crypto.randomUUID();
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
export function demoSnapshot(store: any, revision: number, actor: string, result?: unknown) {
  const state = store.getState();
  state.persistence = 'saved';
  const member = state.members.find((member: any) => member.id === actor);
  return {
    demo: true, revision, actor, result,
    state, exportState: JSON.parse(store.exportState()), suggestions: store.getSuggestions(),
    identity: { actorId: actor, name: member.name, role: actor === 'jack' ? 'admin' : 'member', demo: true },
    event: state.event, members: state.members, tasks: state.tasks, activity: state.activity.slice(0, 40),
    privateDetails: actor === 'jack' ? [
      { title: 'Speaker flight', detail: 'Sample Air · SFO → PDX · October 2', reference: 'DEMO-FLIGHT-24' },
      { title: 'Northstar bus booking', detail: 'Two buses · 9:00 AM pickup', reference: 'DEMO-BUS-08' },
    ] : [],
  };
}
export async function mutateDemo(user: Awaited<ReturnType<typeof administrator>>, actor: string, input: any) {
  const rpc = Object.hasOwn(input, 'method');
  if (Object.keys(input).some(key => !(rpc ? ['method', 'args', 'revision'] : ['action', 'taskId', 'values', 'revision', 'confirmReset']).includes(key)))
    throw new HttpError(400, 'Unsupported demo request field.');
  const { id, row, store } = await loadDemo(user);
  if (input.revision !== row.revision)
    throw new HttpError(409, 'Someone updated this demo. Refresh the task and review your changes before saving.');
  const admin = actor === 'jack';
  const values = input.values || {};
  if (typeof values !== 'object' || Array.isArray(values)) throw new HttpError(400, 'Invalid task update.');
  const legacy: Record<string, any> = {
    update: { method: 'updateTask', args: [input.taskId, values] },
    comment: { method: 'addComment', args: [input.taskId, values.text] },
    accept: { method: 'acceptTask', args: [input.taskId] },
    claim: { method: 'claimTask', args: [input.taskId] },
    complete: { method: 'reportCompletion', args: [input.taskId, values.note] },
    verify: { method: 'verifyTask', args: [input.taskId] },
    reset: { method: 'resetDemo', args: [input.confirmReset] },
  };
  const action = rpc ? input : legacy[input.action];
  if (!action) throw new HttpError(400, 'Unsupported demo action.');
  let next = store;
  let outcome;
  if (action.method === 'resetDemo') {
    if (!admin) throw new HttpError(403, 'Switch to Jack to restart the demo.');
    if (!Array.isArray(action.args) || action.args.length !== 1 || action.args[0] !== true)
      throw new HttpError(400, 'Confirm that you want to restart the demo.');
    next = seedDemo();
  } else outcome = applyWorkspaceAction(store, { actorId: actor, role: admin ? 'admin' : 'member' }, action);
  const serialized = next.exportState();
  if (new TextEncoder().encode(serialized).length > 500000)
    throw new HttpError(413, 'This demo is full. Switch to Jack and restart it.');
  const write = env.DB.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(serialized, id, row.revision);
  const key = 'demo-bookings:' + user.userId;
  const result = action.method === 'resetDemo'
    ? (await env.DB.batch([write, env.DB.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND EXISTS (SELECT 1 FROM workspaces WHERE id=? AND revision=? AND data=?)')
      .bind(await seal(sampleBookings(), key), key, id, row.revision + 1, serialized)]))[0]
    : await write.run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'Another profile saved first. Refresh and try again.');
  return demoSnapshot(next, row.revision + 1, actor, outcome);
}

function sampleBookings() {
  return [
    { id: 'demo-flight', type: 'Flight', title: 'Speaker flight', provider: 'Sample Air', traveler: 'Guest speaker', date: '', reference: 'DEMO-FLIGHT-24', details: 'Fictional booking · SFO → PDX', taskId: '' },
    { id: 'demo-bus', type: 'Transport', title: 'Northstar bus booking', provider: 'Northstar', traveler: 'Field Day guests', date: '', reference: 'DEMO-BUS-08', details: 'Fictional booking · two buses · 9:00 AM pickup', taskId: 'bus' },
  ];
}

// Demo-only records never use the real private_records table or Gmail connections.
export async function demoPrivate(user: Awaited<ReturnType<typeof administrator>>, actor: string, action: string, data?: any) {
  if (actor !== 'jack') throw new HttpError(403, 'Only the demo organizer can view sample bookings.');
  if (!data && action === 'config') return { configured: true };
  if (!data && action === 'session') return { expiresAt: Date.now() + 15 * 60000 };
  if (data && action === 'lock') return { hidden: true };
  if (action !== 'records') throw new HttpError(404, 'Demo feature not found.');
  const key = 'demo-bookings:' + user.userId;
  let row = await env.DB.prepare('SELECT data,revision FROM workspaces WHERE id=?').bind(key).first<any>();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id,data,revision) VALUES (?,?,1)').bind(key, await seal(sampleBookings(), key)).run();
    row = await env.DB.prepare('SELECT data,revision FROM workspaces WHERE id=?').bind(key).first<any>();
  }
  const records = await unseal(row.data, key);
  if (!data) return { records, revision: row.revision };
  if (data.revision !== row.revision) throw new HttpError(409, 'The sample bookings changed. Close this form and reload bookings before saving.');
  const record = bookingRecord(data);
  const index = records.findIndex((r: any) => r.id === record.id);
  if (data.id && index < 0) throw new HttpError(404, 'Sample booking not found.');
  if (!data.id && records.length >= 100) throw new HttpError(409, 'This demo supports 100 sample bookings.');
  if (index < 0) records.push(record); else records[index] = record;
  const write = await env.DB.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?')
    .bind(await seal(records, key), key, row.revision).run();
  if (write.meta.changes !== 1) throw new HttpError(409, 'Another demo tab saved first. Reload bookings and retry.');
  return { saved: true, id: record.id };
}
