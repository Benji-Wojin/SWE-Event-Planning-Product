import { test } from 'node:test';
import assert from 'node:assert/strict';
export function budgetTests(deps) {
  const { sqlite, owner, infoRead, infoWrite, env } = deps;
  const cost = (values) => ({
    title: 'Fictional school dance venue',
    estimate: '100.10',
    committed: '90',
    paid: '20',
    owner: '',
    taskId: '',
    dueDate: '2026-11-01',
    status: 'active',
    ...values,
  });
  function setup() {
    owner();
    const id = 'p_' + crypto.randomUUID(),
      data = sqlite
        .prepare("SELECT data FROM workspaces WHERE id='main'")
        .get().data;
    sqlite
      .prepare(
        'INSERT INTO projects (id,owner_id,request_payload,created_at) VALUES (?,?,?,?)',
      )
      .run(id, 'owner-1', '{}', new Date().toISOString());
    sqlite
      .prepare('INSERT INTO workspaces (id,data,revision) VALUES (?,?,1)')
      .run(id, data);
    return '?project=' + id;
  }
  const write = (query, revision, fields) =>
    infoWrite({ ...fields, revision, requestId: crypto.randomUUID() }, query);
  const enabled = async (query) => {
    let state = await (await infoRead(query)).json();
    const response = await write(query, state.revision, {
      action: 'budgetSettings',
      settings: { enabled: true, currency: 'USD', target: '500' },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  test('manual budget starts optional, encrypts costs, links tasks without changing them and stays out of AI/workspace export', async () => {
    const query = setup(),
      id = query.slice(9),
      before = sqlite
        .prepare('SELECT data,revision FROM workspaces WHERE id=?')
        .get(id);
    assert.equal((await (await infoRead(query)).json()).budget.enabled, false);
    let state = await enabled(query);
    const task = JSON.parse(before.data).tasks[0];
    const response = await write(query, state.revision, {
      action: 'budgetItem',
      id: '',
      item: cost({ taskId: task?.id || '', owner: 'jack' }),
    });
    assert.equal(response.status, 200);
    state = await response.json();
    assert.equal(state.budget.items[0].estimate, 10010);
    assert.equal(state.budget.history.length, 2);
    assert.deepEqual(
      sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),
      before,
    );
    assert.ok(
      !sqlite
        .prepare('SELECT payload FROM project_info WHERE scope=?')
        .get(id)
        .payload.includes('Fictional school dance venue'),
    );
    const snapshot = await (
      await deps.workspace.GET(
        new Request('https://gather.example/api/workspace' + query),
      )
    ).json();
    assert.ok(
      !JSON.stringify(snapshot).includes('Fictional school dance venue'),
    );
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetItem',
          id: '',
          item: cost({ taskId: 'another-project-task' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetItem',
          id: '',
          item: cost({ owner: 'outside-member' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetItem',
          id: '',
          item: cost({ bankAccount: 'forbidden' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (await (await infoRead(setup())).json()).budget.items.length,
      0,
    );
  });
  test('organizer-only writes; teammates read current project, revoked users cannot read or replay', async () => {
    const query = setup(),
      id = query.slice(9);
    let state = await enabled(query);
    const input = {
      action: 'budgetItem',
      id: '',
      item: cost(),
      revision: state.revision,
      requestId: crypto.randomUUID(),
    };
    state = await (await infoWrite(input, query)).json();
    const user = 'budget-' + crypto.randomUUID();
    sqlite
      .prepare(
        'INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)',
      )
      .run(
        user,
        'u_' + user,
        user + '@example.com',
        'Fictional teammate',
        'member',
      );
    sqlite
      .prepare(
        'INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)',
      )
      .run(user, id, user, 'u_' + user, 'fictional', new Date().toISOString());
    globalThis.__gatherUser = {
      userId: user,
      email: user + '@example.com',
      displayName: 'Fictional teammate',
    };
    assert.equal((await (await infoRead(query)).json()).budget.items.length, 1);
    assert.equal((await infoWrite(input, query)).status, 403);
    sqlite
      .prepare(
        "UPDATE project_members SET revoked_at='now',revision=revision+1 WHERE id=?",
      )
      .run(user);
    assert.equal((await infoRead(query)).status, 404);
    assert.equal((await infoWrite(input, query)).status, 404);
    owner();
    const context = await deps.infoCore.infoContext(
      new Request('https://gather.example/api/info' + query),
    );
    sqlite
      .prepare('UPDATE projects SET owner_id=? WHERE id=?')
      .run('new-owner', id);
    await assert.rejects(
      deps.infoCore.mutateInfo(context, input),
      (error) => error.status === 403,
    );
  });
  test('budget saves are idempotent and concurrent stale edits cannot overwrite; currency never reinterprets costs', async () => {
    const query = setup();
    let state = await enabled(query);
    const input = {
      action: 'budgetItem',
      id: '',
      item: cost(),
      revision: state.revision,
      requestId: crypto.randomUUID(),
    };
    const saved = await infoWrite(input, query);
    assert.equal(saved.status, 200);
    state = await saved.json();
    assert.deepEqual(await (await infoWrite(input, query)).json(), state);
    assert.equal(
      (await infoWrite({ ...input, item: cost({ paid: '999' }) }, query))
        .status,
      409,
    );
    assert.equal(
      (await infoWrite({ ...input, requestId: crypto.randomUUID() }, query))
        .status,
      409,
    );
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetSettings',
          settings: { enabled: true, currency: 'JPY', target: '500' },
        })
      ).status,
      400,
    );
    const itemId = state.budget.items[0].id;
    const responses = await Promise.all(
      ['40', '50'].map((paid) =>
        write(query, state.revision, {
          action: 'budgetItem',
          id: itemId,
          item: cost({ paid }),
        }),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409],
    );
    state = await (await infoRead(query)).json();
    state = await (
      await write(query, state.revision, {
        action: 'budgetArchive',
        id: itemId,
        archived: true,
      })
    ).json();
    assert.ok(state.budget.items[0].archivedAt);
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetItem',
          id: itemId,
          item: cost(),
        })
      ).status,
      400,
    );
    state = await (
      await write(query, state.revision, {
        action: 'budgetSettings',
        settings: { enabled: false, currency: 'USD', target: '' },
      })
    ).json();
    assert.equal(state.budget.items.length, 1);
    assert.equal(state.budget.enabled, false);
    assert.equal(
      (
        await write(query, state.revision, {
          action: 'budgetItem',
          id: '',
          item: cost(),
        })
      ).status,
      400,
    );
  });
  test('write-time organizer and workspace-revision guards reject changes made during an in-flight save', async () => {
    for (const race of ['ownership', 'task']) {
      const query = setup(),
        id = query.slice(9);
      const state = await enabled(query);
      const prepare = env.DB.prepare;
      env.DB.prepare = function (sql) {
        if (sql.startsWith('UPDATE project_info SET payload=')) {
          if (race === 'ownership')
            sqlite
              .prepare('UPDATE projects SET owner_id=? WHERE id=?')
              .run('someone-else', id);
          else
            sqlite
              .prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?')
              .run(id);
        }
        return prepare.call(this, sql);
      };
      try {
        assert.equal(
          (
            await write(query, state.revision, {
              action: 'budgetItem',
              id: '',
              item: cost(),
            })
          ).status,
          409,
        );
      } finally {
        env.DB.prepare = prepare;
      }
    }
  });
}
