import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import '../legacy/schedule-ui.js';
import '../legacy/wrap-up.js';

// Real route handlers and release policy, fictional identities and in-memory
// SQLite. This proves an API/model/rendering journey, not hosted/browser QA.
const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
  sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
}
let tail = Promise.resolve();
const db = {
  prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
    };
  },
  batch(statements) {
    const result = tail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    tail = result.catch(() => {});
    return result;
  },
};
const previousFetch = globalThis.fetch;
let externalCalls = 0;
let api;
const origin = 'https://lifecycle.example';
const owner = () => { globalThis.__lifecycleUser = { userId: 'owner-1', email: 'owner@example.com', displayName: 'Fictional Organizer' }; };
const member = kind => { globalThis.__lifecycleUser = { userId: kind + '-helper', email: kind + '-helper@example.com', displayName: 'Fictional Helper' }; };
const request = (path, input) => new Request(origin + path, {
  method: input === undefined ? 'GET' : 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Gather-Request': '1' },
  ...(input === undefined ? {} : { body: JSON.stringify(input) }),
});
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const schedule = GatherScheduleUI.create({ h, options: () => '', person: () => '', statusBadge: () => '' });

before(async () => {
  globalThis.__lifecycleEnv = {
    DB: db, GATHER_ORIGIN: origin, GATHER_OWNER_EMAIL: 'owner@example.com',
    GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64'),
    GROQ_API_KEY: '',
  };
  globalThis.fetch = async () => { externalCalls++; throw new Error('No external access in lifecycle fixtures.'); };
  const directory = mkdtempSync(join(tmpdir(), 'weft-lifecycle-routes-'));
  await build({
    entryPoints: {
      workspace: 'app/api/workspace/route.ts', plan: 'app/api/plan/route.ts',
      projects: 'app/api/projects/route.ts', team: 'app/api/team/route.ts', join: 'app/api/join/route.ts',
      policy: 'lib/release-policy.ts',
    }, outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" },
    plugins: [{ name: 'fictional-runtime-and-identity-only', setup(b) {
      b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
      b.onResolve({ filter: /chatgpt-auth$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'runtime'
        ? 'export const env=globalThis.__lifecycleEnv;'
        : 'export async function getChatGPTUser(){return globalThis.__lifecycleUser;}' }));
    } }],
  });
  api = Object.fromEntries(await Promise.all(['workspace', 'plan', 'projects', 'team', 'join', 'policy'].map(async name => [name, await import(pathToFileURL(join(directory, name + '.mjs')))])));
  owner();
  await json(await api.workspace.GET(request('/api/workspace?project=main')));
});
after(() => {
  globalThis.fetch = previousFetch;
  delete globalThis.__lifecycleEnv;
  delete globalThis.__lifecycleUser;
  sqlite.close();
  assert.equal(externalCalls, 0, 'the entire fixture must stay offline, even after an early failure');
});

for (const kind of ['school', 'corporate']) test(kind + ' journey: reviewed starter → team work → event-day review → wrap-up', async () => {
  owner();
  assert.equal(api.policy.ASK_WEFT_ENABLED, false, 'exercise the real coming-soon release policy');
  assert.equal(api.policy.GMAIL_ENABLED, false);
  const project = (await json(await api.projects.POST(request('/api/projects', {
    requestId: crypto.randomUUID(), event: { name: 'Fictional ' + kind + ' event', date: '2100-03-14', timeZone: 'America/Los_Angeles' },
  })), 201)).id;
  const path = '/api/workspace?project=' + project;
  const read = async () => json(await api.workspace.GET(request(path)));
  const raw = () => sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);
  const write = async (method, args) => {
    const snap = await read();
    return json(await api.workspace.POST(request(path, { method, args, revision: snap.revision })));
  };
  const rejectWrite = async (method, args, status) => {
    const snap = await read(), before = raw();
    const response = await api.workspace.POST(request(path, { method, args, revision: snap.revision }));
    assert.equal(response.status, status, await response.clone().text());
    assert.deepEqual(raw(), before, 'rejected action cannot partially change shared work');
  };
  const invited = await json(await api.team.POST(request('/api/team?project=' + project, {
    action: 'invite', email: kind + '-helper@example.com', requestId: crypto.randomUUID(),
  })));
  const token = new URL(invited.invitations[0].link, origin).searchParams.get('invite');
  member(kind);
  await json(await api.join.POST(request('/api/join', { token })));
  const actor = (await read()).identity.actorId;
  owner();

  const planPath = '/api/plan?project=' + project;
  const initial = await json(await api.plan.GET(request(planPath))), beforeDraft = raw();
  const draft = await json(await api.plan.POST(request(planPath, {
    action: 'starter', revision: initial.revision, workspaceRevision: initial.workspaceRevision,
    requestId: crypto.randomUUID(), suggestDates: true, replace: false,
    brief: { kind, description: 'Fictional formal event', endDate: '', startTime: '', endTime: '' },
  })));
  assert.deepEqual(raw(), beforeDraft, 'preparing a draft does not create or complete shared tasks');
  assert.equal(draft.draft.source, 'starter');
  const selected = new Set(['programme', 'roles', 'briefing', 'cleanup']);
  const items = draft.draft.items.map(item => ({ ...item, included: selected.has(item.id), owner: ['briefing', 'cleanup'].includes(item.id) ? actor : 'jack' }));
  const approval = { action: 'apply', revision: draft.revision, workspaceRevision: draft.workspaceRevision, generation: draft.draft.generation, items, confirm: true };
  member(kind);
  const beforeUnauthorized = raw();
  assert.equal((await api.plan.POST(request(planPath, approval))).status, 403);
  assert.deepEqual(raw(), beforeUnauthorized, 'a teammate cannot approve the organizer draft');
  owner();
  const beforeMissingPrerequisite = raw();
  assert.equal((await api.plan.POST(request(planPath, { ...approval, items: items.map(item => ({ ...item, included: item.id === 'briefing' })) }))).status, 400);
  assert.deepEqual(raw(), beforeMissingPrerequisite, 'missing prerequisites cannot partially apply a plan');
  const applied = await json(await api.plan.POST(request(planPath, approval)));
  assert.equal(applied.receipt.taskIds.length, 4);
  await json(await api.plan.POST(request(planPath, approval)));
  let snap = await read();
  assert.equal(snap.state.tasks.length, 4, 'retrying approval cannot duplicate tasks');
  const taskFor = id => snap.state.tasks.find(task => task.title === items.find(item => item.id === id).title);
  const briefing = taskFor('briefing'), programme = taskFor('programme'), roles = taskFor('roles'), cleanup = taskFor('cleanup');
  assert.deepEqual(new Set(briefing.dependencies.map(link => link.taskId)), new Set([programme.id, roles.id]));
  assert.equal(briefing.scope, items.find(item => item.id === 'briefing').scope);
  assert.equal(briefing.acceptedAt, '', 'assignment is not acceptance');
  for (const task of [briefing, programme, roles, cleanup]) await write('updateTask', [task.id, { requiresVerification: true }]);
  await write('setTaskSchedule', [briefing.id, { start: '2100-03-14T18:00', end: '2100-03-14T18:30', location: 'Fictional hall' }]);
  snap = await read();
  const initialSheet = schedule.runSheet(snap.state, Date.parse('2100-03-14T20:00:00Z'), { mine: true, actor });
  assert.match(initialSheet, /Acceptance not recorded/);
  assert.match(initialSheet, /Required work not complete/);

  member(kind);
  const stale = await read();
  owner();
  await write('updateTask', [briefing.id, { note: 'Fictional updated handoff context.' }]);
  member(kind);
  const beforeStaleAcceptance = raw();
  assert.equal((await api.workspace.POST(request(path, { method: 'acceptTask', args: [briefing.id], revision: stale.revision }))).status, 409);
  assert.deepEqual(raw(), beforeStaleAcceptance, 'stale acceptance cannot overwrite newer planning context');
  await write('acceptTask', [briefing.id]);
  await rejectWrite('reportCompletion', [briefing.id, 'Too early.'], 400);
  await rejectWrite('verifyTask', [briefing.id], 403);
  owner();
  // Opposite completion orders prove either prerequisite alone can block the
  // dependent activity, not merely that some prerequisite is unfinished.
  for (const task of kind === 'school' ? [programme, roles] : [roles, programme]) {
    await write('reportCompletion', [task.id, 'Fictional prerequisite reviewed.']);
    member(kind);
    await rejectWrite('reportCompletion', [briefing.id, 'Not verified yet.'], 400);
    owner();
    await write('verifyTask', [task.id]);
  }
  member(kind);
  await write('reportCompletion', [briefing.id, 'PRIVATE_COMPLETION_NOTE: fictional briefing delivered.']);
  snap = await read();
  assert.ok(GatherWrapUp.groups(snap.state).find(group => group.key === 'verification').tasks.some(task => task.id === briefing.id));
  owner();
  await write('returnCompletion', [briefing.id, 'PRIVATE_REVIEW_REASON: confirm the final handoff.']);
  snap = await read();
  const returnedSheet = schedule.runSheet(snap.state, Date.parse('2100-03-14T20:00:00Z'), { mine: true, actor });
  assert.match(returnedSheet, /Changes requested/);
  assert.doesNotMatch(returnedSheet, /PRIVATE_|Required work not complete|Acceptance not recorded/);
  member(kind);
  await write('reportCompletion', [briefing.id, 'Fictional final handoff confirmed.']);
  owner();
  await write('verifyTask', [briefing.id]);

  member(kind);
  snap = await read();
  const beforeReview = raw();
  const finalSheet = schedule.runSheet(snap.state, Date.parse('2100-03-15T20:00:00Z'), { mine: true, actor });
  assert.ok(finalSheet.includes(h(briefing.title)), 'completed activity remains in the run sheet');
  assert.match(finalSheet, />Done<\/td>/);
  assert.doesNotMatch(finalSheet, /Changes requested|Awaiting verification|Required work not complete|Acceptance not recorded|PRIVATE_/);
  const groups = GatherWrapUp.groups(snap.state, { mine: true, actor });
  assert.deepEqual(groups.find(group => group.key === 'completed').tasks.map(task => task.id), [briefing.id]);
  assert.deepEqual(groups.find(group => group.key === 'open').tasks.map(task => task.id), [cleanup.id]);
  assert.deepEqual(raw(), beforeReview, 'rendering event-day and wrap-up views never completes cleanup');
  await write('acceptTask', [cleanup.id]);
  await write('reportCompletion', [cleanup.id, 'Fictional venue handback recorded.']);
  owner();
  await write('verifyTask', [cleanup.id]);
  await write('addMemory', [{ change: 'Brief helpers before doors open.', wentWell: 'Named handoff owners helped.', category: 'Program', rating: '', scope: 'always' }]);
  snap = await read();
  const reloadedGroups = GatherWrapUp.groups(snap.state);
  assert.equal(reloadedGroups.find(group => group.key === 'completed').tasks.length, 4);
  assert.equal(reloadedGroups.find(group => group.key === 'open').tasks.length, 0);
  assert.equal(snap.state.memories.length, 1);
  const separate = (await json(await api.projects.POST(request('/api/projects', {
    requestId: crypto.randomUUID(), event: { name: 'Fictional separate private project' },
  })), 201)).id;
  member(kind);
  assert.equal((await api.workspace.GET(request('/api/workspace?project=' + separate))).status, 404, 'joining one event grants no access to another');
  assert.equal(externalCalls, 0, 'no AI request, invitation email or other external effect');
});
