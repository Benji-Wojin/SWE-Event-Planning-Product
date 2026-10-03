// Fictional events only. Provider calls are mocked; no API credentials or emails are used.
export async function eventPlanTests({
  t,
  assert,
  sqlite,
  db,
  owner,
  request,
  security,
  planApi,
  planGeneration,
  newTeamProject,
  joinPerson,
  realRead,
  workspace,
  demoRead,
  demoWrite,
}) {
  const originalFetch = globalThis.fetch,
    originalKey = globalThis.__gatherEnv.OPENAI_API_KEY;
  const brief = {
    kind: 'school',
    description:
      'A fictional school arts evening. Keep arrival supervised and include cleanup.',
    endDate: '2030-10-05',
    startTime: '09:00',
    endTime: '17:00',
  };
  const baseItem = {
    id: 'approval',
    kind: 'preparation',
    title: 'Confirm event approval',
    category: 'Program',
    note: 'Confirm the proposed activities with the organizer.',
    dueDate: '2030-10-01',
    start: '',
    end: '',
    location: '',
    dependsOn: [],
  };
  const output = () => ({
    items: [
      { ...baseItem },
      {
        ...baseItem,
        id: 'arrive',
        kind: 'activity',
        title: 'Welcome attendees',
        note: 'Set up supervised arrival.',
        dueDate: '',
        start: '2030-10-04T09:00',
        end: '2030-10-04T09:30',
        dependsOn: ['approval'],
      },
      {
        ...baseItem,
        id: 'cleanup',
        title: 'Agree cleanup responsibilities',
        dependsOn: [],
      },
    ],
    questions: ['Who confirms the venue?'],
    assumptions: ['No bookings are confirmed.'],
  });
  let calls = [];
  const success = (plan) =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(plan) }],
        },
      ],
    });
  const provider = (plan = output()) => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      calls.push(JSON.parse(options.body));
      return success(plan);
    };
  };
  const get = (project) =>
    planApi.GET(
      new Request(
        'https://gather.example/api/plan?' +
          (project.startsWith('demo=') ? project : 'project=' + project),
      ),
    );
  const post = (project, body, origin) =>
    planApi.POST(
      request(
        '/api/plan?' +
          (project.startsWith('demo=') ? project : 'project=' + project),
        body,
        origin,
      ),
    );
  const read = async (project) => {
    const response = await get(project);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const row = (project) =>
    sqlite
      .prepare('SELECT * FROM plan_drafts WHERE workspace_id=?')
      .get(project);
  const cool = (project) =>
    sqlite
      .prepare('UPDATE plan_drafts SET started_at=0 WHERE workspace_id=?')
      .run(project);
  async function change(project, method, args) {
    const snap = await (await realRead(project)).json();
    const response = await workspace.POST(
      request('/api/workspace?project=' + project, {
        method,
        args,
        revision: snap.revision,
      }),
    );
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  }
  async function setup() {
    owner();
    globalThis.__gatherEnv.OPENAI_API_KEY = 'test-only-placeholder';
    calls = [];
    provider();
    sqlite
      .prepare("DELETE FROM resource_usage WHERE id LIKE 'plan-ai:%'")
      .run();
    const project = await newTeamProject('Fictional arts evening');
    await change(project, 'completeSetup', [
      {
        date: '2030-10-04',
        timeZone: 'America/Los_Angeles',
        location: 'School hall',
        guestCount: 60,
      },
    ]);
    return project;
  }
  const generation = (snap, extra = {}) => ({
    action: 'generate',
    revision: snap.revision,
    workspaceRevision: snap.workspaceRevision,
    requestId: crypto.randomUUID(),
    brief,
    consent: true,
    ...extra,
  });
  const approval = (snap, extra = {}) => ({
    action: 'apply',
    revision: snap.revision,
    workspaceRevision: snap.workspaceRevision,
    generation: snap.draft.generation,
    items: snap.draft.items,
    confirm: true,
    ...extra,
  });
  const save = (snap, extra = {}) => ({
    action: 'save',
    revision: snap.revision,
    brief: snap.brief,
    items: snap.draft?.items,
    generation: snap.draft?.generation,
    ...extra,
  });
  async function ready(project) {
    const response = await post(project, generation(await read(project)));
    assert.equal(response.status, 200, await response.clone().text());
    const snap = await response.json();
    assert.equal(snap.status, 'ready', JSON.stringify(snap));
    return snap;
  }
  try {
    await t.test(
      'strict provider and review validation rejects malformed dates, fields, cycles and hidden completion',
      () => {
        for (const kind of planGeneration.eventKinds)
          assert.equal(
            planGeneration.parseBrief({ ...brief, kind }, '2030-10-04').kind,
            kind,
          );
        for (const patch of [
          { kind: 'unknown' },
          { description: '' },
          { endDate: '2030-02-30' },
          { endDate: '2030-10-03' },
          { endTime: '08:00' },
          { startTime: '25:00' },
          { secret: 'extra' },
        ])
          assert.throws(() =>
            planGeneration.parseBrief({ ...brief, ...patch }, '2030-10-04'),
          );
        for (const patch of [
          { status: 'done' },
          { owner: 'jack' },
          { dueDate: '2030-02-30' },
          { title: '' },
          { start: '2030-10-04T09:00' },
          { dependsOn: ['missing'] },
          { dependsOn: ['approval'] },
          { id: '../' },
        ])
          assert.throws(() =>
            planGeneration.parsePlanOutput({
              ...output(),
              items: [{ ...baseItem, ...patch }],
            }),
          );
        const cyclic = output();
        cyclic.items[0].dependsOn = ['arrive'];
        assert.throws(() => planGeneration.parsePlanOutput(cyclic));
        assert.throws(() =>
          planGeneration.parsePlanOutput({
            ...output(),
            items: Array.from({ length: 25 }, (_, i) => ({
              ...baseItem,
              id: 'x' + i,
            })),
          }),
        );
      },
    );
    await t.test(
      'private organizer-only brief, CSRF, project isolation and no-key manual path',
      async () => {
        const project = await setup(),
          other = await newTeamProject('Separate event');
        globalThis.__gatherUser = null;
        assert.equal((await get(project)).status, 401);
        owner();
        await joinPerson(project, 'planner@example.com', 'plan-member');
        assert.equal((await get(project)).status, 403);
        assert.equal(
          (await post(project, { action: 'save', revision: 0, brief })).status,
          403,
        );
        owner();
        assert.equal(
          (
            await post(
              project,
              { action: 'save', revision: 0, brief },
              'https://other.example',
            )
          ).status,
          403,
        );
        const snap = await read(project);
        delete globalThis.__gatherEnv.OPENAI_API_KEY;
        assert.equal((await post(project, generation(snap))).status, 503);
        let response = await post(project, {
          action: 'save',
          revision: 0,
          brief,
        });
        assert.equal(response.status, 200);
        assert.equal(
          (await response.json()).brief.description,
          brief.description,
        );
        assert.ok(!JSON.stringify(row(project)).includes(brief.description));
        const shared = await (await realRead(project)).json();
        assert.equal(shared.state.tasks.length, 0);
        assert.ok(!JSON.stringify(shared).includes(brief.description));
        assert.equal((await read(other)).brief.description, '');
        assert.equal(calls.length, 0);
        assert.equal(
          (
            await post(project, {
              action: 'save',
              revision: 0,
              brief: { ...brief, description: 'stale' },
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'generation sends only disclosed context, persists privately and retries without another provider call',
      async () => {
        const project = await setup();
        const existing = await change(project, 'addTask', [
          { title: 'Check chairs', note: 'PRIVATE_PROGRESS', owner: 'jack' },
        ]);
        await change(project, 'addComment', [
          existing.state.tasks[0].id,
          'PRIVATE_COMMENT',
        ]);
        await change(project, 'addMemory', [
          {
            change: 'Keep arrival signage visible.',
            scope: 'always',
            category: 'Program',
            rating: 4,
          },
        ]);
        const input = generation(await read(project));
        let response = await post(project, input);
        assert.equal(response.status, 200);
        let snap = await response.json();
        assert.equal(snap.status, 'ready');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].store, false);
        assert.equal(calls[0].text.format.strict, true);
        assert.equal(calls[0].tools, undefined);
        const sent = JSON.parse(calls[0].input);
        assert.deepEqual(Object.keys(sent).sort(), [
          'brief',
          'event',
          'existingTasks',
          'feedback',
          'today',
        ]);
        assert.equal(sent.existingTasks[0].title, 'Check chairs');
        assert.ok(
          sent.feedback.some((text) => text.includes('arrival signage')),
        );
        for (const privateValue of [
          'PRIVATE_PROGRESS',
          'PRIVATE_COMMENT',
          'owner@example.com',
        ])
          assert.ok(!JSON.stringify(calls[0]).includes(privateValue));
        assert.equal((await post(project, input)).status, 200);
        assert.equal((await read(project)).draft.items.length, 3);
        assert.equal(calls.length, 1);
        assert.equal(
          (
            await post(project, {
              ...input,
              brief: { ...brief, description: 'Different input' },
            })
          ).status,
          409,
        );
        assert.equal(
          (await (await realRead(project)).json()).state.tasks.length,
          1,
        );
        assert.ok(!row(project).payload.includes('Welcome attendees'));
        assert.equal(
          sqlite
            .prepare(
              "SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'",
            )
            .get().count,
          1,
        );
        assert.equal((await post(project, generation(snap))).status, 429);
        assert.equal(calls.length, 1);
      },
    );
    await t.test(
      'provider failures retain reviewed drafts and surface quota errors without fake AI output',
      async () => {
        const project = await setup();
        let snap = await ready(project);
        snap.draft.items[0].title = 'Organizer edited approval';
        let response = await post(project, save(snap));
        assert.equal(response.status, 200);
        snap = await response.json();
        cool(project);
        globalThis.fetch = async () =>
          Response.json(
            {
              error: {
                code: 'insufficient_quota',
                message: 'PRIVATE_PROVIDER_DETAIL',
              },
            },
            { status: 429 },
          );
        response = await post(project, generation(snap));
        assert.equal(response.status, 200);
        snap = await response.json();
        assert.equal(snap.status, 'error');
        assert.match(snap.issue, /quota/);
        assert.ok(!JSON.stringify(snap).includes('PRIVATE_PROVIDER_DETAIL'));
        assert.equal(snap.draft.items[0].title, 'Organizer edited approval');
        const before = JSON.stringify(snap.draft);
        provider({ ...output(), items: [{ ...baseItem, start: 'invalid' }] });
        cool(project);
        response = await post(project, generation(snap));
        assert.equal(response.status, 200);
        snap = await response.json();
        assert.equal(snap.status, 'error');
        assert.equal(JSON.stringify(snap.draft), before);
        globalThis.fetch = async () =>
          Response.json(
            { error: { code: 'credit_balance_exhausted' } },
            { status: 429 },
          );
        cool(project);
        response = await post(project, generation(snap));
        assert.equal(response.status, 200);
        snap = await response.json();
        assert.match(snap.issue, /quota/);
        assert.equal(JSON.stringify(snap.draft), before);
      },
    );
    await t.test(
      'generated activity dates and daily hours are validated independently of provider output',
      async () => {
        const context = {
          event: { date: '2030-10-04', timeZone: 'America/Los_Angeles' },
          brief,
          today: '2030-09-01',
        };
        for (const patch of [
          { start: '2030-10-30T09:00', end: '' },
          { start: '2030-10-04T08:00', end: '' },
          { start: '2030-10-04T16:00', end: '2030-10-04T18:00' },
          { start: '2030-10-05T16:00', end: '2030-10-06T01:00' },
          { dueDate: '2030-08-01', kind: 'preparation', start: '', end: '' },
        ]) {
          const plan = output();
          Object.assign(plan.items[1], patch);
          provider(plan);
          await assert.rejects(
            planGeneration.generateEventPlan(context, 'test-only-placeholder'),
          );
        }
        provider();
        await assert.rejects(
          planGeneration.generateEventPlan(
            { ...context, event: { date: '', timeZone: '' } },
            'test-only-placeholder',
          ),
        );
        const overnight = output();
        Object.assign(overnight.items[1], {
          start: '2030-10-04T23:00',
          end: '2030-10-05T01:00',
        });
        provider(overnight);
        assert.equal(
          (
            await planGeneration.generateEventPlan(
              { ...context, brief: { ...brief, endTime: '' } },
              'test-only-placeholder',
            )
          ).items[1].end,
          '2030-10-05T01:00',
        );
      },
    );
    await t.test(
      'approval is atomic, preserves existing work, links dependencies and retries lost responses once',
      async () => {
        const project = await setup();
        await change(project, 'addTask', [
          { title: 'Existing work', owner: 'jack', note: 'Keep this note.' },
        ]);
        const before = await (await realRead(project)).json();
        let snap = await ready(project);
        snap.draft.items[0].owner = 'jack';
        snap.draft.items[2].included = false;
        const input = approval(snap);
        const responses = await Promise.all([
          post(project, input),
          post(project, input),
        ]);
        for (const response of responses)
          assert.equal(response.status, 200, await response.clone().text());
        const first = await responses[0].json();
        assert.equal(first.receipt.taskIds.length, 2);
        assert.equal(first.existingTaskCount, 3);
        assert.equal(first.workspaceRevision, before.revision + 1);
        assert.deepEqual(
          (await responses[1].json()).receipt.taskIds,
          first.receipt.taskIds,
        );
        assert.deepEqual(
          (await (await post(project, input)).json()).receipt.taskIds,
          first.receipt.taskIds,
        );
        const result = await (await realRead(project)).json();
        assert.equal(result.state.tasks.length, 3);
        assert.deepEqual(
          result.state.tasks.find((item) => item.title === 'Existing work'),
          before.state.tasks[0],
        );
        const prep = result.state.tasks.find(
            (item) => item.title === 'Confirm event approval',
          ),
          activity = result.state.tasks.find(
            (item) => item.title === 'Welcome attendees',
          );
        assert.equal(prep.owner, 'jack');
        assert.equal(prep.status, 'todo');
        assert.equal(activity.status, 'todo');
        assert.equal(activity.schedule.start, '2030-10-04T09:00');
        assert.equal(activity.dependencies[0].taskId, prep.id);
        assert.equal(
          (
            await post(project, {
              ...input,
              items: input.items.map((item) => ({
                ...item,
                title: item.title + ' changed',
              })),
            })
          ).status,
          409,
        );
        assert.equal((await post(project, save(first))).status, 409);
      },
    );
    await t.test(
      'invalid owners, hidden status, duplicates and unchecked prerequisites add no tasks',
      async () => {
        const project = await setup(),
          snap = await ready(project);
        const before = sqlite
          .prepare('SELECT * FROM workspaces WHERE id=?')
          .get(project);
        const cases = [
          (items) => {
            items[0].owner = 'unknown';
          },
          (items) => {
            items[1].status = 'done';
          },
          (items) => {
            items[0].included = false;
          },
          (items) => {
            items[2].title = items[0].title;
          },
          (items) => {
            items[0].dependsOn = ['arrive'];
          },
          (items) => {
            items.forEach((item) => (item.included = false));
          },
        ];
        for (const mutate of cases) {
          const input = approval(snap, {
            items: structuredClone(snap.draft.items),
          });
          mutate(input.items);
          const response = await post(project, input);
          assert.equal(response.status, 400, await response.clone().text());
          assert.deepEqual(
            sqlite.prepare('SELECT * FROM workspaces WHERE id=?').get(project),
            before,
          );
          assert.equal((await read(project)).receipt, null);
        }
        await joinPerson(project, 'past-planner@example.com', 'past-planner');
        owner();
        const member = sqlite
          .prepare('SELECT actor_id FROM project_members WHERE project_id=?')
          .get(project);
        sqlite
          .prepare(
            "UPDATE project_members SET revoked_at='2030-01-01' WHERE project_id=?",
          )
          .run(project);
        const refreshed = await read(project),
          input = approval(refreshed);
        input.items[0].owner = member.actor_id;
        assert.equal((await post(project, input)).status, 400);
        assert.equal(
          (await (await realRead(project)).json()).state.tasks.length,
          0,
        );
      },
    );
    await t.test(
      'stale project and draft context cannot replace concurrent work',
      async () => {
        const project = await setup();
        let snap = await ready(project);
        await change(project, 'addTask', [
          { title: 'New work added elsewhere' },
        ]);
        assert.equal((await post(project, approval(snap))).status, 409);
        snap = await read(project);
        assert.equal(snap.contextChanged, true);
        assert.equal((await post(project, approval(snap))).status, 409);
        assert.equal(
          (await (await realRead(project)).json()).state.tasks.length,
          1,
        );
        const input = save(snap);
        assert.equal((await post(project, input)).status, 200);
        assert.equal((await post(project, input)).status, 409);
      },
    );
    await t.test(
      'workspace CAS zero rows does not consume the draft receipt',
      async () => {
        const project = await setup(),
          snap = await ready(project);
        const original = db.batch;
        db.batch = async (statements) => {
          sqlite
            .prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?')
            .run(project);
          return original.call(db, statements);
        };
        try {
          assert.equal((await post(project, approval(snap))).status, 409);
        } finally {
          db.batch = original;
        }
        const next = await read(project);
        assert.equal(next.status, 'ready');
        assert.equal(next.receipt, null);
        assert.equal(next.contextChanged, false);
        assert.equal((await post(project, approval(next))).status, 200);
      },
    );
    await t.test(
      'concurrent generation is one provider request and five drafts/day is account-wide',
      async () => {
        const project = await setup();
        const input = generation(await read(project));
        const responses = await Promise.all([
          post(project, input),
          post(project, input),
        ]);
        for (const response of responses) assert.equal(response.status, 200);
        assert.equal(calls.length, 1);
        for (let i = 0; i < 4; i++) {
          cool(project);
          assert.equal(
            (await post(project, generation(await read(project)))).status,
            200,
          );
        }
        assert.equal(calls.length, 5);
        cool(project);
        assert.equal(
          (await post(project, generation(await read(project)))).status,
          429,
        );
        const other = await newTeamProject('Same account quota');
        const another = { ...brief, endDate: '' };
        assert.equal(
          (await post(other, generation(await read(other), { brief: another })))
            .status,
          429,
        );
        assert.equal(calls.length, 5);
      },
    );
    await t.test(
      'expired lease edits survive late successful and failed provider responses',
      async () => {
        for (const failed of [false, true]) {
          const project = await setup();
          let snap = await ready(project);
          cool(project);
          let release, entered;
          const started = new Promise((resolve) => (entered = resolve));
          globalThis.fetch = () => {
            entered();
            return new Promise((resolve) => (release = resolve));
          };
          const pending = post(project, generation(snap));
          await started;
          sqlite
            .prepare(
              'UPDATE plan_drafts SET lease_until=0 WHERE workspace_id=?',
            )
            .run(project);
          snap = await read(project);
          assert.equal(snap.status, 'interrupted');
          snap.draft.items[0].title = 'Keep my newer edit';
          assert.equal((await post(project, save(snap))).status, 200);
          release(
            failed
              ? Response.json({ error: {} }, { status: 500 })
              : success(output()),
          );
          await pending;
          snap = await read(project);
          assert.equal(snap.status, 'ready');
          assert.equal(snap.draft.items[0].title, 'Keep my newer edit');
          assert.equal(snap.issue, '');
        }
      },
    );
    await t.test(
      'approval clears expired generation leases before late success or failure can overwrite its state',
      async () => {
        for (const failed of [false, true]) {
          const project = await setup();
          let snap = await ready(project);
          cool(project);
          let release, entered;
          const started = new Promise((resolve) => (entered = resolve));
          globalThis.fetch = () => {
            entered();
            return new Promise((resolve) => (release = resolve));
          };
          const pending = post(project, generation(snap));
          await started;
          sqlite
            .prepare(
              'UPDATE plan_drafts SET lease_until=0 WHERE workspace_id=?',
            )
            .run(project);
          snap = await read(project);
          assert.equal(snap.status, 'interrupted');
          const applied = await post(project, approval(snap));
          assert.equal(applied.status, 200);
          const receipt = (await applied.json()).receipt;
          release(
            failed
              ? Response.json({ error: {} }, { status: 500 })
              : success(output()),
          );
          await pending;
          snap = await read(project);
          assert.equal(snap.status, 'applied');
          assert.equal(snap.issue, '');
          assert.deepEqual(snap.receipt, receipt);
          assert.equal(
            (await (await realRead(project)).json()).state.tasks.length,
            3,
          );
          assert.equal(row(project).lease, '');
        }
      },
    );
    await t.test(
      'ownership changes block in-flight generation and approval at SQL commit',
      async () => {
        const project = await setup();
        const snap = await ready(project);
        cool(project);
        let release, entered;
        const started = new Promise((resolve) => (entered = resolve));
        globalThis.fetch = () => {
          entered();
          return new Promise((resolve) => (release = resolve));
        };
        const pending = post(project, generation(snap));
        await started;
        sqlite
          .prepare('UPDATE projects SET owner_id=? WHERE id=?')
          .run('new-owner', project);
        release(success(output()));
        assert.equal((await pending).status, 403);
        assert.equal((await get(project)).status, 404);
        sqlite
          .prepare('UPDATE projects SET owner_id=? WHERE id=?')
          .run('owner-1', project);
        sqlite
          .prepare(
            "UPDATE plan_drafts SET lease='',lease_until=0,status='ready' WHERE workspace_id=?",
          )
          .run(project);
        const latest = await read(project),
          original = db.batch;
        db.batch = async (statements) => {
          sqlite
            .prepare('UPDATE projects SET owner_id=? WHERE id=?')
            .run('new-owner', project);
          return original.call(db, statements);
        };
        try {
          assert.equal((await post(project, approval(latest))).status, 403);
        } finally {
          db.batch = original;
        }
        assert.equal(
          JSON.parse(
            sqlite
              .prepare('SELECT data FROM workspaces WHERE id=?')
              .get(project).data,
          ).tasks.length,
          0,
        );
      },
    );
    await t.test(
      'demo draft is organizer-only, isolated and cannot survive a reset during generation',
      async () => {
        const project = await setup(),
          real = await ready(project);
        cool(project);
        let demo = await (await demoRead()).json();
        await demoWrite('jack', {
          method: 'resetDemo',
          args: [true],
          revision: demo.revision,
        });
        const demoQuery = 'demo=1&as=jack';
        assert.equal((await get('demo=1&as=maya')).status, 403);
        const snap = await read(demoQuery);
        let release, entered;
        const started = new Promise((resolve) => (entered = resolve));
        globalThis.fetch = () => {
          entered();
          return new Promise((resolve) => (release = resolve));
        };
        const input = generation(snap, {
          brief: { ...brief, startTime: '', endTime: '', endDate: '' },
        });
        const pending = post(demoQuery, input);
        await started;
        demo = await (await demoRead()).json();
        await demoWrite('jack', {
          method: 'resetDemo',
          args: [true],
          revision: demo.revision,
        });
        const plan = output();
        plan.items[1].start = '';
        plan.items[1].end = '';
        release(success(plan));
        assert.equal((await pending).status, 403);
        assert.equal((await read(demoQuery)).draft, null);
        assert.equal(
          (await read(project)).draft.generation,
          real.draft.generation,
        );
        provider(plan);
        const current = await read(demoQuery);
        let response = await post(
          demoQuery,
          generation(current, {
            brief: { ...brief, startTime: '', endTime: '', endDate: '' },
          }),
        );
        assert.equal(response.status, 200);
        const generated = await response.json();
        response = await post(demoQuery, approval(generated));
        assert.equal(response.status, 200, await response.clone().text());
        for (const actor of ['jack', 'maya', 'jules', 'dev'])
          assert.ok(
            (await (await demoRead(actor)).json()).state.tasks.some(
              (item) => item.title === 'Confirm event approval',
            ),
          );
        assert.equal(
          (await (await realRead(project)).json()).state.tasks.length,
          0,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete globalThis.__gatherEnv.OPENAI_API_KEY;
    else globalThis.__gatherEnv.OPENAI_API_KEY = originalKey;
    owner();
  }
}
