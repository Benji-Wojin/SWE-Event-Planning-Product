// Fictional events only. Provider calls are mocked; no API credentials or emails are used.
import '../legacy/wrap-up.js';
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
  teamRead,
  teamWrite,
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
  const paste = (snap,text,extra={}) => ({
    action:'import-checklist',revision:snap.revision,workspaceRevision:snap.workspaceRevision,
    generation:snap.draft?.generation??null,requestId:crypto.randomUUID(),
    brief:snap.brief.description?snap.brief:brief,items:snap.draft?.items??[],text,...extra,
  });
  async function ready(project) {
    const response = await post(project, generation(await read(project)));
    assert.equal(response.status, 200, await response.clone().text());
    const snap = await response.json();
    assert.equal(snap.status, 'ready', JSON.stringify(snap));
    return snap;
  }
  try {
    await t.test('task breakdown sends only the confirmed title and cannot write shared tasks',async()=>{
      const project=await setup();
      const parent=(await change(project,'addTask',[{title:'Plan welcome desk',note:'PRIVATE_TASK_NOTE',scope:'PRIVATE_TASK_OUTCOME'}])).result;
      await change(project,'addTask',[{title:'PRIVATE_UNRELATED_TITLE'}]);
      const path=project+'&mode=breakdown&task='+encodeURIComponent(parent.id);
      const snap=await read(path), before=await (await realRead(project)).json();
      assert.deepEqual(snap.task,{id:parent.id,title:parent.title,revision:parent.revision});
      assert.deepEqual(Object.keys(snap).sort(),['configured','contextChanged','issue','revision','status','steps','task','workspaceRevision']);
      const input={action:'generate',revision:snap.revision,workspaceRevision:snap.workspaceRevision,taskRevision:snap.task.revision,
        requestId:crypto.randomUUID(),consent:true,consentVersion:'groq-task-breakdown-v1'};
      assert.equal((await post(path,{...input,consentVersion:'groq-plan-v1'})).status,400);
      assert.equal((await post(path,{...input,taskTitle:'Caller-substituted title'})).status,400);
      assert.equal((await post(path,{...input,taskRevision:0})).status,409);
      assert.equal((await post(path,{...input,action:'apply'})).status,400);
      assert.equal((await get(path+'&task='+parent.id)).status,404);
      assert.equal(calls.length,0);
      const step={title:'Draft a volunteer rota',scope:'Every shift has an identified volunteer.'};
      provider({items:[{title:parent.title,scope:''},step,{...step,title:'  DRAFT A VOLUNTEER ROTA  '}]});
      const response=await post(path,input);
      assert.equal(response.status,200,await response.clone().text());
      const generated=await response.json();
      assert.deepEqual(generated.steps,[step]);
      assert.equal(generated.status,'ready');
      assert.deepEqual(JSON.parse(calls[0].messages[1].content),{taskTitle:parent.title});
      assert.doesNotMatch(JSON.stringify(calls[0]),/PRIVATE_|School hall|Fictional arts evening|tool_choice/);
      assert.equal((await post(path,input)).status,200);
      assert.equal(calls.length,1);
      assert.equal((await read(project)).draft,null,'normal starting plan is untouched');
      assert.equal((await read(project+'&mode=suggestions')).draft,null,'gap review is untouched');
      assert.deepEqual((await (await realRead(project)).json()).state,before.state);
      cool(project);
      provider({items:[{...step,owner:'jack'}]});
      const malformed=await post(path,{...input,revision:generated.revision,requestId:crypto.randomUUID()});
      assert.equal(malformed.status,200);
      const failed=await malformed.json();
      assert.equal(failed.status,'error');assert.deepEqual(failed.steps,[step],'failed drafts preserve the last valid private version');
      await change(project,'updateTask',[parent.id,{title:'Updated welcome desk'}]);
      assert.equal((await read(path)).steps,null);
      assert.equal((await read(path)).contextChanged,true);
      assert.equal((await post(path,input)).status,409);
      await joinPerson(project,'fictional-breakdown-member@example.com','fictional-breakdown-member');
      assert.equal((await get(path)).status,403);
      assert.equal((await post(path,input)).status,403);
      assert.equal(calls.length,2);
      assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count,2);
      owner();sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);
    });
    await t.test('AI breakdown refuses a workspace change at reservation and does not persist a late answer',async()=>{
      const project=await setup(),parent=(await change(project,'addTask',[{title:'Plan the foyer'}])).result;
      const path=project+'&mode=breakdown&task='+parent.id;
      const input=snap=>({action:'generate',revision:snap.revision,workspaceRevision:snap.workspaceRevision,taskRevision:snap.task.revision,
        requestId:crypto.randomUUID(),consent:true,consentVersion:'groq-task-breakdown-v1'});
      const initial=await read(path),originalBatch=db.batch;
      const advance=()=>sqlite.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(project);
      db.batch=async statements=>{advance();return originalBatch.call(db,statements);};
      try {
        assert.equal((await post(path,input(initial))).status,409);
        assert.equal(calls.length,0);
        assert.equal(sqlite.prepare("SELECT count(*) AS n FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().n,0);
      } finally {db.batch=originalBatch;}
      globalThis.fetch=async()=>{
        calls.push('late mock');advance();
        return success({items:[{title:'Prepare sign',scope:'A sign is ready.'}]});
      };
      assert.equal((await post(path,input(await read(path)))).status,409);
      const stale=await read(path);
      assert.equal(stale.status,'error');assert.equal(stale.steps,null);
      assert.equal(calls.length,1);
      assert.equal((await (await realRead(project)).json()).state.tasks.length,1);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);
    });
    await t.test('reviewed AI outcomes save separately from instructions and apply as incomplete unaccepted shared tasks',async()=>{
      const project=await setup(),generated=output();generated.items[0].scope='The organizer records the approval decision and outstanding conditions.';provider(generated);
      try {
      let snap=await ready(project);assert.equal(snap.draft.items[0].scope,generated.items[0].scope);
      snap.draft.items[0].scope='The responsible organizer records the reviewed decision and unresolved conditions.';
      assert.equal((await post(project,save(snap))).status,200);snap=await read(project);
      assert.equal((await post(project,approval(snap))).status,200);const state=(await (await realRead(project)).json()).state;
      const task=state.tasks.find(task=>task.title===baseItem.title);assert.equal(task.scope,snap.draft.items[0].scope);assert.equal(task.note,baseItem.note);assert.equal(task.status,'todo');assert.equal(task.acceptedAt,'');assert.equal(task.verifiedAt,'');
      } finally {sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
    });
    await t.test('invalid outcome edits cannot save or partially apply, while absent legacy outcomes remain unknown',async()=>{
      const project=await setup(),snap=await ready(project),before=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project),draftBefore=row(project).payload;
      try {
      assert.ok(snap.draft.items.every(item=>item.scope===''));
      for(const scope of [null,{},'x'.repeat(3001),'bad\u0000outcome']){
        const items=structuredClone(snap.draft.items);items[0].scope=scope;
        assert.equal((await post(project,save(snap,{items}))).status,400);assert.equal(row(project).payload,draftBefore);
        assert.equal((await post(project,approval(snap,{items}))).status,400);assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project),before);
      }
      } finally {sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);}
    });
    await t.test('contextual suggestions have their own saved review, disclosed context and shared quota',async()=>{
      const project=await setup();
      const plan=await ready(project),planBefore=structuredClone(plan.draft);
      const suggestionProject=project+'&mode=suggestions';
      const blank=await read(suggestionProject);
      assert.equal(blank.draft,null);assert.equal(blank.purpose,'suggestions');
      assert.equal(blank.brief.description,brief.description);
      const proposed=await ready(suggestionProject);
      assert.deepEqual((await read(project)).draft,planBefore);
      assert.notEqual(proposed.draft.generation,plan.draft.generation);
      assert.match(calls[1].messages[0].content,/GAP REVIEW/);
      assert.equal(calls[1].response_format.json_schema.schema.properties.items.minItems,0);
      assert.equal(calls[0].response_format.json_schema.schema.properties.items.minItems,1);
      assert.match(calls[1].messages[0].content,/cannot be completed correctly/);
      const context=JSON.parse(calls[1].messages[1].content);
      assert.equal(context.purpose,'suggestions');
      assert.deepEqual(Object.keys(context).sort(),['brief','event','existingTasks','feedback','purpose','today']);
      assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count,2);
      assert.deepEqual((await read(suggestionProject)).draft,proposed.draft);
    });
    await t.test('no supported AI gaps is a valid empty suggestion review, never a fabricated task or empty full plan',async()=>{
      const project=await setup(),target=project+'&mode=suggestions';
      provider({items:[],questions:['What outcome matters most?'],assumptions:[]});
      const response=await post(target,generation(await read(target)));
      assert.equal(response.status,200);const snap=await response.json();
      assert.equal(snap.status,'ready',snap.issue);assert.deepEqual(snap.draft.items,[]);
      assert.equal((await (await realRead(project)).json()).state.tasks.length,0);
      assert.equal((await post(target,save(snap))).status,200);
      assert.equal((await post(target,approval(await read(target)))).status,400);
      assert.throws(()=>planGeneration.parsePlanOutput({items:[],questions:[],assumptions:[]}));
      assert.equal((await read(project)).draft,null);
    });
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
    await t.test('one bounded field correction saves a valid draft and reuses one generation allowance', async () => {
      const project = await setup();
      const sent = [], signals = [];
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
        sent.push(JSON.parse(options.body)); signals.push(options.signal);
        if (sent.length === 1) return success({...output(),items:[{...baseItem,start:'PRIVATE_REJECTED_VALUE'}]});
        assert.equal(sent.length,2);
        return success(output());
      };
      const input = generation(await read(project));
      const response = await post(project,input);
      assert.equal(response.status,200);
      const snap = await response.json();
      assert.equal(snap.status,'ready'); assert.equal(sent.length,2);
      assert.equal(signals[0],signals[1]);
      assert.equal(sent[0].messages[1].content,sent[1].messages[1].content);
      assert.match(sent[1].messages[0].content,/Correction: start must/);
      assert.ok(!JSON.stringify(sent[1]).includes('PRIVATE_REJECTED_VALUE'));
      assert.deepEqual((await read(project)).draft,snap.draft);
      assert.equal((await post(project,input)).status,200); assert.equal(sent.length,2);
      assert.equal(sqlite.prepare("SELECT count FROM resource_usage WHERE id LIKE 'plan-ai:%'").get().count,1);
      assert.equal((await post(project,approval(snap))).status,200);
      assert.equal((await (await realRead(project)).json()).state.tasks.length,3);
    });
    await t.test('field correction is limited to two provider requests and never accepts the second malformed draft', async () => {
      const context={event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-10-01'};
      let requests=0;
      globalThis.fetch=async()=>{requests++;return success({...output(),items:[{...baseItem,existingTaskIndex:-1}]});};
      await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));
      assert.equal(requests,2);
    });
    await t.test('no correction follows rate limits, credential errors, network uncertainty, or hidden fields', async () => {
      const context={event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-10-01'};
      for (const failure of [401,403,429,500,'network','shape','cycle','json']) {
        let requests=0;
        globalThis.fetch=async()=>{
          requests++;
          if (failure==='network') throw new Error('PRIVATE_TRANSPORT');
          if (failure==='shape') return success({...output(),items:[{...baseItem,status:'done'}]});
          if (failure==='cycle') return success({...output(),items:[{...baseItem,dependsOn:[baseItem.id]}]});
          if (failure==='json') return Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:'PRIVATE_INVALID_JSON'}}]});
          return new Response('',{status:failure});
        };
        await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));
        assert.equal(requests,1,failure);
      }
    });
    await t.test('field correction stops when the shared deadline is aborted or nearly exhausted', async (caseContext) => {
      const context={event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-10-01'};
      const controller=new AbortController();
      let requests=0, elapsed=0;
      const clock=caseContext.mock.method(performance,'now',()=>elapsed);
      const timeout=caseContext.mock.method(AbortSignal,'timeout',()=>controller.signal);
      try {
        globalThis.fetch=async()=>{requests++;elapsed=36000;return success({...output(),items:[{...baseItem,start:'bad'}]});};
        await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));assert.equal(requests,1);
        elapsed=0;requests=0;
        globalThis.fetch=async()=>{requests++;controller.abort();return success({...output(),items:[{...baseItem,start:'bad'}]});};
        await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));assert.equal(requests,1);
      } finally {clock.mock.restore();timeout.mock.restore();}
    });
    await t.test('a later forbidden task field prevents correction of an earlier malformed field', async () => {
      const context={event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-10-01'};
      for (const forbidden of [{status:'done'},{owner:'PRIVATE_PERSON'},{sendEmail:true}]) {
        let requests=0;
        globalThis.fetch=async()=>{
          requests++;
          return success({...output(),items:[{...baseItem,start:'bad'},{...baseItem,id:'second',...forbidden}]});
        };
        await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));
        assert.equal(requests,1);
      }
    });
    await t.test('field correction is skipped when adding its hint would exceed the request budget', async () => {
      const context={event:{date:'2030-10-04',timeZone:'America/Los_Angeles'},brief,today:'2030-10-01',extra:''};
      const remaining=8950-Buffer.byteLength(JSON.stringify(planGeneration.planRequestBody(context)));
      assert.ok(remaining>0);context.extra='x'.repeat(remaining);
      planGeneration.planRequestBody(context);
      let requests=0;
      globalThis.fetch=async()=>{requests++;return success({...output(),items:[{...baseItem,start:'bad'}]});};
      await assert.rejects(planGeneration.generateEventPlan(context,'test-only-placeholder'));assert.equal(requests,1);
    });
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
        let requests=0;
        globalThis.fetch = async () => {requests++;return Response.json({ choices });};
        await assert.rejects(planGeneration.generateEventPlan({}, 'test-only-placeholder'));
        assert.equal(requests,1);
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
        {...output(), items:output().items.map(item => ({...item, existingTaskIndex:null}))},
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
        assert.deepEqual(logs.pop(), ['weft_plan_generation_failed', {stage:'plan_validation',field:'start',reason:'item_fields'}]);
        for (const [field, patch] of [
          ['shape', {unexpected:'PRIVATE_FIELD'}],
          ['duplicate_index', {existingTaskIndex:-1}],
          ['id', {id:'PRIVATE INVALID ID'}],
          ['kind', {kind:'PRIVATE_KIND'}],
          ['title', {title:''}],
          ['category', {category:'PRIVATE_CATEGORY'}],
          ['note', {note:{private:'PRIVATE_NOTE'}}],
          ['due_date', {dueDate:'2030-02-30'}],
          ['start', {start:{toString:null},end:'2030-10-04T09:00'}],
          ['end', {end:'PRIVATE_TIME'}],
          ['end', {start:'2030-10-04T09:00',end:{toString:null}}],
          ['end_order', {kind:'activity',dueDate:'',start:'2030-10-04T10:00',end:'2030-10-04T09:00'}],
          ['preparation_schedule', {start:'2030-10-04T10:00'}],
          ['activity_deadline', {kind:'activity'}],
          ['location', {location:{private:'PRIVATE_LOCATION'}}],
          ['dependencies', {dependsOn:['same','same']}],
        ]) {
          provider({...output(),items:[{...baseItem,...patch}]});
          await assert.rejects(planGeneration.generateEventPlan({},'test-only-placeholder'));
          assert.deepEqual(logs.pop(),['weft_plan_generation_failed',{stage:'plan_validation',field,reason:'item_fields'}]);
        }
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
    await t.test('AI leaves nonexistent and repeated event-local endpoints unscheduled, but keeps valid times across a clock change', async () => {
      const zone = 'America/Los_Angeles';
      for (const [start, end, expectedWarning] of [
        ['2030-03-10T02:15', '2030-03-10T03:30', /does not exist|time change/i],
        ['2030-03-10T01:30', '2030-03-10T02:15', /does not exist|time change/i],
        ['2030-11-03T01:15', '2030-11-03T02:30', /occurs twice|time change/i],
        ['2030-11-03T00:30', '2030-11-03T01:15', /occurs twice|time change/i],
        ['2030-03-10T01:30', '2030-03-10T03:15', null],
      ]) {
        const date = start.slice(0, 10), location = 'Fictional welcome hall';
        const plan = output();
        Object.assign(plan.items[1], { start, end, location });
        provider(plan);
        const result = await planGeneration.generateEventPlan({
          event: { date, timeZone: zone, location },
          brief: { ...brief, endDate: date, startTime: '00:00', endTime: '04:00' },
          today: '2030-01-01',
        }, 'test-only-placeholder');
        assert.deepEqual(result.items.map(item => item.id), plan.items.map(item => item.id));
        const activity = result.items.find(item => item.id === 'arrive');
        assert.equal(activity.kind, 'activity');
        assert.equal(activity.title, plan.items[1].title);
        assert.equal(activity.note, plan.items[1].note);
        assert.equal(activity.location, location);
        assert.deepEqual(activity.dependsOn, ['approval']);
        if (expectedWarning) {
          assert.deepEqual([activity.start, activity.end], ['', '']);
          assert.equal(result.scheduleWarnings.length, 1);
          assert.match(result.scheduleWarnings[0], expectedWarning);
          assert.match(result.scheduleWarnings[0], /Welcome attendees/);
        } else {
          assert.deepEqual([activity.start, activity.end], [start, end]);
          assert.equal(result.scheduleWarnings, undefined);
        }
      }
    });
    await t.test('invalid edited event-local times cannot partially approve a plan or consume its private draft', async () => {
      const project = await setup(), zone = 'America/Los_Angeles', date = '2030-03-10';
      try {
        await change(project, 'completeSetup', [{ date, timeZone: zone }]);
        await change(project, 'addTask', [{ title: 'Existing fictional work', note: 'Keep this unchanged.' }]);
        const outputWithTime = output();
        Object.assign(outputWithTime.items[1], { start: date + 'T01:30', end: date + 'T03:15', location: 'School hall' });
        provider(outputWithTime);
        const generated = await post(project, generation(await read(project), { brief: { ...brief, endDate: date, startTime: '00:00', endTime: '04:00' } }));
        assert.equal(generated.status, 200, await generated.clone().text());
        const snap = await generated.json();
        assert.equal(snap.status, 'ready');
        const valid = snap.draft.items.find(item => item.id === 'arrive');
        assert.equal(valid.start, date + 'T01:30');
        assert.equal(valid.end, date + 'T03:15');
        const before = sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);
        const draftBefore = row(project);
        for (const [field, label] of [['start', /Start time/i], ['end', /End time/i]]) {
          const items = snap.draft.items.map(item => item.id === valid.id ? { ...item, [field]: date + 'T02:15' } : item);
          const response = await post(project, approval(snap, { items }));
          assert.equal(response.status, 400, await response.clone().text());
          const { error } = await response.json();
          assert.match(error, label);
          assert.ok(error.includes(zone), error);
          assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project), before);
          assert.deepEqual(row(project), draftBefore);
        }
        assert.equal((await post(project, approval(snap))).status, 200, 'the saved valid draft is still available to approve');
        const after = (await (await realRead(project)).json()).state.tasks;
        assert.deepEqual(after.find(task => task.title === valid.title).schedule, { start: valid.start, end: valid.end, location: valid.location });
        assert.equal(after.find(task => task.title === 'Existing fictional work').note, 'Keep this unchanged.');
      } finally { sqlite.prepare('DELETE FROM projects WHERE id=?').run(project); }
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
    await t.test('repeated drafts skip existing work and reuse its prerequisite without modifying it', async () => {
      const project = await setup();
      await change(project, 'addTask', [{ title: baseItem.title, owner: 'jack', note: 'Keep original note.' }]);
      const before = (await (await realRead(project)).json()).state.tasks[0];
      let snap = await ready(project);
      assert.equal(snap.draft.items[0].included, false);
      assert.equal(snap.existingTasks[0].id, before.id);
      assert.equal((await post(project, save(snap))).status, 200);
      snap = await read(project);
      assert.equal(snap.draft.items[0].included, false);
      const response = await post(project, approval(snap));
      assert.equal(response.status, 200, await response.clone().text());
      const result = await response.json();
      assert.equal(result.receipt.taskIds.length, 2);
      assert.ok(!result.receipt.taskIds.includes(before.id));
      const state = (await (await realRead(project)).json()).state;
      assert.equal(state.tasks.length, 3);
      assert.deepEqual(state.tasks.find(task => task.id === before.id), before);
      assert.equal(state.tasks.find(task => task.title === 'Welcome attendees').dependencies[0].taskId, before.id);
      assert.equal((await post(project, approval(snap))).status, 200);
    });
    await t.test('the organizer receipt follows current team commitments and completion without rewriting the approval',async(test)=>{
      const project=await setup();
      test.after(()=>{owner();sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);});
      await joinPerson(project,'fictional-handoff@example.com','fictional-handoff-user');
      const teammate=globalThis.__gatherUser;
      const actor=(await (await realRead(project)).json()).identity.actorId;
      owner();
      const snap=await ready(project);
      snap.draft.items[0].owner=actor;
      snap.draft.items[2].owner='jack';
      const response=await post(project,approval(snap));
      assert.equal(response.status,200,await response.clone().text());
      const applied=await response.json(),[first,second,third]=applied.receiptTasks;
      assert.deepEqual(first.handoff,{state:'awaiting-acceptance',ownerName:'Maya Real'});
      assert.deepEqual(second.handoff,{state:'needs-owner'});
      assert.equal(third.handoff.state,'awaiting-acceptance');
      globalThis.__gatherUser=teammate;
      assert.equal((await get(project)).status,403,'the teammate has no access to the organizer receipt');
      await change(project,'acceptTask',[first.id]);
      owner();
      assert.deepEqual((await read(project)).receiptTasks[0].handoff,{state:'accepted',ownerName:'Maya Real'});
      await change(project,'updateTask',[first.id,{requiresVerification:true}]);
      globalThis.__gatherUser=teammate;
      await change(project,'reportCompletion',[first.id,'Fictional approval record is ready for review.']);
      owner();
      assert.deepEqual((await read(project)).receiptTasks[0].handoff,{state:'needs-review',ownerName:'Maya Real'});
      const returned=await change(project,'returnCompletion',[first.id,'Confirm the missing fictional approval detail.']);
      const review=returned.state.tasks.find(task=>task.id===first.id).completionReview;
      assert.ok(review);
      assert.deepEqual((await read(project)).receiptTasks[0].handoff,{state:'changes-requested',ownerName:'Maya Real'});
      await change(project,'updateTask',[third.id,{requiresVerification:true}]);
      await change(project,'reportCompletion',[third.id,'Cleanup owners and handback recorded.']);
      assert.equal((await read(project)).receiptTasks[2].handoff.state,'needs-review');
      await change(project,'verifyTask',[third.id]);
      assert.equal((await read(project)).receiptTasks[2].handoff.state,'complete');
      const amended=await change(project,'setCompletionEvidence',[third.id,{note:'Added the updated handback record.'}]);
      assert.equal((await read(project)).receiptTasks[2].handoff.state,'needs-amendment-review');
      await change(project,'reviewCompletionEvidence',[third.id,amended.state.tasks.find(task=>task.id===third.id).revision]);
      const member=(await (await teamRead(project)).json()).members[0];
      assert.equal((await teamWrite(project,{action:'removeMember',id:member.id,revision:member.revision})).status,200);
      const before=sqlite.prepare('SELECT revision,data FROM workspaces WHERE id=?').get(project);
      const draftBefore=row(project);
      const returnedTask=JSON.parse(before.data).tasks.find(task=>task.id===first.id);
      assert.equal(returnedTask.owner,actor);
      assert.deepEqual(returnedTask.completionReview,review,'removing access preserves the returned report');
      const refreshed=await read(project);
      assert.deepEqual(refreshed.receipt,applied.receipt);
      assert.deepEqual(refreshed.receiptTasks[0].handoff,{state:'needs-reassignment'});
      assert.equal(refreshed.receiptTasks[1].handoff.state,'needs-owner');
      assert.equal(refreshed.receiptTasks[2].handoff.state,'complete');
      assert.deepEqual(sqlite.prepare('SELECT revision,data FROM workspaces WHERE id=?').get(project),before);
      assert.deepEqual(row(project),draftBefore,'reading handoff never rewrites the private approval');
      assert.equal(calls.length,1);
      const unassigned=await change(project,'updateTask',[first.id,{owner:''}]);
      assert.deepEqual(unassigned.state.tasks.find(task=>task.id===first.id).completionReview,review);
      assert.deepEqual((await read(project)).receiptTasks[0].handoff,{state:'needs-owner'});
      await change(project,'updateTask',[first.id,{requiresVerification:false}]);
      await change(project,'updateTask',[first.id,{status:'done',requiresVerification:true}]);
      assert.deepEqual((await read(project)).receiptTasks[0].handoff,{state:'needs-review'},'Done without required verification still needs review even without a report');
      const shared=(await (await realRead(project)).json()).state.tasks;
      await change(project,'deleteTask',[second.id,shared.find(task=>task.id===second.id).revision]);
      const deleted=await read(project);
      assert.deepEqual(deleted.receipt,applied.receipt);
      assert.equal(deleted.receiptTasks.some(task=>task.id===second.id),false);
    });
    await t.test('a receipt reports when required work blocks verification without treating related work or amendments as blocked',async(test)=>{
      const project=await setup();
      test.after(()=>{owner();sqlite.prepare('DELETE FROM projects WHERE id=?').run(project);});
      const required=(await change(project,'addTask',[{title:baseItem.title,owner:'jack',requiresVerification:true}])).result;
      await change(project,'reportCompletion',[required.id,'Fictional approval recorded.']);
      await change(project,'verifyTask',[required.id]);
      const related=(await change(project,'addTask',[{title:'Parallel fictional welcome setup',owner:'jack'}])).result;
      const snap=await ready(project);
      assert.equal(snap.draft.items[0].included,false,'the draft can reuse the already verified prerequisite');
      snap.draft.items[1].owner='jack';
      const response=await post(project,approval(snap));
      assert.equal(response.status,200,await response.clone().text());
      const applied=await response.json();
      const receiptTask=applied.receiptTasks.find(task=>task.title==='Welcome attendees');
      assert.ok(receiptTask);
      for(const prerequisite of [required,related])assert.ok(!applied.receipt.taskIds.includes(prerequisite.id));
      await change(project,'addDependency',[receiptTask.id,{taskId:related.id,kind:'related',reason:'Share context without blocking completion.'}]);
      await change(project,'updateTask',[receiptTask.id,{requiresVerification:true}]);
      await change(project,'reportCompletion',[receiptTask.id,'FICTIONAL_PRIVATE_RECEIPT_REPORT']);
      const workspaceRow=()=>sqlite.prepare('SELECT revision,data FROM workspaces WHERE id=?').get(project);
      async function check(expected) {
        const before=workspaceRow(),draftBefore=row(project);
        const refreshed=await read(project);
        assert.deepEqual(refreshed.receipt,applied.receipt);
        const item=refreshed.receiptTasks.find(task=>task.id===receiptTask.id);
        assert.equal(item?.handoff?.state,expected);
        assert.doesNotMatch(JSON.stringify(item),/FICTIONAL_PRIVATE_RECEIPT_|Parallel fictional welcome setup/);
        assert.deepEqual(workspaceRow(),before,'receipt GET must not write the workspace');
        assert.deepEqual(row(project),draftBefore,'receipt GET must not rewrite the private draft');
      }
      await check('needs-review');
      await change(project,'updateTask',[required.id,{status:'todo'}]);
      await check('review-blocked');
      await change(project,'reportCompletion',[required.id,'Fictional approval reconfirmed.']);
      await check('review-blocked');
      await change(project,'verifyTask',[required.id]);
      await check('needs-review');
      await change(project,'verifyTask',[receiptTask.id]);
      await change(project,'updateTask',[required.id,{status:'todo'}]);
      await change(project,'setCompletionEvidence',[receiptTask.id,{note:'FICTIONAL_PRIVATE_RECEIPT_AMENDMENT'}]);
      await check('needs-amendment-review');
      assert.equal(calls.length,1,'receipt refreshes must not call the provider');
    });
    await t.test('semantic duplicate review persists choices, reuses an existing prerequisite and preserves its details', async () => {
      const project = await setup();
      await change(project, 'addTask', [{ title: 'Get approval for the event', owner: 'jack', note: 'Keep original note.' }]);
      const before = (await (await realRead(project)).json()).state.tasks[0];
      const generated = output();
      generated.items[0].existingTaskIndex = 0;
      provider(generated);
      let response = await post(project, generation(await read(project)));
      let snap = await response.json();
      assert.equal(snap.draft.items[0].included,true,'Semantic hints never silently skip');
      assert.equal(snap.draft.duplicateSuggestions[0].taskId,before.id);
      assert.equal((await post(project,approval(snap))).status,400,'Unresolved choice blocks apply');
      const forged = approval(snap, {items:structuredClone(snap.draft.items)});
      forged.items[2].included=false;
      forged.items[2].duplicateChoice='reuse';
      assert.equal((await post(project,forged)).status,400,'Client cannot create a reuse target');
      snap.draft.items[0].included=false;
      snap.draft.items[0].duplicateChoice='reuse';
      assert.equal((await post(project,save(snap))).status,200);
      snap=await read(project);
      assert.equal(snap.draft.items[0].duplicateChoice,'reuse');
      const edited=approval(snap,{items:structuredClone(snap.draft.items)});
      edited.items[0].title='Approve a different event';
      assert.equal((await post(project,edited)).status,400,'Edits invalidate reuse');
      response=await post(project,approval(snap));
      assert.equal(response.status,200,await response.clone().text());
      assert.equal((await response.json()).receipt.taskIds.length,2);
      const state=(await (await realRead(project)).json()).state;
      assert.equal(state.tasks.length,3);
      assert.deepEqual(state.tasks.find(task=>task.id===before.id),before);
      assert.equal(state.tasks.find(task=>task.title==='Welcome attendees').dependencies[0].taskId,before.id);
      assert.equal((await post(project,approval(snap))).status,200);
    });
    await t.test('semantic suggestions can be kept separate and invalid provider references are ignored', async () => {
      for (const index of [0,199]) {
        const project=await setup();
        await change(project,'addTask',[{title:'Get approval for the event'}]);
        const generated=output();generated.items[0].existingTaskIndex=index;provider(generated);
        const response=await post(project,generation(await read(project)));
        const snap=await response.json();
        assert.equal(snap.draft.duplicateSuggestions.length,index===0?1:0);
        if(index===0)snap.draft.items[0].duplicateChoice='keep';
        assert.equal((await post(project,approval(snap))).status,200);
        assert.equal((await (await realRead(project)).json()).state.tasks.length,4);
      }
    });
    await t.test('existing matches cannot bypass duplicate, ambiguity or stale-workspace checks', async () => {
      const project = await setup();
      await change(project, 'addTask', [{ title: baseItem.title }]);
      let snap = await ready(project);
      const input = approval(snap, { items: structuredClone(snap.draft.items) });
      input.items[0].included = true;
      assert.equal((await post(project, input)).status, 400);
      await change(project, 'addTask', [{ title: baseItem.title }]);
      assert.equal((await post(project, approval(snap))).status, 409);
      cool(project);
      snap = await ready(project);
      assert.equal(snap.draft.items[0].included, false);
      assert.equal((await post(project, approval(snap))).status, 400, 'Ambiguous matches require explicit removal of the prerequisite');
      snap.draft.items[1].dependsOn = [];
      assert.equal((await post(project, approval(snap))).status, 200);
      assert.equal((await (await realRead(project)).json()).state.tasks.length, 4);
    });
    await t.test('saving after a same-title prerequisite replacement stays private and reveals the new workspace revision',async test=>{
      const project=await setup();
      test.after(()=>sqlite.prepare('DELETE FROM projects WHERE id=?').run(project));
      const seeded=await change(project,'addTask',[{title:baseItem.title,owner:'jack',note:'Fictional original approval.'}]);
      const original=seeded.state.tasks[0],reviewed=await ready(project);
      const match=reviewed.draft.items.find(item=>item.id===baseItem.id);
      const dependent=reviewed.draft.items.find(item=>item.dependsOn.includes(match.id));
      assert.equal(match.included,false,'the matching shared prerequisite is not selected for creation');
      assert.ok(dependent?.included);
      assert.deepEqual(reviewed.existingTasks,[{id:original.id,title:original.title,start:''}]);

      await change(project,'deleteTask',[original.id,original.revision]);
      const replaced=await change(project,'addTask',[{title:original.title,owner:'jack',note:'Fictional replacement approval.'}]);
      const replacement=replaced.state.tasks[0];
      assert.notEqual(replacement.id,original.id);
      assert.deepEqual(replaced.state.tasks.map(task=>task.id),[replacement.id]);
      const beforeSave=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);

      const edit='Fictional updated notes for the reviewed arrival.';
      const items=reviewed.draft.items.map(item=>item.id===dependent.id?{...item,note:edit}:item);
      const response=await post(project,save(reviewed,{items}));
      assert.equal(response.status,200,await response.clone().text());
      const saved=await response.json();
      assert.ok(saved.revision>reviewed.revision);
      assert.ok(saved.workspaceRevision>reviewed.workspaceRevision);
      assert.equal(saved.workspaceRevision,replaced.revision);
      assert.equal(saved.contextChanged,false,'the generation inputs did not change: same title and start time');
      assert.deepEqual(saved.existingTasks,[{id:replacement.id,title:original.title,start:''}]);
      assert.equal(saved.draft.items.find(item=>item.id===dependent.id).note,edit);
      assert.equal(saved.receipt,null);
      assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project),beforeSave,'Save changes only the private draft');

      const staleApply=await post(project,approval(saved,{workspaceRevision:reviewed.workspaceRevision}));
      assert.equal(staleApply.status,409,await staleApply.clone().text());
      assert.match((await staleApply.json()).error,/project changed/i);
      assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project),beforeSave,'stale Apply creates no tasks or links');
      assert.deepEqual(await read(project),saved,'stale Apply neither consumes nor changes the saved private draft');
    });
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
    await t.test('a pasted checklist starts a private plan and only adds selected tasks on approval',async(test)=>{
      const project=await setup();
      test.after(()=>sqlite.prepare('DELETE FROM projects WHERE id=?').run(project));
      await change(project,'addTask',[{title:'Confirm venue access'}]);
      const before=await read(project);
      const input=paste(before,'- [x] Confirm venue access\r\n1. Recruit volunteers\r\n• Prepare signage\n- [ ] recruit VOLUNTEERS\n\n☑');
      const duplicateOnly=await post(project,paste(before,'Confirm venue access'));
      assert.deepEqual((await duplicateOnly.json()).checklistImportResult,{added:0,skipped:1});
      assert.equal(row(project),undefined);
      assert.equal((await post(project+'&mode=suggestions',input)).status,400);
      const response=await post(project,input);
      assert.equal(response.status,200,await response.clone().text());
      const result=await response.json();
      assert.equal(result.draft.source,'pasted');
      assert.equal(result.workspaceRevision,before.workspaceRevision);
      assert.deepEqual(result.checklistImportResult,{added:2,skipped:2});
      assert.deepEqual(result.draft.items.map(item=>item.title),['Recruit volunteers','Prepare signage']);
      assert.ok(result.draft.items.every(item=>!item.included&&!item.owner&&!item.dueDate&&!item.start&&!item.end&&!item.dependsOn.length));
      assert.equal(result.draft.lastChecklistImport,undefined);
      assert.ok(!JSON.stringify(row(project)).includes('Recruit volunteers'));
      assert.equal((await read(project)).checklistImportResult,undefined);
      assert.deepEqual(await (await post(project,input)).json(),result);
      assert.equal((await post(project,{...input,text:'Other task'})).status,409);
      assert.equal((await post(project,approval(result))).status,400);
      const picked=result.draft.items.map((item,i)=>({...item,included:i===0}));
      assert.equal((await post(project,approval(result,{items:picked}))).status,200);
      const shared=(await (await realRead(project)).json()).state.tasks;
      assert.deepEqual(shared.map(item=>item.title).sort(),['Confirm venue access','Recruit volunteers']);
      assert.notEqual(shared.find(item=>item.title==='Recruit volunteers').status,'done');
      assert.equal(calls.length,0);
    });
    await t.test('a source event checklist round-trips into another event without copying shared task data',async(test)=>{
      const source=await setup(),project=await newTeamProject('Fictional next school evening');
      test.after(()=>sqlite.prepare('DELETE FROM projects WHERE id IN (?,?)').run(source,project));
      await change(source,'addTask',[{title:'2. Review venue access',note:'Exclude original note',owner:'jack',dueDate:'2030-10-02'}]);
      await change(source,'addTask',[{title:'Excluded original task'}]);
      const original=(await (await realRead(source)).json());
      const destination=(await (await realRead(project)).json());
      const rows=GatherWrapUp.reusableTitles(original.state);
      const index=rows.findIndex(row=>row.title==='2. Review venue access');
      const checklist=GatherWrapUp.reusableChecklist(rows,[{index,title:rows[index].title}]);
      assert.equal(checklist,'- [ ] 2. Review venue access');
      const snap=await read(project);
      const response=await post(project,paste(snap,checklist,{brief:{...snap.brief,description:snap.event.name}}));
      assert.equal(response.status,200,await response.clone().text());
      const imported=await response.json();
      assert.deepEqual(imported.draft.items.map(({title,note,owner,dueDate,included})=>({title,note,owner,dueDate,included})),
        [{title:'2. Review venue access',note:'',owner:'',dueDate:'',included:false}]);
      for(const [id,before] of [[source,original],[project,destination]]){
        const after=await (await realRead(id)).json();
        assert.equal(after.revision,before.revision);
        assert.deepEqual(after.state.tasks,before.state.tasks);
      }
      assert.equal(calls.length,0);
    });
    await t.test('pasting keeps reviewed edits and rejects stale, invalid or oversized imports atomically',async(test)=>{
      const project=await setup();
      test.after(()=>sqlite.prepare('DELETE FROM projects WHERE id=?').run(project));
      const snap=await ready(project), previous=row(project);
      const edited=structuredClone(snap.draft.items);
      edited[0].title='Confirm edited venue wording';
      edited[0].included=false;
      const input=paste(snap,'Confirm edited venue wording\n2) Request the accessibility map',{items:edited});
      for(const bad of ['- [x]', 'x'.repeat(181), 'x'.repeat(6001), 'invalid\u0000text',
        Array.from({length:25},(_,i)=>'Line '+i).join('\n'),
        Array.from({length:24},(_,i)=>'Line '+i).join('\n')]){
        assert.equal((await post(project,{...input,text:bad})).status,400);
      }
      assert.deepEqual(row(project),previous);
      const [first,second]=await Promise.all([post(project,input),post(project,input)]);
      assert.equal(first.status,200,await first.clone().text());
      assert.equal(second.status,200,await second.clone().text());
      const result=await first.json();
      assert.deepEqual(await second.json(),result);
      assert.equal(result.revision,snap.revision+1);
      assert.deepEqual(result.draft.items.slice(0,edited.length),edited);
      assert.deepEqual(result.checklistImportResult,{added:1,skipped:1});
      assert.equal(result.draft.items.at(-1).title,'Request the accessibility map');
      assert.equal(result.workspaceRevision,snap.workspaceRevision);
      assert.equal(result.draft.generation,snap.draft.generation);
      for(const field of ['started_at','request_id','request_hash','lease_until'])assert.equal(row(project)[field],previous[field]);
      assert.equal(calls.length,1);
      const next=paste(result,'Prepare volunteer badges');
      await change(project,'addTask',[{title:'New shared task'}]);
      assert.equal((await post(project,next)).status,409);
      assert.equal((await post(project,{...next,workspaceRevision:(await read(project)).workspaceRevision})).status,409);
      assert.equal((await read(project)).draft.items.length,edited.length+1);
    });

    await t.test('rechecking a pasted draft preserves edits and makes new exact matches visible before approval',async(test)=>{
      const project=await setup();
      test.after(()=>sqlite.prepare('DELETE FROM projects WHERE id=?').run(project));
      const created=await post(project,paste(await read(project),'Schedule volunteer briefing\nPrint welcome signs'));
      assert.equal(created.status,200,await created.clone().text());
      await change(project,'addTask',[{title:'Print welcome signs'}]);
      const latest=await read(project);
      assert.equal(latest.contextChanged,true);
      const items=latest.draft.items.map((item,index)=>({...item,included:true,note:index===0?'Confirm the backup lead.':''}));
      const input={action:'recheck-pasted',revision:latest.revision,workspaceRevision:latest.workspaceRevision,
        generation:latest.draft.generation,brief:latest.brief,items};
      const savedBefore=row(project);
      assert.equal((await post(project,{...input,workspaceRevision:latest.workspaceRevision-1})).status,409);
      assert.deepEqual(row(project),savedBefore);
      const reviewed=await post(project,input);assert.equal(reviewed.status,200,await reviewed.clone().text());
      const result=await reviewed.json();
      assert.equal(result.contextChanged,false);
      assert.deepEqual(result.draft.items,items);
      assert.deepEqual(result.existingTasks.map(item=>item.title),['Print welcome signs']);
      assert.equal((await post(project,approval(result))).status,400,'review cannot bypass exact duplicates');
      assert.equal((await post(project,approval(result,{items:items.map((item,index)=>({...item,included:index===0}))}))).status,200);
      assert.equal(calls.length,0);
    });

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
