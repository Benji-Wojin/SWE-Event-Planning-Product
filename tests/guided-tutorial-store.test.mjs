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
    const migration = await migrateDatabase(client, { migrations, apply: true });
    assert.deepEqual(migration.applied, ['0012_guided_tutorial_events.sql']);
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
    const observe = api.recordTutorialObservation;
    const history = api.readTutorialProgress;
    const save = (user, id, p, statement) => db.batch([statement, api.tutorialCheckpointAfterCommit(user,id,p)]);
    const projectWrite = (user,p) => db.prepare('INSERT INTO projects(id,owner_id,request_payload,created_at) VALUES(?,?,?,?)')
      .bind(p,user,'{}','2026-11-11');
    const touched = p => db.prepare('UPDATE projects SET request_payload=request_payload WHERE id=?').bind(p);

    assert.equal(await observe(one,'setup_viewed',null),false);
    assert.equal(await observe(one,'started',null),true);
    assert.equal(await observe(one,'started',null),false);
    assert.equal(await observe(one,'setup_viewed',null),true);
    assert.equal(await observe(one,'project_created',project),false);
    await save(one,'project_created',project,projectWrite(one,project));
    await projectWrite(two,other).run();
    assert.equal((await history(one)).projectId,project);
    assert.equal(await observe(one,'add_task_clicked',other),false);
    assert.equal(await observe(one,'add_task_clicked',project),true);
    assert.equal(await observe(one,'budget_viewed',project),false);
    await save(one,'task_created',project,touched('missing'));
    assert.ok(!(await history(one)).events.some(e=>e.checkpoint==='task_created'));
    await save(one,'task_created',project,touched(project));
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
    assert.ok(completed.events.every(event=>/^\d{4}-\d{2}-\d{2}T/.test(event.at)));
  } finally {
    delete globalThis.__fixtureTutorialDb;
    client.close();
  }
});
