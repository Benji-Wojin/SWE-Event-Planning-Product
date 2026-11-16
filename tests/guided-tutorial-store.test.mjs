import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { build } from 'esbuild';
import { migrateDatabase, readMigrations } from '../scripts/migrate-vercel.mjs';

test('tutorial storage is ordered, idempotent, per account and based on real committed writes', async () => {
  const client = createClient({ url: 'file::memory:', intMode: 'number' });
  try {
    const migrations = await readMigrations();
    await migrateDatabase(client, { migrations: migrations.slice(0, -1), apply: true });
    // Preserve actual pre-migration rows, including an existing task with a
    // plausible title. The migration cannot reconstruct what was committed.
    const older = 'fictional-legacy', legacyProject = 'p_legacy', nearbyTask = 'task-existing-before-migration';
    await client.execute({sql:'INSERT INTO members(user_id,actor_id,email,name,role) VALUES(?,?,?,?,?)',
      args:[older,older,older+'@example.com','Fictional pre-migration user','member']});
    await client.execute({sql:'INSERT INTO projects(id,owner_id,request_payload,created_at) VALUES(?,?,?,?)',
      args:[legacyProject,older,'{}','2026-11-11']});
    await client.execute({sql:'INSERT INTO workspaces(id,data,revision) VALUES(?,?,?)',
      args:[legacyProject,JSON.stringify({tasks:[{id:nearbyTask,title:'First task'}]}),2]});
    const at='2026-11-11T10:00:00Z';
    for(const [checkpoint,projectId] of [['started',null],['project_created',legacyProject],['task_created',null]])
      await client.execute({sql:'INSERT INTO guided_tutorial_events(user_id,version,checkpoint,occurred_at,project_id) VALUES(?,?,?,?,?)',
        args:[older,1,checkpoint,at,projectId]});
    const migration = await migrateDatabase(client, { migrations, apply: true });
    assert.equal(migration.applied.length,1);
    assert.match(migration.applied[0],/^0013_/);
    const taskIdColumn=(await client.execute('PRAGMA table_info(guided_tutorial_events)')).rows.find(row=>row.name==='task_id');
    assert.equal(taskIdColumn.type,'TEXT');assert.equal(taskIdColumn.notnull,0);
    assert.equal((await migrateDatabase(client,{migrations,apply:true})).applied.length,0);
    const result = await build({
      stdin: { resolveDir: process.cwd(), contents: `
        export * from './lib/guided-tutorial-store';
        export { createDatabase } from './lib/platform/database';
      ` },
      bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false,
      plugins: [{ name: 'fictional-tutorial-database', setup(b) {
        b.onResolve({ filter: /^@\/lib\/runtime$/ }, () => ({ path: 'runtime', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const env={get DB(){return globalThis.__fixtureTutorialDb;}};',
        }));
      } }],
    });
    // The bundle has an external libSQL import; give its loader the normal
    // resolution context without requiring a persistent output file.
    const source = result.outputFiles[0].text.replace(
      /from "@libsql\/client"/g, 'from ' + JSON.stringify(import.meta.resolve('@libsql/client')),
    );
    const api = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    const db = globalThis.__fixtureTutorialDb = api.createDatabase(client);
    for (const id of ['fictional-one','fictional-two']) {
      await db.prepare('INSERT INTO members(user_id,actor_id,email,name,role) VALUES(?,?,?,?,?)')
        .bind(id,id,id+'@example.com','Fictional','member').run();
    }
    const one = 'fictional-one', two = 'fictional-two', project = 'p_one', other = 'p_two';
    const sameOwnerOther='p_other_one',first='task-fictional-first',second='task-fictional-second';
    const observe = api.recordTutorialObservation;
    const history = api.readTutorialProgress;
    const save = (user, id, p, statement) => db.batch([statement, api.tutorialCheckpointAfterCommit(user,id,p)]);
    const projectWrite = (user,p) => db.prepare('INSERT INTO projects(id,owner_id,request_payload,created_at) VALUES(?,?,?,?)')
      .bind(p,user,'{}','2026-11-11');
    const touched = p => db.prepare('UPDATE projects SET request_payload=request_payload WHERE id=?').bind(p);
    const insertWorkspace=(id,tasks=[],revision=1)=>db.prepare('INSERT INTO workspaces(id,data,revision) VALUES(?,?,?)')
      .bind(id,JSON.stringify({tasks}),revision);
    const writeWorkspace=(id,tasks,revision)=>db.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=? AND revision=?')
      .bind(JSON.stringify({tasks}),id,revision);
    const oldProgress=await history(older);
    assert.equal(oldProgress.projectId,legacyProject);
    assert.equal(oldProgress.firstTaskId,null);
    assert.deepEqual(oldProgress.events,[{checkpoint:'started',at},{checkpoint:'project_created',at},{checkpoint:'task_created',at}]);
    await api.tutorialCheckpointAfterTask(older,legacyProject,nearbyTask,2).run();
    assert.deepEqual(await history(older),oldProgress,'later saves cannot backfill the historic checkpoint');

    assert.equal(await observe(one,'setup_viewed',null),false);
    assert.equal(await observe(one,'started',null),true);
    assert.equal(await observe(one,'started',null),false);
    assert.equal(await observe(one,'setup_viewed',null),true);
    assert.equal(await observe(one,'project_created',project),false);
    await save(one,'project_created',project,projectWrite(one,project));
    await projectWrite(two,other).run();
    await projectWrite(one,sameOwnerOther).run();
    await insertWorkspace(project).run();
    await insertWorkspace(sameOwnerOther,[{id:first,title:'Decoy same title'}],2).run();
    assert.equal((await history(one)).projectId,project);
    assert.equal((await history(one)).firstTaskId,null);
    assert.equal(await observe(one,'add_task_clicked',other),false);
    assert.equal(await observe(one,'add_task_clicked',project),true);
    assert.equal(await observe(one,'budget_viewed',project),false);
    const record=(user,p,id,revision)=>api.tutorialCheckpointAfterTask(user,p,id,revision);
    const exactFirst={id:first,title:'Fictional first task'};
    const noWrites=await db.batch([writeWorkspace(project,[exactFirst],0),record(one,project,first,2)]);
    assert.deepEqual(noWrites.map(result=>result.meta.changes),[0,0]);
    assert.equal((await record(one,project,'task-missing',1).run()).meta.changes,0);
    assert.equal((await record(one,sameOwnerOther,first,2).run()).meta.changes,0,'ownership alone is not the guide binding');
    assert.equal((await record(two,project,first,2).run()).meta.changes,0);
    assert.ok(!(await history(one)).events.some(e=>e.checkpoint==='task_created'));
    const writes=await db.batch([writeWorkspace(project,[exactFirst],1),record(two,project,first,2),
      record(one,project,first,1),record(one,project,'task-missing',2),record(one,project,first,2)]);
    assert.deepEqual(writes.map(result=>result.meta.changes),[1,0,0,0,1]);
    const secondWrite=await db.batch([writeWorkspace(project,[exactFirst,{id:second,title:'Same title not enough'}],2),record(one,project,second,3)]);
    assert.deepEqual(secondWrite.map(result=>result.meta.changes),[1,0]);
    assert.equal((await history(one)).firstTaskId,first);
    assert.equal(await observe(one,'event_details_viewed',project),false);
    assert.equal(await observe(one,'budget_viewed',project),true);
    assert.equal(await observe(one,'event_details_viewed',project),true);
    await save(one,'invite_created',project,touched(project));
    const completed = await history(one);
    assert.deepEqual(completed.events.map(event=>event.checkpoint),[
      'started','setup_viewed','project_created','add_task_clicked','task_created',
      'budget_viewed','event_details_viewed','invite_created',
    ]);
    assert.equal((await history(two)).events.length,0);
    assert.equal((await history(two)).firstTaskId,null);
    assert.equal(completed.firstTaskId,first);
    assert.ok(completed.events.every(event=>Object.keys(event).sort().join(',')==='at,checkpoint'));
    assert.ok(completed.events.every(event=>/^\d{4}-\d{2}-\d{2}T/.test(event.at)));
    await db.prepare('UPDATE projects SET owner_id=? WHERE id=?').bind(two,project).run();
    assert.equal((await history(one)).firstTaskId,null,'a former owner does not get the stored task id');
    assert.equal((await history(two)).firstTaskId,null,'the new owner does not inherit the guide');
    await db.prepare('DELETE FROM projects WHERE id=?').bind(project).run();
    assert.equal((await history(one)).firstTaskId,null,'a deleted project does not disclose the task id');
    assert.deepEqual((await history(one)).events,completed.events,'history remains intact without the resume id');
  } finally {
    delete globalThis.__fixtureTutorialDb;
    client.close();
  }
});
