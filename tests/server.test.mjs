import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const sqlite = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle')
  .filter((n) => n.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
const db = {
  async batch(statements) {
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
globalThis.__gatherEnv = {
  DB: db,
  GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GATHER_OWNER_EMAIL: 'owner@example.com',
  GATHER_ORIGIN: 'https://gather.example',
};
globalThis.__gatherUser = null;
let workspace, privateApi, gmailApi, security, gmailCore, demoApi;
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
    },
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'test-environment',
        setup(b) {
          b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
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
  [workspace, privateApi, gmailApi, security, gmailCore, demoApi] = await Promise.all(
    ['workspace', 'private', 'gmail', 'security', 'gmailCore', 'demo'].map(
      (name) => import(pathToFileURL(join(directory, name + '.js'))),
    ),
  );
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
  assert.equal((await workspace.GET()).status, 401);
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
  assert.equal((await workspace.GET()).status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM members').get().n, 0);
});
test('owner receives server workspace and real identity', async () => {
  owner();
  const response = await workspace.GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.identity.actorId, 'jack');
  assert.equal(data.state.members[0].name, 'Owner');
  assert.equal(data.state.tasks.length, 12);
});
test('CSRF and actor injection are rejected', async () => {
  owner();
  let snapshot = await (await workspace.GET()).json();
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
  const snapshot = await (await workspace.GET()).json();
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
  const reloaded = await (await workspace.GET()).json();
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
  const shared = await (await workspace.GET()).text();
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
  const raw = await (await workspace.GET()).text();
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
  assert.ok(!(await (await workspace.GET()).text()).includes('SECRET123'));
});

const demoRead = (actor = 'jack') => demoApi.GET(new Request('https://gather.example/api/demo?as=' + actor));
const demoWrite = (actor, data, origin) => demoApi.POST(request('/api/demo?as=' + actor, data, origin));
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
  const before=await(await workspace.GET()).json();
  const data={method:'claimTask',args:['wayfinding'],revision:before.revision};
  const res=await workspace.POST(request('/api/workspace',data));
  assert.equal(res.status,200);
  assert.equal((await res.json()).result.acceptedBy,'jack');
  assert.equal((await workspace.POST(request('/api/workspace',data))).status,409);
});
