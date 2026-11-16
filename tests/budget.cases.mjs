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
  const workspaceSnapshot = async (query = '') => {
    const response = await deps.workspace.GET(new Request('https://gather.example/api/workspace' + query));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const budgetSnapshot = async query => {
    const response = await infoRead(query);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const saveCost = async (query, state, id, item) => {
    const response = await write(query, state.revision, { action: 'budgetItem', id, item });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  async function linkFixture(t) {
    owner();
    await workspaceSnapshot();
    const query = setup(), project = query.slice(9);
    const workspaceRow = () => sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);
    const members = [];
    t.after(() => {
      owner();
      sqlite.prepare('DELETE FROM project_info WHERE scope=?').run(project);
      sqlite.prepare('DELETE FROM project_members WHERE project_id=?').run(project);
      sqlite.prepare('DELETE FROM workspaces WHERE id=?').run(project);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);
      for (const user of members) sqlite.prepare('DELETE FROM members WHERE user_id=?').run(user);
    });
    const addMember = (name, revoked = false) => {
      const userId = 'budget-link-' + crypto.randomUUID(), actorId = 'u_' + userId;
      members.push(userId);
      sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)')
        .run(userId, actorId, userId + '@example.com', name, 'member');
      sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at,revoked_at) VALUES (?,?,?,?,?,?,?)')
        .run(userId, project, userId, actorId, 'fictional', '2026-10-01T00:00:00Z', revoked ? '2026-10-02T00:00:00Z' : '');
      return { userId, actorId };
    };
    const addTask = async (title, status = 'todo') => {
      const response = await deps.workspace.POST(new Request('https://gather.example/api/workspace' + query, {
        method: 'POST',
        headers: { Origin: 'https://gather.example', 'X-Gather-Request': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: workspaceRow().revision, method: 'addTask', args: [{ title, status, owner: 'jack' }] }),
      }));
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).result.id;
    };
    const history = (edit) => {
      const state = JSON.parse(workspaceRow().data);
      edit(state);
      // Seed historical records; there is no organizer RPC for task archiving.
      sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(state), project);
    };
    return { query, project, workspaceRow, addMember, addTask, history };
  }
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
  test('budget link choices allow real and organizer owners, not former or example teammates', async t => {
    const { query, workspaceRow, addMember, history } = await linkFixture(t);
    const active = addMember('Fictional current teammate').actorId;
    const former = addMember('Fictional former teammate', true).actorId;
    const example = 'fictional-budget-example';
    history(state => state.members.push({ id: example, name: 'Fictional legacy volunteer', initials: 'FV', role: 'Volunteer', color: 'mint' }));
    const workspace = await workspaceSnapshot(query);
    assert.equal(workspace.state.members.find(row => row.id === active).active, true);
    assert.equal(workspace.state.members.find(row => row.id === former).active, false);
    assert.match(workspace.state.members.find(row => row.id === example).role, /· example/);

    const unchangedWorkspace = workspaceRow();
    let state = await enabled(query);
    state = await saveCost(query, state, '', cost({ owner: active }));
    const id = state.budget.items[0].id;
    assert.equal(state.budget.items[0].owner, active);
    state = await saveCost(query, state, id, cost({ owner: 'jack' }));
    assert.equal(state.budget.items[0].owner, 'jack');
    for (const owner of [former, example]) {
      const rejected = await write(query, state.revision, { action: 'budgetItem', id, item: cost({ owner }) });
      assert.equal(rejected.status, 400, await rejected.clone().text());
      assert.match((await rejected.json()).error, /owner|member|teammate/i);
      assert.deepEqual(await budgetSnapshot(query), state, 'rejecting a new owner does not change the cost or history');
      assert.deepEqual(workspaceRow(), unchangedWorkspace);
    }
  });
  test('budget link choices preserve original historical links, but only current tasks are new choices', async t => {
    const { query, project, workspaceRow, addMember, addTask, history } = await linkFixture(t);
    const oldMember = addMember('Fictional original volunteer');
    const active = addMember('Fictional replacement teammate').actorId;
    const originalTask = await addTask('Fictional original production task');
    const currentTask = await addTask('Fictional current production task');
    const completedTask = await addTask('Fictional completed production task', 'done');
    const anotherArchived = await addTask('Fictional different archived task');
    let state = await enabled(query);
    const original = cost({ owner: oldMember.actorId, taskId: originalTask });
    state = await saveCost(query, state, '', original);
    const id = state.budget.items[0].id;
    state = await saveCost(query, state, '', cost({ title: 'Fictional other budget cost', owner: active, taskId: currentTask }));
    const other = state.budget.items.find(row => row.id !== id);
    assert.equal(other.taskId, currentTask);
    state = await saveCost(query, state, other.id, cost({ title: other.title, owner: active, taskId: completedTask }));
    assert.equal(state.budget.items.find(row => row.id === other.id).taskId, completedTask);
    assert.ok(JSON.parse(workspaceRow().data).members.some(row => row.id === oldMember.actorId));
    sqlite.prepare('DELETE FROM project_members WHERE id=? AND project_id=?').run(oldMember.userId, project);
    history(saved => {
      for (const task of saved.tasks.filter(row => [originalTask, anotherArchived].includes(row.id))) task.archivedAt = '2026-10-20T16:00:00Z';
    });
    const workspace = await workspaceSnapshot(query);
    assert.match(workspace.state.members.find(row => row.id === oldMember.actorId).role, /· example/);
    assert.ok(workspace.state.tasks.find(row => row.id === originalTask).archivedAt);
    assert.equal(workspace.state.tasks.find(row => row.id === completedTask).status, 'done');
    const unchangedWorkspace = workspaceRow();
    const payment = { ...original, paid: '35.25' };
    state = await saveCost(query, state, id, payment);
    const savedLinks = () => {
      const row = state.budget.items.find(row => row.id === id);
      return [row.owner, row.taskId, row.paid];
    };
    assert.deepEqual(savedLinks(), [oldMember.actorId, originalTask, 3525]);
    assert.deepEqual(state.budget.history.at(-1).after, state.budget.items.find(row => row.id === id));

    for (const [costId, taskId] of [[other.id, originalTask], [id, anotherArchived]]) {
      const rejected = await write(query, state.revision, { action: 'budgetItem', id: costId, item: cost({ taskId }) });
      assert.equal(rejected.status, 400, await rejected.clone().text());
      assert.match((await rejected.json()).error, /task/i);
      assert.deepEqual(await budgetSnapshot(query), state, 'a historical link may stay only on its original cost');
      assert.deepEqual(workspaceRow(), unchangedWorkspace);
    }
    state = await saveCost(query, state, id, { ...payment, owner: '', taskId: '' });
    assert.deepEqual(savedLinks(), ['', '', 3525]);
    state = await saveCost(query, state, id, { ...payment, owner: active, taskId: completedTask });
    assert.deepEqual(savedLinks(), [active, completedTask, 3525]);
    assert.deepEqual(await budgetSnapshot(query), state);
    assert.deepEqual(workspaceRow(), unchangedWorkspace);
  });
  test('budget link choices still allow sample owners in the isolated demo', async t => {
    owner();
    const demo = 'demo:owner-1', query = '?demo=1&as=jack';
    const before = sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(demo);
    const context = await deps.infoCore.infoContext(new Request('https://gather.example/api/info' + query));
    const infoBefore = sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(context.scope);
    t.after(() => {
      if (infoBefore) sqlite.prepare('UPDATE project_info SET payload=?,revision=? WHERE scope=?').run(infoBefore.payload, infoBefore.revision, context.scope);
      else sqlite.prepare('DELETE FROM project_info WHERE scope=?').run(context.scope);
      if (!before) sqlite.prepare('DELETE FROM workspaces WHERE id=?').run(demo);
    });
    const savedBefore = sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(demo);
    const state = JSON.parse(savedBefore.data);
    assert.ok(state.members.some(row => row.id === 'maya'));
    const demoTask = state.tasks.find(row => !row.archivedAt).id;
    const ready = await enabled(query);
    const result = await saveCost(query, ready, '', cost({ title: 'Fictional demo sample cost', owner: 'maya', taskId: demoTask }));
    const row = result.budget.items.find(row => row.title === 'Fictional demo sample cost');
    assert.deepEqual([row.owner, row.taskId], ['maya', demoTask]);
    assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(demo), savedBefore);
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
