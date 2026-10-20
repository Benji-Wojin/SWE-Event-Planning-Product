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
function harness(server, initial = fixture(), query = 'project=p_example') {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    hooks: globalThis.__planHooks,
  };
  const state = [],
    timers = new Map(),
    requests = [];
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
  globalThis.window = {
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener() {},
    removeEventListener() {},
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
    tree = PlanReview({ query });
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
      globalThis.__planHooks = previous.hooks;
    },
  };
}
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
    assert.match(text(active.tree), /1 items added/);
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
        ...context.saved, draft: { ...context.saved.draft, items: context.input.items },
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
  for (const edit of ['note', 'checkbox']) {
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
      else await app.check('include-one', true);
      assert.equal(app.find('include-one').props.checked, true);
      assert.doesNotMatch(text(app.tree), /Using existing task:/);
      const add = nodes(app.tree).find(node => node.type === 'button' && /^Add \d+ selected/.test(text(node)));
      assert.equal(!!add.props.disabled, edit === 'checkbox');
    } finally { app.dispose(); }
  }
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
