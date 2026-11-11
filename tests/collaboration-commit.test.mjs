import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Real API handlers and SQL, fictional request-scoped sessions. This does not
// exercise OAuth, a hosted database, or two independent browser sessions.
const auth = new AsyncLocalStorage();
const organizer = {
  userId: 'commit-owner',
  email: 'organizer@example.com',
  displayName: 'Organizer',
};
const teammate = {
  userId: 'commit-member',
  email: 'teammate@example.com',
  displayName: 'Teammate',
};
const origin = 'https://collaboration.example';
const sqlite = new DatabaseSync(':memory:');
let beforeRun,
  workspace,
  projects,
  team,
  joinApi,
  batchTail = Promise.resolve();
const db = {
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
        await beforeRun?.(sql, args);
        return {
          meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) },
        };
      },
    };
  },
  batch(statements) {
    const run = batchTail.then(async () => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    });
    batchTail = run.catch(() => {});
    return run;
  },
};
before(async () => {
  for (const name of readdirSync('drizzle')
    .filter((n) => n.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(join('drizzle', name), 'utf8'));
  globalThis.__commitAuth = auth;
  globalThis.__commitEnv = {
    DB: db,
    GATHER_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
    GATHER_OWNER_EMAIL: organizer.email,
    GATHER_ORIGIN: origin,
  };
  const directory = mkdtempSync(join(tmpdir(), 'weft-collaboration-commit-'));
  await build({
    entryPoints: {
      workspace: 'app/api/workspace/route.ts',
      projects: 'app/api/projects/route.ts',
      team: 'app/api/team/route.ts',
      join: 'app/api/join/route.ts',
    },
    outdir: directory,
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'fictional-request-context',
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({
            path: 'env',
            namespace: 'fixture',
          }));
          b.onResolve({ filter: /chatgpt-auth$/ }, () => ({
            path: 'auth',
            namespace: 'fixture',
          }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            loader: 'js',
            contents:
              a.path === 'env'
                ? 'export const env=globalThis.__commitEnv;'
                : 'export async function getChatGPTUser(){return globalThis.__commitAuth.getStore() || null;}',
          }));
        },
      },
    ],
  });
  [workspace, projects, team, joinApi] = await Promise.all(
    ['workspace', 'projects', 'team', 'join'].map(
      (name) => import(pathToFileURL(join(directory, `${name}.js`))),
    ),
  );
});
after(() => {
  beforeRun = undefined;
  sqlite.close();
  delete globalThis.__commitEnv;
  delete globalThis.__commitAuth;
});
const as = (user, action) => auth.run(user, action);
const request = (path, data) =>
  new Request(
    origin + path,
    data
      ? {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Gather-Request': '1',
          },
          body: JSON.stringify(data),
        }
      : undefined,
  );
async function read(project, user = organizer) {
  const response = await as(user, () =>
    workspace.GET(request(`/api/workspace?project=${project}`)),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
const stored = (project) =>
  sqlite
    .prepare('SELECT data,revision FROM workspaces WHERE id=?')
    .get(project);
async function mutate(project, user, method, args, revision) {
  const currentRevision = revision ?? (await read(project, user)).revision;
  return as(user, () =>
    workspace.POST(
      request(`/api/workspace?project=${project}`, {
        method,
        args,
        revision: currentRevision,
      }),
    ),
  );
}
async function save(project, user, method, args) {
  const response = await mutate(project, user, method, args);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function setup() {
  const created = await as(organizer, () =>
    projects.POST(
      request('/api/projects', {
        requestId: crypto.randomUUID(),
        event: {
          name: 'Fictional school event',
          timeZone: 'America/Los_Angeles',
        },
      }),
    ),
  );
  assert.equal(created.status, 201, await created.clone().text());
  const project = (await created.json()).id;
  const invitation = await as(organizer, () =>
    team.POST(
      request(`/api/team?project=${project}`, {
        action: 'invite',
        email: teammate.email,
        requestId: crypto.randomUUID(),
      }),
    ),
  );
  assert.equal(invitation.status, 200, await invitation.clone().text());
  const link = (await invitation.json()).invitations.find(
    (row) => row.email === teammate.email,
  ).link;
  const token = new URL(link, origin).searchParams.get('invite');
  const joined = await as(teammate, () =>
    joinApi.POST(request('/api/join', { token })),
  );
  assert.equal(joined.status, 200, await joined.clone().text());
  return { project, actor: (await read(project, teammate)).identity.actorId };
}
const isCommit = (project, sql, args) =>
  sql.startsWith('UPDATE workspaces SET data=') && args[1] === project;
test('task deletion is project-owner-only and cannot delete from a stale review', async () => {
  const {project,actor}=await setup();
  const task=(await save(project,organizer,'addTask',[{title:'Fictional duplicate',owner:actor}])).result;
  const dependent=(await save(project,organizer,'addTask',[{title:'Fictional check'}])).result;
  await save(project,organizer,'addDependency',[dependent.id,{taskId:task.id,kind:'dependency',reason:'Check follows the duplicate.'}]);
  const {revision}=await read(project), before=stored(project);
  assert.equal((await mutate(project,teammate,'deleteTask',[task.id,task.revision],revision)).status,403);
  assert.equal((await mutate(project,organizer,'deleteTask',[task.id,task.revision],revision-1)).status,409);
  assert.equal((await mutate(project,organizer,'deleteTask',[task.id,task.revision+1],revision)).status,400);
  assert.deepEqual(stored(project),before);
  const response=await mutate(project,organizer,'deleteTask',[task.id,task.revision],revision);
  assert.equal(response.status,200,await response.clone().text());
  const next=await read(project,teammate);
  assert.equal(next.revision,revision+1);
  assert.deepEqual(next.state.tasks.map(t=>[t.id,t.status,t.dependencies.length]),[[dependent.id,'todo',0]]);
});
test('event reschedule uses real project guards, stale CAS and commit-time organizer authority',async()=>{
  const {project,actor}=await setup();
  await save(project,organizer,'completeSetup',[{date:'2026-10-30'}]);
  const task=(await save(project,organizer,'addTask',[{title:'School dance check-in',owner:actor,dueDate:'2026-10-23',schedule:{start:'2026-10-30T17:00',end:'2026-10-30T18:00',location:'Hall'}}])).result;
  const current=await read(project),input={fromDate:'2026-10-30',toDate:'2026-11-06',timeZone:'America/Los_Angeles',tasks:[{id:task.id,revision:task.revision,moveDue:true,moveSchedule:true}]};
  const before=stored(project);
  assert.equal((await mutate(project,teammate,'rescheduleEvent',[input],current.revision)).status,403);assert.deepEqual(stored(project),before);
  assert.equal((await mutate(project,organizer,'rescheduleEvent',[{...input,tasks:[{...input.tasks[0],owner:'jack'}]}],current.revision)).status,400);assert.deepEqual(stored(project),before);
  const foreign=await setup();await save(foreign.project,organizer,'completeSetup',[{date:'2026-10-30'}]);
  const untouched=stored(foreign.project);assert.equal((await mutate(foreign.project,organizer,'rescheduleEvent',[input])).status,400);assert.deepEqual(stored(foreign.project),untouched);
  const saved=await mutate(project,organizer,'rescheduleEvent',[input],current.revision);assert.equal(saved.status,200,await saved.clone().text());
  const next=await saved.json();assert.equal(next.state.event.date,'2026-11-06');assert.equal(next.state.tasks.find(t=>t.id===task.id).dueDate,'2026-10-30');
  const stable=stored(project);assert.equal((await mutate(project,organizer,'rescheduleEvent',[input],current.revision)).status,409);assert.deepEqual(stored(project),stable);
  const {project:race}=await setup();await save(race,organizer,'completeSetup',[{date:'2026-10-30'}]);
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)').run('reschedule-owner-race',race,organizer.userId,'jack','fictional',new Date().toISOString());
  const original=stored(race);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(race,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,race);}};
  try{assert.equal((await mutate(race,organizer,'rescheduleEvent',[{...input,tasks:[]}])).status,409);assert.ok(intercepted);assert.deepEqual(stored(race),original);}finally{beforeRun=undefined;}
});
test('batch acceptance commits one reviewed owner-only selection with no partial invalid or stale save', async () => {
  const { project, actor } = await setup();
  const a = (
    await save(project, organizer, 'addTask', [
      { title: 'Corporate briefing', owner: actor },
    ])
  ).result;
  const b = (
    await save(project, organizer, 'addTask', [
      { title: 'Room handoff', owner: actor },
    ])
  ).result;
  const foreign = (
    await save(project, organizer, 'addTask', [
      { title: 'Organizer approval', owner: 'jack' },
    ])
  ).result;
  const refs = [a, b].map((t) => ({ id: t.id, revision: t.revision }));
  let before = stored(project);
  for (const invalid of [[refs[0], refs[0]], Array(101).fill(refs[0])]) {
    assert.equal(
      (
        await mutate(
          project,
          teammate,
          'acceptTasks',
          [invalid],
          before.revision,
        )
      ).status,
      400,
    );
    assert.deepEqual(stored(project), before);
  }
  assert.equal(
    (
      await mutate(
        project,
        teammate,
        'acceptTasks',
        [[refs[0], { id: foreign.id, revision: foreign.revision }]],
        before.revision,
      )
    ).status,
    403,
  );
  assert.deepEqual(stored(project), before);
  assert.equal(
    (await mutate(project, organizer, 'acceptTasks', [refs], before.revision))
      .status,
    403,
  );
  assert.deepEqual(stored(project), before);
  await save(project, organizer, 'updateTask', [
    b.id,
    { title: 'Revised room handoff' },
  ]);
  before = stored(project);
  assert.equal(
    (await mutate(project, teammate, 'acceptTasks', [refs], before.revision))
      .status,
    400,
  );
  assert.deepEqual(stored(project), before);
  const current = await read(project, teammate),
    fresh = current.state.tasks
      .filter((t) => [a.id, b.id].includes(t.id))
      .map((t) => ({ id: t.id, revision: t.revision }));
  const result = await save(project, teammate, 'acceptTasks', [fresh]);
  assert.equal(result.revision, current.revision + 1);
  for (const task of result.result) {
    assert.equal(task.acceptedBy, actor);
    assert.ok(task.acceptedAt);
    assert.equal(task.status, 'todo');
    assert.equal(task.reportedAt, '');
  }
  const stable = stored(project);
  assert.equal(
    (await mutate(project, teammate, 'acceptTasks', [fresh], current.revision))
      .status,
    409,
  );
  assert.deepEqual(stored(project), stable);
});
test('membership revoked during a batch acceptance commit leaves every selected task untouched', async () => {
  const { project, actor } = await setup(),
    refs = [];
  for (const title of ['Welcome guests', 'Prepare room']) {
    const task = (
      await save(project, organizer, 'addTask', [{ title, owner: actor }])
    ).result;
    refs.push({ id: task.id, revision: task.revision });
  }
  const baseline = stored(project);
  let intercepted = false;
  beforeRun = async (sql, args) => {
    if (!isCommit(project, sql, args) || intercepted) return;
    intercepted = true;
    sqlite
      .prepare(
        'UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE project_id=? AND user_id=?',
      )
      .run('fictional-revocation', project, teammate.userId);
  };
  let response;
  try {
    response = await mutate(
      project,
      teammate,
      'acceptTasks',
      [refs],
      baseline.revision,
    );
  } finally {
    beforeRun = undefined;
  }
  assert.ok(intercepted);
  assert.equal(response.status, 409);
  assert.deepEqual(stored(project), baseline);
});
test('batch assignment is organizer-only, revision-bound, project-scoped and accepted separately',async()=>{
  const {project,actor}=await setup();
  const a=(await save(project,organizer,'addTask',[{title:'School volunteer briefing',owner:'jack',dueDate:'2027-02-01'}])).result;
  const b=(await save(project,organizer,'addTask',[{title:'Corporate AV check',owner:'jack',schedule:{start:'2027-02-02T09:00',end:'2027-02-02T10:00',location:'Hall'}}])).result;
  const input={owner:actor,tasks:[a,b].map(t=>({id:t.id,revision:t.revision}))};
  let before=stored(project);
  assert.equal((await mutate(project,teammate,'assignTasks',[input],before.revision)).status,403);assert.deepEqual(stored(project),before);
  assert.equal((await mutate(project,organizer,'assignTasks',[{...input,tasks:[input.tasks[0],{...input.tasks[1],owner:actor}]}],before.revision)).status,400);assert.deepEqual(stored(project),before);
  const foreign=await setup(),untouched=stored(foreign.project);
  assert.equal((await mutate(foreign.project,organizer,'assignTasks',[input])).status,400);assert.deepEqual(stored(foreign.project),untouched);
  await save(project,organizer,'updateTask',[b.id,{note:'Revised instructions'}]);before=stored(project);
  assert.equal((await mutate(project,organizer,'assignTasks',[input],before.revision)).status,400);assert.deepEqual(stored(project),before);
  const current=await read(project),fresh={owner:actor,tasks:current.state.tasks.map(t=>({id:t.id,revision:t.revision}))};
  const saved=await save(project,organizer,'assignTasks',[fresh]);assert.equal(saved.revision,current.revision+1);assert.equal(saved.result.changedTaskCount,2);
  for(const task of saved.result.tasks){const old=current.state.tasks.find(t=>t.id===task.id);assert.equal(task.owner,actor);assert.equal(task.acceptedAt,'');assert.equal(task.status,'todo');assert.deepEqual(task.schedule,old.schedule);assert.equal(task.dueDate,old.dueDate);assert.equal(task.note,old.note);}
  const stable=stored(project);assert.equal((await mutate(project,organizer,'assignTasks',[fresh],current.revision)).status,409);assert.deepEqual(stored(project),stable);
  const accepted=await save(project,teammate,'acceptTasks',[saved.result.tasks.map(t=>({id:t.id,revision:t.revision}))]);assert.ok(accepted.result.every(t=>t.acceptedBy===actor&&t.status==='todo'));
});
test('assignment target removal or renewed membership at commit cannot partially save',async()=>{
  for(const renewed of [false,true]){
    const {project,actor}=await setup(),task=(await save(project,organizer,'addTask',[{title:'School dance check-in'}])).result;
    const baseline=stored(project);let intercepted=false;
    beforeRun=(sql,args)=>{if(!isCommit(project,sql,args)||intercepted)return;intercepted=true;sqlite.prepare('UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE project_id=? AND actor_id=?').run(renewed?'':'removed',project,actor);};
    try{assert.equal((await mutate(project,organizer,'assignTasks',[{owner:actor,tasks:[{id:task.id,revision:task.revision}]}],baseline.revision)).status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);}finally{beforeRun=undefined;}
  }
});
test('linked creation target removal or renewed membership cannot save either task or link',async()=>{
  for(const renewed of [false,true]){
    const {project,actor}=await setup(),task=(await save(project,organizer,'addTask',[{title:'School dance delivery'}])).result;
    const baseline=stored(project);let intercepted=false;
    beforeRun=(sql,args)=>{if(!isCommit(project,sql,args)||intercepted)return;intercepted=true;sqlite.prepare('UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE project_id=? AND actor_id=?').run(renewed?'':'removed',project,actor);};
    try{
      const response=await mutate(project,organizer,'addLinkedTask',[task.id,{title:'Prepare welcome signs',note:'Fictional shared instructions.',owner:actor,kind:'related',reason:'Supports guest arrival.'}],baseline.revision);
      assert.equal(response.status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);
    }finally{beforeRun=undefined;}
  }
});
test('linked creation loses organizer authority even if old organizer remains a teammate',async()=>{
  const {project}=await setup(),task=(await save(project,organizer,'addTask',[{title:'Corporate event delivery'}])).result;
  // Match the organizer snapshot's synthetic membership generation so the
  // ordinary member-access predicate still passes after ownership is lost.
  // Only the additional current-organizer predicate must reject this write.
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at,revision) VALUES (?,?,?,?,?,?,0)').run('linked-old-owner',project,organizer.userId,'jack','fictional',new Date().toISOString());
  const baseline=stored(project);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(project,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,project);}};
  try{
    const response=await mutate(project,organizer,'addLinkedTask',[task.id,{title:'Prepare briefing',note:'Fictional shared instructions.',owner:'jack',kind:'dependency',reason:'Needed before delivery.'}],baseline.revision);
    assert.equal(response.status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);
  }finally{beforeRun=undefined;}
});
test('assignment loses organizer authority even if old organizer remains a teammate',async()=>{
  const {project}=await setup(),task=(await save(project,organizer,'addTask',[{title:'Corporate handoff'}])).result;
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)').run('batch-old-owner',project,organizer.userId,'jack','fictional',new Date().toISOString());
  const baseline=stored(project);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(project,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,project);}};
  try{assert.equal((await mutate(project,organizer,'assignTasks',[{owner:'jack',tasks:[{id:task.id,revision:task.revision}]}],baseline.revision)).status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);}finally{beforeRun=undefined;}
});
test('task outcomes are persistent shared requirements, organizer-edited and unchanged by member reporting',async()=>{
  const {project,actor}=await setup();
  try{
    const created=(await save(project,organizer,'addTask',[{title:'Fictional school welcome',owner:actor,scope:'A reviewed welcome route and named greeter.',note:'Initial context',requiresVerification:true,schedule:{start:'2027-01-08T17:00',end:'2027-01-08T17:30',location:'Fictional hall'}}])).result;
    assert.equal(created.scope,'A reviewed welcome route and named greeter.');
    await save(project,teammate,'acceptTask',[created.id]);await save(project,teammate,'setNextUp',[created.id,{enabled:true}]);
    let baseline=stored(project);
    for(const [method,args,status] of [['setTaskOutcome',[created.id,'Forged requirement'],403],['updateTask',[created.id,{scope:'Forged generic patch'}],403],['setTaskOutcome',[created.id,'Forged actor','jack'],400]]){
      assert.equal((await mutate(project,teammate,method,args)).status,status);assert.deepEqual(stored(project),baseline);
    }
    await save(project,teammate,'updateTask',[created.id,{status:'progress',note:'Drafting the route.'}]);
    const before=(await read(project)).state.tasks.find(task=>task.id===created.id);assert.equal(before.scope,created.scope);baseline=stored(project);
    assert.equal((await mutate(project,organizer,'setTaskOutcome',[created.id,'Stale review'],baseline.revision-1)).status,409);assert.deepEqual(stored(project),baseline);
    for(const value of [null,{},'x'.repeat(3001)]){assert.equal((await mutate(project,organizer,'setTaskOutcome',[created.id,value])).status,400);assert.deepEqual(stored(project),baseline);}
    const changed=(await save(project,organizer,'setTaskOutcome',[created.id,'Organizer-approved route, named greeter and accessible entrance.'])).result;
    assert.equal(changed.acceptedAt,'');assert.equal(changed.nextUpAt,'');assert.equal(changed.scope,'Organizer-approved route, named greeter and accessible entrance.');
    for(const key of ['status','note','owner','dueDate','schedule','dependencies','updatedAt','updatedBy'])assert.deepEqual(changed[key],before[key],key);
    assert.match(changed.comments.at(-1).text,/Previous outcome: A reviewed welcome route/);
    await save(project,teammate,'acceptTask',[created.id]);await save(project,teammate,'reportCompletion',[created.id,'Reviewed route and greeter recorded.']);
    baseline=stored(project);assert.equal((await mutate(project,organizer,'setTaskOutcome',[created.id,'Replace pending work'])).status,400);assert.deepEqual(stored(project),baseline);
    await save(project,organizer,'verifyTask',[created.id]);baseline=stored(project);assert.equal((await mutate(project,organizer,'setTaskOutcome',[created.id,'Rewrite history'])).status,400);assert.deepEqual(stored(project),baseline);
    assert.equal((await read(project,teammate)).state.tasks.find(task=>task.id===created.id).scope,changed.scope);
    await save(project,organizer,'completeSetup',[{membersCanCreateTasks:true}]);const memberTask=(await save(project,teammate,'addTask',[{title:'Fictional guest signs',owner:actor,scope:'Guests can identify the entrance.'}])).result;assert.equal(memberTask.scope,'Guests can identify the entrance.');assert.equal(memberTask.status,'todo');
  }finally{sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
});
for(const action of ['setTaskOutcome','resolveRecovery'])test(action+' outcome edit loses organizer authority at commit even if old organizer retains member access',async()=>{
  const {project}=await setup(),task=(await save(project,organizer,'addTask',[{title:'Corporate handoff criteria',scope:'Original required result.',owner:'jack'}])).result;
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at,revision) VALUES (?,?,?,?,?,?,0)').run('outcome-old-owner-'+project,project,organizer.userId,'jack','fictional',new Date().toISOString());
  const baseline=stored(project);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(project,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,project);}};
  const args=action==='setTaskOutcome'?[task.id,'Unauthorized changed outcome.']:[task.id,{action:'scope',scope:'Unauthorized smaller outcome.',note:'Fictional decision.',reviewAfter:'2027-01-09'}];
  try{assert.equal((await mutate(project,organizer,action,args,baseline.revision)).status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);}finally{beforeRun=undefined;sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
});
test('completion return is organizer-only, preserves evidence/outcome and permits owner resubmission before verification',async()=>{
  const {project,actor}=await setup();
  try{
    const task=(await save(project,organizer,'addTask',[{title:'Fictional reviewed welcome plan',owner:actor,scope:'Route and greeter confirmed.',requiresVerification:true}])).result;
    const report=(await save(project,teammate,'reportCompletion',[task.id,{note:'Route prepared.',links:['https://www.nasa.gov/']}])).result;
    let baseline=stored(project);assert.equal((await mutate(project,teammate,'returnCompletion',[task.id,'Self approval.'])).status,403);assert.deepEqual(stored(project),baseline);
    assert.equal((await mutate(project,organizer,'returnCompletion',[task.id,'Stale review.'],baseline.revision-1)).status,409);assert.deepEqual(stored(project),baseline);
    const returned=(await save(project,organizer,'returnCompletion',[task.id,'Name the greeter before resubmitting.'])).result;
    assert.equal(returned.status,'progress');assert.equal(returned.reportedAt,'');assert.equal(returned.verifiedAt,'');assert.equal(returned.scope,task.scope);assert.deepEqual(returned.completionEvidenceHistory[0],report.completionEvidence);assert.equal(returned.updatedAt,report.updatedAt);assert.equal(returned.updatedBy,report.updatedBy);assert.equal(returned.completionReview.actor,'jack');
    baseline=stored(project);assert.equal((await mutate(project,organizer,'verifyTask',[task.id])).status,400);assert.deepEqual(stored(project),baseline);
    await save(project,teammate,'updateTask',[task.id,{status:'progress',note:'Greeter review in progress.'}]);assert.ok((await read(project,teammate)).state.tasks.find(t=>t.id===task.id).completionReview);
    const revised=(await save(project,teammate,'reportCompletion',[task.id,'Route and greeter confirmed.'])).result;assert.equal(revised.completionReview,null);assert.equal(revised.status,'progress');assert.equal(revised.scope,task.scope);
    baseline=stored(project);assert.equal((await mutate(project,organizer,'returnCompletion',[task.id,'Old review cannot clear new report.'],baseline.revision-1)).status,409);assert.deepEqual(stored(project),baseline);
    const verified=(await save(project,organizer,'verifyTask',[task.id])).result;assert.equal(verified.status,'done');assert.equal(verified.verifiedBy,'jack');assert.ok(verified.reportedBy);assert.equal(verified.completionEvidenceHistory.length,1);assert.ok(verified.comments.some(comment=>comment.kind==='completion-returned'));
  }finally{sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
});
test('completion return loses organizer authority at commit even if old organizer retains member access',async()=>{
  const {project,actor}=await setup(),task=(await save(project,organizer,'addTask',[{title:'Corporate report review',owner:actor,requiresVerification:true}])).result;
  await save(project,teammate,'reportCompletion',[task.id,'Fictional work reported.']);
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at,revision) VALUES (?,?,?,?,?,?,0)').run('return-old-owner-'+project,project,organizer.userId,'jack','fictional',new Date().toISOString());
  const baseline=stored(project);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(project,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,project);}};
  try{assert.equal((await mutate(project,organizer,'returnCompletion',[task.id,'Needs another check.'],baseline.revision)).status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);}finally{beforeRun=undefined;sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
});
for(const winnerMethod of ['verifyTask','returnCompletion'])test('overlapping verify/return retains only the '+winnerMethod+' decision',async()=>{
  const {project,actor}=await setup(),task=(await save(project,organizer,'addTask',[{title:'Fictional event review race',owner:actor,requiresVerification:true}])).result;
  await save(project,teammate,'reportCompletion',[task.id,'Fictional reported result.']);const baseline=stored(project);
  let arrived=0,release,releaseLoser;const gate=new Promise(resolve=>release=resolve),winnerFinished=new Promise(resolve=>releaseLoser=resolve);
  const actions=[{method:'verifyTask',args:[task.id]},{method:'returnCompletion',args:[task.id,'Review the missing result.']}];
  beforeRun=async(sql,args)=>{if(!isCommit(project,sql,args))return;const method=JSON.parse(args[0]).activity[0].type==='verified'?'verifyTask':'returnCompletion';if(++arrived===2)release();await gate;if(method!==winnerMethod)await winnerFinished;};
  try{
    const responses=await bounded(Promise.all(actions.map(action=>mutate(project,organizer,action.method,action.args,baseline.revision).finally(()=>{if(action.method===winnerMethod)releaseLoser();}))));
    assert.equal(arrived,2);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(responses[actions.findIndex(action=>action.method===winnerMethod)].status,200);
    const final=(await read(project)).state.tasks.find(t=>t.id===task.id);assert.equal(stored(project).revision,baseline.revision+1);
    if(winnerMethod==='verifyTask'){assert.equal(final.status,'done');assert.ok(final.verifiedAt);assert.equal(final.completionReview,null);assert.ok(final.completionEvidence);}else{assert.equal(final.status,'progress');assert.equal(final.verifiedAt,'');assert.equal(final.reportedAt,'');assert.ok(final.completionReview);assert.equal(final.completionEvidenceHistory.length,1);assert.equal(final.completionEvidence,null);}
  }finally{release();releaseLoser();beforeRun=undefined;sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
});
async function amendmentFixture(){
  const {project,actor}=await setup();
  const task=(await save(project,organizer,'addTask',[{title:'Fictional reviewed handoff',owner:actor,requiresVerification:true}])).result;
  await save(project,teammate,'reportCompletion',[task.id,'Original fictional report.']);
  const verified=(await save(project,organizer,'verifyTask',[task.id])).result;
  const amended=(await save(project,teammate,'setCompletionEvidence',[task.id,{note:'Fictional amended report.'}])).result;
  return {project,actor,task:amended,verified};
}
test('amendment acknowledgment is organizer-only, binds both revisions and persists without rewriting verification',async()=>{
  const {project,task,verified}=await amendmentFixture();
  const snap=await read(project),baseline=stored(project);
  assert.equal((await mutate(project,teammate,'reviewCompletionEvidence',[task.id,task.revision],snap.revision)).status,403);assert.deepEqual(stored(project),baseline);
  assert.equal((await mutate(project,organizer,'reviewCompletionEvidence',[task.id,task.revision,'jack'],snap.revision)).status,400);assert.deepEqual(stored(project),baseline);
  await save(project,teammate,'setCompletionEvidence',[task.id,{note:'Newer fictional amendment.'}]);
  const newer=stored(project);
  assert.equal((await mutate(project,organizer,'reviewCompletionEvidence',[task.id,task.revision],snap.revision)).status,409);assert.deepEqual(stored(project),newer);
  assert.equal((await mutate(project,organizer,'reviewCompletionEvidence',[task.id,task.revision])).status,400);assert.deepEqual(stored(project),newer);
  const latest=(await read(project)).state.tasks.find(t=>t.id===task.id);
  const acknowledged=(await save(project,organizer,'reviewCompletionEvidence',[task.id,latest.revision])).result;
  assert.equal(acknowledged.completionEvidenceReviewAt,verified.verifiedAt);
  for(const key of ['status','verifiedAt','verifiedBy','reportedAt','completedAt','completedBy','note','updatedAt','updatedBy','completionEvidence'])assert.deepEqual(acknowledged[key],latest[key],key);
  assert.equal(acknowledged.comments.at(-1).kind,'completion-evidence-reviewed');assert.equal(acknowledged.comments.at(-1).actor,'jack');
  const reloaded=(await read(project,teammate)).state.tasks.find(t=>t.id===task.id);assert.equal(reloaded.completionEvidenceReviewAt,verified.verifiedAt);
  await save(project,teammate,'setCompletionEvidence',[task.id,{note:'Another fictional amendment.'}]);
  assert.equal((await read(project)).state.tasks.find(t=>t.id===task.id).completionEvidenceReviewAt,'');
});
test('amendment acknowledgment rechecks organizer authority at commit even with retained member access',async()=>{
  const {project,task}=await amendmentFixture();
  sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at,revision) VALUES (?,?,?,?,?,?,0)').run('amend-old-owner-'+project,project,organizer.userId,'jack','fictional',new Date().toISOString());
  const baseline=stored(project);let intercepted=false;
  beforeRun=(sql,args)=>{if(isCommit(project,sql,args)){intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run(teammate.userId,project);}};
  try{assert.equal((await mutate(project,organizer,'reviewCompletionEvidence',[task.id,task.revision],baseline.revision)).status,409);assert.ok(intercepted);assert.deepEqual(stored(project),baseline);}finally{beforeRun=undefined;}
});
for(const winner of ['reviewCompletionEvidence','setCompletionEvidence'])test('overlapping amendment review/edit retains only '+winner,async()=>{
  const {project,task}=await amendmentFixture(),baseline=stored(project);
  let arrived=0,release,finish;const gate=new Promise(resolve=>release=resolve),winnerDone=new Promise(resolve=>finish=resolve);
  const actions=[{method:'reviewCompletionEvidence',user:organizer,args:[task.id,task.revision]},{method:'setCompletionEvidence',user:teammate,args:[task.id,{note:'Concurrent fictional amendment.'}]}];
  beforeRun=async(sql,args)=>{if(!isCommit(project,sql,args))return;const method=JSON.parse(args[0]).activity[0].type==='completion-evidence-reviewed'?'reviewCompletionEvidence':'setCompletionEvidence';if(++arrived===2)release();await gate;if(method!==winner)await winnerDone;};
  try{
    const responses=await bounded(Promise.all(actions.map(action=>mutate(project,action.user,action.method,action.args,baseline.revision).finally(()=>{if(action.method===winner)finish();}))));
    assert.equal(arrived,2);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(responses[actions.findIndex(a=>a.method===winner)].status,200);
    const final=(await read(project)).state.tasks.find(t=>t.id===task.id);
    assert.equal(stored(project).revision,baseline.revision+1);assert.equal(final.verifiedAt,task.verifiedAt);assert.equal(final.status,'done');
    assert.equal(final.completionEvidenceReviewAt,winner==='reviewCompletionEvidence'?task.verifiedAt:'');
    assert.equal(final.completionEvidence.note,winner==='reviewCompletionEvidence'?task.completionEvidence.note:'Concurrent fictional amendment.');
  }finally{release();finish();beforeRun=undefined;}
});
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Commit barrier was not reached')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const firstWriter of ['organizer', 'teammate']) {
  test(`overlapping schedule/report retains the ${firstWriter}-first winner, then merges only after fresh review`, async () => {
    const { project, actor } = await setup();
    const memberTask = (
      await save(project, organizer, 'addTask', [
        {
          title: 'Prepare welcome desk',
          owner: actor,
          requiresVerification: true,
        },
      ])
    ).result;
    const ownerTask = (
      await save(project, organizer, 'addTask', [
        { title: 'Open the hall', owner: 'jack' },
      ])
    ).result;
    const base = await read(project),
      initial = JSON.parse(stored(project).data);
    const slot = {
      start: '2026-11-20T17:00',
      end: '2026-11-20T17:15',
      location: 'School hall',
    };
    const actions = [
      {
        user: organizer,
        method: 'setTaskSchedule',
        args: [ownerTask.id, slot],
      },
      {
        user: teammate,
        method: 'reportCompletion',
        args: [memberTask.id, 'Fictional desk prepared.'],
      },
    ];
    const expectedWinner = firstWriter === 'organizer' ? 0 : 1;
    const winnerActor = expectedWinner === 0 ? 'jack' : actor;
    let arrived = 0,
      release,
      releaseLoser;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const winnerFinished = new Promise((resolve) => {
      releaseLoser = resolve;
    });
    beforeRun = async (sql, args) => {
      if (!isCommit(project, sql, args)) return;
      const writer = JSON.parse(args[0]).activity[0].actor;
      assert.ok(writer === 'jack' || writer === actor);
      if (++arrived === 2) release();
      await gate;
      if (writer !== winnerActor) await winnerFinished;
    };
    let responses;
    try {
      responses = await bounded(
        Promise.all(
          actions.map((a, index) =>
            mutate(project, a.user, a.method, a.args, base.revision).finally(
              () => {
                if (index === expectedWinner) releaseLoser();
              },
            ),
          ),
        ),
      );
    } finally {
      release();
      releaseLoser();
      beforeRun = undefined;
    }
    assert.equal(
      arrived,
      2,
      'both requests reached the actual commit boundary',
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const winner = responses.findIndex((r) => r.status === 200),
      loser = 1 - winner;
    assert.equal(
      winner,
      expectedWinner,
      'the requested interleaving actually happened',
    );
    const won = await responses[winner].json(),
      current = await read(project);
    assert.equal(current.revision, base.revision + 1);
    assert.deepEqual(current.state, won.state);
    assert.equal(current.state.activity.length, initial.activity.length + 1);
    const unchangedTask = loser === 0 ? ownerTask.id : memberTask.id;
    assert.deepEqual(
      current.state.tasks.find((t) => t.id === unchangedTask),
      initial.tasks.find((t) => t.id === unchangedTask),
    );
    const retry = actions[loser];
    const merged = await save(project, retry.user, retry.method, retry.args);
    assert.equal(merged.revision, base.revision + 2);
    assert.deepEqual(
      merged.state.tasks.find((t) => t.id === ownerTask.id).schedule,
      slot,
    );
    const reported = merged.state.tasks.find((t) => t.id === memberTask.id);
    assert.equal(reported.status, 'progress');
    assert.equal(reported.reportedBy, teammate.displayName);
    assert.equal(reported.verifiedAt, '');
    assert.equal(
      (
        await mutate(
          project,
          teammate,
          'verifyTask',
          [memberTask.id],
          merged.revision,
        )
      ).status,
      403,
    );
    const verified = await save(project, organizer, 'verifyTask', [
      memberTask.id,
    ]);
    assert.equal(verified.result.status, 'done');
    assert.equal(
      verified.result.completionResult.reporter,
      teammate.displayName,
    );
    assert.equal(verified.result.verifiedBy, 'jack');
  });
}

for (const change of ['revoked', 'renewed']) {
  test(`a ${change} membership generation cannot commit an already-authorized completion report`, async () => {
    const { project, actor } = await setup();
    const task = (
      await save(project, organizer, 'addTask', [
        {
          title: 'Check entrance signs',
          owner: actor,
          requiresVerification: true,
        },
      ])
    ).result;
    await save(project, teammate, 'acceptTask', [task.id]);
    const baseline = stored(project);
    let intercepted = false;
    beforeRun = async (sql, args) => {
      if (!isCommit(project, sql, args) || intercepted) return;
      intercepted = true;
      // Deliberately leave workspace revision unchanged: isolate the commit-time
      // membership predicate from the separate workspace CAS protection. The
      // real team routes also bump the workspace revision, tested elsewhere.
      sqlite
        .prepare(
          'UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE project_id=? AND user_id=?',
        )
        .run(
          change === 'revoked' ? 'fictional-revocation' : '',
          project,
          teammate.userId,
        );
    };
    let response;
    try {
      response = await mutate(
        project,
        teammate,
        'reportCompletion',
        [task.id, 'Must not persist from old authorization.'],
        baseline.revision,
      );
    } finally {
      beforeRun = undefined;
    }
    assert.ok(intercepted);
    assert.equal(response.status, 409);
    assert.deepEqual(
      stored(project),
      baseline,
      'no completion, evidence, activity or revision partially committed',
    );
    const access = await as(teammate, () =>
      workspace.GET(request(`/api/workspace?project=${project}`)),
    );
    assert.equal(access.status, change === 'revoked' ? 404 : 200);
    if (change === 'renewed') {
      const retried = await save(project, teammate, 'reportCompletion', [
        task.id,
        'Fresh authorization and explicit retry.',
      ]);
      assert.equal(retried.result.status, 'progress');
      assert.equal(retried.result.reportedBy, teammate.displayName);
    }
  });
}

test('verification cannot overwrite a prerequisite reopened while verification was in flight', async () => {
  const { project, actor } = await setup();
  const prerequisite = (
    await save(project, organizer, 'addTask', [
      { title: 'Inspect hall layout', owner: 'jack' },
    ])
  ).result;
  const dependent = (
    await save(project, organizer, 'addTask', [
      {
        title: 'Prepare school room',
        owner: actor,
        requiresVerification: true,
      },
    ])
  ).result;
  await save(project, organizer, 'addDependency', [
    dependent.id,
    {
      taskId: prerequisite.id,
      reason: 'Room setup needs the confirmed layout.',
    },
  ]);
  await save(project, organizer, 'reportCompletion', [
    prerequisite.id,
    'Fictional layout confirmed.',
  ]);
  const pending = await save(project, teammate, 'reportCompletion', [
    dependent.id,
    'Fictional room prepared.',
  ]);
  let intervening,
    intercepted = false;
  beforeRun = async (sql, args) => {
    if (!isCommit(project, sql, args) || intercepted) return;
    intercepted = true;
    intervening = await save(project, organizer, 'updateTask', [
      prerequisite.id,
      { status: 'todo', note: 'Layout changed; inspect again.' },
    ]);
  };
  let verification;
  try {
    verification = await mutate(
      project,
      organizer,
      'verifyTask',
      [dependent.id],
      pending.revision,
    );
  } finally {
    beforeRun = undefined;
  }
  assert.ok(intercepted);
  assert.equal(verification.status, 409);
  const current = await read(project);
  assert.deepEqual(current.state, intervening.state);
  assert.equal(
    current.state.tasks.find((t) => t.id === dependent.id).verifiedAt,
    '',
  );
  const beforeRetry = stored(project);
  assert.equal(
    (
      await mutate(
        project,
        organizer,
        'verifyTask',
        [dependent.id],
        current.revision,
      )
    ).status,
    400,
  );
  assert.deepEqual(stored(project), beforeRetry);
  await save(project, organizer, 'reportCompletion', [
    prerequisite.id,
    'Reinspection finished.',
  ]);
  const finished = await save(project, organizer, 'verifyTask', [dependent.id]);
  assert.equal(finished.result.status, 'done');
  assert.equal(finished.result.completionResult.reporter, teammate.displayName);
});
