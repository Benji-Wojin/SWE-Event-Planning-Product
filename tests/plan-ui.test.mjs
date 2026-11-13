import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Hook-level interaction tests, not a substitute for real-browser layout/accessibility QA.
let PlanReview;
before(async () => {
  const bundle = await build({
    entryPoints: ['app/plan/plan-client.tsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'ui-harness',
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (args) => ({
            path: args.path,
            namespace: 'harness',
          }));
          b.onResolve({ filter: /^@\/components\/ui\// }, (args) => ({
            path: args.path,
            namespace: 'harness',
          }));
          b.onLoad({ filter: /.*/, namespace: 'harness' }, (args) => ({
            loader: 'js',
            contents:
              args.path === 'react'
                ? 'export const useState=(v)=>globalThis.__planHooks.useState(v),useRef=(v)=>globalThis.__planHooks.useRef(v),useEffect=(f,d)=>globalThis.__planHooks.useEffect(f,d);'
                : args.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";'
                  : 'export const Button="button",Input="input",Textarea="textarea",Label="label",NativeSelect="select",Card="article",CardContent="div";',
          }));
        },
      },
    ],
  });
  ({ PlanReview } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(bundle.outputFiles[0].text).toString('base64')
  ));
});
const brief = {
  kind: 'school',
  description: 'An arts evening.',
  endDate: '',
  startTime: '',
  endTime: '',
};
const item = {
  id: 'one',
  kind: 'preparation',
  title: 'Confirm activities',
  note: 'Confirm the program.',
  category: 'Program',
  dueDate: '',
  start: '',
  end: '',
  location: '',
  dependsOn: [],
  owner: '',
  included: true,
};
const fixture = () => ({
  revision: 2,
  workspaceRevision: 4,
  event: { name: 'Example event', date: '', timeZone: 'UTC' },
  members: [{ id: 'jack', name: 'Organizer' }],
  existingTaskCount: 0,
  configured: true,
  brief: structuredClone(brief),
  draft: {
    generation: 'de22719e-0292-4545-a5dd-fd2e50c5969e',
    brief: structuredClone(brief),
    items: [structuredClone(item)],
    questions: [],
    assumptions: [],
  },
  receipt: null,
  status: 'ready',
  issue: '',
  contextChanged: false,
  retryAfter: 0,
});
const copy = (value) => structuredClone(value);
const text = (node) =>
  node == null || typeof node === 'boolean'
    ? ''
    : typeof node === 'string' || typeof node === 'number'
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join('')
        : text(node.props?.children);
function nodes(node) {
  return node == null || typeof node !== 'object'
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];
}
function harness(server, initial = fixture(), query = 'project=p_example', embedded = false, guided = false) {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
    hooks: globalThis.__planHooks,
  };
  const state = [],
    timers = new Map(),
    requests = [], listeners=new Map(), parentMessages=[];
  let index = 0,
    changed = true,
    effects = [],
    tree,
    nextTimer = 0;
  const hooks = {
    useState(initial) {
      const id = index++;
      if (!state[id]) state[id] = { value: initial };
      return [
        state[id].value,
        (value) => {
          const next =
            typeof value === 'function' ? value(state[id].value) : value;
          if (!Object.is(next, state[id].value)) {
            state[id].value = next;
            changed = true;
          }
        },
      ];
    },
    useRef(initial) {
      const id = index++;
      if (!state[id]) state[id] = { current: initial };
      return state[id];
    },
    useEffect(callback, deps) {
      const id = index++,
        old = state[id];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        state[id] = { deps, cleanup: old?.cleanup };
        effects.push(() => {
          state[id].cleanup?.();
          state[id].cleanup = callback();
        });
      }
    },
  };
  let saved = copy(initial);
  globalThis.__planHooks = hooks;
  globalThis.document={getElementById:()=>null};
  globalThis.window = {
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    location:{origin:'https://weft.example'},
    parent:{postMessage:(value,origin)=>parentMessages.push({value,origin})},
    addEventListener(type,fn) {if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn) {listeners.get(type)?.delete(fn);},
    confirm: () => true,
  };
  globalThis.fetch = async (url, options = {}) => {
    const input = options.body ? JSON.parse(options.body) : null;
    requests.push(input || { action: 'get' });
    const context = {
      input,
      url,
      saved,
      get value() {
        return saved;
      },
      set value(value) {
        saved = copy(value);
      },
    };
    const response = await server?.(context);
    return response || Response.json(copy(saved));
  };
  function render() {
    changed = false;
    index = 0;
    tree = PlanReview({ query, embedded, guided });
    const next = effects;
    effects = [];
    next.forEach((callback) => callback());
  }
  async function settle() {
    for (let i = 0; i < 12; i++) {
      if (changed) render();
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (changed) render();
  }
  return {
    requests,
    parentMessages,
    async message(data,extra={}){
      for(const listener of listeners.get('message')||[])listener({data,source:window.parent,origin:window.location.origin,...extra});
      await settle();
    },
    timers,
    get tree() {
      return tree;
    },
    get saved() {
      return saved;
    },
    async chat(action, ...args) {
      const chat = nodes(tree).find(node => typeof node.type === 'function' && node.props?.onSend);
      assert.ok(chat, 'Task conversation');
      const result = await chat.props[action](...args);
      await settle();
      return result;
    },
    async start() {
      await settle();
    },
    async click(label) {
      const button = nodes(tree).find(
        (node) => node.type === 'button' && text(node) === label,
      );
      assert.ok(button, 'Button ' + label);
      assert.ok(!button.props.disabled, 'Enabled ' + label);
      await button.props.onClick();
      await settle();
    },
    async edit(id, value) {
      const field = nodes(tree).find((node) => node.props?.id === id);
      assert.ok(field, 'Field ' + id);
      field.props.onChange({ target: { value } });
      await settle();
    },
    async check(id, checked) {
      const field = nodes(tree).find((node) => node.props?.id === id);
      assert.ok(field, 'Checkbox ' + id);
      field.props.onChange({ target: { checked } });
      await settle();
    },
    find(id) {
      return nodes(tree).find((node) => node.props?.id === id);
    },
    async poll() {
      const entry = [...timers.entries()][0];
      assert.ok(entry, 'Polling timer');
      timers.delete(entry[0]);
      entry[1]();
      await settle();
    },
    dispose() {
      for (const slot of state) slot?.cleanup?.();
      globalThis.fetch = previous.fetch;
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      globalThis.__planHooks = previous.hooks;
    },
  };
}
test('embedded task context is only an offer; cancel preserves edits and accepting seeds a new private message without a request',async()=>{
  const initial=fixture();initial.brief.description=JSON.stringify([{role:'user',content:'Existing private conversation'}]);
  const app=harness(undefined,initial,'project=p_example&mode=assistant',true);
  const chat=()=>nodes(app.tree).find(node=>typeof node.type==='function'&&node.props?.onSend).props;
  try{
    await app.start();const before=copy(app.saved),count=app.requests.length;
    assert.ok(app.parentMessages.some(message=>message.value.type==='weft-task-breakdown-ready'));
    const offer={type:'weft-task-breakdown',requestId:7,title:'Prepare fictional school welcome'};
    await app.message(offer,{source:{}});await app.message(offer,{origin:'https://wrong.example'});assert.equal(chat().taskContextTitle,undefined);
    await app.message(offer);assert.equal(chat().taskContextTitle,offer.title);assert.ok(app.parentMessages.some(message=>message.value.type==='weft-task-breakdown-received'&&message.value.requestId===7));assert.deepEqual(app.saved,before);
    await app.chat('onDirty',true);window.confirm=()=>false;await app.chat('onNew','A reviewed task request');assert.equal(chat().initialMessage,'');assert.equal(chat().taskContextTitle,offer.title);assert.equal(chat().brief.description,initial.brief.description);
    window.confirm=()=>true;await app.chat('onNew','A reviewed task request');assert.equal(chat().initialMessage,'A reviewed task request');assert.equal(chat().taskContextTitle,undefined);assert.equal(chat().brief.description,'');assert.equal(app.requests.length,count);assert.deepEqual(app.saved,before);assert.match(text(app.tree),/Review the new message before sending/);
    window.confirm=()=>false;await app.chat('onNew');assert.equal(chat().initialMessage,'A reviewed task request','seed is treated as an unsent dirty message');
  }finally{app.dispose();}
});
test('starter checklist is available with an empty brief and no AI configuration, without generating or applying',async()=>{
  const initial=fixture();initial.configured=false;initial.draft=null;initial.status='empty';initial.brief={...brief,description:''};
  const active=harness(context=>{
    if(context.input?.action==='starter'){
      assert.equal(context.input.brief.description,'Example event');assert.equal(context.input.brief.kind,'corporate');assert.equal(context.input.replace,false);
      context.value={...context.saved,revision:3,status:'ready',brief:context.input.brief,draft:{...fixture().draft,source:'starter',brief:context.input.brief}};
    }
  },initial);
  try{
    await active.start();await active.edit('plan-kind','corporate');await active.click('Use starter checklist');
    assert.deepEqual(active.requests.map(r=>r.action),['get','starter']);
    assert.match(text(active.tree),/Product-authored starter checklist/);assert.match(text(active.tree),/no shared tasks were added/);
    assert.equal(active.saved.receipt,null);
  }finally{active.dispose();}
});

test('pasted text and pending edits survive a lost response and retry without changing selection',async()=>{
  const pasted={...item,id:'pasted-signage',title:'Prepare signage',note:'',included:false};
  let loseResponse=true;
  const app=harness(context=>{
    if(context.input?.action!=='import-checklist')return;
    if(loseResponse){
      context.value={...context.saved,revision:3,
        draft:{...context.saved.draft,items:[...context.input.items,pasted]},
        checklistImportResult:{added:1,skipped:1}};
      loseResponse=false;
      throw new Error('Response lost');
    }
  });
  try{
    await app.start();
    await app.edit('title-one','Keep the revised programme');
    const input='- Keep the revised programme\n- [x] Prepare signage';
    await app.edit('plan-pasted-checklist',input);
    await app.click('Import for review');
    assert.equal(app.find('plan-pasted-checklist').props.value,input);
    assert.equal(app.find('title-one').props.value,'Keep the revised programme');
    await app.click('Import for review');
    assert.deepEqual(app.requests.map(x=>x.action),['get','import-checklist','import-checklist']);
    assert.deepEqual(app.requests[1],app.requests[2]);
    assert.equal(app.find('plan-pasted-checklist').props.value,'');
    assert.equal(app.find('include-one').props.checked,true);
    assert.equal(app.find('include-'+pasted.id).props.checked,false);
    assert.match(text(app.tree),/1 matching line was skipped/);
  }finally{app.dispose();}
});

test('starter replacement saves edited work and retries the same request after an uncertain response',async()=>{
  let first=true,body;
  const active=harness(context=>{
    if(context.input?.action==='save')context.value={...context.saved,revision:context.saved.revision+1,brief:copy(context.input.brief),draft:{...context.saved.draft,items:copy(context.input.items)}};
    if(context.input?.action==='starter'){
      assert.equal(context.input.replace,true);assert.equal(context.saved.draft.items[0].title,'Keep this edited task');
      if(first){first=false;body=copy(context.input);return Response.json({error:'Response interrupted'},{status:503});}
      assert.deepEqual(context.input,body);
      context.value={...context.saved,revision:context.saved.revision+1,draft:{...context.saved.draft,source:'starter'}};
    }
  });
  try{
    await active.start();await active.edit('title-one','Keep this edited task');await active.click('Replace with starter checklist');
    assert.deepEqual(active.requests.map(r=>r.action),['get','save','starter']);
    assert.equal(active.saved.draft.items[0].title,'Keep this edited task');
    await active.click('Retry checklist request');assert.deepEqual(active.requests.map(r=>r.action),['get','save','starter','starter']);
  }finally{active.dispose();}
});

test('starter replacement cancellation does not save, generate or replace the draft',async()=>{
  const active=harness();
  try{await active.start();globalThis.window.confirm=()=>false;await active.click('Replace with starter checklist');assert.deepEqual(active.requests.map(r=>r.action),['get']);}
  finally{active.dispose();}
});

test('starter controls stay locked during generation and are absent from conversation or suggestions modes',async()=>{
  const initial=fixture();initial.status='generating';
  let active=harness(undefined,initial);
  try{await active.start();const button=nodes(active.tree).find(n=>n.type==='button'&&text(n)==='Replace with starter checklist');assert.ok(button.props.disabled);}
  finally{active.dispose();}
  for(const mode of ['assistant','suggestions']){
    active=harness(undefined,fixture(),'project=p_example&mode='+mode);
    try{await active.start();assert.ok(!nodes(active.tree).some(n=>n.type==='button'&&/starter checklist/.test(text(n))));}
    finally{active.dispose();}
  }
});

test('apply saves brief edits and sends normalized reviewed items, without losing either on a failed response', async () => {
  let first = true;
  const active = harness((context) => {
    const { input, saved } = context;
    if (input?.action === 'save')
      context.value = {
        ...saved,
        revision: saved.revision + 1,
        brief: copy(input.brief),
        draft: {
          ...saved.draft,
          items: input.items.map((item) => ({
            ...item,
            title: item.title.trim(),
          })),
        },
      };
    if (input?.action === 'apply') {
      assert.equal(input.items[0].title, 'Updated task');
      context.value = {
        ...saved,
        revision: saved.revision + 1,
        status: 'applied',
        receipt: { taskIds: ['task-new'] },
        receiptTasks: [{id:'task-new',title:'Updated task',handoff:{state:'needs-owner'}}],
      };
      if (first) {
        first = false;
        throw new Error('Connection lost after save');
      }
    }
  });
  try {
    await active.start();
    await active.edit('plan-brief', 'New brief to preserve');
    await active.edit('title-one', '  Updated task  ');
    await active.click('Add 1 selected items to project');
    assert.equal(
      active.find('plan-brief').props.value,
      'New brief to preserve',
    );
    assert.equal(active.find('title-one').props.value, 'Updated task');
    await active.click('Add 1 selected items to project');
    assert.match(text(active.tree), /1 task added/);
    assert.deepEqual(
      active.requests
        .filter((input) => input.action !== 'get')
        .map((input) => input.action),
      ['save', 'apply', 'apply'],
    );
    assert.deepEqual(
      active.requests.at(-1).items,
      active.requests.at(-2).items,
    );
  } finally {
    active.dispose();
  }
});
for (const contextChanged of [false, true]) {
  test(`saving dirty approval pauses when the workspace revision advances${contextChanged ? ' and the draft needs a new context review' : ' with the same context hash'}`, async () => {
    const initial = fixture();
    const prerequisite = { id: 'old-prerequisite', title: 'Confirm venue', start: '' };
    initial.existingTasks = [prerequisite];
    initial.existingTaskCount = 1;
    initial.draft.items = [
      { ...initial.draft.items[0], dependsOn: ['venue'] },
      { ...copy(item), id: 'venue', title: prerequisite.title, included: false },
      { ...copy(item), id: 'signs', title: 'Print welcome signs', included: false },
    ];
    const replacement = { ...prerequisite, id: 'new-prerequisite' };
    const existingTasks = contextChanged
      ? [replacement, { id: 'task-added', title: 'Check the room layout', start: '' }]
      : [replacement];
    const active = harness(context => {
      const { input, saved } = context;
      if (input?.action === 'save') {
        assert.equal(input.revision, initial.revision);
        assert.equal(input.generation, initial.draft.generation);
        // A private save may return a newer workspace, even if its context hash is unchanged.
        context.value = {
          ...saved,
          revision: saved.revision + 1,
          workspaceRevision: saved.workspaceRevision + 1,
          existingTasks,
          existingTaskCount: existingTasks.length,
          contextChanged,
          brief: input.brief,
          draft: { ...saved.draft, items: input.items },
        };
      }
    }, initial);
    try {
      await active.start();
      await active.edit('plan-brief', 'Fictional updated brief');
      await active.edit('title-one', 'Confirm the evening activities');
      await active.check('include-signs', true);
      await active.click('Add 2 selected items to project');
      assert.deepEqual(active.requests.map(({ action }) => action), ['get', 'save']);
      assert.equal(active.find('plan-brief').props.value, 'Fictional updated brief');
      assert.equal(active.find('title-one').props.value, 'Confirm the evening activities');
      assert.equal(active.find('include-one').props.checked, true);
      assert.equal(active.find('include-venue').props.checked, false);
      assert.equal(active.find('include-signs').props.checked, true);
      assert.deepEqual(active.saved.draft.items[0].dependsOn, ['venue']);
      const add = nodes(active.tree).find(node => node.type === 'button' && text(node) === 'Add 2 selected items to project');
      assert.ok(add, 'the reviewed selection remains visible');
      assert.equal(Boolean(add.props.disabled), contextChanged);
      if (contextChanged) return;

      await active.click('Add 2 selected items to project');
      assert.deepEqual(active.requests.map(({ action }) => action), ['get', 'save', 'apply']);
      assert.deepEqual(active.requests.at(-1), {
        action: 'apply',
        revision: initial.revision + 1,
        workspaceRevision: initial.workspaceRevision + 1,
        generation: initial.draft.generation,
        items: active.saved.draft.items,
        confirm: true,
      });
    } finally {
      active.dispose();
    }
  });
}
test('a newer private draft from another tab does not replace local review or get applied', async () => {
  const initial = fixture();
  const active = harness(context => {
    if (context.input?.action !== 'save') return;
    context.value = {
      ...context.saved,
      revision: initial.revision + 2,
      brief: { ...brief, description: 'Fictional brief from another tab' },
      draft: { ...initial.draft, items: [{ ...item, title: 'Other tab task', included: false }] },
    };
  }, initial);
  try {
    await active.start();
    await active.edit('plan-brief', 'Fictional brief in this tab');
    await active.edit('title-one', 'Task reviewed in this tab');
    await active.click('Add 1 selected items to project');
    assert.deepEqual(active.requests.map(({ action }) => action), ['get', 'save']);
    assert.equal(active.find('plan-brief').props.value, 'Fictional brief in this tab');
    assert.equal(active.find('title-one').props.value, 'Task reviewed in this tab');
    assert.equal(active.find('include-one').props.checked, true);
    const alert = nodes(active.tree).find(node => node.props.role === 'alert');
    assert.match(text(alert), /draft changed while saving.*did not add any tasks.*Reload saved draft/);
  } finally {
    active.dispose();
  }
});
test('the plan receipt links only current created tasks in order and reports unavailable tasks',async()=>{
  for(const [query,embedded,expected] of [
    ['project=p_school&mode=suggestions',false,'/project?project=p_school&task='],
    ['project=p_school&mode=assistant',true,'/project?project=p_school&task='],
    ['demo=1&project=not-shared&mode=suggestions',true,'/demo?as=jack&task='],
  ]){
    const initial=fixture();
    initial.status='applied';
    initial.receipt={taskIds:['task-b','task-missing','task-a']};
    initial.receiptTasks=[{id:'task-b',title:'Run volunteer briefing'},{id:'task-a',title:'Check signage'}];
    initial.existingTasks=[{id:'task-reused',title:'Approve venue'}];
    const app=harness(null,initial,query,embedded);
    try{
      await app.start();
      const receipt=nodes(app.tree).find(node=>node.type==='section'&&node.props['aria-labelledby']==='plan-receipt-heading');
      assert.ok(receipt);
      assert.match(text(receipt),/3 tasks added to the project\. 1 is no longer available/);
      const links=nodes(receipt).filter(node=>node.type==='a');
      assert.deepEqual(links.slice(0,2).map(node=>[text(node),node.props.href]),[
        ['Run volunteer briefing',expected+'task-b'],['Check signage',expected+'task-a'],
      ]);
      assert.ok(links.every(node=>node.props.target===(embedded?'_top':undefined)));
      if(!embedded)assert.equal(text(links[2]),'View tasks and schedule');
      assert.doesNotMatch(text(receipt),/Approve venue|task-missing/);
    }finally{app.dispose();}
  }
});
test('only a guided organizer plan keeps the guide on individual receipt task links',async()=>{
  for(const [query,embedded,guided,expected] of [
    ['project=p_school',false,true,'/project?project=p_school&task=task-a&guide=1'],
    ['project=p_school',false,false,'/project?project=p_school&task=task-a'],
    ['project=p_school&mode=suggestions',false,true,'/project?project=p_school&task=task-a'],
    ['project=p_school',true,true,'/project?project=p_school&task=task-a'],
    ['demo=1&project=not-shared',false,true,'/demo?as=jack&task=task-a'],
  ]){
    const initial=fixture();
    initial.status='applied';
    initial.receipt={taskIds:['task-a']};
    initial.receiptTasks=[{id:'task-a',title:'Check signage'}];
    const app=harness(null,initial,query,embedded,guided);
    try{
      await app.start();
      const receipt=nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='plan-receipt-heading');
      const link=nodes(receipt).find(node=>node.type==='a'&&text(node)==='Check signage');
      assert.equal(link?.props.href,expected);
      assert.ok(app.requests.every(request=>request.action==='get'));
    }finally{app.dispose();}
  }
});
test('the organizer handoff refreshes assignment and acceptance with a read only',async()=>{
  const initial=fixture();
  initial.status='applied';
  initial.receipt={taskIds:['task-1','task-2','task-3']};
  initial.receiptTasks=[
    {id:'task-1',title:'Set up AV',handoff:{state:'awaiting-acceptance',ownerName:'Fictional Planner'}},
    {id:'task-2',title:'Print signs',handoff:{state:'needs-review'}},
    {id:'task-3',title:'Confirm handback',handoff:{state:'needs-amendment-review'}},
  ];
  let reads=0;
  const app=harness(context=>{
    if(!context.input&&++reads===2){
      const next=copy(context.saved);
      next.workspaceRevision++;
      next.contextChanged=true;
      next.receiptTasks[0].handoff.state='accepted';
      next.receiptTasks[1].handoff.state='needs-owner';
      next.receiptTasks[2].handoff.state='complete';
      context.value=next;
    }
  },initial);
  try{
    await app.start();
    assert.match(text(app.tree),/Need an active owner: 0 · Awaiting acceptance: 1 · Need completion review: 2/);
    assert.match(text(app.tree),/Assigned to Fictional Planner · awaiting acceptance/);
    assert.match(text(app.tree),/Completion needs verification/);
    assert.match(text(app.tree),/Complete · updated evidence needs review/);
    await app.click('Refresh task handoff');
    assert.deepEqual(app.requests,[{action:'get'},{action:'get'}]);
    assert.match(text(app.tree),/Need an active owner: 1 · Awaiting acceptance: 0 · Need completion review: 0/);
    assert.match(text(app.tree),/Accepted by Fictional Planner/);
    assert.match(text(app.tree),/Task handoff refreshed from the project/);
    assert.doesNotMatch(text(app.tree),/Choose a fresh starter|Generate a new draft before adding it/);
  }finally{app.dispose();}
});
test('context refresh discards a rejected stale generation payload and uses the current revision', async () => {
  let failed = false;
  const app = harness((context) => {
    if (context.input?.action === 'generate' && !failed) {
      failed = true;
      context.value = { ...context.saved, workspaceRevision: 5 };
      return Response.json(
        { error: 'Project changed. Refresh before generating.' },
        { status: 409 },
      );
    }
    if (context.input?.action === 'generate') {
      assert.equal(context.input.workspaceRevision, 5);
      context.value = { ...context.saved, revision: 3 };
    }
  });
  try {
    await app.start();
    await app.click('Generate another draft');
    assert.match(text(app.tree), /Project changed/);
    await app.click('Refresh project context');
    await app.click('Generate another draft');
    assert.equal(
      app.requests.filter((item) => item.action === 'generate').length,
      2,
    );
    assert.equal(app.requests.at(-1).workspaceRevision, 5);
  } finally {
    app.dispose();
  }
});
test('failed generation preserves the same request id until status is reconciled', async () => {
  let failed = false;
  const app = harness(({ input }) => {
    if (input?.action === 'generate' && !failed) {
      failed = true;
      throw new Error('Network unavailable');
    }
  });
  try {
    await app.start();
    await app.click('Generate another draft');
    await app.click('Retry request');
    const attempts = app.requests.filter((item) => item.action === 'generate');
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
  } finally {
    app.dispose();
  }
});
test('edits or explicit saves after an ambiguous generation invalidate cached intent without losing edits', async () => {
  for (const edit of [true, false]) {
    let failed = false;
    const app = harness((context) => {
      const { input, saved } = context;
      if (input?.action === 'generate' && !failed) {
        failed = true;
        throw new Error('Request did not arrive');
      }
      if (input?.action === 'save')
        context.value = {
          ...saved,
          revision: saved.revision + 1,
          brief: input.brief,
          draft: { ...saved.draft, items: input.items },
        };
      if (input?.action === 'generate') {
        assert.equal(input.revision, saved.revision);
        context.value = {
          ...saved,
          revision: saved.revision + 1,
          status: 'error',
          issue: 'Provider unavailable; saved draft kept.',
        };
      }
    });
    try {
      await app.start();
      await app.click('Generate another draft');
      if (edit) await app.edit('title-one', 'Keep this newer title');
      else await app.click('Save draft');
      await app.click('Generate another draft');
      assert.equal(
        app.find('title-one').props.value,
        edit ? 'Keep this newer title' : item.title,
      );
      const calls = app.requests.filter((input) => input.action === 'generate');
      assert.equal(calls.length, 2);
      assert.notEqual(calls[0].requestId, calls[1].requestId);
      assert.deepEqual(
        app.requests
          .filter((input) => input.action !== 'get')
          .map((input) => input.action),
        ['generate', 'save', 'generate'],
      );
    } finally {
      app.dispose();
    }
  }
});
test('terminal polling errors clear private content and stop; transient errors pause for explicit retry', async () => {
  for (const status of [401, 403, 404, 503]) {
    let reads = 0;
    const app = harness(
      ({ input }) => {
        if (!input && ++reads > 1)
          return Response.json(
            {
              error:
                status === 503 ? 'Temporarily unavailable' : 'Access ended',
            },
            { status },
          );
      },
      { ...fixture(), status: 'generating' },
    );
    try {
      await app.start();
      assert.equal(app.timers.size, 1);
      await app.poll();
      assert.equal(app.timers.size, 0);
      assert.match(
        text(app.tree),
        status === 503 ? /Temporarily unavailable/ : /Access ended/,
      );
      if (status !== 503) {
        assert.equal(app.find('plan-brief'), undefined);
        assert.doesNotMatch(text(app.tree), /Example event/);
      } else assert.match(text(app.tree), /Check request status/);
    } finally {
      app.dispose();
    }
  }
});
test('schedule recovery warnings appear in collapsed review details', async () => {
  const initial = fixture();
  initial.draft.scheduleWarnings = [
    'Arrival: proposed timing was left unscheduled.',
  ];
  const app = harness(undefined, initial);
  try {
    await app.start();
    const details = nodes(app.tree).find(
      (node) =>
        node.type === 'details' && text(node).includes('Dates to review (1)'),
    );
    assert.ok(details);
    assert.ok(!details.props.open);
    assert.match(text(details), /left unscheduled/);
  } finally {
    app.dispose();
  }
});
test('unchecking an existing prerequisite keeps the remaining draft items addable', async () => {
  const initial = fixture();
  initial.existingTasks = [{ id: 'existing', title: item.title, start: '' }];
  initial.draft.items.push({
    ...copy(item),
    id: 'two',
    title: 'Prepare arrival',
    dependsOn: ['one'],
  });
  const app = harness((context) => {
    if (context.input?.action === 'save')
      context.value = {
        ...context.saved,
        revision: context.saved.revision + 1,
        draft: { ...context.saved.draft, items: context.input.items },
      };
  }, initial);
  try {
    await app.start();
    await app.check('include-one', false);
    await app.click('Add 1 selected items to project');
    assert.equal(app.requests.at(-1).action, 'apply');
    assert.deepEqual(app.requests.at(-1).items[1].dependsOn, ['one']);
  } finally {
    app.dispose();
  }
});
test('unchecked prerequisites offer visible include or remove-link actions without losing other edits', async () => {
  for (const action of ['include', 'remove']) {
    const initial = fixture();
    initial.draft.items.push({
      ...copy(item),
      id: 'two',
      title: 'Prepare arrival',
      dependsOn: ['one'],
    });
    const app = harness((context) => {
      if (context.input?.action === 'save')
        context.value = {
          ...context.saved,
          draft: { ...context.saved.draft, items: context.input.items },
        };
    }, initial);
    try {
      await app.start();
      await app.edit('note-two', 'Keep my edited note');
      await app.check('include-one', false);
      const issue = nodes(app.tree).find(
        (node) =>
          node.props?.role === 'status' &&
          text(node).includes('depends on unchecked'),
      );
      assert.ok(issue);
      assert.ok(
        !nodes(app.tree).some(
          (node) => node.type === 'details' && nodes(node).includes(issue),
        ),
        'Recovery is outside collapsed details',
      );
      await app.click(
        action === 'include'
          ? 'Include prerequisite: Confirm activities'
          : 'Remove link: Prepare arrival → Confirm activities',
      );
      await app.click(
        `Add ${action === 'include' ? 2 : 1} selected items to project`,
      );
      const sent = app.requests.at(-1).items;
      assert.equal(sent[1].note, 'Keep my edited note');
      assert.deepEqual(sent[1].dependsOn, action === 'include' ? ['one'] : []);
    } finally {
      app.dispose();
    }
  }
});
test('existing duplicate offers a one-click skip and edited titles invalidate matches', async () => {
  const initial = fixture();
  initial.existingTasks = [{ id: 'existing', title: item.title, start: '' }];
  initial.draft.items.push({
    ...copy(item),
    id: 'two',
    title: 'Prepare arrival',
    dependsOn: ['one'],
  });
  const app = harness(undefined, initial);
  try {
    await app.start();
    await app.click('Skip existing task: Confirm activities');
    assert.equal(app.find('include-one').props.checked, false);
    assert.doesNotMatch(text(app.tree), /depends on unchecked/);
    await app.edit('title-one', 'A different prerequisite');
    assert.match(text(app.tree), /depends on unchecked/);
  } finally {
    app.dispose();
  }
});
test('semantic duplicate choices are visible, preserve links, and are saved before applying', async () => {
  for (const choice of ['reuse', 'keep']) {
    const initial = fixture();
    initial.existingTasks = [{ id: 'existing', title: 'Finalize activities', start: '' }];
    initial.draft.duplicateSuggestions = [{
      itemId: 'one', taskId: 'existing', taskIdentity: 'finalize activities|',
      itemIdentity: JSON.stringify([item.title, item.kind, item.note, item.dueDate, item.start, item.end, item.location, item.category]),
    }];
    initial.draft.items.push({ ...copy(item), id: 'two', title: 'Prepare arrival', dependsOn: ['one'] });
    const app = harness(context => {
      if (context.input?.action === 'save') context.value = {
        ...context.saved, revision: context.saved.revision + 1, draft: { ...context.saved.draft, items: context.input.items },
      };
    }, initial);
    try {
      await app.start();
      assert.match(text(app.tree), /Possible duplicate of: Finalize activities/);
      const add = () => nodes(app.tree).find(node => node.type === 'button' && /^Add \d+ selected/.test(text(node)));
      assert.equal(add().props.disabled, true);
      await app.click(choice === 'reuse' ? 'Use existing: Finalize activities' : 'Keep separate: Confirm activities');
      // The server trims these fields; harmless whitespace must retain the choice.
      await app.edit('title-one', item.title + ' ');
      await app.edit('note-one', item.note + ' ');
      assert.equal(app.find('include-one').props.checked, choice === 'keep');
      assert.equal(!!add().props.disabled, false);
      assert.doesNotMatch(text(app.tree), /depends on unchecked/);
      await app.click(`Add ${choice === 'reuse' ? 1 : 2} selected items to project`);
      assert.equal(app.requests.at(-1).action, 'apply');
      assert.equal(app.requests.at(-1).items[0].duplicateChoice, choice);
      assert.deepEqual(app.requests.at(-1).items[1].dependsOn, ['one']);
    } finally { app.dispose(); }
  }
});
test('editing a reused semantic suggestion invalidates the choice without losing the item', async () => {
  for (const edit of ['note', 'scope', 'checkbox']) {
    const initial = fixture();
    initial.existingTasks = [{ id: 'existing', title: 'Finalize activities', start: '' }];
    initial.draft.duplicateSuggestions = [{
      itemId: 'one', taskId: 'existing', taskIdentity: 'finalize activities|',
      itemIdentity: JSON.stringify([item.title, item.kind, item.note, item.dueDate, item.start, item.end, item.location, item.category]),
    }];
    const app = harness(undefined, initial);
    try {
      await app.start();
      await app.click('Use existing: Finalize activities');
      if (edit === 'note') await app.edit('note-one', 'An expanded scope');
      else if(edit==='scope')await app.edit('scope-one','A different required outcome.');
      else await app.check('include-one', true);
      assert.equal(app.find('include-one').props.checked, true);
      assert.doesNotMatch(text(app.tree), /Using existing task:/);
      const add = nodes(app.tree).find(node => node.type === 'button' && /^Add \d+ selected/.test(text(node)));
      assert.equal(!!add.props.disabled, edit === 'checkbox');
    } finally { app.dispose(); }
  }
});
test('proposed outcomes are visible, editable and preserved through save/reload/apply independently of instructions',async()=>{
  const initial=fixture();initial.draft.items[0].scope='A reviewed programme is recorded.';
  const app=harness(context=>{
    if(context.input?.action==='save')context.value={...context.saved,revision:context.saved.revision+1,draft:{...context.saved.draft,items:context.input.items}};
  },initial);
  try{
    await app.start();assert.match(text(app.tree),/Proposed Done when:/);assert.match(text(app.tree),/not evidence that the work is complete/);
    await app.edit('scope-one','Named leads approve the programme and record unresolved decisions.');
    assert.equal(app.find('note-one').props.value,item.note);await app.click('Save draft');
    assert.equal(app.requests.at(-1).items[0].scope,'Named leads approve the programme and record unresolved decisions.');
    await app.click('Reload saved draft');assert.equal(app.find('scope-one').props.value,'Named leads approve the programme and record unresolved decisions.');
    await app.click('Add 1 selected items to project');assert.equal(app.requests.at(-1).action,'apply');assert.equal(app.requests.at(-1).items[0].scope,'Named leads approve the programme and record unresolved decisions.');assert.equal(app.requests.at(-1).items[0].note,item.note);
  } finally {app.dispose();}
});
test('draft reload asks before discarding local edits, and unattended reads never call generate', async () => {
  const app = harness();
  try {
    await app.start();
    assert.deepEqual(
      app.requests.map((item) => item.action),
      ['get'],
    );
    await app.edit('plan-brief', 'Unsaved text');
    globalThis.window.confirm = () => false;
    await app.click('Reload saved draft');
    assert.equal(app.find('plan-brief').props.value, 'Unsaved text');
    assert.equal(app.requests.length, 1);
  } finally {
    app.dispose();
  }
});
test('task assistant retries the same request but uses a fresh request for an edited message', async () => {
  const initial=fixture();initial.brief.description='';initial.draft=null;
  const app=harness(context=>context.input?.action==='generate' ? Response.json({error:'Connection lost'},{status:503}) : undefined,initial,'project=p_example&mode=assistant');
  try {
    await app.start();
    const first={...initial.brief,description:JSON.stringify([{role:'user',content:'Prepare signs'}])};
    const second={...first,description:JSON.stringify([{role:'user',content:'Prepare badges instead'}])};
    assert.equal(await app.chat('onSend',first),false);
    await app.chat('onSend',first);
    await app.chat('onSend',second);
    const calls=app.requests.filter(row=>row.action==='generate');
    assert.equal(calls[0].requestId,calls[1].requestId);
    assert.notEqual(calls[1].requestId,calls[2].requestId);
    assert.equal(calls[2].brief.description,second.description);
  } finally {app.dispose();}
});
test('assistant does not acknowledge a failed provider result as a delivered message',async()=>{
  const initial=fixture();initial.brief.description='';initial.draft=null;
  const app=harness(context=>context.input?.action==='generate' ? Response.json({...context.saved,brief:context.input.brief,status:'error',issue:'The AI reply failed. Try again.'}) : undefined,initial,'project=p_example&mode=assistant');
  try{
    await app.start();
    const outgoing={...initial.brief,description:JSON.stringify([{role:'user',content:'Please reply to this'}])};
    assert.equal(await app.chat('onSend',outgoing),false);assert.match(text(app.tree),/The AI reply failed/);
  }finally{app.dispose();}
});
test('batch selection changes only inclusion, preserves draft edits, and never calls save or apply',async()=>{
  const initial=fixture();initial.draft.items=[copy(item),{...copy(item),id:'two',title:'Check venue',included:false},
    {...copy(item),id:'repeat',title:'Check venue',included:false}];
  initial.existingTasks=[{id:'existing',title:item.title,start:''}];
  const app=harness(undefined,initial);
  try{
    await app.start();await app.edit('note-two','Keep this reviewed note.');
    await app.click('Select none');assert.equal(app.find('include-one').props.checked,false);assert.equal(app.find('include-two').props.checked,false);
    await app.click('Select all new items');assert.equal(app.find('include-one').props.checked,false);assert.equal(app.find('include-two').props.checked,true);assert.equal(app.find('include-repeat').props.checked,false);
    assert.equal(app.find('note-two').props.value,'Keep this reviewed note.');
    assert(app.requests.every(r=>r.action==='get'));assert.match(text(app.tree),/1 of 3 proposals selected/);
  }finally{app.dispose();}
});

test('mixed starter groups can be selected separately, with required links still blocking apply',async()=>{
  const initial=fixture();
  initial.draft.source='starter';initial.draft.starterVersion=5;
  initial.draft.items.push({...copy(item),id:'arrival',kind:'activity',title:'Welcome guests',dependsOn:['one']});
  const app=harness(undefined,initial);
  try{
    await app.start();assert.equal(app.find('starter-activities').props.checked,true);
    await app.click('Select activities only');
    assert.equal(app.find('include-one').props.checked,false);assert.equal(app.find('include-arrival').props.checked,true);
    const add=()=>nodes(app.tree).find(n=>n.type==='button'&&/^Add \d+ selected/.test(text(n)));
    assert.equal(add().props.disabled,true);assert.match(text(app.tree),/Resolve the unchecked prerequisites/);
    await app.click('Select preparation only');
    assert.equal(app.find('include-one').props.checked,true);assert.equal(app.find('include-arrival').props.checked,false);
    assert.equal(add().props.disabled,false);assert(app.requests.every(r=>r.action==='get'));
  }finally{app.dispose();}
});

test('prep-only starters leave activities off and do not show group controls',async()=>{
  const initial=fixture();initial.draft.source='starter';initial.draft.starterVersion=4;
  initial.draft.items.push({...copy(item),id:'other',title:'Prepare signage'});
  const app=harness(undefined,initial);
  try{
    await app.start();assert.equal(app.find('starter-activities').props.checked,false);
    assert(!nodes(app.tree).some(n=>n.type==='button'&&/^Select (preparation|activities) only$/.test(text(n))));
  }finally{app.dispose();}
});

test('batch owner assignment changes selected proposals only and saves through the existing draft workflow',async()=>{
  const initial=fixture();initial.members.push({id:'maya',name:'Maya'},{id:'former',name:'Former',active:false});
  initial.draft.items=[{...copy(item),owner:'jack',dueDate:'2030-10-02'},
    {...copy(item),id:'excluded',title:'Excluded work',owner:'jack',included:false},
    {...copy(item),id:'reuse',title:'Secure venue',owner:'jack',included:false,duplicateChoice:'reuse',existingTaskIndex:0}];
  initial.existingTasks=[{id:'existing',title:'Book venue',start:''}];
  initial.draft.duplicateSuggestions=[{itemId:'reuse',taskId:'existing',taskIdentity:'book venue|',itemIdentity:JSON.stringify(['Secure venue','preparation',item.note,'','','','','Program'])}];
  const app=harness(context=>{if(context.input?.action==='save')context.value={...context.saved,revision:3,draft:{...context.saved.draft,items:context.input.items}};},initial);
  try{
    await app.start();await app.edit('batch-owner','maya');await app.click('Assign selected');
    assert.equal(app.find('owner-one').props.value,'maya');assert.equal(app.find('owner-excluded').props.value,'jack');assert.equal(app.find('owner-reuse').props.value,'jack');
    assert.equal(app.find('date-one').props.value,'2030-10-02');assert(app.requests.every(r=>r.action==='get'));
    assert.match(text(app.tree),/shared tasks have not changed/);await app.click('Save draft');
    const saved=app.requests.at(-1);assert.equal(saved.action,'save');assert.equal(saved.items[0].owner,'maya');
    assert.deepEqual(saved.items[1],initial.draft.items[1]);assert.deepEqual(saved.items[2],initial.draft.items[2]);
    assert.equal(app.find('batch-owner').props.value,'');
  }finally{app.dispose();}
});

test('batch assignment requires a selected item and a current active owner',async()=>{
  const initial=fixture();initial.members.push({id:'former',name:'Former',active:false});initial.draft.items.push({...copy(item),id:'two',title:'Other work'});
  const app=harness(undefined,initial);
  const assign=()=>nodes(app.tree).find(n=>n.type==='button'&&text(n)==='Assign selected');
  try{
    await app.start();assert.equal(assign().props.disabled,true);
    await app.edit('batch-owner','unknown');assert.equal(assign().props.disabled,true);
    await app.edit('batch-owner','former');assert.equal(assign().props.disabled,true);
    await app.edit('batch-owner','jack');assert.equal(assign().props.disabled,false);
    await app.click('Select none');assert.equal(assign().props.disabled,true);assert(app.requests.every(r=>r.action==='get'));
    assert(!nodes(app.find('batch-owner')).some(n=>n.type==='option'&&n.props.value==='former'));
  }finally{app.dispose();}
});

test('batch controls cannot edit running, applied, or single-item drafts',async()=>{
  for(const mode of ['generating','applied','single']){
    const initial=fixture();if(mode!=='single')initial.draft.items.push({...copy(item),id:'two',title:'Other work'});
    if(mode==='generating')initial.status='generating';if(mode==='applied')initial.receipt={taskIds:['saved']};
    const app=harness(undefined,initial);
    try{await app.start();const buttons=nodes(app.tree).filter(n=>n.type==='button'&&['Select all new items','Select none','Assign selected'].includes(text(n)));
      if(mode==='generating'){assert.equal(buttons.length,3);assert(buttons.every(b=>b.props.disabled));}
      else assert.equal(buttons.length,0);
    }finally{app.dispose();}
  }
});

test('batch assignment does not resolve possible semantic duplicates or allow their application',async()=>{
  const initial=fixture();initial.draft.items.push({...copy(item),id:'two',title:'Other work'});
  initial.existingTasks=[{id:'existing',title:'Finalize activities',start:''}];
  initial.draft.duplicateSuggestions=[{itemId:'one',taskId:'existing',taskIdentity:'finalize activities|',itemIdentity:JSON.stringify([item.title,item.kind,item.note,'','','','',item.category])}];
  const app=harness(undefined,initial);
  try{await app.start();await app.click('Select none');await app.click('Select all new items');await app.edit('batch-owner','jack');await app.click('Assign selected');
    const add=nodes(app.tree).find(n=>n.type==='button'&&/^Add \d+ selected/.test(text(n)));assert.equal(add.props.disabled,true);
    assert.match(text(app.tree),/Possible duplicate of: Finalize activities/);assert(app.requests.every(r=>r.action==='get'));
  }finally{app.dispose();}
});

test('batch edits invalidate an uncertain generation retry and preserve the updated draft before a new request',async()=>{
  for(const edit of ['selection','owner']){
    const initial=fixture();initial.draft.items.push({...copy(item),id:'two',title:'Other work'});
    let failed=false;
    const app=harness(context=>{
      if(context.input?.action==='generate'&&!failed){failed=true;throw Error('Network unavailable');}
      if(context.input?.action==='save')context.value={...context.saved,revision:3,draft:{...context.saved.draft,items:context.input.items}};
    },initial);
    try{await app.start();await app.click('Generate another draft');
      if(edit==='selection')await app.click('Select none');
      else {await app.edit('batch-owner','jack');await app.click('Assign selected');}
      await app.click('Generate another draft');
      const attempts=app.requests.filter(r=>r.action==='generate');assert.equal(attempts.length,2);assert.notEqual(attempts[0].requestId,attempts[1].requestId);
      const saved=app.requests.find(r=>r.action==='save');assert.ok(saved);
      if(edit==='selection')assert(saved.items.every(i=>!i.included));else assert(saved.items.every(i=>i.owner==='jack'));
    }finally{app.dispose();}
  }
});

test('Ask Weft shows proposed prerequisites for human review and preserves an explicit removal on apply',async()=>{
  const initial=fixture();initial.brief.description=JSON.stringify([{role:'user',content:'Break this preparation into two steps.'}]);
  initial.draft.items.push({...copy(item),id:'two',title:'Prepare final briefing',note:'Needs the reviewed programme.',dependsOn:['one']});
  const app=harness(context=>{if(context.input?.action==='save')context.value={...context.saved,revision:context.saved.revision+1,draft:{...context.saved.draft,items:context.input.items}};},initial,'project=p_example&mode=assistant');
  try{
    await app.start();assert.match(text(app.tree),/Required before completion/);assert.match(text(app.tree),/Related work can run in parallel/);
    assert.equal(app.find('required-two:one').props.checked,true);
    await app.check('required-two:one',false);await app.click('Add 2 selected items to project');
    assert.equal(app.requests.at(-1).action,'apply');assert.deepEqual(app.requests.at(-1).items[1].dependsOn,[]);
    assert.deepEqual(app.saved.draft.items[1].dependsOn,[]);
  }finally{app.dispose();}
});
test('new task conversation confirms unsaved edits and hides the old draft without a server write', async () => {
  const initial=fixture();initial.brief.description=JSON.stringify([{role:'user',content:'Prepare signs'}]);
  const app=harness(undefined,initial,'project=p_example&mode=assistant');
  try {
    await app.start();
    assert.ok(app.find('title-one'));
    await app.chat('onDirty',true);
    globalThis.window.confirm=()=>false;
    await app.chat('onNew');
    assert.ok(app.find('title-one'));
    globalThis.window.confirm=()=>true;
    await app.chat('onNew');
    assert.equal(app.find('title-one'),undefined);
    assert.deepEqual(app.requests.map(row=>row.action),['get']);
    assert.equal(app.saved.draft.items[0].title,item.title);
  } finally {app.dispose();}
});
