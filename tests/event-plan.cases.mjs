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
    originalKey = globalThis.__gatherEnv.GROQ_API_KEY;
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
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(plan) },
        },
      ],
    });
  const provider = (plan = output()) => {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      assert.equal(
        options.headers.Authorization,
        'Bearer test-only-placeholder',
      );
      assert.equal(JSON.parse(options.body).model, 'openai/gpt-oss-20b');
      assert.equal(JSON.parse(options.body).store, undefined);
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
    globalThis.__gatherEnv.GROQ_API_KEY = 'test-only-placeholder';
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
    consentVersion: 'groq-plan-v1',
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
    await t.test('saving a new brief does not consume quota or prevent the first generation', async () => {
      const project = await setup();
      const saved = await post(project, save(await read(project), { brief }));
      assert.equal(saved.status, 200);
      assert.equal(sqlite.prepare("SELECT count(*) AS n FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().n, 0);
      const response = await post(project, generation(await saved.json()));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'ready');
      assert.equal(calls.length, 1);
    });
    await t.test('cooldown is not reported as exhausted daily quota and rejected retries cost nothing', async () => {
      const project = await setup();
      const snap = await ready(project);
      const input = generation(snap);
      const response = await post(project, input);
      assert.equal(response.status, 429);
      const message = (await response.json()).error;
      assert.match(message, /Wait \d+ seconds/);
      assert.doesNotMatch(message, /daily|limit|credits/);
      assert.equal(calls.length, 1);
      assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count, 1);
      cool(project);
      assert.equal((await post(project, input)).status, 200);
      assert.equal(calls.length, 2);
    });
    await t.test('a save racing generation is a recoverable conflict, not a quota error', async () => {
      const project = await setup();
      const saved = await post(project, save(await read(project), { brief }));
      const snap = await saved.json();
      const original = db.batch;
      db.batch = async statements => {
        sqlite.prepare('UPDATE plan_drafts SET revision=revision+1 WHERE workspace_id=?').run(project);
        return original.call(db, statements);
      };
      try {
        const response = await post(project, generation(snap));
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /Reload/);
        assert.equal(calls.length, 0);
        assert.equal(sqlite.prepare("SELECT count(*) AS n FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().n, 0);
      } finally { db.batch = original; }
      assert.equal((await ready(project)).status, 'ready');
    });
    await t.test('another in-flight generation reports progress without charging a rejected request', async () => {
      const project = await setup();
      let release, entered;
      const started = new Promise(resolve => { entered = resolve; });
      globalThis.fetch = () => {
        calls.push('pending');
        entered();
        return new Promise(resolve => { release = resolve; });
      };
      const pending = post(project, generation(await read(project)));
      await started;
      try {
        const response = await post(project, generation(await read(project)));
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /already generating/);
        assert.equal(calls.length, 1);
        assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count, 1);
      } finally { release(success(output())); }
      assert.equal((await pending).status, 200);
    });
    await t.test('AI planning accepts event-local today while account quotas remain UTC', async () => {
      const project = await setup();
      const RealDate = globalThis.Date;
      const instant = RealDate.parse('2030-10-02T06:00:00Z');
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [instant])); }
        static now() { return instant; }
      };
      try {
        const snap = await ready(project);
        assert.equal(JSON.parse(calls[0].messages[1].content).today, '2030-10-01');
        assert.equal(snap.draft.items[0].dueDate, '2030-10-01');
        assert.ok(sqlite.prepare("SELECT id FROM resource_usage WHERE id LIKE 'plan-ai:%:2030-10-02'").get());
      } finally { globalThis.Date = RealDate; }
    });
    await t.test(
      'strict provider and review validation rejects malformed dates, fields, cycles and hidden completion',
      () => {
        const item = planGeneration.planRequestBody({}).response_format.json_schema.schema.properties.items.items;
        assert.equal(item.anyOf, undefined);
        assert.equal(item.additionalProperties, false);
        assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
        assert.deepEqual(item.properties.kind.enum, ['preparation','activity']);
        assert.deepEqual(item.properties.category.enum, planGeneration.planCategories);
        assert.match(item.properties.start.description, /YYYY-MM-DDTHH:mm/);
        assert.match(item.properties.start.description, /empty for preparation/);
        assert.match(item.properties.end.description, /empty for preparation/);
        assert.match(item.properties.dueDate.description, /empty for activities/);
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
          { category: 'Unknown category' },
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
        delete globalThis.__gatherEnv.GROQ_API_KEY;
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
      'Groq consent and oversized context fail before provider calls or daily usage',
      async () => {
        const project = await setup(),
          snap = await read(project);
        for (const consentVersion of [undefined, 'openai-plan-v1']) {
          assert.equal(
            (await post(project, generation(snap, { consentVersion }))).status,
            400,
          );
        }
        await change(project, 'addTask', [{ title: 'Long planning context', category: 'Program' }]);
        const stored = sqlite
          .prepare('SELECT data FROM workspaces WHERE id=?')
          .get(project);
        const data = JSON.parse(stored.data);
        data.tasks = Array.from({ length: 200 }, (_, i) => ({
          ...data.tasks[0],
          id: 'large-' + i,
          title: 'Long planning context '.repeat(8),
        }));
        sqlite
          .prepare('UPDATE workspaces SET data=? WHERE id=?')
          .run(JSON.stringify(data), project);
        const response = await post(project, generation(await read(project)));
        assert.equal(response.status, 413);
        assert.equal(calls.length, 0);
        assert.equal(
          sqlite
            .prepare(
              "SELECT count(*) AS n FROM resource_usage WHERE id LIKE 'plan-ai:%'",
            )
            .get().n,
          0,
        );
        assert.equal(row(project), undefined);
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
        assert.equal(calls[0].store, undefined);
        assert.equal(calls[0].response_format.json_schema.strict, true);
        assert.equal(calls[0].max_completion_tokens, 4000);
        assert.equal(calls[0].reasoning_effort, 'low');
        assert.equal(calls[0].messages[0].role, 'system');
        assert.equal(calls[0].messages[1].role, 'user');
        assert.equal(calls[0].tools, undefined);
        const sent = JSON.parse(calls[0].messages[1].content);
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
        assert.match(snap.issue, /free-plan limit/);
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
        assert.match(snap.issue, /free-plan limit/);
        assert.equal(JSON.stringify(snap.draft), before);
      },
    );
    await t.test('chat completions reject truncated, refused, ambiguous and tool responses', async () => {
      const message = { role: 'assistant', content: JSON.stringify(output()) };
      for (const choices of [
        [],
        [{ finish_reason: 'length', message }],
        [{ finish_reason: 'stop', message: { ...message, refusal: 'Cannot comply' } }],
        [{ finish_reason: 'stop', message: { ...message, tool_calls: [{}] } }],
        [{ finish_reason: 'stop', message: { ...message, content: null } }],
        [{ finish_reason: 'stop', message: { ...message, role: 'user' } }],
        [{ finish_reason: 'stop', message }, { finish_reason: 'stop', message }],
      ]) {
        globalThis.fetch = async () => Response.json({ choices });
        await assert.rejects(planGeneration.generateEventPlan({}, 'test-only-placeholder'));
      }
      assert.throws(() => planGeneration.planRequestBody({ oversized: 'x'.repeat(10000) }), /context_limit/);
    });
    await t.test('provider missing-notes rejection recovers one validated draft and persists it without retrying', async () => {
      const project = await setup();
      const generated = output();
      delete generated.assumptions;
      let attempts = 0;
      globalThis.fetch = async () => {
        attempts++;
        return Response.json({error:{code:'json_validate_failed',failed_generation:JSON.stringify(generated)}},{status:400});
      };
      const response = await post(project, generation(await read(project)));
      const snap = await response.json();
      assert.equal(response.status, 200);
      assert.equal(snap.status, 'ready');
      assert.equal(attempts, 1);
      assert.deepEqual(snap.draft.assumptions, []);
      assert.deepEqual(snap.draft.questions, generated.questions);
      assert.equal(snap.draft.items.length, generated.items.length);
      assert.deepEqual((await read(project)).draft, snap.draft);
      assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count, 1);
    });
    await t.test('optional notes recovery never accepts malformed tasks, provider errors or partial output', async () => {
      const context = {event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-09-01'};
      const missing = () => { const plan = output(); delete plan.questions; delete plan.assumptions; return plan; };
      for (const value of [
        {...missing(), assumptions:null},
        {...missing(), completed:true},
        {...missing(), items:[]},
        {...missing(), items:[{...baseItem,dueDate:'2030-02-30'}]},
        {...missing(), items:[{...baseItem,dependsOn:['unknown']}]},
        {...missing(), items:[{...baseItem,completed:true}]},
        {...missing(), items:[{...baseItem,title:undefined}]},
        {...missing(), items:[{...baseItem,dependsOn:undefined}]},
        output(),
      ]) {
        globalThis.fetch = async () => Response.json({error:{code:'json_validate_failed',failed_generation:JSON.stringify(value)}},{status:400});
        await assert.rejects(planGeneration.generateEventPlan(context, 'test-only-placeholder'));
      }
      for (const [status, code, content] of [
        [401,'json_validate_failed',JSON.stringify(missing())],
        [429,'json_validate_failed',JSON.stringify(missing())],
        [500,'json_validate_failed',JSON.stringify(missing())],
        [400,'invalid_request_error',JSON.stringify(missing())],
        [400,'json_validate_failed','{"items": ['],
        [400,'json_validate_failed','x'.repeat(96001)],
      ]) {
        globalThis.fetch = async () => Response.json({error:{code,failed_generation:content}},{status});
        await assert.rejects(planGeneration.generateEventPlan(context, 'test-only-placeholder'));
      }
      for (const absent of ['questions','assumptions','both']) {
        const plan = output();
        if (absent !== 'questions') delete plan.assumptions;
        if (absent !== 'assumptions') delete plan.questions;
        provider(plan);
        const result = await planGeneration.generateEventPlan(context, 'test-only-placeholder');
        assert.ok(Array.isArray(result.questions) && Array.isArray(result.assumptions));
        assert.equal(result.items.length, 3);
      }
    });
    await t.test('missing optional date/location fields stay blank without inventing tasks or discarding invalid values', async () => {
      const context = {event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-09-01'};
      for (const status of [200,400]) {
        const plan = output();
        for (const item of plan.items) for (const key of ['dueDate','start','end','location']) delete item[key];
        globalThis.fetch = async () => status === 200 ? success(plan) : Response.json({error:{code:'json_validate_failed',failed_generation:JSON.stringify(plan)}},{status});
        const result = await planGeneration.generateEventPlan(context,'test-only-placeholder');
        assert.equal(result.items.length, plan.items.length);
        for (const [i,item] of result.items.entries()) {
          for (const key of ['dueDate','start','end','location']) assert.equal(item[key],'');
          assert.deepEqual(item.dependsOn,plan.items[i].dependsOn);
          assert.equal(item.title,plan.items[i].title);
        }
      }
      for (const bad of [null,42,{},'not-a-date']) {
        const plan = output(); delete plan.assumptions; plan.items[0].dueDate=bad;
        globalThis.fetch = async () => Response.json({error:{code:'json_validate_failed',failed_generation:JSON.stringify(plan)}},{status:400});
        await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));
      }
    });
    await t.test('generation diagnostics contain fixed labels, never provider content or credentials', async () => {
      const warn = console.warn, logs = [];
      console.warn = (...args) => logs.push(args);
      try {
        globalThis.fetch = async () => Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'PRIVATE_MODEL_OUTPUT'}}]});
        await assert.rejects(planGeneration.generateEventPlan({}, 'PRIVATE_API_KEY'));
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'output_json',reason:'invalid_response'}]);
        globalThis.fetch = async () => { throw new Error('PRIVATE_TRANSPORT_DETAIL'); };
        await assert.rejects(planGeneration.generateEventPlan({}, 'PRIVATE_API_KEY'));
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'request',reason:'invalid_response'}]);
        provider({...output(),items:[{...baseItem,start:'PRIVATE_INVALID_VALUE'}]});
        await assert.rejects(planGeneration.generateEventPlan({}, 'test-only-placeholder'));
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'plan_validation',reason:'item_fields'}]);
        globalThis.fetch = async () => Response.json({error:{code:'json_validate_failed',message:'PRIVATE_ERROR',failed_generation:'PRIVATE_MODEL_OUTPUT'}},{status:400});
        await assert.rejects(planGeneration.generateEventPlan({}, 'PRIVATE_API_KEY'));
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'output_json',httpStatus:400,providerCode:'json_validate_failed',reason:'invalid_response'}]);
        globalThis.fetch = async () => Response.json({error:{code:'PRIVATE_CODE',message:'PRIVATE_ERROR'}},{status:503});
        await assert.rejects(planGeneration.generateEventPlan({}, 'PRIVATE_API_KEY'));
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'request',httpStatus:503,reason:'provider'}]);
      } finally { console.warn = warn; }
    });
    await t.test(
      'unsupported generated schedules are left blank with review warnings without losing useful tasks',
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
          const result = await planGeneration.generateEventPlan(context, 'test-only-placeholder');
          assert.equal(result.items.length, plan.items.length);
          assert.equal(result.items[1].start, '');
          assert.equal(result.items[1].end, '');
          assert.equal(result.items[1].dueDate, '');
          assert.equal(result.items[1].title, plan.items[1].title);
          assert.deepEqual(result.items[1].dependsOn, plan.items[1].dependsOn);
          assert.equal(result.scheduleWarnings.length, 1);
          assert.match(result.scheduleWarnings[0], /left blank|left unscheduled/);
        }
        provider();
        for (const missing of [
          {...context,event:{date:'',timeZone:''}},
          {...context,brief:{...brief,startTime:''}},
          {...context,event:{date:'2030-10-04',timeZone:''}},
        ]) {
          const result = await planGeneration.generateEventPlan(missing, 'test-only-placeholder');
          assert.equal(result.items[1].start, '');
          assert.equal(result.items[1].end, '');
          assert.equal(result.items[0].dueDate, '2030-10-01');
          assert.equal(result.scheduleWarnings.length, 1);
        }
        const valid = await planGeneration.generateEventPlan(context, 'test-only-placeholder');
        assert.equal(valid.scheduleWarnings, undefined);
        assert.equal(valid.items[1].start, '2030-10-04T09:00');
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
    await t.test('schedule recovery stays private, survives save/reload, and only adds unscheduled work after approval', async () => {
      const project = await setup();
      const response = await post(project, generation(await read(project), {brief:{...brief,startTime:'',endTime:''}}));
      assert.equal(response.status, 200);
      let snap = await response.json();
      assert.equal(snap.status, 'ready');
      assert.equal(snap.draft.items[1].start, '');
      assert.equal(snap.draft.items[1].end, '');
      assert.equal(snap.draft.scheduleWarnings.length, 1);
      assert.equal((await (await realRead(project)).json()).state.tasks.length, 0);
      assert.equal((await post(project, save(snap))).status, 200);
      snap = await read(project);
      assert.equal(snap.draft.scheduleWarnings.length, 1);
      assert.equal((await post(project, approval(snap))).status, 200);
      const state = (await (await realRead(project)).json()).state;
      assert.equal(state.tasks.length, 3);
      assert.equal(state.tasks.some(task => !!task.schedule?.start), false);
    });
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
      'concurrent generation is one provider request and owner testing cap of 25 is account-wide',
      async () => {
        const project = await setup();
        const input = generation(await read(project));
        const responses = await Promise.all([
          post(project, input),
          post(project, input),
        ]);
        for (const response of responses) assert.equal(response.status, 200);
        assert.equal(calls.length, 1);
        for (let i = 0; i < 24; i++) {
          cool(project);
          assert.equal(
            (await post(project, generation(await read(project)))).status,
            200,
          );
        }
        assert.equal(calls.length, 25);
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
        assert.equal(calls.length, 25);
      },
    );
    await t.test('project organizers do not inherit the configured app owner testing allowance', async () => {
      const project = await setup(), configuredOwner = globalThis.__gatherEnv.GATHER_OWNER_EMAIL;
      globalThis.__gatherEnv.GATHER_OWNER_EMAIL = 'different-owner@example.com';
      try {
        for (let i = 0; i < 5; i++) {
          cool(project);
          assert.equal((await post(project, generation(await read(project)))).status, 200);
        }
        cool(project);
        const response = await post(project, generation(await read(project)));
        assert.equal(response.status, 429);
        const message = (await response.json()).error;
        assert.match(message, /daily limit is 5/);
        assert.match(message, /including failed attempts/);
        assert.match(message, /midnight UTC/);
        assert.equal(calls.length, 5);
      } finally { globalThis.__gatherEnv.GATHER_OWNER_EMAIL = configuredOwner; }
    });
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
    // Explicit opt-in only: fixture identity + in-memory SQLite, never live user
    // data. The key is supplied out-of-band and is never written or logged here.
    if (process.env.WEFT_LIVE_PLAN_TEST === '1') {
      await t.test('LIVE Groq fictional draft is validated, saved, reloaded and applied in isolated SQLite', async () => {
        assert.ok(process.env.GROQ_API_KEY, 'Live smoke requires an explicitly supplied Groq key');
        const project = await setup();
        await change(project, 'completeSetup', [{date:'2027-02-01',timeZone:'Asia/Tokyo',location:'Japan',guestCount:6}]);
        globalThis.__gatherEnv.GROQ_API_KEY = process.env.GROQ_API_KEY;
        let requests = 0;
        globalThis.fetch = async (url, options) => {
          assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
          assert.equal(++requests, 1, 'No automatic retry or alternate destination');
          return originalFetch(url, options);
        };
        const response = await post(project, generation(await read(project), {
          brief:{kind:'trip',description:'Fictional QA trip for six people: one week in Tokyo for shopping, sightseeing and meals, followed by one week skiing in Rusutsu. Include preparation and transfers. Nothing is booked.',endDate:'2027-02-14',startTime:'',endTime:''},
        }));
        assert.equal(response.status, 200);
        const snap = await response.json();
        assert.equal(snap.status, 'ready', snap.issue);
        assert.ok(snap.draft.items.length >= 1);
        assert.deepEqual((await read(project)).draft, snap.draft);
        if (process.env.WEFT_LIVE_PLAN_CAPTURE === '1') {
          const { writeFile } = await import('node:fs/promises');
          await writeFile('work/live-plan-preview.json', JSON.stringify(snap), {mode:0o600});
        }
        const result = await post(project, approval(snap));
        assert.equal(result.status, 200);
        const state = (await (await realRead(project)).json()).state;
        assert.equal(state.tasks.length, snap.draft.items.length);
        console.info('LIVE fictional draft verified:', {items:snap.draft.items.length,requests,saved:true,reloaded:true,applied:true});
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete globalThis.__gatherEnv.GROQ_API_KEY;
    else globalThis.__gatherEnv.GROQ_API_KEY = originalKey;
    owner();
  }
}
