import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let Feed;
before(async () => {
  const bundle = await build({
    entryPoints: ['app/plan/suggestion-feed.tsx'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    jsx: 'automatic',
    plugins: [
      {
        name: 'feed-hooks',
        setup(b) {
          b.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$|^@\/components\/ui\// },
            (a) => ({ path: a.path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            loader: 'js',
            contents:
              a.path === 'react'
                ? 'export const useState=v=>globalThis.__feed.useState(v),useRef=v=>globalThis.__feed.useRef(v),useEffect=(f,d)=>globalThis.__feed.useEffect(f,d);'
                : a.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx;'
                  : 'export const Button="button";',
          }));
        },
      },
    ],
  });
  ({ SuggestionFeed: Feed } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(bundle.outputFiles[0].text).toString('base64')
  ));
});
const nodes = (n) =>
  !n || typeof n !== 'object'
    ? []
    : Array.isArray(n)
      ? n.flatMap(nodes)
      : [n, ...nodes(n.props?.children)];
const text = (n) =>
  n == null || typeof n === 'boolean'
    ? ''
    : typeof n !== 'object'
      ? String(n)
      : Array.isArray(n)
        ? n.map(text).join('')
        : text(n.props?.children);
const item = (id) => ({
  id,
  title: 'Prepare ' + id,
  note: 'A concrete gap.',
  kind: 'preparation',
  category: 'Program',
  dueDate: '',
  start: '',
  end: '',
  location: '',
  dependsOn: [],
  owner: '',
  included: true,
});
const initial = () => ({
  event: { name: 'Fictional' },
  suggestionScope: 'owner:project',
  contextKey: 'context1',
  revision: 1,
  workspaceRevision: 1,
  brief: {
    kind: 'other',
    description: 'Fictional event',
    endDate: '',
    startTime: '',
    endTime: '',
  },
  configured: true,
  draft: null,
  receipt: null,
  status: 'empty',
  issue: '',
  contextChanged: false,
  retryAfter: 0,
  existingTasks: [],
});
function harness(server) {
  const saved = Object.fromEntries(
    [
      'fetch',
      'window',
      'location',
      'document',
      'ResizeObserver',
      'localStorage',
      '__feed',
    ].map((k) => [k, globalThis[k]]),
  );
  const state = [],
    timers = new Map(),
    storage = new Map(),
    listeners = {},
    calls = [],
    messages = [];
  let cursor = 0,
    changed = true,
    effects = [],
    tree,
    nextTimer = 0,
    data = initial();
  globalThis.__feed = {
    useState(v) {
      const i = cursor++;
      if (!(i in state)) state[i] = v;
      return [
        state[i],
        (next) => {
          state[i] = typeof next === 'function' ? next(state[i]) : next;
          changed = true;
        },
      ];
    },
    useRef(v) {
      const i = cursor++;
      return state[i] || (state[i] = { current: v });
    },
    useEffect(fn, deps) {
      const i = cursor++,
        old = state[i];
      if (!old || deps.some((v, j) => !Object.is(v, old.deps[j]))) {
        state[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => {
          state[i].cleanup?.();
          state[i].cleanup = fn();
        });
      }
    },
  };
  globalThis.location = { origin: 'https://fixture.example' };
  globalThis.window = {
    parent: { postMessage: (m) => messages.push(m) },
    setTimeout: (fn) => {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener() {},
  };
  globalThis.document = { getElementById: () => null };
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, v) => storage.set(key, v),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.fetch = async (url, options = {}) => {
    const input = options.body ? JSON.parse(options.body) : null;
    calls.push(input || { action: 'get' });
    const result = await server?.(input, data);
    if (result instanceof Response) return result;
    if (result) data = result;
    return Response.json(data);
  };
  async function settle() {
    for (let n = 0; n < 30; n++) {
      if (changed) {
        changed = false;
        cursor = 0;
        effects = [];
        tree = Feed({ query: 'project=fixture&mode=suggestions' });
        effects.forEach((f) => f());
      }
      await new Promise((r) => setImmediate(r));
      if (!changed) break;
    }
  }
  return {
    calls,
    storage,
    messages,
    listeners,
    get data() {
      return data;
    },
    set data(v) {
      data = v;
    },
    get tree() {
      return tree;
    },
    settle,
    async click(label) {
      const n = nodes(tree).find(
        (n) => n.type === 'button' && text(n) === label,
      );
      assert.ok(n, label);
      assert.ok(!n.props.disabled, label + ' enabled');
      await n.props.onClick();
      await settle();
    },
    async tick() {
      const entry = timers.entries().next().value;
      if (entry) {
        timers.delete(entry[0]);
        entry[1]();
        await settle();
      }
    },
    restore() {
      for (const row of state) row?.cleanup?.();
      Object.assign(globalThis, saved);
    },
  };
}
test('automatic suggestions require scoped opt-in, stay stable, dismiss locally and add only by click', async () => {
  const app = harness((input, data) =>
    input?.action === 'generate'
      ? {
          ...data,
          revision: 2,
          status: 'ready',
          draft: {
            generation: crypto.randomUUID(),
            items: [item('one'), item('two')],
            duplicateSuggestions: [],
          },
        }
      : input?.action === 'apply'
        ? { ...data, receipt: { taskIds: ['created'] }, status: 'applied' }
        : undefined,
  );
  try {
    await app.settle();
    await app.tick();
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 0);
    await app.click('Enable automatic suggestions');
    await app.tick();
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 1);
    await app.tick();
    assert.equal(
      app.calls.filter((c) => c.action === 'generate').length,
      1,
      'no loop for ready draft',
    );
    await app.click('Dismiss');
    assert.doesNotMatch(text(app.tree), /Prepare one/);
    assert.equal(app.calls.filter((c) => c.action === 'apply').length, 0);
    await app.click('Add task');
    const apply = app.calls.find((c) => c.action === 'apply');
    assert.equal(apply.confirm, true);
    assert.deepEqual(
      apply.items.filter((i) => i.included).map((i) => i.id),
      ['two'],
    );
    assert.ok(app.messages.some((m) => m.event === 'applied'));
  } finally {
    app.restore();
  }
});
test('automatic provider failures stop until explicit refresh and consent cannot leak to another scope', async () => {
  const app = harness((input) =>
    input?.action === 'generate'
      ? Response.json({ error: 'Provider unavailable' }, { status: 503 })
      : undefined,
  );
  try {
    await app.settle();
    await app.click('Enable automatic suggestions');
    await app.tick();
    await app.tick();
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 1);
    assert.match(text(app.tree), /Provider unavailable/);
    await app.click('Refresh suggestions');
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 2);
    app.data = { ...app.data, suggestionScope: 'different-user:project' };
    app.listeners.message({
      origin: location.origin,
      source: window.parent,
      data: { type: 'weft-context-changed' },
    });
    await app.settle();
    assert.match(text(app.tree), /Enable automatic suggestions/);
  } finally {
    app.restore();
  }
});
test('authorization loss clears private suggestions and pending context messages are recovered', async () => {
  let release,
    terminal = false;
  const app = harness(async (input, data) => {
    if (terminal) return Response.json({ error: 'No access' }, { status: 403 });
    if (input?.action === 'generate') {
      await new Promise((r) => {
        release = r;
      });
      return Response.json({ error: 'Project changed' }, { status: 409 });
    }
    return undefined;
  });
  try {
    await app.settle();
    await app.click('Enable automatic suggestions');
    await app.tick();
    assert.ok(release);
    app.data = {
      ...app.data,
      workspaceRevision: 9,
      contextKey: 'context2',
      draft: {
        generation: 'fresh',
        items: [item('private')],
        duplicateSuggestions: [],
      },
      status: 'ready',
    };
    app.listeners.message({
      origin: location.origin,
      source: window.parent,
      data: { type: 'weft-context-changed' },
    });
    release();
    await app.settle();
    assert.match(text(app.tree), /Prepare private/);
    assert.ok(app.calls.filter((c) => c.action === 'get').length >= 2);
    terminal = true;
    app.listeners.message({
      origin: location.origin,
      source: window.parent,
      data: { type: 'weft-context-changed' },
    });
    await app.settle();
    assert.doesNotMatch(text(app.tree), /Prepare private/);
    assert.match(text(app.tree), /No access/);
    assert.equal(
      app.storage.get('weft-auto-suggestions-v1:owner:project'),
      undefined,
    );
  } finally {
    app.restore();
  }
});
test('suggestion cards disclose every applied schedule field and complex links require review', async () => {
  const app = harness();
  try {
    app.data = {
      ...app.data,
      status: 'ready',
      draft: {
        generation: 'scheduled',
        items: [
          {
            ...item('activity'),
            kind: 'activity',
            start: '2030-11-20T10:00',
            end: '2030-11-20T11:00',
            location: 'Main hall',
            dependsOn: ['other'],
          },
          item('other'),
        ],
        duplicateSuggestions: [],
      },
    };
    await app.settle();
    const content = text(app.tree);
    assert.match(content, /2030-11-20T10:00/);
    assert.match(content, /2030-11-20T11:00/);
    assert.match(content, /Main hall/);
    assert.match(content, /Added as incomplete/);
    assert.equal(nodes(app.tree).some((n) => n.type === 'button' && text(n) === 'Add task'), true,
      'independent tasks still have an Add button');
    const reviewLink = nodes(app.tree).find((n) => n.type === 'a' && text(n) === 'Review & add');
    assert.ok(reviewLink, 'linked tasks offer an active review path, not a disabled Add');
    assert.equal(reviewLink.props.href, '/plan?project=fixture&mode=suggestions');
    assert.match(content, /Review links & duplicates/);
  } finally {
    app.restore();
  }
});
test('manual refresh cannot carry automatic AI consent across a changed identity scope', async () => {
  let changeIdentity = false;
  const app = harness((input, data) =>
    input?.action === 'generate'
      ? {
          ...data,
          status: 'ready',
          draft: {
            generation: 'one',
            items: [item('one')],
            duplicateSuggestions: [],
          },
        }
      : !input && changeIdentity
        ? { ...data, suggestionScope: 'another-person:project' }
        : undefined,
  );
  try {
    await app.settle();
    await app.click('Enable automatic suggestions');
    await app.tick();
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 1);
    changeIdentity = true;
    await app.click('Refresh suggestions');
    assert.equal(app.calls.filter((c) => c.action === 'generate').length, 1);
    assert.match(text(app.tree), /Enable automatic suggestions/);
  } finally {
    app.restore();
  }
});
test('even reused exact-match prerequisites require explicit link review', async () => {
  const app = harness();
  try {
    app.data = {
      ...app.data,
      existingTasks: [{ id: 'already', title: 'Prepare existing', start: '' }],
      status: 'ready',
      draft: {
        generation: 'linked',
        items: [
          { ...item('new'), dependsOn: ['existing'] },
          { ...item('existing'), included: false },
        ],
        duplicateSuggestions: [],
      },
    };
    await app.settle();
    const button = nodes(app.tree).find(
      (n) => n.type === 'button' && text(n) === 'Add task',
    );
    assert.equal(button, undefined);
    assert.ok(nodes(app.tree).some((n) => n.type === 'a' && text(n) === 'Review & add'));
    assert.match(text(app.tree), /Review links & duplicates/);
  } finally {
    app.restore();
  }
});

test('stale cards offer an explicit refresh and become addable only after fresh generation', async () => {
  const app = harness((input, data) => input?.action === 'generate'
    ? { ...data, revision: 3, contextChanged: false, draft: { ...data.draft, generation: 'fresh' } }
    : undefined);
  try {
    app.storage.set('weft-auto-suggestions-v1:owner:project', 'enabled');
    app.data = { ...app.data, status: 'ready', contextChanged: true,
      draft: { generation: 'old', items: [item('one')], duplicateSuggestions: [] } };
    await app.settle();
    assert.equal(nodes(app.tree).some(n => n.type === 'button' && text(n) === 'Add task'), false);
    assert.match(text(app.tree), /Refreshing uses an AI attempt/);
    await app.click('Refresh changed suggestions');
    const add = nodes(app.tree).find(n => n.type === 'button' && text(n) === 'Add task');
    assert.ok(add && !add.props.disabled);
    assert.equal(app.calls.filter(c => c.action === 'generate').length, 1);
    assert.equal(app.calls.filter(c => c.action === 'apply').length, 0);
  } finally { app.restore(); }
});

test('stale cards with consent off explain how to re-enable instead of exposing a no-op refresh', async () => {
  const app = harness();
  try {
    app.data = { ...app.data, status: 'ready', contextChanged: true,
      draft: { generation: 'old', items: [item('one')], duplicateSuggestions: [] } };
    await app.settle();
    assert.match(text(app.tree), /Enable automatic suggestions above to refresh/);
    assert.equal(nodes(app.tree).some(n => n.type === 'button' && text(n) === 'Refresh changed suggestions'), false);
    assert.equal(app.calls.filter(c => c.action === 'generate').length, 0);
  } finally { app.restore(); }
});

test('a rejected Add reloads current revisions once without replaying the mutation', async () => {
  let first = true;
  const app = harness((input, data) => {
    if (input?.action === 'apply' && first) {
      first = false;
      app.data = { ...data, workspaceRevision: 7 };
      return Response.json({ error: 'Project changed' }, { status: 409 });
    }
    if (input?.action === 'apply') return { ...data, receipt: { taskIds: ['new-task'] }, status: 'applied' };
  });
  try {
    app.data = { ...app.data, status: 'ready',
      draft: { generation: 'one', items: [item('one')], duplicateSuggestions: [] } };
    await app.settle();
    await app.click('Add task');
    assert.equal(app.calls.filter(c => c.action === 'apply').length, 1);
    assert.equal(app.calls.filter(c => c.action === 'get').length, 2);
    await app.click('Add task');
    assert.equal(app.calls.filter(c => c.action === 'apply').at(-1).workspaceRevision, 7);
    assert.match(text(app.tree), /Task added/);
  } finally { app.restore(); }
});

test('failed reads do not loop, and a timed-out Add unlocks without automatically resending', async () => {
  let readFails = false;
  const app = harness(input => {
    if (input?.action === 'apply') throw new DOMException('Timeout', 'TimeoutError');
    if (readFails) return Response.json({ error: 'Read changed' }, { status: 409 });
  });
  try {
    app.data = { ...app.data, status: 'ready',
      draft: { generation: 'one', items: [item('one')], duplicateSuggestions: [] } };
    await app.settle();
    await app.click('Add task');
    assert.match(text(app.tree), /request timed out/);
    assert.equal(app.calls.filter(c => c.action === 'apply').length, 1);
    assert.equal(nodes(app.tree).find(n => n.type === 'button' && text(n) === 'Add task').props.disabled, false);
    readFails = true;
    await app.click('Reload suggestions');
    await app.settle();
    assert.equal(app.calls.filter(c => c.action === 'get').length, 2, 'one explicit GET, no retry loop');
    assert.match(text(app.tree), /Read changed/);
  } finally { app.restore(); }
});

test('a failed poll of a generating draft leaves read-only reload and consent revocation usable', async () => {
  let failRead = false;
  const app = harness(() => failRead
    ? Promise.reject(new DOMException('Timeout', 'TimeoutError')) : undefined);
  try {
    app.storage.set('weft-auto-suggestions-v1:owner:project', 'enabled');
    app.data = { ...app.data, status: 'generating' };
    await app.settle();
    failRead = true;
    await app.tick();
    assert.match(text(app.tree), /request timed out/);
    const reload = nodes(app.tree).find(n => n.type === 'button' && text(n) === 'Reload suggestions');
    const turnOff = nodes(app.tree).find(n => n.type === 'button' && text(n) === 'Turn off');
    assert.equal(reload.props.disabled, false, 'saved generating status cannot disable a read-only recovery');
    assert.equal(turnOff.props.disabled, false, 'a failed poll cannot trap consent on');
    await app.click('Turn off');
    assert.equal(app.storage.has('weft-auto-suggestions-v1:owner:project'), false);
    failRead = false;
    app.data = { ...app.data, status: 'ready', draft: { generation: 'ready', items: [item('one')], duplicateSuggestions: [] } };
    await app.click('Reload suggestions');
    const add = nodes(app.tree).find(n => n.type === 'button' && text(n) === 'Add task');
    assert.ok(add && !add.props.disabled);
    assert.equal(app.calls.filter(c => c.action === 'generate' || c.action === 'apply').length, 0);
  } finally { app.restore(); }
});
