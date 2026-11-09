import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { migrateDatabase, readMigrations } from '../scripts/migrate-vercel.mjs';

const origin = 'https://onboarding.example';
const client = createClient({ url: 'file::memory:', intMode: 'number' });
const identity = new AsyncLocalStorage();
const owner = { userId: 'site-owner', email: 'owner@example.com', displayName: 'Site Owner' };
const person = name => ({ userId: 'provider-' + name, email: name + '@example.com', displayName: 'Fictional ' + name });
const alice = person('alice'), bob = person('bob'), carol = person('carol'), dylan = person('dylan');
let api, db, interceptBatch, historicProject, dylanProject, calls = 0;
const originalFetch = globalThis.fetch;
const run = (user, fn) => identity.run(user, fn);
const request = (path, input) => new Request(origin + path, {
  method: input === undefined ? 'GET' : 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Gather-Request': '1' },
  ...(input === undefined ? {} : { body: JSON.stringify(input) }),
});
const body = async (response, status = 200) => {
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
};
const record = user => db.prepare('SELECT created_at FROM onboarding_first_tasks WHERE user_id=?').bind(user.userId).first();
const memberCode = user => db.prepare('SELECT actor_id FROM members WHERE user_id=?').bind(user.userId).first('actor_id');
const dashboard = after => run(owner, () => api.readOnboardingMilestones(after));
const workspace = project => '/api/workspace?project=' + project;
const plan = project => '/api/plan?project=' + project;
const read = (user, project) => run(user, async () => body(await api.readWorkspace(request(workspace(project)))));
const change = (user, project, input) => run(user, () => api.writeWorkspace(request(workspace(project), input)));
async function makeProject(user, name, requestId = crypto.randomUUID()) {
  return run(user, async () => (await body(await api.createProject(request('/api/projects', {
    requestId, event: { name, date: '2100-03-14', timeZone: 'America/Los_Angeles' },
  })), 201)).id);
}
async function starter(user, project, taskCount = 1) {
  return run(user, async () => {
    const context = await body(await api.readPlan(request(plan(project))));
    const draft = await body(await api.writePlan(request(plan(project), {
      action: 'starter', revision: context.revision, workspaceRevision: context.workspaceRevision,
      requestId: crypto.randomUUID(), suggestDates: false, replace: false,
      brief: { kind: 'school', description: 'Fictional event', endDate: '', startTime: '', endTime: '' },
    })));
    const ids = draft.draft.items.filter(x => !x.dependsOn.length).slice(0, taskCount).map(x => x.id);
    assert.equal(ids.length, taskCount);
    return {
      action: 'apply', revision: draft.revision, workspaceRevision: draft.workspaceRevision,
      generation: draft.draft.generation, confirm: true,
      items: draft.draft.items.map(item => ({ ...item, included: ids.includes(item.id) })),
    };
  });
}

before(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      export { createDatabase } from './lib/platform/database';
      export { principal, registerAccount } from './lib/security';
      export { model } from './lib/workspace';
      export { readOnboardingMilestones } from './lib/onboarding-milestones';
      export { POST as openApp } from './app/api/activity/route';
      export { default as OnboardingPage } from './app/admin/onboarding/page';
      export { POST as createProject } from './app/api/projects/route';
      export { GET as readWorkspace, POST as writeWorkspace } from './app/api/workspace/route';
      export { GET as readPlan, POST as writePlan } from './app/api/plan/route';
    ` },
    bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, jsx: 'automatic',
    plugins: [{ name: 'fictional-auth-and-provider', setup(b) {
      b.onResolve({ filter: /^@\/lib\/runtime$|chatgpt-auth$|^next\/(navigation|link)$|^@\/components\/theme-toggle$/ },
        args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
        const contents = path.endsWith('/runtime') ? 'export const env=globalThis.__onboardingEnv;'
          : path.endsWith('chatgpt-auth') ? 'export async function getChatGPTUser(){return globalThis.__onboardingIdentity.getStore();} export const chatGPTSignInPath = path => "/signin-with-chatgpt?return_to="+encodeURIComponent(path);'
            : path === 'next/navigation' ? 'export const redirect=path=>{throw Error("Redirect: "+path)}; export const notFound=()=>{throw Error("Not found")};'
              : path === 'next/link' ? 'import {createElement} from "react"; export default function Link({href,prefetch,...props}){return createElement("a",{...props,href:typeof href==="string"?href:href.pathname+"?"+new URLSearchParams(href.query)});}'
                : 'export const ThemeToggle=()=>null;';
        return { loader: 'js', contents, resolveDir: process.cwd() };
      });
    } }],
  });
  globalThis.__onboardingIdentity = identity;
  globalThis.__onboardingEnv = {
    GATHER_ORIGIN: origin, GATHER_OWNER_EMAIL: owner.email,
    GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 24).toString('base64'),
  };
  globalThis.fetch = async () => { calls++; throw Error('Outbound requests forbidden'); };
  const source = result.outputFiles[0].text.replace(/^(import .*? from )"([^"]+)"/gm,
    (_, prefix, name) => prefix + JSON.stringify(import.meta.resolve(name)));
  try { api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')); }
  catch (error) { throw new Error('Could not load local route fixture: ' + error.message.split('data:text')[0]); }
  db = api.createDatabase(client);
  globalThis.__onboardingEnv.DB = {
    prepare: db.prepare,
    async batch(statements) {
      if (interceptBatch) { const intercept = interceptBatch; interceptBatch = null; await intercept(); }
      return db.batch(statements);
    },
  };
  const migrations = await readMigrations();
  await migrateDatabase(client, { migrations: migrations.slice(0, -2), apply: true });
  for (const account of [owner, alice, bob, carol, dylan]) await run(account, api.registerAccount);
  historicProject = await makeProject(carol, 'Private historic project');
  await db.prepare('UPDATE projects SET created_at=? WHERE id=?').bind('2025-05-01T12:00:00.000Z', historicProject).run();
  const legacy = api.model(await db.prepare('SELECT data FROM workspaces WHERE id=?').bind(historicProject).first('data'));
  legacy.addTask({ title: 'Private historic task', owner: 'jack' });
  await db.prepare('UPDATE workspaces SET data=? WHERE id=?').bind(legacy.exportState(), historicProject).run();
  assert.deepEqual((await migrateDatabase(client, { migrations, apply: true })).applied, ['0010_onboarding_first_tasks.sql', '0011_product_activity_daily.sql']);
  assert.equal(await db.prepare('SELECT COUNT(*) AS total FROM onboarding_first_tasks').first('total'), 0);
});

after(() => {
  client.close();
  globalThis.fetch = originalFetch;
  delete globalThis.__onboardingIdentity;
  delete globalThis.__onboardingEnv;
  assert.equal(calls, 0);
});

test('owner sees historical projects and unknown historical task progress; others cannot read or render the dashboard', async () => {
  const initial = await dashboard();
  assert.deepEqual(initial.totals, { accounts: 4, projects: 1, tasks: 0, both: 0 });
  assert.deepEqual(initial.rows.find(x => x.firstProjectAt), {
    accountCode: await memberCode(carol), firstProjectAt: '2025-05-01T12:00:00.000Z', firstTaskAt: null,
  });
  await assert.rejects(run(carol, () => api.readOnboardingMilestones()), error => error.status === 403);
  await assert.rejects(run(carol, () => api.OnboardingPage({ searchParams: Promise.resolve({}) })), /Not found/);
  await assert.rejects(run(null, () => api.OnboardingPage({ searchParams: Promise.resolve({}) })), /Redirect: .*return_to=%2Fadmin%2Fonboarding/);
  const html = renderToStaticMarkup(await run(owner, () => api.OnboardingPage({ searchParams: Promise.resolve({}) })));
  assert.match(html, /Progress by account/);
  assert.match(html, /Product activity/);
  assert.match(html, /Not recorded/);
  assert.ok(html.includes(await memberCode(carol)));
  assert.doesNotMatch(html, /@example\.com|Fictional carol|provider-carol|Private historic (project|task)/);
  assert.equal((await read(carol, historicProject)).state.tasks.length, 1);
});

test('app opens are authenticated, same-origin and counted once per account/window; active users are unique', async () => {
  const post = (user, input = {}) => run(user, () => api.openApp(request('/api/activity', input)));
  assert.equal((await post(null)).status, 401);
  assert.equal((await post(alice, { userId: bob.userId })).status, 400);
  assert.equal((await run(alice, () => api.openApp(new Request(origin + '/api/activity', {
    method: 'POST', headers: { Origin: 'https://other.example', 'X-Gather-Request': '1', 'Content-Type': 'application/json' }, body: '{}',
  })))).status, 403);
  await body(await post(owner));
  assert.equal((await dashboard()).activity.days[0].active, 0);
  const responses = await Promise.all([post(alice), post(alice)]);
  for (const response of responses) {
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await body(response), { ok: true });
  }
  let activity = (await dashboard()).activity;
  assert.equal(activity.days.length, 14);
  assert.deepEqual([activity.days[0].active, activity.days[0].opens, activity.weeklyActive], [1, 1, 1]);
  await db.prepare("UPDATE product_activity_daily SET last_open_slot=last_open_slot-1 WHERE user_id=? AND day=date('now')").bind(alice.userId).run();
  await body(await post(alice));
  await db.prepare("INSERT INTO product_activity_daily(user_id,day,app_opens) VALUES (?,date('now','-1 day'),1),(?,date('now','-1 day'),1),(?,date('now','-8 days'),1)")
    .bind(alice.userId, bob.userId, carol.userId).run();
  activity = (await dashboard()).activity;
  assert.deepEqual([activity.days[0].active, activity.days[0].opens, activity.days[1].active, activity.weeklyActive], [1, 2, 2, 2]);
});

test('successful manual creation moves one account through both milestones, without crediting the assignee or retries', async () => {
  const requestId = crypto.randomUUID();
  const project = await makeProject(alice, 'Fictional secret project', requestId);
  assert.equal(await makeProject(alice, 'Fictional secret project', requestId), project);
  assert.deepEqual((await dashboard()).totals, { accounts: 4, projects: 2, tasks: 0, both: 0 });
  const revision = (await read(alice, project)).revision;
  const task = { method: 'addTask', args: [{ title: 'Private task content', owner: '' }], revision };
  assert.equal((await change(alice, project, { ...task, args: [{ title: '' }] })).status, 400);
  assert.equal((await change(alice, project, { ...task, method: ['addTask'] })).status, 400);
  assert.equal((await read(alice, project)).state.tasks.length, 0);
  assert.equal((await change(bob, project, task)).status, 404);
  assert.equal(await record(alice), null);
  const assigned = await memberCode(bob);
  await db.prepare("INSERT INTO project_members(id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)")
    .bind('fixture-invitation-member', project, bob.userId, assigned, 'fictional', new Date().toISOString()).run();
  task.args[0].owner = assigned;
  const saved = await body(await change(alice, project, task));
  assert.equal(saved.state.tasks.length, 1);
  const first = await record(alice);
  assert.match(first.created_at, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal((await change(alice, project, task)).status, 409);
  await body(await change(alice, project, { ...task, revision: saved.revision }));
  assert.deepEqual(await record(alice), first);
  assert.equal(await record(bob), null);
  assert.deepEqual((await dashboard()).totals, { accounts: 4, projects: 2, tasks: 1, both: 1 });
  assert.equal((await dashboard()).activity.days[0].created, 2);
});

test('a zero-row save and an aborted milestone write do not leave task or tracking changes', async () => {
  const project = dylanProject = await makeProject(dylan, 'Race fixture');
  const old = await read(dylan, project);
  const task = { method: 'addTask', args: [{ title: 'Fictional competing task' }], revision: old.revision };
  interceptBatch = () => db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').bind(project).run();
  assert.equal((await change(dylan, project, task)).status, 409);
  assert.equal(await record(dylan), null);
  const latest = await read(dylan, project);
  assert.equal(latest.state.tasks.length, 0);
  const dayBefore = (await dashboard()).activity.days[0];
  await client.execute("CREATE TRIGGER reject_fixture_marker BEFORE INSERT ON onboarding_first_tasks BEGIN SELECT RAISE(ABORT,'fixture only'); END");
  try {
    assert.equal((await change(dylan, project, { ...task, revision: latest.revision })).status, 500);
    assert.equal(await record(dylan), null);
    assert.deepEqual(await read(dylan, project), latest);
    assert.deepEqual((await dashboard()).activity.days[0], dayBefore);
  } finally { await client.execute('DROP TRIGGER reject_fixture_marker'); }
});

test('a reviewed starter only counts when it commits a new task, and the owner is excluded', async () => {
  const project = await makeProject(bob, 'Reviewed starter fixture');
  const apply = await starter(bob, project, 2);
  assert.equal(await record(bob), null);
  const approve = input => run(bob, () => api.writePlan(request(plan(project), input)));
  assert.equal((await approve({ ...apply, confirm: false })).status, 400);
  assert.equal(await record(bob), null);
  const saved = await body(await approve(apply));
  assert.equal(saved.receipt.taskIds.length, 2);
  assert.equal((await read(bob, project)).state.tasks.length, 2);
  const first = await record(bob);
  assert.ok(first);
  await body(await approve(apply));
  assert.deepEqual(await record(bob), first);
  assert.equal((await dashboard()).activity.days[0].created, 4);
  const ownProject = await makeProject(owner, 'Owner testing excluded');
  const { revision } = await read(owner, ownProject);
  await body(await change(owner, ownProject, { method: 'addTask', args: [{ title: 'Test task' }], revision }));
  assert.equal(await record(owner), null);
  assert.deepEqual((await dashboard()).totals, { accounts: 4, projects: 4, tasks: 2, both: 2 });
});

test('completion counts actual transitions, waits for required verification, and ignores retries', async () => {
  const project = await makeProject(alice, 'Completion verification fixture');
  const write = async (method, args, revision) =>
    body(await change(alice, project, { method, args, revision }));
  const original = await read(alice, project);
  const created = await write('addTask', [{ title: 'Fictional task', owner: 'jack', requiresVerification: true }], original.revision);
  const taskId = created.result.id;
  const reported = await write('reportCompletion', [taskId, 'Fictional evidence'], created.revision);
  assert.equal(reported.result.status, 'progress');
  assert.equal((await dashboard()).activity.days[0].completed, 0);
  const verified = await write('verifyTask', [taskId], reported.revision);
  assert.equal(verified.result.status, 'done');
  assert.equal((await dashboard()).activity.days[0].completed, 1);
  assert.equal((await change(alice, project, { method: 'verifyTask', args: [taskId], revision: reported.revision })).status, 409);
  await write('verifyTask', [taskId], verified.revision);
  assert.equal((await dashboard()).activity.days[0].completed, 1);
});

test('a losing reviewed plan save cannot record a milestone; existing task edits do not count', async () => {
  const current = await read(carol, historicProject);
  const task = current.state.tasks[0];
  await body(await change(carol, historicProject, {
    method: 'updateTask', args: [task.id, { note: 'Fictional edit' }], revision: current.revision,
  }));
  assert.equal(await record(carol), null);
  const apply = await starter(carol, historicProject);
  interceptBatch = () => db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').bind(historicProject).run();
  const result = await run(carol, () => api.writePlan(request(plan(historicProject), apply)));
  assert.equal(result.status, 409);
  assert.equal((await read(carol, historicProject)).state.tasks.length, 1);
  assert.equal(await record(carol), null);
});

test('reviewing a message only counts if it directly creates a new task, not a blocker side effect', async () => {
  const current = await read(carol, historicProject);
  const write = async (method, args, revision) =>
    body(await change(carol, historicProject, { method, args, revision }));
  const edit = await write('addMessage', [{
    subject: 'Private historic task', body: 'We are blocked and still waiting for budget approval.',
    taskId: current.state.tasks[0].id,
  }], current.revision);
  assert.equal(edit.result.suggested.mode, 'update');
  const updated = await write('applyMessage', [edit.result.id, {}], edit.revision);
  assert.ok(updated.state.tasks.length > current.state.tasks.length, 'automatic blocker follow-up was created');
  assert.equal(await record(carol), null);
  const newMessage = await write('addMessage', [{
    subject: 'New fictional registration instructions', body: 'Please prepare a sign at the door.',
  }], updated.revision);
  assert.equal(newMessage.result.suggested.mode, 'new');
  await write('applyMessage', [newMessage.result.id, {}], newMessage.revision);
  assert.ok(await record(carol));
});

test('creating a dependency task counts; linking existing work does not', async () => {
  const legacy = api.model(await db.prepare('SELECT data FROM workspaces WHERE id=?').bind(dylanProject).first('data'));
  const a = legacy.addTask({ title: 'Historic task A', owner: 'jack' });
  const b = legacy.addTask({ title: 'Historic task B', owner: 'jack' });
  await db.prepare('UPDATE workspaces SET data=? WHERE id=?').bind(legacy.exportState(), dylanProject).run();
  const { revision } = await read(dylan, dylanProject);
  const related = await body(await change(dylan, dylanProject, {
    method: 'addDependency', args: [a.id, { taskId: b.id, kind: 'related' }], revision,
  }));
  assert.equal(related.state.tasks.length, 2);
  assert.equal(await record(dylan), null);
  const created = await body(await change(dylan, dylanProject, {
    method: 'addDependency', args: [a.id, { title: 123 }], revision: related.revision,
  }));
  assert.equal(created.state.tasks.length, 3);
  assert.ok(await record(dylan));
});

test('owner account results are bounded, totals span every page, and cursors cannot inject SQL', async () => {
  for (let i = 0; i < 53; i++) {
    await db.prepare("INSERT INTO members(user_id,actor_id,email,name,role) VALUES (?,?,?,?,'member')")
      .bind('extra-' + i, 'extra_' + String(i).padStart(2, '0'), 'extra@example.com', 'Fictional extra').run();
  }
  const first = await dashboard("'; DROP TABLE members;");
  const next = await dashboard(first.next);
  assert.equal(first.after, '');
  assert.equal(first.rows.length, 50);
  assert.equal(first.totals.accounts, 57);
  assert.equal(next.rows.length, 7);
  assert.equal(next.next, '');
  assert.deepEqual(next.totals, first.totals);
  assert.equal(new Set([...first.rows, ...next.rows].map(row => row.accountCode)).size, 57);
});
