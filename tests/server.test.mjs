import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gmailAutomaticTests } from './gmail-automatic.cases.mjs';
import { eventPlanTests } from './event-plan.cases.mjs';
import { selfserviceTests } from './selfservice.cases.mjs';

const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle')
  .filter((n) => n.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
let batchTail = Promise.resolve();
const db = {
  async batch(statements) {
    const run = batchTail.then(async () => {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const stmt of statements) results.push(await stmt.run());
      sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
    });
    batchTail = run.catch(() => {});
    return run;
  },
  prepare(sql) {
    let args = [];
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async first() {
        return sqlite.prepare(sql).get(...args) || null;
      },
      async all() {
        return { results: sqlite.prepare(sql).all(...args) };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...args);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  },
};
const uploadedObjects=new Map();
const bucket={async put(key,bytes){uploadedObjects.set(key,new Uint8Array(bytes).slice());},async get(key){const bytes=uploadedObjects.get(key);return bytes?{arrayBuffer:async()=>bytes.slice().buffer}:null;},async delete(key){uploadedObjects.delete(key);}};
globalThis.__gatherEnv = {
  DB: db,
  BUCKET: bucket,
  GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GATHER_OWNER_EMAIL: 'owner@example.com',
  GATHER_ORIGIN: 'https://gather.example',
};
globalThis.__gatherUser = null;
let workspace, privateApi, gmailApi, security, gmailCore, demoApi, resourcesApi, resourcesCore, infoApi, infoCore, projectsApi, teamApi, joinApi, accessCore, senderCore, senderApi, automaticCore, automaticApi, classifierCore, planApi, planGeneration, signupApi, invitationsApi;
before(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gather-server-test-'));
  await build({
    entryPoints: {
      workspace: 'app/api/workspace/route.ts',
      private: 'app/api/private/[action]/route.ts',
      gmail: 'app/api/gmail/[action]/route.ts',
      security: 'lib/security.ts',
      gmailCore: 'lib/gmail.ts',
      demo: 'app/api/demo/route.ts',
      resources: 'app/api/resources/route.ts',
      resourcesCore: 'lib/task-resources.ts',
      info: 'app/api/info/route.ts',
      infoCore: 'lib/project-info.ts',
      projects: 'app/api/projects/route.ts',
      team: 'app/api/team/route.ts',
      join: 'app/api/join/route.ts',
      access: 'lib/project-access.ts',
      senderCore: 'lib/invitation-sender.ts',
      sender: 'app/api/sender/route.ts',
      automaticCore: 'lib/gmail-automatic.ts',
      automaticApi: 'app/api/gmail/automatic-run/route.ts',
      classifierCore: 'lib/mail-classifier.ts',
      planApi: 'app/api/plan/route.ts',
      planGeneration: 'lib/plan-generation.ts',
      signupApi: 'app/api/signup/route.ts',
      invitationsApi: 'app/api/invitations/route.ts',
    },
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'test-environment',
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({
            path: 'env',
            namespace: 'test',
          }));
          b.onResolve({ filter: /chatgpt-auth$/ }, () => ({
            path: 'auth',
            namespace: 'test',
          }));
          b.onLoad({ filter: /.*/, namespace: 'test' }, (a) => ({
            contents:
              a.path === 'env'
                ? 'export const env=globalThis.__gatherEnv;'
                : 'export async function getChatGPTUser(){return globalThis.__gatherUser;}',
            loader: 'js',
          }));
        },
      },
    ],
  });
  [workspace, privateApi, gmailApi, security, gmailCore, demoApi, resourcesApi, resourcesCore, infoApi, infoCore, projectsApi, teamApi, joinApi, accessCore, senderCore, senderApi] = await Promise.all(
    ['workspace', 'private', 'gmail', 'security', 'gmailCore', 'demo', 'resources', 'resourcesCore', 'info', 'infoCore', 'projects', 'team', 'join', 'access', 'senderCore', 'sender'].map(
      (name) => import(pathToFileURL(join(directory, name + '.js'))),
    ),
  );
  [automaticCore, automaticApi, classifierCore] = await Promise.all(['automaticCore', 'automaticApi', 'classifierCore'].map(name => import(pathToFileURL(join(directory, name + '.js')))));
  [planApi, planGeneration] = await Promise.all(['planApi','planGeneration'].map(name=>import(pathToFileURL(join(directory,name+'.js')))));
  [signupApi, invitationsApi] = await Promise.all(['signupApi','invitationsApi'].map(name=>import(pathToFileURL(join(directory,name+'.js')))));
});
const owner = () => {
  globalThis.__gatherUser = {
    userId: 'owner-1',
    email: 'owner@example.com',
    displayName: 'Owner',
  };
};
const request = (path, data, origin = 'https://gather.example') =>
  new Request('https://gather.example' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gather-Request': '1',
      Origin: origin,
    },
    body: JSON.stringify(data),
  });
test('connection CAS cannot resurrect disconnected tokens or revert a changed label', async () => {
  const userId = 'race-user';
  await db
    .prepare(
      'INSERT INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?)',
    )
    .bind(
      userId,
      await security.seal(
        { labelId: 'old', accessToken: 'token' },
        'gmail:' + userId,
      ),
      'generation-a',
    )
    .run();
  const stale = await gmailCore.connection(userId);
  await gmailCore.saveConnection(userId, { ...stale, labelId: 'new' }, true);
  await assert.rejects(
    gmailCore.saveConnection(userId, { ...stale, accessToken: 'delayed' }),
  );
  assert.equal((await gmailCore.connection(userId)).labelId, 'new');
  const current = await gmailCore.connection(userId);
  await db
    .prepare('DELETE FROM gmail_connections WHERE user_id=?')
    .bind(userId)
    .run();
  await assert.rejects(gmailCore.saveConnection(userId, current));
  assert.equal(await gmailCore.connection(userId), null);
});
test('anonymous APIs deny all private data', async () => {
  globalThis.__gatherUser = null;
  assert.equal((await workspace.GET(new Request('https://gather.example/api/workspace'))).status, 401);
  assert.equal(
    (
      await privateApi.GET(
        new Request('https://gather.example/api/private/records'),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await gmailApi.GET(
        new Request('https://gather.example/api/gmail/messages'),
      )
    ).status,
    401,
  );
});
test('signed-in outsider cannot bootstrap membership', async () => {
  globalThis.__gatherUser = {
    userId: 'outsider',
    email: 'other@example.com',
    displayName: 'Other',
  };
  assert.equal((await workspace.GET(new Request('https://gather.example/api/workspace'))).status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM members').get().n, 0);
});
test('owner receives server workspace and real identity', async () => {
  owner();
  const response = await workspace.GET(new Request('https://gather.example/api/workspace'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.identity.actorId, 'jack');
  assert.equal(data.state.members[0].name, 'Owner');
  assert.equal(data.setupRequired, true);
  assert.equal(data.state.tasks.length, 0);
  assert.equal(data.state.messages.length, 0);
  assert.equal(data.state.memories.length, 0);
  assert.equal(data.state.members.length, 1);
  assert.deepEqual(data.suggestions, []);
  assert.equal(data.state.event.guestCount, 0);
  assert.equal(data.state.event.name, '');
});
test('project setup validates, persists an owner-only plan and protects concurrent edits', async () => {
  owner();
  const initial = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const invalid = [{name:'  '},{name:7},{name:'a'.repeat(161)},{date:'2026-02-30'}, {outdoor:'maybe'}, {guestCount:-1}, {guestCount:true}, {guestCount:[]}, {guestCount:''}, {guestCount:10,dietaryOutstanding:11}, {setupCompletedAt:'forged'}];
  for (const details of invalid) {
    const response = await workspace.POST(request('/api/workspace', {method:'completeSetup',args:[details],revision:initial.revision}));
    assert.equal(response.status, 400);
  }
  assert.equal((await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json()).revision, initial.revision);
  const input = {method:'completeSetup',args:[{name:'  Team offsite  ',date:'',location:'Community hall',guestCount:30,outdoor:true,transportNeeded:true}],revision:initial.revision};
  assert.equal((await workspace.POST(request('/api/workspace',input,'https://evil.example'))).status,403);
  assert.equal((await workspace.POST(request('/api/workspace',input))).status,200);
  assert.equal((await workspace.POST(request('/api/workspace',input))).status,409);
  const saved = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  assert.equal(saved.setupRequired,false);
  assert.equal(saved.state.event.name,'Team offsite'); assert.equal(saved.state.event.date,'');
  assert.ok(saved.state.event.setupCompletedAt); assert.equal(saved.state.members.length,1);
  assert.equal(saved.state.tasks.length,0); assert.equal(saved.state.messages.length,0);
  assert.equal(saved.suggestions.find(s=>s.id==='accessibility').task.owner,'');
  const accept = await workspace.POST(request('/api/workspace',{method:'acceptSuggestion',args:['accessibility'],revision:saved.revision}));
  assert.equal(accept.status,200); assert.equal((await accept.json()).result.owner,'');
  const persisted = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  assert.equal(persisted.state.tasks.length,1); assert.equal(persisted.state.members.length,1);
});
test('legacy project setup keeps existing work and feedback instead of resetting the project', async () => {
  owner();
  // Explicit legacy fixture for the regression suite; production never resets an existing row.
  const fixture = globalThis.GatherStore.createStore({storage:null});
  const before = JSON.parse(fixture.exportState());
  sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(fixture.exportState(),'main');
  const initial = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  assert.equal(initial.setupRequired,false);
  const response = await workspace.POST(request('/api/workspace',{method:'completeSetup',args:[{name:'Existing project',date:'2026-10-20',location:'New venue'}],revision:initial.revision}));
  assert.equal(response.status,200);
  const saved = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  for(const key of ['tasks','messages','memories','drafts','dismissed']) assert.deepEqual(saved.state[key],initial.state[key]);
  assert.equal(saved.state.tasks.length,before.tasks.length);
  assert.equal(saved.state.activity.length,initial.state.activity.length+1);
  assert.equal(saved.state.event.name,'Existing project');
});
test('setup denies outsiders and teammates; malformed saved projects are never replaced by demo data', async () => {
  owner(); const initial=await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const input={method:'completeSetup',args:[{name:'No access'}],revision:initial.revision};
  globalThis.__gatherUser=null;
  assert.equal((await workspace.POST(request('/api/workspace',input))).status,401);
  globalThis.__gatherUser={userId:'outsider-setup',email:'stranger@example.com',displayName:'Stranger'};
  assert.equal((await workspace.POST(request('/api/workspace',input))).status,403);
  sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run('setup-member','u_setup','setup@example.com','Setup teammate','member');
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)').run('setup-member','main','setup-member','u_setup','fixture','now');
  globalThis.__gatherUser={userId:'setup-member',email:'setup@example.com',displayName:'Setup teammate'};
  try { assert.equal((await workspace.POST(request('/api/workspace',input))).status,403); }
  finally { sqlite.prepare('DELETE FROM project_members WHERE id=?').run('setup-member'); sqlite.prepare('DELETE FROM members WHERE user_id=?').run('setup-member'); owner(); }
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  const invalid=JSON.parse(original);invalid.tasks[0].owner='nonexistent';
  const damaged=JSON.stringify(invalid);sqlite.prepare('UPDATE workspaces SET data=? WHERE id=?').run(damaged,'main');
  try {
    assert.equal((await workspace.GET(new Request('https://gather.example/api/workspace'))).status,503);
    assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,damaged);
  } finally { sqlite.prepare('UPDATE workspaces SET data=? WHERE id=?').run(original,'main'); }
});
test('CSRF and actor injection are rejected', async () => {
  owner();
  let snapshot = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const args = {
    method: 'addTask',
    args: [{ title: 'Unsafe' }, 'maya'],
    revision: snapshot.revision,
  };
  assert.equal(
    (
      await workspace.POST(
        request('/api/workspace', args, 'https://evil.example'),
      )
    ).status,
    403,
  );
  assert.equal(
    (await workspace.POST(request('/api/workspace', args))).status,
    400,
  );
  assert.equal(
    (
      await workspace.POST(
        request('/api/workspace', {
          method: 'exportState',
          args: [],
          revision: snapshot.revision,
        }),
      )
    ).status,
    400,
  );
});
test('writes persist, record trusted actor, and reject stale revisions', async () => {
  owner();
  const snapshot = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const data = {
    method: 'addTask',
    args: [{ title: 'Real task', owner: 'jack', status: 'todo' }],
    revision: snapshot.revision,
  };
  const response = await workspace.POST(request('/api/workspace', data));
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.result.updatedBy, 'jack');
  assert.equal(
    (await workspace.POST(request('/api/workspace', data))).status,
    409,
  );
  const reloaded = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  assert.ok(reloaded.state.tasks.some((t) => t.title === 'Real task'));
});
test('private records encrypt at rest and never enter shared state', async () => {
  owner();
  const reference = 'TEST-SECRET-BOOKING';
  const response = await privateApi.POST(
    request('/api/private/records', {
      title: 'Test flight',
      type: 'Flight',
      reference,
    }),
  );
  assert.equal(response.status, 200);
  const row = sqlite.prepare('SELECT payload FROM private_records').get();
  assert.ok(!row.payload.includes(reference));
  const records = await (
    await privateApi.GET(
      new Request('https://gather.example/api/private/records'),
    )
  ).json();
  assert.equal(records.records[0].reference, reference);
  const shared = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).text();
  assert.ok(!shared.includes(reference));
  assert.equal(
    (
      await privateApi.POST(
        request('/api/private/setup', { passphrase: 'ignored' }),
      )
    ).status,
    404,
  );
});
test('encryption is context-bound and detects tampering', async () => {
  const encrypted = await security.seal({ value: 'secret' }, 'a');
  assert.equal((await security.unseal(encrypted, 'a')).value, 'secret');
  await assert.rejects(security.unseal(encrypted, 'b'));
  await assert.rejects(security.unseal(encrypted.slice(0, -4) + 'AAAA', 'a'));
});
test('project organizers cannot replace app-wide Google settings or invalidate pending authorizations',async()=>{
  owner();await security.principal();
  const config={clientId:'app-owner.apps.googleusercontent.com',clientSecret:'app-owner-fixture-secret'};
  const payload=await security.seal(config,'google-oauth');
  sqlite.prepare('INSERT INTO settings (id,payload) VALUES (?,?)').run('google-oauth',payload);
  const pending=await gmailApi.POST(request('/api/gmail/connect',{}));assert.equal(pending.status,200);
  const state=new URL((await pending.json()).url).searchParams.get('state');
  const pendingRow=sqlite.prepare('SELECT * FROM oauth_states WHERE id=?').get(state);
  sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run('settings-organizer','u_settings_organizer','organizer@example.com','Organizer','admin');
  globalThis.__gatherUser={userId:'settings-organizer',email:'organizer@example.com',displayName:'Organizer'};
  try {
    const replacement={clientId:'replacement.apps.googleusercontent.com',clientSecret:'replacement-fixture-secret'};
    assert.equal((await gmailApi.POST(request('/api/gmail/configure',replacement))).status,403);
    assert.equal((await gmailApi.POST(request('/api/gmail/configure',{...replacement,role:'admin',email:'owner@example.com'}))).status,403);
    assert.equal(sqlite.prepare('SELECT payload FROM settings WHERE id=?').get('google-oauth').payload,payload);
    assert.deepEqual(sqlite.prepare('SELECT * FROM oauth_states WHERE id=?').get(state),pendingRow);
    const status=await (await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))).json();
    assert.equal(status.canManageGoogle,false);assert.equal(status.configured,true);
    assert.ok(!JSON.stringify(status).includes(config.clientSecret));
    const connected=await gmailApi.POST(request('/api/gmail/connect',{}));assert.equal(connected.status,200);
    assert.equal(new URL((await connected.json()).url).searchParams.get('client_id'),config.clientId);
    owner();
    const ownerStatus=await (await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))).json();
    assert.equal(ownerStatus.canManageGoogle,true);
    assert.equal((await gmailApi.POST(request('/api/gmail/configure',replacement))).status,200);
  } finally {
    owner();
    sqlite.prepare("DELETE FROM settings WHERE id='google-oauth'").run();
    sqlite.prepare("DELETE FROM oauth_states WHERE user_id IN ('owner-1','settings-organizer')").run();
  }
});
test('Google configuration authority fails closed without the configured global owner identity',async()=>{
  owner();const user=await security.principal();
  const originalEmail=globalThis.__gatherEnv.GATHER_OWNER_EMAIL;
  const config={clientId:'restricted.apps.googleusercontent.com',clientSecret:'restricted-fixture-secret'};
  try {
    globalThis.__gatherEnv.GATHER_OWNER_EMAIL='OWNER@example.com';
    assert.equal(security.isAppOwner(user),true);
    for(const configured of ['',undefined,'someone-else@example.com']) {
      globalThis.__gatherEnv.GATHER_OWNER_EMAIL=configured;
      assert.equal((await gmailApi.POST(request('/api/gmail/configure',config))).status,403);
      assert.equal((await (await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))).json()).canManageGoogle,false);
    }
    globalThis.__gatherEnv.GATHER_OWNER_EMAIL=originalEmail;
    assert.equal(security.isAppOwner({...user,actorId:'u_other'}),false);
    assert.equal(security.isAppOwner({...user,role:'member'}),false);
    assert.equal(security.isAppOwner({...user,email:'someone-else@example.com'}),false);
    assert.equal(sqlite.prepare("SELECT payload FROM settings WHERE id='google-oauth'").get(),undefined);
  } finally {globalThis.__gatherEnv.GATHER_OWNER_EMAIL=originalEmail;owner();}
});
test('managed Gmail setup reuses server registration without exposing or copying secrets', async () => {
  owner();
  const config = { clientId: 'managed.apps.googleusercontent.com', clientSecret: 'server-only-fixture-secret' };
  Object.assign(globalThis.__gatherEnv, { GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret });
  try {
    const status = await (await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))).json();
    assert.equal(status.configured, true);
    assert.equal(status.managed, true);
    assert.equal(status.connected, false);
    assert.ok(!JSON.stringify(status).includes(config.clientSecret));
    assert.equal(sqlite.prepare("SELECT payload FROM settings WHERE id='google-oauth'").get(), undefined);
    assert.equal((await gmailApi.POST(request('/api/gmail/configure', config))).status, 409);
    const url = new URL((await (await gmailApi.POST(request('/api/gmail/connect', {}))).json()).url);
    assert.equal(url.searchParams.get('client_id'), config.clientId);
    assert.equal(url.searchParams.get('prompt'), 'consent select_account');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const row = sqlite.prepare("SELECT payload FROM settings WHERE id='google-oauth'").get();
    assert.match(row.payload, /^env:[a-f0-9]{64}$/);
    assert.ok(!row.payload.includes(config.clientSecret));
    const state = url.searchParams.get('state');
    const saved = sqlite.prepare('SELECT payload FROM oauth_states WHERE id=?').get(state);
    assert.equal((await security.unseal(saved.payload, 'oauth:' + state)).configPayload, row.payload);
  } finally {
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_ID;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET;
    sqlite.prepare("DELETE FROM settings WHERE id='google-oauth'").run();
    sqlite.prepare("DELETE FROM oauth_states WHERE user_id='owner-1'").run();
  }
});
test('managed Gmail callback, refresh and replay protections work without manual configuration', async () => {
  owner();
  Object.assign(globalThis.__gatherEnv, { GOOGLE_CLIENT_ID: 'managed.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'server-fixture-secret' });
  const originalFetch = globalThis.fetch;
  let exchanges = 0;
  globalThis.fetch = async (path, options) => {
    if (path === 'https://oauth2.googleapis.com/token') {
      exchanges++;
      assert.equal(options.body.get('client_id'), globalThis.__gatherEnv.GOOGLE_CLIENT_ID);
      assert.equal(options.body.get('client_secret'), globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET);
      return Response.json({ access_token: 'managed-access', refresh_token: 'managed-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    }
    assert.equal(path, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
    return Response.json({ emailAddress: 'managed@example.com' });
  };
  try {
    const start = async () => new URL(await gmailCore.beginOAuth('owner-1')).searchParams.get('state');
    const state = await start();
    const callback = state => gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=' + state + '&code=fixture'));
    assert.equal((await callback(state)).status, 303);
    assert.equal((await gmailCore.connection('owner-1')).email, 'managed@example.com');
    assert.equal((await callback(state)).status, 400);
    assert.equal(exchanges, 1);
    const conn = await gmailCore.connection('owner-1');
    await gmailCore.saveConnection('owner-1', { ...conn, expiresAt: 0 });
    await gmailCore.gmail('owner-1', 'profile');
    assert.equal(exchanges, 2);
    const stale = await start();
    globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET = 'rotated-fixture-secret';
    assert.equal((await callback(stale)).status, 409);
    assert.equal(exchanges, 2);
    assert.equal((await callback(await start())).status, 303);
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET;
    assert.equal(await gmailCore.configuration(), null);
    assert.equal((await gmailApi.POST(request('/api/gmail/connect', {}))).status, 409);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_ID;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET;
    sqlite.prepare("DELETE FROM settings WHERE id='google-oauth'").run();
    sqlite.prepare("DELETE FROM oauth_states WHERE user_id='owner-1'").run();
    sqlite.prepare("DELETE FROM gmail_connections WHERE user_id='owner-1'").run();
  }
});
test('Gmail authorization preserves only authorized project context through success and cancellation', async () => {
  owner();
  const id = 'p_00000000-0000-4000-8000-000000000001';
  sqlite.prepare('INSERT INTO projects (id,owner_id,request_payload,created_at) VALUES (?,?,?,?)').run(id, 'owner-1', '{}', 'now');
  Object.assign(globalThis.__gatherEnv, { GOOGLE_CLIENT_ID: 'managed.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'server-fixture-secret' });
  const original = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async path => {
    fetches++;
    if (path === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.readonly' });
    assert.equal(path, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
    return Response.json({ emailAddress: 'fixture@example.com' });
  };
  try {
    const start = async () => {
      const response = await gmailApi.POST(request('/api/gmail/connect?project=' + id, {}));
      assert.equal(response.status, 200);
      return new URL((await response.json()).url).searchParams.get('state');
    };
    let state = await start();
    const payload = sqlite.prepare('SELECT payload FROM oauth_states WHERE id=?').get(state).payload;
    assert.equal((await security.unseal(payload, 'oauth:' + state)).projectId, id);
    let response = await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=' + state + '&error=access_denied&project=main'));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://gather.example/settings?project=' + id + '&gmail=cancelled');
    assert.equal(fetches, 0);
    state = await start();
    response = await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=' + state + '&code=fixture&project=https://evil.example'));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://gather.example/settings?project=' + id + '&gmail=connected');
    const previous = await gmailCore.connection('owner-1');
    state = await start();
    sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run('another-owner', id);
    assert.equal((await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=' + state + '&code=fixture'))).status, 404);
    assert.equal(fetches, 2);
    assert.equal((await gmailCore.connection('owner-1')).storedPayload, previous.storedPayload);
    for (const project of [id, 'https://evil.example', 'demo', '']) {
      assert.equal((await gmailApi.POST(request('/api/gmail/connect?project=' + encodeURIComponent(project), {}))).status, 404);
    }
    assert.equal(sqlite.prepare('SELECT id FROM oauth_states WHERE user_id=?').get('owner-1').id, state);
  } finally {
    globalThis.fetch = original;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_ID;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET;
    sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
    sqlite.prepare("DELETE FROM settings WHERE id='google-oauth'").run();
    sqlite.prepare("DELETE FROM oauth_states WHERE user_id='owner-1'").run();
    sqlite.prepare("DELETE FROM gmail_connections WHERE user_id='owner-1'").run();
  }
});
test('browser OAuth failures have private recovery pages while API callers retain JSON errors', async () => {
  owner();
  const url = 'https://gather.example/api/gmail/callback?state=expired-fixture&code=DO-NOT-REFLECT&error_description=%3Cscript%3Ealert(1)%3C/script%3E';
  let response = await gmailApi.GET(new Request(url, { headers: { Accept: 'text/html' } }));
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  let html = await response.text();
  assert.match(html, /authorization expired/);
  assert.match(html, /href="\/settings"/);
  assert.doesNotMatch(html, /DO-NOT-REFLECT|<script|expired-fixture|error_description/);
  response = await gmailApi.GET(new Request(url));
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.match((await response.json()).error, /authorization expired/);
  globalThis.__gatherUser = null;
  response = await gmailApi.GET(new Request(url, { headers: { Accept: 'text/html' } }));
  assert.equal(response.status, 401);
  html = await response.text();
  assert.match(html, /href="\/signin-with-chatgpt\?return_to=%2Fsettings"/);
  assert.doesNotMatch(html, /DO-NOT-REFLECT|expired-fixture/);
  response = await gmailApi.GET(new Request('https://gather.example/api/gmail/status', { headers: { Accept: 'text/html' } }));
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type'), /application\/json/);
  owner();
});
test('saved Gmail clients retain precedence over managed credentials', async () => {
  const payload = await security.seal({ clientId: 'legacy.apps.googleusercontent.com', clientSecret: 'legacy-fixture-secret' }, 'google-oauth');
  sqlite.prepare('INSERT INTO settings (id,payload) VALUES (?,?)').run('google-oauth', payload);
  Object.assign(globalThis.__gatherEnv, { GOOGLE_CLIENT_ID: 'managed.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'managed-fixture-secret' });
  try {
    const config = await gmailCore.configuration(true);
    assert.equal(config.clientId, 'legacy.apps.googleusercontent.com');
    assert.equal(config.managed, false);
    assert.equal(config.storedPayload, payload);
    assert.equal(sqlite.prepare("SELECT payload FROM settings WHERE id='google-oauth'").get().payload, payload);
  } finally {
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_ID;
    delete globalThis.__gatherEnv.GOOGLE_CLIENT_SECRET;
    sqlite.prepare("DELETE FROM settings WHERE id='google-oauth'").run();
  }
});
test('Gmail setup is explicit and secrets are not returned', async () => {
  owner();
  let status = await (
    await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))
  ).json();
  assert.equal(status.connected, false);
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/connect', {}))).status,
    409,
  );
  const config = {
    clientId: '123-test.apps.googleusercontent.com',
    clientSecret: 'test-only-secret-123',
  };
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/configure', config))).status,
    200,
  );
  status = await (
    await gmailApi.GET(new Request('https://gather.example/api/gmail/status'))
  ).json();
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes(config.clientSecret));
  assert.ok(
    !sqlite
      .prepare('SELECT payload FROM settings')
      .get()
      .payload.includes(config.clientSecret),
  );
});
test('OAuth state is bound to identity and code uses PKCE', async () => {
  owner();
  const result = await (
    await gmailApi.POST(request('/api/gmail/connect', {}))
  ).json();
  const url = new URL(result.url);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://gather.example/api/gmail/callback',
  );
  assert.equal(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/gmail.readonly',
  );
  const state = url.searchParams.get('state');
  const saved = sqlite
    .prepare('SELECT * FROM oauth_states WHERE id=?')
    .get(state);
  assert.equal(saved.user_id, 'owner-1');
  const cancelled = await gmailApi.GET(
    new Request(
      'https://gather.example/api/gmail/callback?state=' +
        state +
        '&error=access_denied',
    ),
  );
  assert.equal(cancelled.status, 303);
  assert.equal(
    (
      await gmailApi.GET(
        new Request(
          'https://gather.example/api/gmail/callback?state=' +
            state +
            '&error=access_denied',
        ),
      )
    ).status,
    400,
  );
});
test('Gmail review copies only explicitly approved text', async () => {
  owner();
  const secret = {
    subject: 'Private booking ABC123',
    sender: 'private@example.com',
    body: 'Confirmation SECRET123',
    receivedAt: new Date().toISOString(),
    threadId: 'thread-private',
    providerId: 'provider-1',
  };
  await db
    .prepare(
      'INSERT INTO mail_messages (id,user_id,provider_id,payload,received_at) VALUES (?,?,?,?,?)',
    )
    .bind(
      'mail-1',
      'owner-1',
      'provider-1',
      await security.seal(secret, 'mail:mail-1'),
      secret.receivedAt,
    )
    .run();
  const data = {
    id: 'mail-1',
    taskId: 'bus',
    title: 'Speaker arrival',
    summary: 'Transport is confirmed.',
    confirmShared: true,
  };
  assert.equal(
    (
      await gmailApi.POST(
        request('/api/gmail/review', { ...data, confirmShared: false }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await gmailApi.POST(request('/api/gmail/review', data))).status,
    200,
  );
  const raw = await (await workspace.GET(new Request('https://gather.example/api/workspace'))).text();
  assert.ok(raw.includes('Transport is confirmed.'));
  for (const field of ['ABC123', 'SECRET123', 'private@example.com'])
    assert.ok(!raw.includes(field));
  const shared = JSON.parse(raw).state.messages.find(m => m.externalId === 'review:mail-1');
  assert.equal(shared.linkedTaskId, 'bus');
  const imported = await (await gmailApi.GET(new Request('https://gather.example/api/gmail/messages'))).json();
  assert.equal(imported.messages[0].sharedMessageId, shared.id);
  assert.equal(imported.messages[0].taskId, 'bus');
  assert.ok(imported.tasks.some(t => t.id === 'bus'));
});
test('private original is owner-scoped, no-store, and absent from shared exports', async () => {
  owner();
  const url = 'https://gather.example/api/gmail/original?id=mail-1';
  const response = await gmailApi.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).body, 'Confirmation SECRET123');
  assert.equal((await gmailApi.GET(new Request(url.replace('mail-1','missing')))).status,404);
  await db.prepare('INSERT INTO mail_messages (id,user_id,provider_id,payload,received_at) VALUES (?,?,?,?,?)')
    .bind('outsider-mail','outsider','other-provider',await security.seal({body:'OTHER-SECRET'},'mail:outsider-mail'),new Date().toISOString()).run();
  assert.equal((await gmailApi.GET(new Request(url.replace('mail-1','outsider-mail')))).status,404);
  globalThis.__gatherUser = null;
  assert.equal((await gmailApi.GET(new Request(url))).status,401);
  owner();
  assert.ok(!(await (await workspace.GET(new Request('https://gather.example/api/workspace'))).text()).includes('SECRET123'));
});

const demoRead = (actor = 'jack') => demoApi.GET(new Request('https://gather.example/api/demo?as=' + actor));
const demoWrite = (actor, data, origin) => demoApi.POST(request('/api/demo?as=' + actor, data, origin));
test('task priority RPC persists in real and demo workspaces, rejects teammates and conflicts, and preserves progress',async()=>{
  owner();
  let live=await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const before=live.state.tasks.find(t=>t.id==='dietary');
  const response=await workspace.POST(request('/api/workspace',{method:'setTaskPriority',args:['dietary','high'],revision:live.revision}));
  assert.equal(response.status,200);live=await response.json();
  const after=live.state.tasks.find(t=>t.id==='dietary');assert.equal(after.priority,'high');
  assert.deepEqual({...after,priority:before.priority,revision:before.revision},before);
  assert.equal((await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json()).state.tasks.find(t=>t.id==='dietary').priority,'high');
  let demo=await (await demoRead()).json(),revision=demo.revision;
  assert.equal((await demoWrite('maya',{method:'setTaskPriority',args:['dietary','low'],revision})).status,403);
  assert.equal((await demoWrite('jack',{method:'setTaskPriority',args:['dietary','urgent'],revision})).status,400);
  const saved=await demoWrite('jack',{method:'setTaskPriority',args:['dietary','low'],revision});assert.equal(saved.status,200);demo=await saved.json();
  assert.equal((await demoWrite('jack',{method:'setTaskPriority',args:['dietary','auto'],revision})).status,409);
  for(const actor of ['jack','maya','dev','jules'])assert.equal((await (await demoRead(actor)).json()).state.tasks.find(t=>t.id==='dietary').priority,'low');
  assert.equal((await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json()).state.tasks.find(t=>t.id==='dietary').priority,'high');
  assert.equal((await demoWrite('jack',{method:'setTaskPriority',args:['dietary','auto'],revision:demo.revision})).status,200);
});
test('demo is authenticated, owner-scoped, and isolated from the real workspace', async () => {
  globalThis.__gatherUser = null;
  assert.equal((await demoRead()).status, 401);
  globalThis.__gatherUser = { userId:'outsider', email:'other@example.com', displayName:'Other' };
  assert.equal((await demoRead()).status, 403);
  owner();
  const original = sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  const jack = await (await demoRead()).json();
  assert.equal(jack.actor, 'jack');
  assert.equal(jack.members[0].name, 'Jack Morgan');
  assert.equal(jack.privateDetails.length,2);
  assert.ok(!JSON.stringify(jack).includes('SECRET123'));
  assert.ok(!jack.tasks.some(t => t.title === 'Real task'));
  const jules = await (await demoRead('jules')).json();
  assert.equal(jules.actor,'jules');
  assert.equal(jules.revision,jack.revision);
  assert.deepEqual(jules.privateDetails,[]);
  assert.ok(!JSON.stringify(jules).includes('DEMO-FLIGHT-24'));
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data, original);
  assert.equal(sqlite.prepare("SELECT count(*) n FROM workspaces WHERE id LIKE 'demo:%'").get().n,1);
});
test('demo role rules reject cross-owner edits, assignment, verification, and identity injection', async () => {
  owner();
  const state = await (await demoRead('maya')).json();
  const base = { revision: state.revision, taskId:'dietary', action:'update', values:{note:'Updated'} };
  assert.equal((await demoWrite('maya',{...base,taskId:'bus'})).status,403);
  for(const values of [{owner:'maya'},{requiresVerification:false},{title:'Changed'}]) assert.equal((await demoWrite('maya',{...base,values})).status,403);
  assert.equal((await demoWrite('maya',{...base,action:'verify'})).status,403);
  assert.equal((await demoWrite('maya',{...base,actor:'jack'})).status,400);
  assert.equal((await demoWrite('maya',{...base,workspaceId:'main'})).status,400);
  assert.equal((await demoWrite('maya',base,'https://evil.example')).status,403);
  assert.equal((await demoRead('not-a-profile')).status,400);
  assert.equal((await demoWrite('maya',{...base,action:'reset',confirmReset:true})).status,403);
});
test('all four perspectives share assignment, comments, completion and verification', async () => {
  owner();
  const original = sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  let current = await (await demoRead('jack')).json();
  async function save(actor, action, taskId, values = {}) {
    const response = await demoWrite(actor,{action,taskId,values,revision:current.revision});
    assert.equal(response.status,200,await response.clone().text());
    current=await response.json();
  }
  await save('jack','update','wayfinding',{owner:'dev'});
  await save('dev','accept','wayfinding');
  assert.equal(current.tasks.find(t => t.id === 'wayfinding').acceptedBy,'dev');
  await save('maya','comment','bus',{text:'Guest count is now final.'});
  assert.equal(current.tasks.find(t => t.id === 'bus').comments.at(-1).actor,'maya');
  await save('jules','complete','bus',{note:'Both buses confirmed. Ready for organizer verification.'});
  let bus=current.tasks.find(t => t.id === 'bus');
  assert.equal(bus.status,'progress');
  assert.equal(bus.reportedBy,'Jules Miller');
  await save('jack','verify','bus');
  bus=current.tasks.find(t => t.id === 'bus');
  assert.equal(bus.status,'done');
  assert.equal(bus.verifiedBy,'jack');
  for(const actor of ['jack','maya','jules','dev']) {
    const view=await (await demoRead(actor)).json();
    assert.equal(view.actor,actor);
    assert.equal(view.revision,current.revision);
    assert.equal(view.tasks.find(t => t.id === 'bus').status,'done');
  }
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});
test('stale demo tabs cannot overwrite newer updates and restart only resets the demo', async () => {
  owner();
  const original = sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  const before=await (await demoRead('maya')).json();
  const update={action:'comment',taskId:'dietary',values:{text:'Newest update'},revision:before.revision};
  assert.equal((await demoWrite('maya',update)).status,200);
  assert.equal((await demoWrite('dev',{...update,values:{text:'Stale overwrite'}})).status,409);
  const current=await (await demoRead()).json();
  assert.ok(!JSON.stringify(current).includes('Stale overwrite'));
  assert.equal((await demoWrite('jack',{action:'reset',revision:current.revision})).status,400);
  assert.equal((await demoWrite('jack',{action:'reset',revision:current.revision,confirmReset:true})).status,200);
  const reset=await (await demoRead('jules')).json();
  assert.ok(reset.revision>current.revision);
  assert.equal(reset.tasks.find(t => t.id === 'bus').status,'blocked');
  assert.ok(!JSON.stringify(reset).includes('Newest update'));
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});

test('full demo uses the real workspace contract and atomically arbitrates task claims', async () => {
  owner();
  const before=await (await demoRead('maya')).json();
  assert.equal(before.identity.role,'member');
  assert.equal(before.identity.actorId,'maya');
  assert.deepEqual(before.state.tasks,before.tasks);
  assert.ok(Array.isArray(before.suggestions)&&Array.isArray(before.state.messages)&&Array.isArray(before.state.memories));
  const payload={method:'claimTask',args:['wayfinding'],revision:before.revision};
  const results=await Promise.all(['maya','dev'].map(actor=>demoWrite(actor,payload)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=await results.find(r=>r.status===200).json();
  const task=winner.state.tasks.find(t=>t.id==='wayfinding');
  assert.equal(task.owner,task.acceptedBy);
  assert.equal(winner.result.id,'wayfinding');
  assert.equal(winner.state.activity.filter(a=>a.type==='claimed'&&a.taskId===task.id).length,1);
  for(const actor of ['jack','maya','jules','dev'])assert.equal((await (await demoRead(actor)).json()).state.tasks.find(t=>t.id===task.id).owner,task.owner);
  assert.equal((await demoWrite('jules',{...payload,revision:winner.revision})).status,400);
});

test('full demo organizer actions work and cannot mutate live data; teammate RPC is constrained', async () => {
  owner();
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  let current=await (await demoRead()).json();
  const rpc=async(method,args)=>{
    const res=await demoWrite('jack',{method,args,revision:current.revision});
    assert.equal(res.status,200,await res.clone().text());current=await res.json();return current.result;
  };
  const task=await rpc('addTask',[{title:'Demo-only task',owner:'',note:'Sample work'}]);
  await rpc('updateTask',[task.id,{title:'Demo-only renamed task',dueDate:'2027-02-01'}]);
  await rpc('addMemory',[{change:'Provide maps before arrival',wentWell:'Shared updates',rating:4}]);
  await rpc('updateEvent',[{guestCount:150}]);
  const message=await rpc('addMessage',[{sender:'Sample vendor',subject:'Signage update',body:'Signs are ready for review.',taskId:task.id}]);
  await rpc('applyMessage',[message.id,{}]);
  assert.equal(current.state.event.guestCount,150);
  assert.ok(current.state.messages.some(m=>m.id===message.id&&m.appliedTaskId));
  for(const [method,args] of [['addTask',[{title:'Forbidden'}]],['updateTask',['dietary',{owner:'maya'}]],['updateEvent',[{guestCount:1}]],['applyMessage',[message.id,{}]],['verifyTask',['bus']],['resetDemo',[true]]])
    assert.equal((await demoWrite('maya',{method,args,revision:current.revision})).status,403,method);
  assert.equal((await demoWrite('maya',{method:'claimTask',args:[task.id,'jack'],revision:current.revision})).status,400);
  assert.equal((await demoWrite('maya',{method:'claimTask',args:[task.id],revision:current.revision,workspaceId:'main'})).status,400);
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});

test('dependency RPC is owner-scoped, revision-safe, persistent and isolated from the real project', async () => {
  owner();
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  let current=await (await demoRead()).json();
  const rpc=async(actor,method,args)=>demoWrite(actor,{method,args,revision:current.revision});
  current=await (await rpc('jack','resetDemo',[true])).json();
  const blocked=await rpc('maya','updateTask',['dietary',{status:'blocked',note:'Need budget approval for guest calls.'}]);
  assert.equal(blocked.status,200);
  current=await blocked.json();
  const child=current.state.tasks.find(t=>t.id===current.state.tasks.find(t=>t.id==='dietary').dependencies[0].taskId);
  assert.equal(child.owner,'');
  for(const [method,args] of [['resumeTask',['dietary']],['addDependency',['dietary',{title:'Forged work'}]],['removeDependency',['dietary',child.id]]])
    assert.equal((await rpc('jules',method,args)).status,403);
  assert.equal((await rpc('maya','addDependency',['dietary',{title:'Forged assignment',owner:'jules'}])).status,400);
  const stale=current.revision;
  current=await (await rpc('dev','claimTask',[child.id])).json();
  const conflict=await demoWrite('maya',{method:'addDependency',args:['dietary',{title:'Stale follow-up'}],revision:stale});
  assert.equal(conflict.status,409);
  current=await (await rpc('dev','reportCompletion',[child.id,'Budget approved: $50 for guest calls.'])).json();
  assert.match(current.state.tasks.find(t=>t.id==='dietary').comments.at(-1).text,/Budget approved: \$50/);
  current=await (await rpc('maya','resumeTask',['dietary'])).json();
  assert.equal(current.state.tasks.find(t=>t.id==='dietary').status,'progress');
  assert.equal((await (await demoRead('jules')).json()).state.tasks.find(t=>t.id==='dietary').status,'progress');
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});

test('demo blocker naming reuses one task and cannot overwrite a concurrent claim', async () => {
  owner();
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  let current=await (await demoRead()).json();
  const rpc=async(actor,method,args)=>{
    const response=await demoWrite(actor,{method,args,revision:current.revision});
    assert.equal(response.status,200,await response.clone().text());
    current=await response.json(); return current.result;
  };
  const parent=await rpc('jack','addTask',[{title:'Inspect stage',owner:'dev',status:'blocked',note:'Need an inspection.'}]);
  const id=parent.dependencies[0].taskId;
  const named=await rpc('dev','addDependency',[parent.id,{title:'Inspect the stage supports'}]);
  assert.equal(named.id,id);
  assert.equal(current.state.tasks.find(t=>t.id===parent.id).dependencies.length,1);
  const other=await rpc('jack','addTask',[{title:'Arrange lights',owner:'dev',status:'blocked',note:'Need help.'}]);
  const followup=other.dependencies[0].taskId, stale=current.revision;
  await rpc('jules','claimTask',[followup]);
  const response=await demoWrite('dev',{method:'addDependency',args:[other.id,{title:'Inspect the fuse box'}],revision:stale});
  assert.equal(response.status,409);
  const reloaded=await (await demoRead('dev')).json();
  assert.equal(reloaded.state.tasks.find(t=>t.id===followup).owner,'jules');
  assert.equal(reloaded.state.tasks.find(t=>t.id===other.id).dependencies.length,1);
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});

test('handoff RPC persists suggestions, enforces assignment permissions and resolves atomically in the full demo',async()=>{
 owner();const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
 let current=await (await demoRead()).json();
 const rpc=async(actor,method,args)=>{const response=await demoWrite(actor,{method,args,revision:current.revision});assert.equal(response.status,200,await response.clone().text());current=await response.json();return current.result;};
 const parent=await rpc('jack','addTask',[{title:'Handoff API check-in desk',owner:'dev',status:'progress'}]);
 await rpc('dev','updateTask',[parent.id,{status:'progress',note:'I need Jules to print the API name badges.'}]);
 const suggestion=current.state.tasks.find(t=>t.id===parent.id).handoffs[0];assert.equal(suggestion.owner,'jules');
 for(const [actor,args,status] of [
  ['maya',[parent.id,suggestion.id,{action:'dismiss'}],403],
  ['dev',[parent.id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'}],403],
  ['dev',[parent.id,suggestion.id,{action:'create',title:suggestion.title,actor:'jack'}],400],
  ['dev',[parent.id,suggestion.id,{action:'create',title:suggestion.title},'jack'],400],
 ])assert.equal((await demoWrite(actor,{method:'resolveHandoff',args,revision:current.revision})).status,status);
 const stale=current.revision,args=[parent.id,suggestion.id,{action:'create',title:suggestion.title,owner:''}];
 const responses=await Promise.all([demoWrite('dev',{method:'resolveHandoff',args,revision:stale}),demoWrite('dev',{method:'resolveHandoff',args,revision:stale})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);current=await responses.find(r=>r.status===200).json();const child=current.result;
 assert.equal(child.owner,'');assert.equal(current.state.tasks.find(t=>t.id===parent.id).status,'progress');
 const retried=await rpc('dev','resolveHandoff',args);assert.equal(retried.id,child.id);assert.equal(current.state.tasks.filter(t=>t.title===suggestion.title).length,1);
 await rpc('jules','claimTask',[child.id]);await rpc('jules','reportCompletion',[child.id,'API name badges printed.']);
 assert.ok(current.state.tasks.find(t=>t.id===parent.id).comments.some(c=>c.kind==='dependency-result'&&c.text.includes('API name badges printed')));
 const reloaded=await (await demoRead('maya')).json();assert.equal(reloaded.state.tasks.find(t=>t.id===parent.id).handoffs[0].status,'accepted');
 assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
});

test('organizer can confirm a suggested owner and explicit associations keep existing task ownership',async()=>{
 owner();let current=await (await demoRead()).json();
 const rpc=async(actor,method,args)=>{const response=await demoWrite(actor,{method,args,revision:current.revision});assert.equal(response.status,200,await response.clone().text());current=await response.json();return current.result;};
 const parent=await rpc('jack','addTask',[{title:'Coordinate API signage',owner:'dev',status:'progress'}]);
 await rpc('maya','addComment',[parent.id,'Jules needs to print the API venue maps.']);let suggestion=current.state.tasks.find(t=>t.id===parent.id).handoffs.find(h=>h.status==='pending');
 const created=await rpc('jack','resolveHandoff',[parent.id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'}]);assert.equal(created.owner,'jules');assert.equal(created.acceptedAt,'');
 await rpc('dev','addComment',[parent.id,'This is associated with Collect dietary needs.']);suggestion=current.state.tasks.find(t=>t.id===parent.id).handoffs.find(h=>h.status==='pending');
 const target=JSON.stringify(current.state.tasks.find(t=>t.id==='dietary'));
 await rpc('dev','resolveHandoff',[parent.id,suggestion.id,{action:'link',taskId:'dietary'}]);assert.equal(JSON.stringify(current.state.tasks.find(t=>t.id==='dietary')),target);
 assert.equal(current.state.tasks.find(t=>t.id===parent.id).dependencies.find(l=>l.taskId==='dietary').kind,'related');
});

test('demo booking storage is isolated, organizer-only and absent from exports', async () => {
  owner();
  const originals=sqlite.prepare('SELECT * FROM private_records ORDER BY id').all();
  const gmail=sqlite.prepare('SELECT * FROM gmail_connections ORDER BY user_id').all();
  const url='/api/demo?as=jack&resource=private&action=records';
  const response=await demoApi.GET(new Request('https://gather.example'+url));
  assert.equal(response.status,200);
  const {records,revision}=await response.json();
  assert.equal(records.length,2);
  const data={...records[0],reference:'DEMO-CHANGED',revision};
  assert.equal((await demoApi.POST(request(url,data))).status,200);
  assert.equal((await (await demoApi.GET(new Request('https://gather.example'+url))).json()).records[0].reference,'DEMO-CHANGED');
  for(const actor of ['maya','jules','dev']){
    const path=url.replace('as=jack','as='+actor);
    assert.equal((await demoApi.GET(new Request('https://gather.example'+path))).status,403);
    assert.equal((await demoApi.POST(request(path,data))).status,403);
    assert.ok(!(await (await demoRead(actor)).text()).includes('DEMO-CHANGED'));
  }
  const shared=await (await demoRead()).json();
  assert.ok(!JSON.stringify(shared.exportState).includes('DEMO-'));
  assert.ok(!sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('demo-bookings:owner-1').data.includes('DEMO-CHANGED'));
  assert.deepEqual(sqlite.prepare('SELECT * FROM private_records ORDER BY id').all(),originals);
  assert.deepEqual(sqlite.prepare('SELECT * FROM gmail_connections ORDER BY user_id').all(),gmail);
  assert.equal((await demoWrite('jack',{method:'resetDemo',args:[true],revision:shared.revision})).status,200);
  assert.equal((await (await demoApi.GET(new Request('https://gather.example'+url))).json()).records[0].reference,'DEMO-FLIGHT-24');
  assert.equal((await demoApi.POST(request(url,data))).status,409,'Old forms cannot resurrect pre-reset bookings');
  const fresh=await (await demoApi.GET(new Request('https://gather.example'+url))).json();
  const concurrent=await Promise.all(['one','two'].map(title=>demoApi.POST(request(url,{title,type:'Hotel',reference:'DEMO-'+title,revision:fresh.revision}))));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
});

test('real workspace claims use authenticated actor, not a submitted persona',async()=>{
  owner();
  const before=await(await workspace.GET(new Request('https://gather.example/api/workspace'))).json();
  const data={method:'claimTask',args:['wayfinding'],revision:before.revision};
  const res=await workspace.POST(request('/api/workspace',data));
  assert.equal(res.status,200);
  assert.equal((await res.json()).result.acceptedBy,'jack');
  assert.equal((await workspace.POST(request('/api/workspace',data))).status,409);
});

test('private booking edits reject stale versions and concurrent saves without losing newer details',async()=>{
  owner();
  const created=await privateApi.POST(request('/api/private/records',{title:'Concurrent booking',type:'Hotel',reference:'QA-REFERENCE'}));
  assert.equal(created.status,200);
  const {id}=await created.json();
  const list=async()=> (await (await privateApi.GET(new Request('https://gather.example/api/private/records'))).json()).records;
  const initial=(await list()).find(r=>r.id===id);
  assert.match(initial.version,/^[a-f0-9]{64}$/);
  const responses=await Promise.all(['first','second'].map(provider=>privateApi.POST(request('/api/private/records',{...initial,provider}))));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const saved=(await list()).find(r=>r.id===id);
  assert.notEqual(saved.version,initial.version);
  assert.equal((await privateApi.POST(request('/api/private/records',{...initial,provider:'stale'}))).status,409);
  assert.equal((await list()).find(r=>r.id===id).provider,saved.provider);
  assert.equal((await privateApi.POST(request('/api/private/records',{...saved,version:undefined}))).status,409);
  assert.equal((await privateApi.POST(request('/api/private/records',{...saved,provider:'updated safely'}))).status,200);
  assert.ok(!(await (await workspace.GET(new Request('https://gather.example/api/workspace'))).text()).includes('QA-REFERENCE'));
});

test('Gmail review retries are idempotent but conflicting summaries cannot silently disappear',async()=>{
  owner();
  const data={id:'mail-1',taskId:'bus',title:'Speaker arrival',summary:'Transport is confirmed.',confirmShared:true};
  const first=await gmailApi.POST(request('/api/gmail/review',data));
  assert.equal(first.status,200);
  const duplicate=await first.json();
  for(const patch of [{title:'Corrected arrival'},{summary:'Transport is cancelled.'},{taskId:'dietary'}]){
    const res=await gmailApi.POST(request('/api/gmail/review',{...data,...patch}));
    assert.equal(res.status,409);
    assert.match((await res.json()).error,/already saved/);
  }
  const shared=(await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json()).state.messages.filter(m=>m.externalId==='review:mail-1');
  assert.equal(shared.length,1);assert.equal(shared[0].id,duplicate.id);
  assert.equal(shared[0].body,data.summary);
});

test('OAuth profile failure preserves the previous connection and a successful callback saves the verified account atomically',async()=>{
  owner();
  const previous={accessToken:'old-access',refreshToken:'old-refresh',email:'original@example.com',labelId:'old-label',expiresAt:Date.now()+3600000};
  const originalPayload=await security.seal(previous,'gmail:owner-1');
  await db.prepare('INSERT INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?)').bind('owner-1',originalPayload,'old-generation').run();
  const start=async()=>new URL((await (await gmailApi.POST(request('/api/gmail/connect',{}))).json()).url).searchParams.get('state');
  const originalFetch=globalThis.fetch;
  let failProfile=true;
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
    assert.equal(String(url),'https://gmail.googleapis.com/gmail/v1/users/me/profile');
    assert.equal(options.headers.Authorization,'Bearer new-access');
    return failProfile?Response.json({error:'unavailable'},{status:503}):Response.json({emailAddress:'new@example.com'});
  };
  try{
    const state=await start();
    const failed=await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state='+state+'&code=fixture-code'));
    assert.equal(failed.status,502);
    assert.equal(sqlite.prepare('SELECT payload FROM gmail_connections WHERE user_id=?').get('owner-1').payload,originalPayload);
    assert.ok(sqlite.prepare('SELECT id FROM oauth_states WHERE id=?').get(state));
    failProfile=false;
    const nextState=await start();
    const succeeded=await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state='+nextState+'&code=new-fixture-code'));
    assert.equal(succeeded.status,303);
    const current=await gmailCore.connection('owner-1');
    assert.equal(current.email,'new@example.com');assert.equal(current.accessToken,'new-access');
    assert.notEqual(current.generation,'old-generation');
    assert.equal(sqlite.prepare('SELECT id FROM oauth_states WHERE id=?').get(nextState),undefined);
  }finally{
    globalThis.fetch=originalFetch;
    await db.prepare('DELETE FROM gmail_connections WHERE user_id=?').bind('owner-1').run();
  }
});

const resourceRead=(query='taskId=bus')=>resourcesApi.GET(new Request('https://gather.example/api/resources?'+query));

test('Gmail label validation cannot cross a reconnection',async()=>{
  owner();const originalFetch=globalThis.fetch;
  const save=async(email,generation)=>db.prepare('INSERT INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,generation=excluded.generation').bind('owner-1',await security.seal({accessToken:'fixture',email,expiresAt:Date.now()+3600000,labelId:''},'gmail:owner-1'),generation).run();
  try{
    await save('old@example.com','label-old');
    globalThis.fetch=async()=>{await save('new@example.com','label-new');return Response.json({labels:[{id:'OLD_ONLY',type:'user'}]});};
    const result=await gmailApi.POST(request('/api/gmail/label',{labelId:'OLD_ONLY'}));
    assert.equal(result.status,409);assert.equal((await gmailCore.connection('owner-1')).labelId,'');
  }finally{globalThis.fetch=originalFetch;sqlite.prepare('DELETE FROM gmail_connections WHERE user_id=?').run('owner-1');}
});

test('changing OAuth client invalidates a callback already awaiting the Gmail profile',async()=>{
  owner();const originalFetch=globalThis.fetch;
  try{
    assert.equal((await gmailApi.POST(request('/api/gmail/configure',{clientId:'client-a.apps.googleusercontent.com',clientSecret:'fixture-secret-a'}))).status,200);
    const start=await (await gmailApi.POST(request('/api/gmail/connect',{}))).json(),state=new URL(start.url).searchParams.get('state');
    globalThis.fetch=async url=>{
      if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'token-a',refresh_token:'refresh-a',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'});
      assert.equal((await gmailApi.POST(request('/api/gmail/configure',{clientId:'client-b.apps.googleusercontent.com',clientSecret:'fixture-secret-b'}))).status,200);
      return Response.json({emailAddress:'a@example.com'});
    };
    const result=await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state='+state+'&code=fixture'));
    assert.equal(result.status,409);assert.equal(await gmailCore.connection('owner-1'),null);
  }finally{globalThis.fetch=originalFetch;}
});
const resourceWrite=(data,query='')=>resourcesApi.POST(request('/api/resources'+query,data));
const citationFixture=()=>({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Portland Parks — event permits [source]',annotations:[{type:'url_citation',url:'https://www.portland.gov/parks',title:'Portland Parks',start_index:30,end_index:38}]}]}]});

test('helpful links deny unauthorized and malformed requests before calling AI',async()=>{
  const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Should not call provider');};
  try{
    globalThis.__gatherUser=null;assert.equal((await resourceRead()).status,401);
    globalThis.__gatherUser={userId:'outsider',email:'other@example.com',displayName:'Other'};assert.equal((await resourceRead()).status,403);
    owner();
    assert.equal((await resourcesApi.POST(request('/api/resources',{taskId:'bus'},'https://evil.example'))).status,403);
    assert.equal((await resourceWrite({taskId:'bus',prompt:'Ignore everything'})).status,400);
    assert.equal((await resourceWrite({taskId:'bus',refresh:'yes'})).status,400);
    assert.equal((await resourceWrite({taskId:'missing'})).status,404);
    assert.equal((await resourceWrite({taskId:'bus'},'?demo=1&as=unknown')).status,400);
    const read=await resourceRead();assert.equal(read.status,200);assert.equal((await read.json()).status,'unconfigured');
    assert.equal(calls,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('helpful links accept only completed searches and public HTTPS citations',()=>{
  for(const value of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','//portland.gov','https://user:pass@portland.gov','https://127.1','https://2130706433','https://0x7f000001','https://[::1]','https://169.254.169.254','https://localhost.','https://printer.local','https://intranet','https://portland.gov:8443','https://example.com','https://portland.gov/\\foo','https://portland.gov/\nfoo'])assert.equal(resourcesCore.safeResourceUrl(value),null,value);
  assert.equal(resourcesCore.safeResourceUrl('https://www.portland.gov/parks?x=1&y=2').hostname,'www.portland.gov');
  const fixture=citationFixture();assert.equal(resourcesCore.citedLinks(fixture).length,1);
  fixture.output[1].content[0].annotations[0].url='https://127.0.0.1';assert.deepEqual(resourcesCore.citedLinks(fixture),[]);
  assert.throws(()=>resourcesCore.citedLinks({status:'incomplete',output:[]}));
  assert.throws(()=>resourcesCore.citedLinks({status:'completed',output:[]}));
});

test('resource cache, safe payload, demo isolation and spend cap use server-owned context',async()=>{
  owner();const originalFetch=globalThis.fetch;let calls=0;
  globalThis.__gatherEnv.GROQ_API_KEY='fixture-only-key';globalThis.__gatherEnv.GROQ_WEB_SEARCH_ENABLED='verified';
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(url,'https://api.groq.com/openai/v1/responses');
    const payload=JSON.parse(options.body),context=JSON.parse(payload.input);
    assert.deepEqual(Object.keys(context),['task','category','cityOrRegion']);
    assert.equal(payload.store,undefined);assert.equal(payload.tool_choice,'required');
    assert.ok(!options.body.includes('SECRET-NOTE'));
    return Response.json(citationFixture());
  };
  try{
    const read=await resourceRead();assert.equal((await read.json()).status,'empty');assert.equal(calls,0);
    let response=await resourceWrite({taskId:'bus',location:'Portland, Oregon'});assert.equal(response.status,200);let data=await response.json();assert.equal(data.status,'ready');assert.equal(data.links.length,1);assert.equal(calls,1);
    await resourceWrite({taskId:'bus'});assert.equal(calls,1);
    assert.equal((await (await resourceRead()).json()).location,'Portland, Oregon');assert.equal(calls,1);
    await resourceWrite({taskId:'bus',refresh:true});assert.equal(calls,1);
    response=await resourceWrite({taskId:'bus'},'?demo=1&as=maya');assert.equal(response.status,200);assert.equal(calls,2);
    assert.equal((await (await resourceRead('demo=1&as=jules&taskId=bus')).json()).status,'ready');
    const real=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
    assert.ok(!real.includes('www.portland.gov'));
    let demo=await (await demoRead()).json();await demoWrite('jack',{method:'resetDemo',args:[true],revision:demo.revision});
    assert.equal((await (await resourceRead('demo=1&as=maya&taskId=bus')).json()).status,'empty');
    assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,real);
    const quota='owner-1:'+new Date().toISOString().slice(0,10),count=sqlite.prepare('SELECT count FROM resource_usage WHERE id=?').get(quota).count;
    sqlite.prepare('UPDATE resource_usage SET count=25 WHERE id=?').run(quota);
    response=await resourceWrite({taskId:'bus'},'?demo=1&as=maya');assert.equal(response.status,429);assert.equal(calls,2);
    sqlite.prepare('UPDATE resource_usage SET count=? WHERE id=?').run(count,quota);
    const task={id:'safe-payload',title:'Venue permits',category:'Venue',note:'SECRET-NOTE',comments:['SECRET-NOTE'],owner:'private-person'};
    await resourcesCore.taskResources('payload-test','owner-1',task,{});assert.equal(calls,3);
  }finally{delete globalThis.__gatherEnv.GROQ_API_KEY;delete globalThis.__gatherEnv.GROQ_WEB_SEARCH_ENABLED;globalThis.fetch=originalFetch;}
});

test('Groq search is gated independently of its API key and preserves safe cached links', async () => {
  const originalFetch=globalThis.fetch;
  globalThis.__gatherEnv.GROQ_API_KEY='fixture-only-key';
  delete globalThis.__gatherEnv.GROQ_WEB_SEARCH_ENABLED;
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Search remains gated');};
  try {
    const result=await resourceWrite({taskId:'bus',refresh:true});
    assert.equal(result.status,200);
    const data=await result.json();
    assert.equal(data.status,'unconfigured');
    assert.equal(data.links.length,1);
    assert.equal(calls,0);
  } finally {delete globalThis.__gatherEnv.GROQ_API_KEY;globalThis.fetch=originalFetch;}
});

test('concurrent resource readers share one lookup; provider failures never expose details',async()=>{
  const originalFetch=globalThis.fetch;globalThis.__gatherEnv.GROQ_API_KEY='fixture-only-key';globalThis.__gatherEnv.GROQ_WEB_SEARCH_ENABLED='verified';let calls=0,release,notify;
  const started=new Promise(resolve=>notify=resolve);
  globalThis.fetch=async()=>{calls++;notify();await new Promise(resolve=>release=resolve);return Response.json(citationFixture());};
  const task={id:'concurrent-resource',title:'Find a venue',category:'Venue'};
  try{
    const first=resourcesCore.taskResources('concurrency','owner-1',task,{});await started;
    const second=await resourcesCore.taskResources('concurrency','owner-1',task,{});assert.equal(second.status,'loading');assert.equal(calls,1);
    release();assert.equal((await first).status,'ready');
    assert.equal((await resourcesCore.taskResources('concurrency','owner-1',task)).status,'ready');
    globalThis.fetch=async()=>{throw new Error('SECRET provider key and task details');};
    await assert.rejects(resourcesCore.taskResources('failure','owner-1',task,{}),error=>error.status===503&&!error.message.includes('SECRET'));
    const cached=await resourcesCore.taskResources('failure','owner-1',task);assert.equal(cached.status,'error');assert.ok(!JSON.stringify(cached).includes('SECRET'));
  }finally{delete globalThis.__gatherEnv.GROQ_API_KEY;delete globalThis.__gatherEnv.GROQ_WEB_SEARCH_ENABLED;globalThis.fetch=originalFetch;}
});

const infoRead=(query='')=>infoApi.GET(new Request('https://gather.example/api/info'+query));
const infoWrite=(data,query='')=>infoApi.POST(request('/api/info'+query,data));
const infoContext=scope=>({scope,userId:'upload-test-'+scope,actor:'jack',name:'Jack',admin:true,demoId:'',generation:''});
const uploadRequest=(revision,name='list.txt',content='Private guest details',query='',id=crypto.randomUUID(),origin='https://gather.example')=>{
  const form=new FormData();form.set('file',new Blob([content]),name);form.set('revision',revision);form.set('requestId',id);
  return new Request('https://gather.example/api/info?upload=1'+query,{method:'POST',headers:{Origin:origin,'X-Gather-Request':'1'},body:form});
};

test('event info denies anonymous, outsiders, actor injection and cross-origin writes',async()=>{
  globalThis.__gatherUser=null;assert.equal((await infoRead()).status,401);
  globalThis.__gatherUser={userId:'guest-only',email:'attendee@example.com',displayName:'Attendee'};
  assert.equal((await infoRead()).status,403);
  owner();const state=await (await infoRead()).json();assert.equal(state.guests.length,0);
  assert.equal((await infoWrite({action:'add',guest:{name:'A'},actor:'jack',revision:state.revision,requestId:crypto.randomUUID()})).status,400);
  assert.equal((await infoApi.POST(request('/api/info',{action:'preview',csv:'Name\nA',revision:state.revision},'https://evil.example'))).status,403);
  assert.equal((await infoApi.POST(uploadRequest(state.revision,'x.txt','x','',crypto.randomUUID(),'https://evil.example'))).status,403);
});
test('guest preview is read-only, imports are atomic, deduplicated and idempotent',async()=>{
  owner();let state=await (await infoRead()).json();const before=state.revision;
  const csv='Name,Email,Type\nPrivate Guest,private-guest@example.com,speaker\nDuplicate,PRIVATE-GUEST@example.com,attendee\nNo email,,attendee';
  const preview=await (await infoWrite({action:'preview',csv,revision:before})).json();assert.equal(preview.added,2);assert.equal(preview.duplicates,1);
  assert.equal((await (await infoRead()).json()).revision,before);
  const bad={action:'import',csv:'Name,Email\nValid,v@example.com\nInvalid,no-email',filename:'bad.csv',revision:before,requestId:crypto.randomUUID()};
  assert.equal((await infoWrite(bad)).status,400);assert.equal((await (await infoRead()).json()).guests.length,0);
  const input={action:'import',csv,filename:'guests.csv',revision:before,requestId:crypto.randomUUID()};
  state=await (await infoWrite(input)).json();assert.equal(state.guests.length,2);assert.equal(state.revision,before+1);
  assert.deepEqual(await (await infoWrite(input)).json(),state);
  assert.equal((await infoWrite({...input,csv:'Name\nDifferent'})).status,409);
  assert.equal((await infoWrite({...input,requestId:crypto.randomUUID()})).status,409);
  assert.ok(!JSON.stringify(await (await workspace.GET(new Request('https://gather.example/api/workspace'))).json()).includes('private-guest@example.com'));
  const raw=sqlite.prepare('SELECT payload FROM project_info WHERE scope=?').get('main').payload;
  assert.ok(!raw.includes('Private Guest'));assert.ok(!raw.includes('private-guest@example.com'));
});
test('valid CSV with JSON escaping remains within the route-specific request envelope',async()=>{
  owner();const state=await (await infoRead()).json();
  const csv='Name,Notes\n'+Array.from({length:70},(_,i)=>'Guest '+i+','+'\\'.repeat(490)).join('\n');
  assert.ok(Buffer.byteLength(csv)<40000);assert.ok(JSON.stringify({csv}).length>50000);
  const response=await infoWrite({action:'preview',csv,revision:state.revision});assert.equal(response.status,200);assert.equal((await response.json()).added,70);
});
test('team members can contribute guests but only organizers can archive them',async()=>{
  owner();let state=await (await infoRead('?demo=1&as=maya')).json();
  state=await (await infoWrite({action:'add',guest:{name:'Team contribution'},revision:state.revision,requestId:crypto.randomUUID()},'?demo=1&as=maya')).json();
  const guest=state.guests.find(g=>g.name==='Team contribution');assert.equal(guest.createdBy,'maya');
  const archive={action:'archiveGuest',id:guest.id,archived:true,revision:state.revision,requestId:crypto.randomUUID()};
  assert.equal((await infoWrite(archive,'?demo=1&as=maya')).status,403);
  state=await (await infoWrite(archive,'?demo=1&as=jack')).json();assert.ok(state.guests.find(g=>g.id===guest.id).archivedAt);
  const restore=await infoWrite({...archive,archived:false,revision:state.revision,requestId:crypto.randomUUID()},'?demo=1&as=jack');assert.equal(restore.status,200);
  assert.equal((await infoRead('?demo=1&as=unknown')).status,400);
});
test('uploads are encrypted, authenticated attachments with idempotent retries',async()=>{
  owner();let state=await (await infoRead()).json();const id=crypto.randomUUID(),revision=state.revision;
  const payload='Private file content '+ 'x'.repeat(1024*1024);
  let response=await infoApi.POST(uploadRequest(revision,'attendee-list.txt',payload,'',id));assert.equal(response.status,200);
  state=await response.json();const file=state.files.at(-1);assert.equal(file.key,undefined);assert.equal(file.size,Buffer.byteLength(payload));
  const object=uploadedObjects.get('project-files/'+file.id);assert.ok(object);assert.ok(!Buffer.from(object).includes(Buffer.from('Private file content')));
  response=await infoRead('?file='+file.id);assert.equal(response.status,200);assert.equal(await response.text(),payload);
  assert.match(response.headers.get('content-disposition'),/^attachment/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('cache-control'),/no-store/);
  const replay=await infoApi.POST(uploadRequest(revision,'attendee-list.txt',payload,'',id));assert.equal(replay.status,200);assert.equal((await replay.json()).files.length,state.files.length);
  assert.equal((await infoRead('?demo=1&as=jack&file='+file.id)).status,404);
  globalThis.__gatherUser=null;assert.equal((await infoRead('?file='+file.id)).status,401);owner();
  state=await (await infoWrite({action:'archiveFile',id:file.id,archived:true,revision:state.revision,requestId:crypto.randomUUID()})).json();assert.equal((await infoRead('?file='+file.id)).status,404);
  await infoWrite({action:'archiveFile',id:file.id,archived:false,revision:state.revision,requestId:crypto.randomUUID()});assert.equal((await infoRead('?file='+file.id)).status,200);
});
test('uploads reject unsupported, empty and oversized actual bodies',async()=>{
  owner();const state=await (await infoRead()).json();
  for(const [name,content,status] of [['x.html','<script>x</script>',400],['empty.txt','',400],['limit.txt',new Uint8Array(4*1024*1024+1),400],['big.txt',new Uint8Array(6*1024*1024),413]]){
    const source=uploadRequest(state.revision,name,content);
    // Materialize test transport: Node's FormData producer errors on early stream cancellation.
    const incoming=new Request(source.url,{method:'POST',headers:source.headers,body:await source.arrayBuffer()});
    assert.equal((await infoApi.POST(incoming)).status,status);
  }
  assert.equal((await (await infoRead()).json()).revision,state.revision);
});
test('simultaneous identical upload retries keep exactly one winning object',async()=>{
  const context=infoContext('upload-race'),state=await infoCore.readInfo(context),id=crypto.randomUUID();
  const input={bytes:new TextEncoder().encode('Simultaneous retry').buffer,name:'retry.txt',revision:state.revision,requestId:id};
  const before=uploadedObjects.size;
  const results=await Promise.all([infoCore.uploadInfo(context,input),infoCore.uploadInfo(context,input)]);
  assert.equal(results[0].files.length,1);assert.equal(results[1].files.length,1);assert.equal(results[0].files[0].id,results[1].files[0].id);
  assert.equal(uploadedObjects.size,before+1);assert.equal(await (await infoCore.downloadInfo(context,results[0].files[0].id)).text(),'Simultaneous retry');
});
test('upload metadata committed before a transport error never loses its bytes',async()=>{
  const context=infoContext('ambiguous-upload'),state=await infoCore.readInfo(context);
  let failed=false;
  globalThis.__gatherEnv.DB={...db,prepare(sql){const statement=db.prepare(sql),run=statement.run;statement.run=async()=>{const result=await run();if(!failed&&sql.startsWith('UPDATE project_info')){failed=true;throw new Error('Response lost after commit');}return result;};return statement;}};
  try{
    const result=await infoCore.uploadInfo(context,{bytes:new TextEncoder().encode('Retained content').buffer,name:'keep.txt',revision:state.revision,requestId:crypto.randomUUID()});
    assert.equal(result.files.length,1);assert.equal(await (await infoCore.downloadInfo(context,result.files[0].id)).text(),'Retained content');
  }finally{globalThis.__gatherEnv.DB=db;}
});
test('demo reset isolates guest records and files without touching real event info',async()=>{
  owner();const real=await (await infoRead()).json(),context=await infoCore.infoContext(new Request('https://gather.example/api/info?demo=1&as=maya'));
  let state=await (await infoRead('?demo=1&as=maya')).json();
  state=await (await infoApi.POST(uploadRequest(state.revision,'demo.txt','Demo only','&demo=1&as=maya'))).json();const file=state.files.at(-1);
  assert.equal((await infoWrite({action:'archiveFile',id:file.id,archived:true,revision:state.revision,requestId:crypto.randomUUID()},'?demo=1&as=jules')).status,403);
  assert.equal((await infoRead('?demo=1&as=jules&file='+file.id)).status,200);
  const demo=await (await demoRead()).json();assert.equal((await demoWrite('jack',{method:'resetDemo',args:[true],revision:demo.revision})).status,200);
  assert.equal((await infoRead('?demo=1&as=maya&file='+file.id)).status,404);
  assert.equal((await (await infoRead('?demo=1&as=maya')).json()).guests.length,2);
  await assert.rejects(infoCore.mutateInfo(context,{action:'add',guest:{name:'Stale write'},revision:state.revision,requestId:crypto.randomUUID()}),error=>error.status===409);
  assert.deepEqual(await (await infoRead()).json(),real);
});
test('storage quota includes archived and previous demo files',async()=>{
  const context=infoContext('quota-upload'),state=await infoCore.readInfo(context),reservation=crypto.randomUUID();
  sqlite.prepare('INSERT INTO project_uploads (id,account_id,size) VALUES (?,?,?)').run(reservation,context.userId,50*1024*1024);
  try{await assert.rejects(infoCore.uploadInfo(context,{bytes:new Uint8Array([1]).buffer,name:'limit.txt',revision:state.revision,requestId:crypto.randomUUID()}),error=>error.status===409);}finally{sqlite.prepare('DELETE FROM project_uploads WHERE id=?').run(reservation);}
});

test('new projects are empty, persistent and idempotent without changing the original plan',async()=>{
  owner();
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  const input={requestId:crypto.randomUUID(),event:{name:'Separate retreat',location:'North hall',guestCount:30}};
  const first=await projectsApi.POST(request('/api/projects',input));assert.equal(first.status,201);
  const {id}=await first.json();
  assert.equal((await (await projectsApi.POST(request('/api/projects',input))).json()).id,id);
  assert.equal((await projectsApi.POST(request('/api/projects',{...input,event:{name:'Conflicting retry'}}))).status,409);
  const state=await (await workspace.GET(new Request('https://gather.example/api/workspace?project='+id))).json();
  assert.equal(state.projectId,id);assert.equal(state.state.event.name,'Separate retreat');assert.equal(state.state.tasks.length,0);assert.equal(state.state.messages.length,0);assert.equal(state.state.members.length,1);
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
  const list=(await (await projectsApi.GET()).json()).projects;
  assert.equal(list.filter(project=>project.id===id).length,1);assert.ok(list.some(project=>project.id==='main'));assert.ok(!list.some(project=>project.id.startsWith('demo')));
  assert.equal((await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name:'   '}}))).status,400);
  assert.equal((await projectsApi.POST(request('/api/projects',input,'https://evil.example'))).status,403);
});
test('a distinct organizer gets a project-local owner identity without changing global identity or other projects',async()=>{
  owner();
  await workspace.GET(new Request('https://gather.example/api/workspace'));
  const original=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  const user={userId:'distinct-organizer',email:'distinct@example.com',displayName:'Distinct Organizer'};
  sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run(user.userId,'u_distinct',user.email,user.displayName,'admin');
  globalThis.__gatherUser=user;
  try {
    const input={requestId:crypto.randomUUID(),event:{name:'Distinct organizer event',guestCount:40}};
    const created=await projectsApi.POST(request('/api/projects',input));
    assert.equal(created.status,201);
    const {id}=await created.json();
    assert.equal((await (await projectsApi.POST(request('/api/projects',input))).json()).id,id);
    const path='/api/workspace?project='+id;
    let snapshot=await (await workspace.GET(new Request('https://gather.example'+path))).json();
    assert.equal(snapshot.identity.actorId,'jack');
    assert.equal(snapshot.identity.role,'admin');
    assert.equal(snapshot.state.members.length,1);
    assert.equal(snapshot.state.members[0].id,'jack');
    assert.equal(snapshot.state.members[0].name,user.displayName);
    assert.equal(snapshot.state.members[0].role,'Organizer');
    const changed=await workspace.POST(request(path,{method:'addTask',args:[{title:'Owner task',owner:'jack'}],revision:snapshot.revision}));
    assert.equal(changed.status,200);
    snapshot=await (await workspace.GET(new Request('https://gather.example'+path))).json();
    assert.equal(snapshot.state.tasks[0].owner,'jack');
    assert.equal(snapshot.state.tasks[0].updatedBy,'jack');
    assert.deepEqual((await (await projectsApi.GET()).json()).projects.map(project=>project.id),[id]);
    assert.equal((await workspace.GET(new Request('https://gather.example/api/workspace'))).status,404);
    assert.equal(sqlite.prepare('SELECT actor_id FROM members WHERE user_id=?').get(user.userId).actor_id,'u_distinct');
    assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,original);
    owner();
    assert.equal((await workspace.GET(new Request('https://gather.example'+path))).status,404);
  } finally { owner(); }
});
test('tasks, guests, files, bookings and reviewed email stay in their selected project',async()=>{
  owner();
  const create=async name=>(await (await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name}}))).json()).id;
  const a=await create('Project A'),b=await create('Project B');
  const read=async id=>(await workspace.GET(new Request('https://gather.example/api/workspace?project='+id))).json();
  const before=await read('main');
  let state=await read(a);
  const update=await workspace.POST(request('/api/workspace?project='+a,{method:'addTask',args:[{title:'Only in A',owner:'jack',status:'todo',category:'Logistics'}],revision:state.revision}));
  assert.equal(update.status,200);state=await update.json();const task=state.state.tasks[0];
  assert.equal((await read(b)).state.tasks.length,0);
  let info=await (await infoRead('?project='+a)).json();
  info=await (await infoWrite({action:'add',guest:{name:'A guest'},revision:info.revision,requestId:crypto.randomUUID()},'?project='+a)).json();
  assert.equal(info.guests.length,1);assert.equal((await (await infoRead('?project='+b)).json()).guests.length,0);
  info=await (await infoApi.POST(uploadRequest(info.revision,'a-only.txt','Project A content','&project='+a))).json();
  const file=info.files[0];assert.ok(file);
  assert.equal((await infoRead('?project='+a+'&file='+file.id)).status,200);
  assert.equal((await infoRead('?project='+b+'&file='+file.id)).status,404);
  const created=await privateApi.POST(request('/api/private/records?project='+a,{title:'A booking',type:'Hotel',reference:'A-ONLY',taskId:task.id}));assert.equal(created.status,200);
  const privateRead=async id=>(await (await privateApi.GET(new Request('https://gather.example/api/private/records?project='+id))).json()).records;
  const record=(await privateRead(a))[0];assert.equal(record.reference,'A-ONLY');assert.equal((await privateRead(b)).length,0);
  assert.equal((await privateApi.POST(request('/api/private/records?project='+b,{...record,taskId:'',reference:'OVERWRITE'}))).status,404);
  assert.equal((await privateApi.POST(request('/api/private/records?project='+b,{title:'Wrong task',type:'Hotel',reference:'B',taskId:task.id}))).status,400);
  const review=await gmailApi.POST(request('/api/gmail/review?project='+a,{id:'mail-1',title:'A update',summary:'Only project A receives this update.',confirmShared:true,taskId:task.id}));assert.equal(review.status,200);
  assert.equal((await read(a)).state.messages.length,1);assert.equal((await read(b)).state.messages.length,0);
  assert.deepEqual((await read('main')).state,before.state);
  assert.equal((await resourcesApi.GET(new Request('https://gather.example/api/resources?project='+b+'&taskId='+task.id))).status,404);
});
test('unknown, internal and other-owner project IDs cannot read or mutate project data',async()=>{
  owner();const id=(await (await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name:'Private project'}}))).json()).id;
  const invalid=['demo:owner-1','demo-bookings:owner-1','p_'+crypto.randomUUID(),''];
  sqlite.prepare('INSERT OR IGNORE INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run('project-audit-member','maya','member@example.com','Member','member');
  const member=sqlite.prepare('SELECT user_id FROM members WHERE user_id=?').get('project-audit-member');assert.ok(member);
  globalThis.__gatherUser={userId:member.user_id,email:'member@example.com',displayName:'Member'};
  invalid.push(id,'main');
  for(const project of invalid){
    const query='?project='+encodeURIComponent(project);
    assert.equal((await workspace.GET(new Request('https://gather.example/api/workspace'+query))).status,404);
    assert.equal((await workspace.POST(request('/api/workspace'+query,{method:'addTask',args:[{title:'Injected'}],revision:1}))).status,404);
    assert.equal((await infoRead(query)).status,404);
  }
  assert.ok(!(await (await projectsApi.GET()).json()).projects.some(project=>project.id===id));
  assert.equal((await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name:'My own private event'}}))).status,201);
  globalThis.__gatherUser=null;assert.equal((await projectsApi.GET()).status,401);owner();
});

const getRequest=path=>new Request('https://gather.example'+path);
const realRead=id=>workspace.GET(getRequest('/api/workspace?project='+id));
const teamRead=id=>teamApi.GET(getRequest('/api/team?project='+id));
const teamWrite=(id,input)=>teamApi.POST(request('/api/team?project='+id,input));
const senderWrite=(id,input)=>senderApi.POST(request('/api/sender?project='+id,input));
const asTeammate=(email='maya-real@example.com',userId='real-maya')=>{globalThis.__gatherUser={userId,email,displayName:'Maya Real'};};
async function newTeamProject(name='Team event') {
  owner();const response=await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name}}));assert.equal(response.status,201);return (await response.json()).id;
}
async function invitePerson(project,email='maya-real@example.com') {
  owner();const response=await teamWrite(project,{action:'invite',email,requestId:crypto.randomUUID()});assert.equal(response.status,200);
  const invite=(await response.json()).invitations.find(item=>item.email===email.toLowerCase());
  return {...invite,token:new URL(invite.link,'https://gather.example').searchParams.get('invite')};
}
async function joinPerson(project,email='maya-real@example.com',userId='real-maya') {
  const invite=await invitePerson(project,email);asTeammate(email,userId);
  const response=await joinApi.POST(request('/api/join',{token:invite.token}));assert.equal(response.status,200);assert.equal((await response.json()).projectId,project);return invite;
}
test('invitation creation is organizer-only, encrypted, email-bound, expiring and idempotent',async()=>{
  const id=await newTeamProject(), requestId=crypto.randomUUID();
  let response=await teamWrite(id,{action:'invite',email:'New@example.com',requestId});assert.equal(response.status,200);
  const first=(await response.json()).invitations[0],token=new URL(first.link,'https://gather.example').searchParams.get('invite');
  response=await teamWrite(id,{action:'invite',email:'new@example.com',requestId});assert.equal((await response.json()).invitations[0].link,first.link);
  assert.equal((await teamWrite(id,{action:'invite',email:'different@example.com',requestId})).status,409);
  assert.equal((await teamWrite(id,{action:'invite',email:'new@example.com',requestId:crypto.randomUUID()})).status,409);
  assert.equal((await teamWrite(id,{action:'invite',email:'other@example.com',role:'admin',requestId:crypto.randomUUID()})).status,400);
  assert.equal((await teamWrite(id,{action:'invite',email:'owner@example.com',requestId:crypto.randomUUID()})).status,400);
  const saved=sqlite.prepare('SELECT * FROM project_invites WHERE id=?').get(first.id);
  assert.ok(!JSON.stringify(saved).includes(token));assert.equal(saved.expires_at>Date.now(),true);
  globalThis.__gatherUser=null;assert.equal((await joinApi.POST(request('/api/join',{token}))).status,401);
  asTeammate('wrong@example.com','wrong-user');assert.equal((await joinApi.GET(getRequest(first.link.replace('/join?','/api/join?')))).status,403);
  assert.equal((await joinApi.POST(request('/api/join',{token}))).status,403);
  assert.equal(sqlite.prepare('SELECT * FROM members WHERE user_id=?').get('wrong-user'),undefined);
  asTeammate('new@example.com','new-user');
  assert.equal((await joinApi.GET(getRequest('/api/join?invite='+token))).status,200);
  assert.equal(sqlite.prepare('SELECT accepted_by FROM project_invites WHERE id=?').get(first.id).accepted_by,'');
  assert.equal((await joinApi.POST(request('/api/join',{token,role:'admin'}))).status,400);
  assert.equal((await joinApi.POST(request('/api/join',{token},'https://evil.example'))).status,403);
  sqlite.prepare('UPDATE project_invites SET expires_at=? WHERE id=?').run(Date.now()-1,first.id);
  assert.equal((await joinApi.POST(request('/api/join',{token}))).status,410);owner();
  const revoked=await invitePerson(id,'revoked@example.com');
  assert.equal((await teamWrite(id,{action:'revokeInvite',id:revoked.id})).status,200);
  asTeammate('revoked@example.com','revoked-user');assert.equal((await joinApi.POST(request('/api/join',{token:revoked.token}))).status,410);owner();
});
test('real accounts join only their invited project and cannot impersonate organizers or read private data',async()=>{
  const a=await newTeamProject('Shared A'),b=await newTeamProject('Private B'),invite=await joinPerson(a);
  assert.equal((await joinApi.POST(request('/api/join',{token:invite.token}))).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM project_members WHERE project_id=? AND user_id=?').get(a,'real-maya').n,1);
  const member=sqlite.prepare('SELECT * FROM members WHERE user_id=?').get('real-maya');assert.equal(member.role,'member');assert.match(member.actor_id,/^u_/);
  const snap=await (await workspace.GET(getRequest('/api/workspace?project='+a+'&as=jack'))).json();assert.equal(snap.identity.actorId,member.actor_id);assert.equal(snap.identity.role,'member');
  assert.deepEqual((await (await projectsApi.GET()).json()).projects.map(p=>p.id),[a]);
  assert.equal((await (await projectsApi.GET()).json()).canCreateProjects,true);
  for(const id of [b,'main']) { assert.equal((await realRead(id)).status,404);assert.equal((await infoRead('?project='+id)).status,404); }
  assert.equal((await teamRead(a)).status,403);
  assert.equal((await teamWrite(a,{action:'invite',email:'hack@example.com',requestId:crypto.randomUUID()})).status,403);
  assert.equal((await privateApi.GET(getRequest('/api/private/records?project='+a))).status,403);
  assert.equal((await gmailApi.GET(getRequest('/api/gmail/messages?project='+a))).status,403);
  assert.equal((await demoRead()).status,403);
  assert.equal((await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name:'My own private event'}}))).status,201);owner();
});
test('an organizer invited as a teammate cannot access another project’s private bookings',async()=>{
  const id=await newTeamProject('Private booking boundary');
  const created=await privateApi.POST(request('/api/private/records?project='+id,{title:'Owner booking',type:'Flight',reference:'FICTIONAL-PRIVATE'}));
  assert.equal(created.status,200);
  const saved=await created.json();
  sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run('other-organizer','u_other_organizer','other-organizer@example.com','Other organizer','admin');
  try {
    await joinPerson(id,'other-organizer@example.com','other-organizer');
    assert.equal((await security.principal()).role,'admin');
    assert.equal((await (await realRead(id)).json()).identity.role,'member');
    for(const action of ['config','session','records'])
      assert.equal((await privateApi.GET(getRequest('/api/private/'+action+'?project='+id))).status,403,action);
    for(const record of [{title:'Forbidden new booking',type:'Flight'}, {id:saved.id,version:saved.version,title:'Forbidden edit',type:'Flight'}])
      assert.equal((await privateApi.POST(request('/api/private/records?project='+id,record))).status,403);
    assert.equal((await privateApi.POST(request('/api/private/lock?project='+id,{}))).status,403);
    owner();
    const records=await (await privateApi.GET(getRequest('/api/private/records?project='+id))).json();
    assert.equal(records.records.length,1);
    assert.equal(records.records[0].reference,'FICTIONAL-PRIVATE');
    assert.equal(records.records[0].title,'Owner booking');
  } finally { owner(); }
});
test('a global owner invited elsewhere has a separate teammate identity that survives rejoining',async()=>{
  owner();
  await workspace.GET(getRequest('/api/workspace'));
  const organizer={userId:'cross-organizer',email:'cross-organizer@example.com',displayName:'Cross Organizer'};
  sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run(organizer.userId,'u_cross_organizer',organizer.email,organizer.displayName,'admin');
  try {
    globalThis.__gatherUser=organizer;
    const created=await projectsApi.POST(request('/api/projects',{requestId:crypto.randomUUID(),event:{name:'Cross-organizer project'}}));
    assert.equal(created.status,201);const {id}=await created.json();
    const write=input=>workspace.POST(request('/api/workspace?project='+id,input));
    let snap=await (await realRead(id)).json();
    snap=await (await write({method:'addTask',args:[{title:'Organizer only',owner:'jack'}],revision:snap.revision})).json();
    const organizerTask=snap.state.tasks[0].id;
    const invite=async()=>{
      const response=await teamWrite(id,{action:'invite',email:'owner@example.com',requestId:crypto.randomUUID()});
      assert.equal(response.status,200);
      return new URL((await response.json()).invitations.find(i=>i.email==='owner@example.com').link,'https://gather.example').searchParams.get('invite');
    };
    const token=await invite();owner();
    assert.equal((await joinApi.POST(request('/api/join',{token}))).status,200);
    snap=await (await realRead(id)).json();
    assert.equal((await write({method:'reportCompletion',args:[organizerTask,'Not mine'],revision:snap.revision})).status,403);
    const actor=snap.identity.actorId;
    assert.notEqual(actor,'jack');assert.equal(snap.identity.role,'member');
    assert.equal(snap.state.members.find(m=>m.id==='jack').name,organizer.displayName);
    assert.equal(snap.state.members.find(m=>m.id==='jack').role,'Organizer');
    assert.equal(snap.state.members.length,2);
    assert.equal(sqlite.prepare('SELECT actor_id FROM members WHERE user_id=?').get('owner-1').actor_id,'jack');
    assert.equal((await (await realRead('main')).json()).identity.role,'admin');
    globalThis.__gatherUser=organizer;
    snap=await (await write({method:'addTask',args:[{title:'Teammate task',owner:actor}],revision:snap.revision})).json();
    const teammateTask=snap.state.tasks.find(t=>t.owner===actor).id;
    owner();
    assert.equal((await write({method:'updateTask',args:[teammateTask,{status:'progress',note:'Working'}],revision:snap.revision})).status,200);
    globalThis.__gatherUser=organizer;
    const member=(await (await teamRead(id)).json()).members[0];
    assert.equal((await teamWrite(id,{action:'removeMember',id:member.id,revision:member.revision})).status,200);
    const nextToken=await invite();owner();
    assert.equal((await realRead(id)).status,404);
    assert.equal((await joinApi.POST(request('/api/join',{token:nextToken}))).status,200);
    snap=await (await realRead(id)).json();
    assert.equal(snap.identity.actorId,actor);
    assert.equal(snap.state.tasks.find(t=>t.id===teammateTask).owner,actor);
    assert.equal((await write({method:'reportCompletion',args:[organizerTask,'Still not mine'],revision:snap.revision})).status,403);
  } finally { owner(); }
});
test('invited teammates claim tasks, report and comment, but cannot change the plan or another owner’s task',async()=>{
  const id=await newTeamProject(),invite=await joinPerson(id);owner();
  let snap=await (await realRead(id)).json();
  snap=await (await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'Collect dietary preferences'}],revision:snap.revision}))).json();
  const task=snap.state.tasks[0];asTeammate();
  snap=await (await realRead(id)).json();
  let response=await workspace.POST(request('/api/workspace?project='+id,{method:'claimTask',args:[task.id],revision:snap.revision}));assert.equal(response.status,200);snap=await response.json();
  assert.equal(snap.state.tasks[0].owner,snap.identity.actorId);
  response=await workspace.POST(request('/api/workspace?project='+id,{method:'updateTask',args:[task.id,{title:'Forged'}],revision:snap.revision}));assert.equal(response.status,403);
  response=await workspace.POST(request('/api/workspace?project='+id,{method:'updateTask',args:[task.id,{status:'progress',note:'Collecting replies.'}],revision:snap.revision}));assert.equal(response.status,200);snap=await response.json();
  response=await workspace.POST(request('/api/workspace?project='+id,{method:'addComment',args:[task.id,'Need 2 more responses.'],revision:snap.revision}));assert.equal(response.status,200);snap=await response.json();
  response=await workspace.POST(request('/api/workspace?project='+id,{method:'reportCompletion',args:[task.id,'All replies collected.'],revision:snap.revision}));assert.equal(response.status,200);
  let info=await (await infoRead('?project='+id)).json();
  response=await infoWrite({action:'add',guest:{name:'New guest',type:'attendee'},revision:info.revision,requestId:crypto.randomUUID()},'?project='+id);assert.equal(response.status,200);info=await response.json();assert.equal(info.guests[0].createdBy,snap.identity.actorId);
  response=await infoApi.POST(uploadRequest(info.revision,'team.txt','Shared information','&project='+id));assert.equal(response.status,200);info=await response.json();assert.equal((await infoRead('?project='+id+'&file='+info.files[0].id)).status,200);
  asTeammate('maya-real@example.com','different-same-email');assert.equal((await joinApi.POST(request('/api/join',{token:invite.token}))).status,410);owner();
});
test('removing and re-inviting access preserves history, invalidates stale writes and keeps the same task identity',async()=>{
  const id=await newTeamProject();const invite=await joinPerson(id);let snap=await (await realRead(id)).json();const actor=snap.identity.actorId;
  const authorization=await accessCore.projectUser(await security.principal(),id);
  owner();snap=await (await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'Assigned before removal',owner:actor}],revision:snap.revision}))).json();
  const team=await (await teamRead(id)).json(),member=team.members[0];
  assert.equal((await teamWrite(id,{action:'removeMember',id:member.id,revision:member.revision})).status,200);
  const removed=await (await realRead(id)).json();assert.equal(removed.state.tasks[0].owner,actor);assert.equal(removed.state.members.find(m=>m.id===actor).active,false);
  assert.equal((await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'No former assignments',owner:actor}],revision:removed.revision}))).status,400);
  asTeammate();assert.equal((await realRead(id)).status,404);assert.equal((await infoRead('?project='+id)).status,404);assert.equal((await joinApi.POST(request('/api/join',{token:invite.token}))).status,410);
  assert.ok(!(await (await projectsApi.GET()).json()).projects.some(p=>p.id===id));
  await joinPerson(id);assert.equal((await (await realRead(id)).json()).identity.actorId,actor);
  await assert.rejects(accessCore.assertProjectAccess(authorization),error=>error.status===403);
  assert.equal((await workspace.POST(request('/api/workspace?project='+id,{method:'updateTask',args:[snap.state.tasks[0].id,{status:'progress',note:'Old request'}],revision:snap.revision}))).status,409);owner();
});
test('membership removal at workspace commit prevents a write even with a freshly checked revision',async()=>{
  const id=await newTeamProject();await joinPerson(id);owner();let snap=await (await realRead(id)).json();
  snap=await (await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'Race claim'}],revision:snap.revision}))).json();asTeammate();
  const original=globalThis.__gatherEnv.DB;let revoked=false;
  globalThis.__gatherEnv.DB={...db,prepare(sql){const statement=db.prepare(sql);if(sql.startsWith('UPDATE workspaces SET data=')){const run=statement.run;statement.run=async()=>{sqlite.prepare("UPDATE project_members SET revoked_at='race',revision=revision+1 WHERE project_id=? AND user_id=?").run(id,'real-maya');revoked=true;return run();};}return statement;}};
  try{const response=await workspace.POST(request('/api/workspace?project='+id,{method:'claimTask',args:[snap.state.tasks[0].id],revision:snap.revision}));assert.equal(response.status,409);assert.ok(revoked);}finally{globalThis.__gatherEnv.DB=original;owner();}
  assert.equal((await (await realRead(id)).json()).state.tasks[0].owner,'');
});
test('membership removal during file upload cleans uncommitted bytes and denies downloads',async()=>{
  const id=await newTeamProject();await joinPerson(id);const info=await (await infoRead('?project='+id)).json();
  const count=uploadedObjects.size,reservations=sqlite.prepare('SELECT count(*) AS n FROM project_uploads').get().n;
  const original=globalThis.__gatherEnv.BUCKET;
  globalThis.__gatherEnv.BUCKET={...bucket,async put(key,bytes){await bucket.put(key,bytes);sqlite.prepare("UPDATE project_members SET revoked_at='race',revision=revision+1 WHERE project_id=? AND user_id=?").run(id,'real-maya');}};
  try{const response=await infoApi.POST(uploadRequest(info.revision,'revoked.txt','Must not commit','&project='+id));assert.equal(response.status,403);}finally{globalThis.__gatherEnv.BUCKET=original;}
  assert.equal(uploadedObjects.size,count);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM project_uploads').get().n,reservations);
  owner();assert.equal((await (await infoRead('?project='+id)).json()).files.length,0);
});
for (const operation of ['guest retry', 'upload retry', 'CSV preview']) {
  test(`event info ${operation} denies access revoked while loading saved information`, async () => {
    const id = await newTeamProject();
    await joinPerson(id);
    const query = '?project=' + id;
    let state = await (await infoRead(query)).json();
    const input = {action:'add', guest:{name:'Fictional private guest'}, revision:state.revision, requestId:crypto.randomUUID()};
    state = await (await infoWrite(input, query)).json();
    const uploadRevision = state.revision, uploadId = crypto.randomUUID();
    if (operation === 'upload retry') {
      const response = await infoApi.POST(uploadRequest(uploadRevision, 'fixture.txt', 'Fictional file', '&project='+id, uploadId));
      assert.equal(response.status, 200);
      state = await response.json();
    }
    const beforeObjects = uploadedObjects.size;
    const beforeReservations = sqlite.prepare('SELECT count(*) AS n FROM project_uploads').get().n;
    const original = globalThis.__gatherEnv.DB;
    let revoked = false;
    globalThis.__gatherEnv.DB = {...db, prepare(sql) {
      const statement = db.prepare(sql);
      if (sql === 'SELECT payload,revision FROM project_info WHERE scope=?') {
        const first = statement.first;
        statement.first = async () => {
          const row = await first();
          sqlite.prepare("UPDATE project_members SET revoked_at='race',revision=revision+1 WHERE project_id=? AND user_id=?").run(id, 'real-maya');
          revoked = true;
          return row;
        };
      }
      return statement;
    }};
    try {
      const response = operation === 'upload retry'
        ? await infoApi.POST(uploadRequest(uploadRevision, 'fixture.txt', 'Fictional file', '&project='+id, uploadId))
        : await infoWrite(operation === 'CSV preview' ? {action:'preview', csv:'Name\nFictional import', revision:state.revision} : input, query);
      assert.ok(revoked);
      assert.equal(response.status, 403);
      assert.ok(!JSON.stringify(await response.json()).includes('Fictional private guest'));
      assert.equal(uploadedObjects.size, beforeObjects);
      assert.equal(sqlite.prepare('SELECT count(*) AS n FROM project_uploads').get().n, beforeReservations);
    } finally {
      globalThis.__gatherEnv.DB = original;
      owner();
    }
  });
}
test('simultaneous invitation retries create one link without a false conflict',async()=>{
  const id=await newTeamProject(),input={action:'invite',email:'concurrent@example.com',requestId:crypto.randomUUID()};
  const responses=await Promise.all([teamWrite(id,input),teamWrite(id,input)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const [a,b]=await Promise.all(responses.map(r=>r.json()));assert.equal(a.invitations[0].link,b.invitations[0].link);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM project_invites WHERE project_id=?').get(id).n,1);
});
test('acceptance racing invitation creation cannot leave a spare usable link',async()=>{
  const id=await newTeamProject(),invite=await invitePerson(id,'race-invite@example.com');
  const original=globalThis.__gatherEnv.DB;let accepted=false;
  globalThis.__gatherEnv.DB={...db,prepare(sql){const statement=db.prepare(sql);if(sql.startsWith('INSERT OR IGNORE INTO project_invites')){const run=statement.run;statement.run=async()=>{
    if(!accepted){accepted=true;asTeammate('race-invite@example.com','race-invite-user');assert.equal((await joinApi.POST(request('/api/join',{token:invite.token}))).status,200);owner();}return run();};}return statement;}};
  try{assert.equal((await teamWrite(id,{action:'invite',email:'race-invite@example.com',requestId:crypto.randomUUID()})).status,409);assert.ok(accepted);}finally{globalThis.__gatherEnv.DB=original;owner();}
  assert.equal((await (await teamRead(id)).json()).invitations.length,0);
  const member=(await (await teamRead(id)).json()).members[0];
  // Defense in depth for pending links created before the race fix.
  sqlite.prepare("INSERT INTO project_invites (id,project_id,email,token_hash,payload,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)").run('spare-'+id,id,'race-invite@example.com','spare-hash-'+id,'unused','owner-1','now',Date.now()+60000);
  assert.equal((await teamWrite(id,{action:'removeMember',id:member.id,revision:member.revision})).status,200);
  assert.ok(sqlite.prepare('SELECT revoked_at FROM project_invites WHERE id=?').get('spare-'+id).revoked_at);
});

const senderEmail='gather-sender@gmail.com', sendScope='https://www.googleapis.com/auth/gmail.send';
async function senderFixture(extra={}) {
  owner();
  sqlite.prepare('INSERT OR REPLACE INTO settings (id,payload) VALUES (?,?)').run('google-oauth',await security.seal({clientId:'fixture.apps.googleusercontent.com',clientSecret:'fixture-secret'},'google-oauth'));
  sqlite.prepare('INSERT OR REPLACE INTO gmail_senders (user_id,payload,generation) VALUES (?,?,?)').run('owner-1',await security.seal({email:senderEmail,sub:'verified-google-sub',accessToken:'sender-token',refreshToken:'sender-refresh',expiresAt:Date.now()+3600000,...extra},'gmail-sender:owner-1'),'sender-generation');
}
const newSend=(email='invite-send@example.com')=>({action:'sendInvite',email,requestId:crypto.randomUUID(),senderEmail});
const retrySend=id=>({action:'sendExistingInvite',id,senderEmail});
async function startSender(id) {
  const response=await senderWrite(id,{action:'connect'});assert.equal(response.status,200);
  const url=new URL((await response.json()).url);return {url,state:url.searchParams.get('state')};
}
const callback=state=>gmailApi.GET(getRequest('/api/gmail/callback?state='+state+'&code=code'));
test('sender browser errors return to the verified project and never suggest the import flow', async () => {
  const id = await newTeamProject();
  await senderFixture();
  const { state } = await startSender(id);
  const original = globalThis.fetch;
  globalThis.fetch = async path => {
    assert.equal(path, 'https://oauth2.googleapis.com/token');
    return Response.json({ access_token: 'fixture', refresh_token: 'fixture-refresh', expires_in: 3600, scope: 'openid email' });
  };
  try {
    let response = await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=' + state + '&code=fixture&project=main', { headers: { Accept: 'text/html' } }));
    assert.equal(response.status, 400);
    let html = await response.text();
    assert.match(html, new RegExp('href="/team\\?project=' + id + '"'));
    assert.match(html, /Back to Team access/);
    assert.doesNotMatch(html, /Back to Gmail settings|href="\/settings/);
    response = await gmailApi.GET(new Request('https://gather.example/api/gmail/callback?state=send_expired&code=fixture&project=' + id, { headers: { Accept: 'text/html' } }));
    assert.equal(response.status, 400);
    html = await response.text();
    assert.match(html, /href="\/">Back to projects/);
    assert.ok(!html.includes(id));
  } finally { globalThis.fetch = original; }
});
test('dedicated sender OAuth has isolated PKCE state, send-only access, verified identity and replay protection',async()=>{
  const id=await newTeamProject();await senderFixture();
  sqlite.prepare('INSERT OR REPLACE INTO gmail_connections (user_id,payload,generation) VALUES (?,?,?)').run('owner-1',await security.seal({email:'imports@gmail.com',labelId:'keep-label',accessToken:'import-token'},'gmail:owner-1'),'import-generation');
  const imported=sqlite.prepare('SELECT * FROM gmail_connections WHERE user_id=?').get('owner-1');
  const {url,state}=await startSender(id);
  assert.deepEqual(new Set(url.searchParams.get('scope').split(' ')),new Set(['openid','email',sendScope]));
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('prompt'),'consent select_account');assert.equal(url.searchParams.has('include_granted_scopes'),false);
  assert.equal(url.searchParams.get('redirect_uri'),'https://gather.example/api/gmail/callback');
  await gmailCore.beginOAuth('owner-1');assert.ok(sqlite.prepare('SELECT 1 FROM sender_oauth_states WHERE id=?').get(state));
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(path,options)=>{
    calls++;
    if(path==='https://oauth2.googleapis.com/token') {assert.equal(options.body.get('grant_type'),'authorization_code');assert.ok(options.body.get('code_verifier'));return Response.json({access_token:'new-sender-token',refresh_token:'new-sender-refresh',expires_in:3600,scope:'openid email '+sendScope});}
    assert.equal(path,'https://openidconnect.googleapis.com/v1/userinfo');return Response.json({email:senderEmail,email_verified:true,sub:'verified-google-sub'});
  };
  try {
    const response=await callback(state);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'https://gather.example/team?project='+id+'&sender=connected');
    assert.equal((await callback(state)).status,400);assert.equal(calls,2);
    const json=await (await teamRead(id)).json();assert.equal(json.sender.email,senderEmail);assert.ok(!JSON.stringify(json).includes('sender-token'));
    assert.deepEqual(sqlite.prepare('SELECT * FROM gmail_connections WHERE user_id=?').get('owner-1'),imported);
  } finally {globalThis.fetch=original;}
});
test('unverified sender and disconnect during callback preserve connection safety',async()=>{
  const id=await newTeamProject();await senderFixture();const before=await senderCore.senderConnection('owner-1');
  const original=globalThis.fetch;let mode='unverified';
  globalThis.fetch=async path=>{
    if(path==='https://oauth2.googleapis.com/token')return Response.json({access_token:'new-token',refresh_token:'new-refresh',expires_in:3600,scope:sendScope});
    if(mode==='disconnect')await senderCore.disconnectSender('owner-1');
    return Response.json({email:senderEmail,email_verified:mode!=='unverified',sub:'verified-sub'});
  };
  try {
    assert.equal((await callback((await startSender(id)).state)).status,400);
    assert.equal((await senderCore.senderConnection('owner-1')).storedPayload,before.storedPayload);
    mode='disconnect';assert.equal((await callback((await startSender(id)).state)).status,409);
    assert.equal(await senderCore.senderConnection('owner-1'),null);
    assert.equal((await gmailCore.connection('owner-1')).labelId,'keep-label');
  } finally {globalThis.fetch=original;}
});
test('sender refresh and shared configuration cannot resurrect a disconnected or replaced connection',async()=>{
  const id=await newTeamProject();await senderFixture({expiresAt:0});
  assert.equal((await gmailApi.POST(request('/api/gmail/configure',{clientId:'replacement.apps.googleusercontent.com',clientSecret:'fixture-replacement'}))).status,409);
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{await senderCore.disconnectSender('owner-1');return Response.json({access_token:'late-token',expires_in:3600,scope:sendScope});};
  try {assert.equal((await teamWrite(id,newSend())).status,409);assert.equal(await senderCore.senderConnection('owner-1'),null);}finally{globalThis.fetch=original;}
});
test('concurrent send requests emit one email with server-owned recipient, safe MIME and a persistent receipt',async()=>{
  const id=await newTeamProject('Dinner 🥗\r\nBcc: attacker@example.com');await senderFixture();
  const input=newSend(),original=globalThis.fetch;let calls=0,raw='';
  globalThis.fetch=async(path,options)=>{assert.equal(path,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');calls++;raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString('utf8');return Response.json({id:'gmail-message-1'});};
  try {
    const responses=await Promise.all([teamWrite(id,input),teamWrite(id,input)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal(calls,1);
    let team=await (await teamRead(id)).json();assert.equal(team.invitations.length,1);assert.equal(team.invitations[0].delivery.status,'sent');
    assert.equal((await teamWrite(id,input)).status,200);assert.equal((await teamWrite(id,retrySend(input.requestId))).status,200);assert.equal(calls,1);
    const [headers,body]=raw.split('\r\n\r\n');assert.ok(headers.includes('From: Weft <'+senderEmail+'>'));assert.ok(headers.includes('To: '+input.email));assert.ok(!headers.includes('Bcc:'));assert.ok(!headers.includes('attacker@example.com'));
    assert.ok(headers.includes('Subject: Weft project invitation'));
    const text=Buffer.from(body,'base64').toString('utf8');assert.ok(text.includes('https://gather.example/join?invite='));assert.ok(text.includes(input.email));assert.ok(text.includes(' on Weft.'));
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM invitation_send_attempts WHERE invite_id=?').get(input.requestId).n,1);
    assert.ok(!JSON.stringify(team).includes('sender-token'));
  } finally {globalThis.fetch=original;}
});
test('uncertain sends, malformed success, provider errors and lost database receipts never auto-resend',async()=>{
  const id=await newTeamProject();await senderFixture();const original=globalThis.fetch;
  for(const mode of ['timeout','malformed','server-error','lost-receipt']) {
    const input=newSend(mode+'@example.com');let calls=0;const originalDb=globalThis.__gatherEnv.DB;
    globalThis.fetch=async()=>{calls++;if(mode==='timeout')throw new Error('timeout');if(mode==='malformed')return Response.json({});if(mode==='server-error')return new Response('provider details',{status:503});return Response.json({id:'accepted-email'});};
    if(mode==='lost-receipt')globalThis.__gatherEnv.DB={...db,prepare(sql){const stmt=db.prepare(sql);if(sql.startsWith('UPDATE invitation_deliveries SET status=?'))stmt.run=async()=>{throw new Error('write receipt lost');};return stmt;}};
    try {
      const response=await teamWrite(id,input);assert.equal(response.status,mode==='lost-receipt'?500:200);
      globalThis.__gatherEnv.DB=originalDb;
      sqlite.prepare('UPDATE invitation_deliveries SET attempted_at=? WHERE invite_id=?').run(Date.now()-61000,input.requestId);
      const team=await (await teamRead(id)).json(),invite=team.invitations.find(i=>i.id===input.requestId);
      assert.equal(invite.delivery.status,'unknown');assert.equal(invite.delivery.canRetry,false);
      assert.equal((await teamWrite(id,input)).status,200);assert.equal((await teamWrite(id,retrySend(input.requestId))).status,200);assert.equal(calls,1);
    } finally {globalThis.__gatherEnv.DB=originalDb;}
  }
  globalThis.fetch=original;
});
test('definitive rejection allows only explicit bounded retries and successful retries stay idempotent',async()=>{
  const id=await newTeamProject();await senderFixture();const input=newSend(),original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return calls===1?new Response('',{status:401}):Response.json({id:'retry-accepted'});};
  try {
    let response=await teamWrite(id,input);assert.equal(response.status,200);let invite=(await response.json()).invitations[0];assert.equal(invite.delivery.status,'failed');assert.equal(invite.delivery.canRetry,true);
    assert.equal((await teamWrite(id,retrySend(invite.id))).status,409);assert.equal(calls,1);
    sqlite.prepare('UPDATE invitation_deliveries SET attempted_at=? WHERE invite_id=?').run(Date.now()-61000,invite.id);
    response=await teamWrite(id,retrySend(invite.id));assert.equal(response.status,200);assert.equal((await response.json()).invitations[0].delivery.status,'sent');assert.equal(calls,2);
    await teamWrite(id,retrySend(invite.id));assert.equal(calls,2);
  } finally {globalThis.fetch=original;}
});
test('sending denies members, spoofed fields, cross-origin, cross-project, changed sender and invalid invitations before Gmail',async()=>{
  const id=await newTeamProject(),other=await newTeamProject();await senderFixture();const invite=await invitePerson(id,'permissions@example.com');
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('must not dispatch');};
  try {
    assert.equal((await teamWrite(id,{...newSend(),from:'spoof@gmail.com'})).status,400);
    assert.equal((await teamWrite(id,{...newSend(),senderEmail:'changed@gmail.com'})).status,409);
    assert.equal((await teamWrite(id,newSend('a@example.com,b@example.com'))).status,400);
    assert.equal((await teamApi.POST(request('/api/team?project='+id,newSend(),'https://evil.example'))).status,403);
    assert.equal((await senderApi.POST(request('/api/sender?project='+id,{action:'connect'},'https://evil.example'))).status,403);
    assert.equal((await teamWrite(other,retrySend(invite.id))).status,409);
    await teamWrite(id,{action:'revokeInvite',id:invite.id});assert.equal((await teamWrite(id,retrySend(invite.id))).status,409);
    const expired=await invitePerson(id,'expired-send@example.com');sqlite.prepare('UPDATE project_invites SET expires_at=? WHERE id=?').run(Date.now()-1,expired.id);assert.equal((await teamWrite(id,retrySend(expired.id))).status,409);
    const accepted=await joinPerson(id);assert.equal((await senderWrite(id,{action:'connect'})).status,403);assert.equal((await teamWrite(id,newSend())).status,403);
    owner();assert.equal((await teamWrite(id,retrySend(accepted.id))).status,409);
    await teamRead(id);assert.equal(calls,0);
  } finally {globalThis.fetch=original;owner();}
});
test('invitation sending rate limit is durable across projects and caps attempts',async()=>{
  const id=await newTeamProject();await senderFixture();const invite=await invitePerson(id,'quota-send@example.com');
  sqlite.prepare("INSERT INTO invitation_deliveries (invite_id,status,attempts) VALUES (?,'failed',3)").run(invite.id);
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:'not-expected'});};
  try {
    assert.equal((await teamWrite(id,retrySend(invite.id))).status,409);
    for(let n=0;n<50;n++)sqlite.prepare('INSERT INTO invitation_send_attempts (id,user_id,invite_id,started_at) VALUES (?,?,?,?)').run('quota-fixture-'+n,'owner-1','quota-fixture',Date.now());
    assert.equal((await teamWrite(id,newSend('quota-new@example.com'))).status,409);assert.equal(calls,0);
  } finally {globalThis.fetch=original;sqlite.prepare("DELETE FROM invitation_send_attempts WHERE invite_id='quota-fixture'").run();}
});
test('import and sender cannot connect the same account in either order, including during commit',async()=>{
  const id=await newTeamProject();await senderFixture();const original=globalThis.fetch,originalDb=globalThis.__gatherEnv.DB;
  let profileEmail=senderEmail;
  globalThis.fetch=async path=>{
    if(path==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fresh',refresh_token:'refresh',expires_in:3600,scope:sendScope+' https://www.googleapis.com/auth/gmail.readonly'});
    if(path==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({email:profileEmail,email_verified:true,sub:'verified-sub'});
    if(path==='https://gmail.googleapis.com/gmail/v1/users/me/profile')return Response.json({emailAddress:profileEmail});
    throw new Error('unexpected provider path');
  };
  const importState=async()=>new URL(await gmailCore.beginOAuth('owner-1')).searchParams.get('state');
  try {
    assert.equal((await callback(await importState())).status,409);
    profileEmail='imports@gmail.com';assert.equal((await callback((await startSender(id)).state)).status,409);
    profileEmail=senderEmail;let raced=false;
    const replacement=await security.seal({email:senderEmail,labelId:'race-import',accessToken:'racing-import'},'gmail:owner-1');
    globalThis.__gatherEnv.DB={...db,prepare(sql){const stmt=db.prepare(sql);if(sql.includes('INSERT INTO gmail_senders')){const run=stmt.run;stmt.run=async()=>{raced=true;sqlite.prepare('UPDATE gmail_connections SET payload=? WHERE user_id=?').run(replacement,'owner-1');return run();};}return stmt;}};
    const before=(await senderCore.senderConnection('owner-1')).storedPayload;
    assert.equal((await callback((await startSender(id)).state)).status,409);assert.equal(raced,true);assert.equal((await senderCore.senderConnection('owner-1')).storedPayload,before);
    globalThis.__gatherEnv.DB=originalDb;profileEmail='new-import@gmail.com';raced=false;
    const newSender=await security.seal({email:profileEmail,sub:'race-sub',accessToken:'racing-sender',refreshToken:'fixture',expiresAt:Date.now()+3600000},'gmail-sender:owner-1');
    globalThis.__gatherEnv.DB={...db,prepare(sql){const stmt=db.prepare(sql);if(sql.includes('INSERT INTO gmail_connections (user_id,payload,generation) SELECT')){const run=stmt.run;stmt.run=async()=>{raced=true;sqlite.prepare('UPDATE gmail_senders SET payload=? WHERE user_id=?').run(newSender,'owner-1');return run();};}return stmt;}};
    assert.equal((await callback(await importState())).status,409);assert.equal(raced,true);assert.equal((await gmailCore.connection('owner-1')).storedPayload,replacement);
  } finally {globalThis.fetch=original;globalThis.__gatherEnv.DB=originalDb;}
});

test('scheduled activities persist in their project, preserve task state and reject forged/stale edits',async()=>{
  const project=await newTeamProject('Schedule checks'),other=await newTeamProject('Separate plan');owner();
  const path='/api/workspace?project='+project,read=async()=>await (await realRead(project)).json();
  let state=await read();
  const write=(method,args,revision=state.revision)=>workspace.POST(request(path,{method,args,revision}));
  let response=await write('completeSetup',[{timeZone:'America/Los_Angeles'}]);assert.equal(response.status,200);state=await response.json();
  const slot={start:'2026-10-03T09:30',end:'2026-10-03T10:00',location:'East entrance'};
  response=await write('addTask',[{title:'Check-in',owner:'jack',schedule:slot}]);assert.equal(response.status,200);state=await response.json();
  const original=state.result,id=original.id;
  assert.deepEqual(original.schedule,slot);assert.equal(original.dueDate,'');
  const next={...slot,start:'2026-10-04T09:30',end:'2026-10-04T10:00'},base=state.revision;
  response=await write('setTaskSchedule',[id,next]);assert.equal(response.status,200);state=await response.json();
  const updated=state.state.tasks.find(t=>t.id===id);
  assert.deepEqual({...updated,schedule:original.schedule,revision:original.revision},original);
  assert.deepEqual((await read()).state.tasks.find(t=>t.id===id).schedule,next);
  assert.equal(state.state.activity[0].actor,'jack');assert.equal(state.state.activity[0].type,'schedule');
  assert.equal((await write('setTaskSchedule',[id,slot],base)).status,409);
  for(const body of [
    {method:'setTaskSchedule',args:[id,slot,'jack'],revision:state.revision},
    {method:'setTaskSchedule',args:[id,slot],revision:state.revision,actor:'jack'},
    {method:'setTaskSchedule',args:[id,{...slot,status:'done'}],revision:state.revision},
  ])assert.equal((await workspace.POST(request(path,body))).status,400);
  assert.equal((await workspace.POST(request(path,{method:'setTaskSchedule',args:[id,slot],revision:state.revision},'https://evil.example'))).status,403);
  const otherState=await (await realRead(other)).json();
  assert.equal((await workspace.POST(request('/api/workspace?project='+other,{method:'setTaskSchedule',args:[id,slot],revision:otherState.revision}))).status,400);
  const concurrent=await Promise.all([write('setTaskSchedule',[id,slot]),write('setTaskSchedule',[id,{...slot,location:'West entrance'}])]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const winner=await concurrent.find(r=>r.status===200).json();
  state=await read();assert.deepEqual(state.state.tasks.find(t=>t.id===id).schedule,winner.result.schedule);
  const originalData=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get(project).data;
  try{
    const corrupt=JSON.parse(originalData);corrupt.tasks[0].schedule.end='invalid';const raw=JSON.stringify(corrupt);
    sqlite.prepare('UPDATE workspaces SET data=? WHERE id=?').run(raw,project);
    assert.equal((await realRead(project)).status,503);assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get(project).data,raw);
  }finally{sqlite.prepare('UPDATE workspaces SET data=? WHERE id=?').run(originalData,project);}
  await joinPerson(project);asTeammate();
  state=await read();assert.deepEqual(state.state.tasks.find(t=>t.id===id).schedule,winner.result.schedule);
  assert.equal((await write('setTaskSchedule',[id,slot])).status,403);
  assert.equal((await write('addComment',[id,'I can see the activity time.'])).status,200);
  owner();
  assert.equal((await (await realRead(other)).json()).state.tasks.length,0);
});

test('demo personas share the same schedule and reset never changes real project data',async()=>{
  owner();let state=await (await demoRead()).json();
  let response=await demoWrite('jack',{method:'resetDemo',args:[true],revision:state.revision});assert.equal(response.status,200);state=await response.json();
  const samples=state.state.tasks.filter(t=>t.schedule);assert.equal(samples.length,3);
  const slot={start:'2026-10-05T23:30',end:'2026-10-06T01:00',location:'Station'};
  const raw=sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data;
  assert.equal((await demoWrite('maya',{method:'setTaskSchedule',args:[samples[0].id,slot],revision:state.revision})).status,403);
  response=await demoWrite('jack',{method:'setTaskSchedule',args:[samples[0].id,slot],revision:state.revision});assert.equal(response.status,200);state=await response.json();
  for(const actor of ['jack','maya','jules','dev'])assert.deepEqual((await (await demoRead(actor)).json()).state.tasks.find(t=>t.id===samples[0].id).schedule,slot);
  response=await demoWrite('jack',{method:'resetDemo',args:[true],revision:state.revision});assert.equal(response.status,200);
  assert.equal((await response.json()).state.tasks.filter(t=>t.schedule).length,3);
  assert.equal(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get('main').data,raw);
});

test('shared completion enforces prerequisites before reports, verification and reviewed email updates',async()=>{
  const project=await newTeamProject('Fictional school arts evening');
  await joinPerson(project);owner();
  let current=await (await realRead(project)).json();
  const path='/api/workspace?project='+project;
  const send=(method,args,revision=current.revision)=>workspace.POST(request(path,{method,args,revision}));
  const apply=async(method,args)=>{const response=await send(method,args);assert.equal(response.status,200);current=await response.json();return current.result;};
  const reject=async(method,args)=>{
    const before=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);
    const response=await send(method,args);assert.equal(response.status,400);assert.match((await response.json()).error,/required work/);
    assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project),before);
  };
  const hall=await apply('addTask',[{title:'Approve hall readiness',owner:'jack',requiresVerification:true}]);
  const arrival=await apply('addTask',[{title:'Prepare arrival area'}]);
  await apply('addDependency',[arrival.id,{taskId:hall.id}]);
  const email=await apply('addMessage',[{sender:'Arrival volunteer',subject:'Arrival preparation complete',taskId:arrival.id,body:'The arrival area is complete.'}]);
  await reject('updateTask',[arrival.id,{status:'done',note:'Ready.'}]);
  await reject('applyMessage',[email.id,{status:'done'}]);
  await apply('updateTask',[arrival.id,{requiresVerification:true}]);
  await apply('refreshProposal',[email.id,arrival.id]);
  await reject('applyMessage',[email.id,{status:'done'}]);
  asTeammate();current=await (await realRead(project)).json();
  await apply('claimTask',[arrival.id]);
  await reject('reportCompletion',[arrival.id,'Arrival area ready.']);
  await apply('addComment',[arrival.id,'Waiting for hall approval.']);
  owner();current=await (await realRead(project)).json();
  await apply('reportCompletion',[hall.id,'Hall inspection passed.']);
  asTeammate();current=await (await realRead(project)).json();
  await reject('reportCompletion',[arrival.id,'Arrival area ready.']);
  owner();current=await (await realRead(project)).json();
  await apply('verifyTask',[hall.id]);
  asTeammate();current=await (await realRead(project)).json();
  await apply('reportCompletion',[arrival.id,'Arrival area ready.']);
  const beforeReopen=current.revision;
  owner();await apply('updateTask',[hall.id,{status:'progress'}]);
  assert.equal((await send('verifyTask',[arrival.id],beforeReopen)).status,409);
  await reject('verifyTask',[arrival.id]);
  assert.ok(current.state.tasks.find(task=>task.id===arrival.id).reportedAt);
  await apply('reportCompletion',[hall.id,'Hall inspected again.']);
  await apply('verifyTask',[hall.id]);
  await apply('verifyTask',[arrival.id]);
  asTeammate();const shared=await (await realRead(project)).json();
  assert.equal(shared.state.tasks.find(task=>task.id===arrival.id).status,'done');
  assert.equal(shared.state.tasks.find(task=>task.id===arrival.id).comments.filter(item=>item.kind==='dependency-result').length,2);
  owner();
  let demo=await (await demoRead()).json();
  demo=await (await demoWrite('jack',{method:'resetDemo',args:[true],revision:demo.revision})).json();
  const response=await demoWrite('maya',{method:'reportCompletion',args:['catering','Menu ready.'],revision:demo.revision});
  assert.equal(response.status,400);assert.match((await response.json()).error,/required work/);
  assert.equal((await (await demoRead()).json()).revision,demo.revision);
});

test('private starting plans',async t=>{
  await eventPlanTests({t,assert,sqlite,db,owner,request,security,planApi,planGeneration,newTeamProject,joinPerson,realRead,workspace,demoRead,demoWrite});
});

test('automatic Gmail integration', async t => {
  const checks = [];
  gmailAutomaticTests({ test: (name, fn) => checks.push(t.test(name, fn)), assert, sqlite, db, owner, request, security,
    gmailApi, gmailCore, automaticCore, automaticApi, classifierCore, newTeamProject });
  await Promise.all(checks);
});

test('self-service accounts and internal invitations', async t=>{
  await selfserviceTests({t,assert,sqlite,db,request,security,signupApi,invitationsApi,projectsApi,teamApi,workspace,privateApi,gmailApi,senderApi,owner});
});
