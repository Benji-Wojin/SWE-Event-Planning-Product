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
