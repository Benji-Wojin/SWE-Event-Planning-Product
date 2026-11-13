import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

// Hook-level interaction tests, not a substitute for real-browser layout/accessibility QA.
let PlanReview, PlanGuideHint, PlanApprovalImpact;
before(async () => {
  const bundle = await build({
    stdin: {
      contents: "export {PlanReview} from './app/plan/plan-client'; export {PlanGuideHint} from './app/plan/guide-hint'; export {PlanApprovalImpact} from './app/plan/approval-impact';",
      resolveDir: process.cwd(),
    },
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
  ({ PlanReview, PlanGuideHint, PlanApprovalImpact } = await import(
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
const approvalHash = ({ generation, items }) => createHash('sha256').update(JSON.stringify({ generation, items })).digest('hex');
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
      : node.type === PlanGuideHint || node.type === PlanApprovalImpact
        ? nodes(node.type(node.props))
      : [node, ...nodes(node.props?.children)];
}
const planLink = (tree, label) => nodes(tree).find(node => node.type === 'a' && text(node) === label);
const planButton = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label);
const planHint = tree => nodes(tree).find(node => node.props?.id === 'plan-guide-hint');
function assertGuideReturn(tree) {
  const ordered = nodes(tree);
  const link = ordered.find(node => node.type === 'a' && text(node) === 'Return to your guide');
  assert.equal(link?.props.href, '/project?project=p_example&guide=1');
  assert.equal(link.props.onClick, undefined);
  const hint = ordered.find(node => node.props?.id === 'plan-guide-hint');
  if (hint) assert.ok(ordered.indexOf(link) < ordered.indexOf(hint), 'return precedes the walkthrough');
}
const existingTaskLinks = (tree, title) => nodes(tree).filter(node =>
  node.type === 'a' && (title === undefined
    ? node.props?.['aria-label']?.startsWith('Open existing task: ')
    : node.props?.['aria-label'] === `Open existing task: ${title} (opens in a new tab)`));
const existingPrerequisites = tree => nodes(tree).filter(node =>
  node.props?.['aria-label'] === 'Existing prerequisites');
function assertExistingTaskLink(link, href) {
  assert.ok(link, 'read-only task link exists');
  assert.equal(link.props.href, href);
  assert.equal(link.props.target, '_blank');
  assert.equal(link.props.rel, 'noopener noreferrer');
  assert.equal(link.props.onClick, undefined);
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
    requests = [], listeners=new Map(), parentMessages=[], focused=[];
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
      signal: options.signal,
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
    // The hook renderer has no real DOM; attach focus refs before effects.
    for (const target of nodes(tree).filter(node => node.props?.ref && ['plan-receipt-heading', 'plan-brief'].includes(node.props.id))) {
      target.props.ref.current = { focus: () => focused.push(target.props.id) };
    }
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
    focused,
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
test('guided planner return stays available before the project loads and on load failure', async () => {
  let failLoad;
  const pending = new Promise(resolve => { failLoad = resolve; });
  const app = harness(() => pending, fixture(), 'project=p_example', false, true);
  try {
    await app.start();
    assertGuideReturn(app.tree);
    assert.match(text(app.tree), /Loading project/);
    assert.equal(planLink(app.tree, 'Start the event brief'), undefined);
    assert.equal(planLink(app.tree, 'Review proposed items'), undefined);

    failLoad(Response.json({ error: 'Fictional load failure' }, { status: 503 }));
    await app.start();
    assertGuideReturn(app.tree);
    assert.match(text(app.tree), /Fictional load failure/);
    assert.equal(planLink(app.tree, 'Start the event brief'), undefined);
    assert.equal(planLink(app.tree, 'Review proposed items'), undefined);
    assert.deepEqual(app.requests.map(row => row.action), ['get']);
  } finally { app.dispose(); }
});

test('guided planner points to the real brief, explicit generation, private review, and receipt', async () => {
  const initial = { ...fixture(), brief: { ...brief, description: '' }, draft: null, status: 'empty' };
  const app = harness(context => {
    if (context.input?.action === 'save') context.value = { ...context.saved, brief: context.input.brief, revision: context.saved.revision + 1 };
    if (context.input?.action === 'generate') {
      context.value = { ...context.saved, brief: context.input.brief, status: 'ready', draft: { ...fixture().draft, brief: context.input.brief } };
    }
    if (context.input?.action === 'apply') context.value = { ...context.saved, status: 'applied',
      receipt: { generation: context.input.generation, approvalHash: approvalHash(context.input), taskIds: ['task-created'] } };
  }, initial, 'project=p_example', false, true);
  try {
    await app.start();
    assert.ok(planHint(app.tree));
    assertGuideReturn(app.tree);
    const briefLink = planLink(app.tree, 'Start the event brief');
    assert.equal(briefLink?.props.href, '#plan-kind');
    assert.equal(briefLink.props.onClick, undefined);
    assert.equal(app.find('plan-kind')?.type, 'select');
    assert.equal(planLink(app.tree, 'Review proposed items'), undefined);
    assert.equal(app.find('plan-proposed-items'), undefined);
    assert.equal(planButton(app.tree, 'Generate draft').props.disabled, true);
    assert.deepEqual(app.requests.map(row => row.action), ['get']);
    assert.deepEqual(app.saved, initial);

    await app.edit('plan-brief', 'A fictional neighborhood welcome night.');
    const generate = planLink(app.tree, 'Go to draft controls');
    assert.equal(generate?.props.href, '#plan-generate');
    assert.equal(generate.props.onClick, undefined);
    assert.equal(app.find('plan-generate').props.tabIndex, -1);
    assert.match(text(app.find('plan-generate')), /Groq/);
    assert.equal(planButton(app.tree, 'Generate draft').props.disabled, false);
    assert.ok(nodes(app.tree).some(node => node.type === 'li' && node.props['aria-current'] === 'step' && text(node).includes('Generate a private draft')));
    assert.deepEqual(app.requests.map(row => row.action), ['get']);

    await app.click('Generate draft');
    const review = planLink(app.tree, 'Review proposed items');
    const heading = app.find('plan-proposed-items');
    assert.equal(review?.props.href, '#plan-proposed-items');
    assert.equal(review.props.onClick, undefined);
    assert.equal(heading?.type, 'h2');
    assert.equal(heading.props.tabIndex, -1);
    assert.equal(text(heading), 'Review proposed items');
    assert.equal(planLink(app.tree, 'Jump to your draft')?.props.href, '#plan-proposed-items');
    assert.deepEqual(app.requests.map(row => row.action), ['get', 'save', 'generate']);
    assert.equal(app.saved.receipt, null);

    await app.click('Add 1 selected items to project');
    assert.equal(planLink(app.tree, 'See what was added')?.props.href, '#plan-receipt-heading');
    assert.equal(planLink(app.tree, 'Review proposed items'), undefined);
    assert.equal(planLink(app.tree, 'Jump to your draft'), undefined);
    assertGuideReturn(app.tree);
    assert.deepEqual(app.requests.map(row => row.action), ['get', 'save', 'generate', 'apply']);
  } finally { app.dispose(); }
});

test('the guided sample fills the editable brief without saving, generating, or adding work', async () => {
  const initial = { ...fixture(), brief: { ...brief, description: '' }, draft: null, status: 'empty' };
  const app = harness(undefined, initial, 'project=p_example', false, true);
  try {
    await app.start();
    const action = planButton(app.tree, 'Use this example');
    assert.ok(action);
    assert.equal(action.props.type, 'button');
    const sample = 'A two-hour welcome night for 40 people. We need a check-in table, a short intro, and time to clean up.';
    assert.ok(nodes(app.tree).some(node => node.type === 'p' && text(node).includes(`Example brief: “${sample}”`)));
    assert.match(text(app.find(action.props['aria-describedby'])), /fills in the brief for you to edit.*Nothing is sent to AI until you choose Generate draft/);
    assert.equal(app.find('plan-brief').props.value, '');
    assert.equal(planButton(app.tree, 'Generate draft').props.disabled, true);

    await app.click('Use this example');
    assert.equal(app.find('plan-brief').props.value, sample);
    assert.equal(app.find('plan-brief').props.readOnly, undefined);
    assert.equal(planButton(app.tree, 'Generate draft').props.disabled, false);
    assert.equal(planButton(app.tree, 'Use this example'), undefined);
    assert.deepEqual(app.focused, ['plan-brief']);
    assert.equal(app.find('plan-kind').props.value, brief.kind);
    assert.equal(app.saved.receipt, null);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
    assert.deepEqual(app.saved, initial);

    await app.edit('plan-brief', 'My edited fictional welcome night.');
    assert.equal(app.find('plan-brief').props.value, 'My edited fictional welcome night.');
    assert.equal(planButton(app.tree, 'Use this example'), undefined);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
  } finally { app.dispose(); }
});

test('the sample action never replaces an existing brief, saved draft or unsupported planner', async () => {
  for (const [name, patch, query, embedded, guided] of [
    ['existing brief', { brief: { ...brief, description: 'Earlier private planning text.' } }, 'project=p_example', false, true],
    ['whitespace-only brief', { brief: { ...brief, description: ' ' } }, 'project=p_example', false, true],
    ['saved draft with empty brief', { draft: fixture().draft }, 'project=p_example', false, true],
    ['AI not configured', { configured: false }, 'project=p_example', false, true],
    ['locked while generating', { status: 'generating' }, 'project=p_example', false, true],
    ['unguided', {}, 'project=p_example', false, false],
    ['embedded', {}, 'project=p_example', true, true],
    ['demo', {}, 'demo=1', false, true],
    ['suggestions', {}, 'project=p_example&mode=suggestions', false, true],
    ['assistant', {}, 'project=p_example&mode=assistant', false, true],
  ]) {
    const initial = { ...fixture(), brief: { ...brief, description: '' }, draft: null, status: 'empty', ...patch };
    const app = harness(undefined, initial, query, embedded, guided);
    try {
      await app.start();
      assert.equal(planButton(app.tree, 'Use this example'), undefined, name);
      assert.deepEqual(app.requests, [{ action: 'get' }], name);
      assert.deepEqual(app.saved, initial, name);
    } finally { app.dispose(); }
  }
});

test('guided planner hides proposal shortcuts during generation and after apply', async () => {
  for (const status of ['generating', 'applied']) {
    const initial = { ...fixture(), status,
      receipt: status === 'applied' ? { taskIds: [] } : null };
    const app = harness(undefined, initial, 'project=p_example', false, true);
    try {
      await app.start();
      assert.ok(planHint(app.tree));
      assertGuideReturn(app.tree);
      assert.equal(planLink(app.tree, 'Review proposed items'), undefined);
      assert.equal(Boolean(planLink(app.tree, 'See what was added')), status === 'applied');
      assert.deepEqual(app.requests.map(row => row.action), ['get']);
    } finally { app.dispose(); }
  }
});

test('guided planner explains how to refresh stale proposals before adding', async () => {
  for (const [source, configured, label, anchor] of [
    [undefined, true, 'Generate a new draft', '#plan-generate'],
    [undefined, false, 'Start a fresh checklist', '#plan-starter'],
    ['starter', true, 'Start a fresh checklist', '#plan-starter'],
    ['pasted', true, 'Recheck your pasted draft', '#plan-recheck'],
  ]) {
    const initial = { ...fixture(), contextChanged: true, configured };
    initial.draft.source = source;
    const app = harness(undefined, initial, 'project=p_example', false, true);
    try {
      await app.start();
      assert.ok(nodes(app.tree).some(node => node.type === 'p' && text(node).includes('The project changed since this draft was saved')));
      assert.equal(planLink(app.tree, label)?.props.href, anchor);
      assert.equal(app.find(anchor.slice(1)).props.tabIndex, -1);
      assert.equal(planButton(app.tree, 'Add 1 selected items to project').props.disabled, true);
      assert.deepEqual(app.requests.map(row => row.action), ['get']);
    } finally { app.dispose(); }
  }
});

test('guided planner without AI configuration points to the real starter option without requesting generation', async () => {
  const initial = { ...fixture(), configured: false, brief: { ...brief, description: '' }, draft: null, status: 'empty' };
  const app = harness(undefined, initial, 'project=p_example', false, true);
  try {
    await app.start();
    assert.equal(planLink(app.tree, 'Go to starter checklist')?.props.href, '#plan-starter');
    assert.match(text(app.find('plan-starter')), /No AI call or AI quota is used/);
    assert.equal(planButton(app.tree, 'Use starter checklist').props.disabled, false);
    assert.equal(planButton(app.tree, 'Generate draft').props.disabled, true);
    assert.ok(nodes(app.tree).some(node => node.type === 'p' && text(node).includes('AI isn’t configured for this planner')));
    assert.deepEqual(app.requests.map(row => row.action), ['get']);
  } finally { app.dispose(); }
});

test('guided first draft offers a no-AI path after a confirmed generation failure or interruption', async () => {
  for (const status of ['error', 'interrupted']) {
    const initial = { ...fixture(), brief: { ...brief, description: '' }, draft: null, status: 'empty' };
    const entered = 'A fictional school fundraiser with a volunteer check-in.';
    const recoveredRevision = status === 'error' ? 5 : 4;
    const app = harness(context => {
      if (context.input?.action === 'save') {
        assert.equal(context.input.brief.description, entered);
        context.value = { ...context.saved, revision: 3, brief: context.input.brief };
      } else if (context.input?.action === 'generate') {
        assert.equal(context.input.revision, 3);
        context.value = { ...context.saved, revision: recoveredRevision, brief: context.input.brief,
          status: status === 'error' ? 'error' : 'generating',
          issue: status === 'error' ? 'AI could not finish this fictional plan.' : '' };
      } else if (context.input?.action === 'starter') {
        assert.deepEqual(context.input.brief, { ...initial.brief, description: entered });
        assert.equal(context.input.replace, false);
        assert.equal(context.input.revision, recoveredRevision);
        context.value = { ...context.saved, revision: recoveredRevision + 1, status: 'ready', issue: '', brief: context.input.brief,
          draft: { ...fixture().draft, source: 'starter', brief: context.input.brief } };
      } else if (!context.input && context.saved.status === 'generating') {
        context.value = { ...context.saved, status: 'interrupted' };
      }
    }, initial, 'project=p_example', false, true);
    try {
      await app.start();
      await app.edit('plan-brief', entered);
      assert.equal(planLink(app.tree, 'Go to starter checklist'), undefined);
      await app.click('Generate draft');
      const beforeStarter = ['get', 'save', 'generate'];
      if (status === 'interrupted') {
        assert.equal(planLink(app.tree, 'Go to starter checklist'), undefined, 'an active lease is not a failure');
        await app.poll();
        beforeStarter.push('get');
      }
      const fallback = planLink(app.tree, 'Go to starter checklist');
      const retry = planLink(app.tree, 'Back to AI draft controls');
      assert.equal(fallback?.props.href, '#plan-starter', status);
      assert.equal(retry?.props.href, '#plan-generate', status);
      assert.equal(fallback.props.onClick, undefined);
      assert.equal(retry.props.onClick, undefined);
      assert.equal(app.find('plan-starter').props.tabIndex, -1);
      assert.equal(app.find('plan-generate').props.tabIndex, -1);
      assert.equal(app.find('plan-brief').props.value, entered);
      assert.doesNotMatch(text(app.tree), /AI isn’t configured for this planner/);
      assert.deepEqual(app.requests.map(row => row.action), beforeStarter);

      await app.click('Use starter checklist');
      assert.deepEqual(app.requests.map(row => row.action), [...beforeStarter, 'starter']);
      assert.equal(app.find('plan-brief').props.value, entered);
      assert.equal(planLink(app.tree, 'Review proposed items')?.props.href, '#plan-proposed-items');
      assert.equal(planLink(app.tree, 'Go to starter checklist'), undefined);
      assert.equal(app.saved.receipt, null);
    } finally { app.dispose(); }
  }
});

test('guided recovery keeps a previous draft in review and does not infer failure from a lost response', async () => {
  const prior = { ...fixture(), status: 'error', issue: 'AI could not finish this fictional plan.' };
  const priorApp = harness(undefined, prior, 'project=p_example', false, true);
  try {
    await priorApp.start();
    assert.equal(planLink(priorApp.tree, 'Review proposed items')?.props.href, '#plan-proposed-items');
    assert.equal(planLink(priorApp.tree, 'Go to starter checklist'), undefined);
    assert.equal(planLink(priorApp.tree, 'Back to AI draft controls'), undefined);
    assert.equal(priorApp.find('title-one').props.value, item.title);
    assert.deepEqual(priorApp.requests.map(row => row.action), ['get']);
  } finally { priorApp.dispose(); }

  for (const status of ['empty', 'error', 'interrupted']) {
    const initial = { ...fixture(), draft: null, status };
    const app = harness(context => {
      if (context.input?.action === 'generate') throw new Error('Fictional network interruption');
    }, initial, 'project=p_example', false, true);
    try {
      await app.start();
      assert.equal(Boolean(planLink(app.tree, 'Go to starter checklist')), status !== 'empty');
      await app.click('Generate draft');
      assert.match(text(app.tree), /Fictional network interruption/);
      assert.ok(planButton(app.tree, 'Retry request'));
      assert.equal(planLink(app.tree, 'Go to starter checklist'), undefined, status);
      assert.equal(planLink(app.tree, 'Back to AI draft controls'), undefined, status);
      assert.equal(app.find('plan-brief').props.value, initial.brief.description);
      assert.deepEqual(app.requests.map(row => row.action), ['get', 'generate']);
    } finally { app.dispose(); }
  }
});

test('planner walkthrough stays out of regular, embedded, demo, and other planning modes', async () => {
  for (const [query, embedded, guided] of [
    ['project=p_example', false, false],
    ['project=p_example', true, true],
    ['demo=1', false, true],
    ['project=p_example&mode=suggestions', false, true],
    ['project=p_example&mode=assistant', false, true],
  ]) {
    const app = harness(undefined, fixture(), query, embedded, guided);
    try {
      await app.start();
      assert.equal(planHint(app.tree), undefined);
      for (const label of ['Return to your guide', 'Start the event brief', 'Review proposed items']) {
        assert.equal(planLink(app.tree, label), undefined);
      }
      assert.deepEqual(app.requests.map(row => row.action), ['get']);
    } finally { app.dispose(); }
  }
});

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

test('a lost apply response checks the matching saved receipt without replaying approval or losing normalized edits', async () => {
  let writes = 0;
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
      assert.equal(++writes, 1, 'the approval write is never replayed');
      assert.equal(input.items[0].title, 'Updated task');
      context.value = {
        ...saved,
        revision: saved.revision + 1,
        workspaceRevision: saved.workspaceRevision + 1,
        status: 'applied',
        receipt: { generation: input.generation, approvalHash: approvalHash(input), taskIds: ['task-new'] },
        receiptTasks: [{id:'task-new',title:'Updated task',handoff:{state:'needs-owner'}}],
      };
      throw new Error('Connection lost after save');
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
    assert.equal(planButton(active.tree, 'Add 1 selected items to project').props.disabled, true);
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'save', 'apply']);
    await active.click('Check what was added');
    assert.match(text(active.tree), /1 task added/);
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'save', 'apply', 'get']);
    assert.deepEqual(active.focused, ['plan-receipt-heading']);
    assert.match(planLink(active.tree, 'Updated task').props.href, /task=task-new/);
  } finally {
    active.dispose();
  }
});

for (const direct of [false, true]) test(`receipt from another approval of the same generation cannot replace local review${direct ? ' even in a successful response' : ' after a lost response'}`, async () => {
  const initial = fixture();
  const active = harness(context => {
    if (context.input?.action !== 'apply') return;
    const changedItems = [{ ...context.input.items[0], title: 'Different tab proposal' }];
    context.value = {
      ...context.saved, revision: initial.revision + 1, workspaceRevision: initial.workspaceRevision + 1, status: 'applied',
      draft: { ...initial.draft, items: changedItems },
      receipt: { generation: context.input.generation, approvalHash: approvalHash({ generation: context.input.generation, items: changedItems }), taskIds: ['other-tab'] },
      receiptTasks: [{ id: 'other-tab', title: 'Different tab proposal' }],
    };
    if (!direct) throw new Error('Fictional connection loss');
  }, initial);
  try {
    await active.start();
    await active.click('Add 1 selected items to project');
    assert.equal(active.find('plan-receipt-heading'), undefined);
    assert.equal(active.find('title-one').props.value, item.title);
    await active.click('Check what was added');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get']);
    assert.equal(active.find('title-one').props.value, item.title);
    assert.equal(active.find('include-one').props.checked, true);
    assert.equal(active.find('plan-receipt-heading'), undefined);
    assert.equal(planLink(active.tree, 'Different tab proposal'), undefined);
    assert.equal(planButton(active.tree, 'Add 1 selected items to project').props.disabled, true);
    assert.ok(planButton(active.tree, 'Reload saved draft'));
    assert.deepEqual(active.focused, []);
  } finally { active.dispose(); }
});

test('an unconfirmed approval without a saved receipt requires a separate click to approve', async () => {
  let attempts = 0;
  const active = harness(context => {
    if (context.input?.action !== 'apply') return;
    if (++attempts === 1) return Response.json({ error: 'Fictional gateway timeout' }, { status: 504 });
    context.value = { ...context.saved, revision: context.saved.revision + 1, status: 'applied',
      receipt: { generation: context.input.generation, approvalHash: approvalHash(context.input), taskIds: ['task-new'] } };
  });
  try {
    await active.start();
    await active.click('Add 1 selected items to project');
    assert.equal(planButton(active.tree, 'Add 1 selected items to project').props.disabled, true);
    await active.click('Check what was added');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get']);
    assert.equal(active.find('plan-receipt-heading'), undefined);
    assert.equal(active.find('include-one').props.checked, true);
    assert.equal(Boolean(planButton(active.tree, 'Add 1 selected items to project').props.disabled), false);
    await active.click('Add 1 selected items to project');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get', 'apply']);
    assert.deepEqual(active.requests.at(-1), active.requests[1], 'retry is the same exact approval when nothing changed');
    assert.match(text(active.tree), /1 task added/);
  } finally { active.dispose(); }
});

test('explicit approval conflict blocks repeat writes until a read-only refresh and fresh confirmation', async () => {
  const initial = fixture();
  let attempts = 0, advanceContext = false;
  const active = harness(context => {
    if (!context.input && advanceContext)
      context.value = { ...context.saved, workspaceRevision: initial.workspaceRevision + 1 };
    if (context.input?.action !== 'apply') return;
    if (++attempts === 1) {
      assert.equal(context.input.workspaceRevision, initial.workspaceRevision);
      return Response.json({ error: 'The project changed. Refresh before adding.' }, { status: 409 });
    }
    assert.equal(context.input.workspaceRevision, initial.workspaceRevision + 1);
    assert.equal(context.input.revision, initial.revision);
    assert.equal(context.input.generation, initial.draft.generation);
    assert.equal(context.input.confirm, true);
    context.value = { ...context.saved, revision: initial.revision + 1, status: 'applied',
      receipt: { generation: context.input.generation, approvalHash: approvalHash(context.input), taskIds: ['task-new'] } };
  }, initial);
  try {
    await active.start();
    await active.click('Add 1 selected items to project');
    assert.equal(planButton(active.tree, 'Add 1 selected items to project').props.disabled, true);
    assert.equal(active.find('include-one').props.checked, true);
    assert.equal(active.find('title-one').props.value, item.title);
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply']);
    await active.click('Refresh before adding');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get']);
    assert.equal(planButton(active.tree, 'Add 1 selected items to project').props.disabled, true, 'a still-stale read cannot unlock approval');
    advanceContext = true;
    await active.click('Refresh before adding');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get', 'get']);
    assert.equal(active.find('include-one').props.checked, true);
    assert.equal(active.find('plan-receipt-heading'), undefined);
    assert.equal(Boolean(planButton(active.tree, 'Add 1 selected items to project').props.disabled), false);
    await active.click('Add 1 selected items to project');
    assert.deepEqual(active.requests.map(input => input.action), ['get', 'apply', 'get', 'get', 'apply']);
    assert.match(text(active.tree), /1 task added/);
  } finally { active.dispose(); }
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
      assertExistingTaskLink(existingTaskLinks(existingPrerequisites(active.tree)[0], prerequisite.title)[0],
        '/project?project=p_example&task=old-prerequisite');
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
      const refreshed = existingTaskLinks(active.tree, prerequisite.title);
      assert.ok(refreshed.length);
      for (const link of refreshed)
        assertExistingTaskLink(link, '/project?project=p_example&task=new-prerequisite');
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
      assert.deepEqual(links.filter(node=>node.props.href.startsWith(expected)).map(node=>[text(node),node.props.href]),[
        ['Run volunteer briefing',expected+'task-b'],['Check signage',expected+'task-a'],
      ]);
      assert.ok(links.every(node=>node.props.target===(embedded?'_top':undefined)));
      if(!embedded)assert.deepEqual(links.filter(node=>node.props.href.includes('#')).map(node=>[text(node),node.props.href]),[
        ['Open Shared tasks','/project?project=p_school#tasks'],['Open Timeline','/project?project=p_school#timeline'],
      ]);
      assert.doesNotMatch(text(receipt),/Approve venue|task-missing/);
    }finally{app.dispose();}
  }
});
test('the organizer receipt flags untimed activities in place and ignores a regressed refresh',async()=>{
  const initial=fixture();
  initial.status='applied';
  initial.workspaceRevision=15;
  initial.receipt={taskIds:['one','two','prep']};
  initial.receiptTasks=[
    {id:'one',title:'Fictional welcome',needsStartTime:true,handoff:{state:'needs-owner'}},
    {id:'two',title:'Fictional cleanup',needsStartTime:true,handoff:{state:'accepted'}},
    {id:'prep',title:'Fictional approvals',handoff:{state:'needs-owner'}},
  ];
  let reads=0;
  const app=harness(context=>{
    if(context.input||++reads===1)return;
    const next=copy(context.saved);
    next.workspaceRevision=reads===2?14:reads===3?16:17;
    delete next.receiptTasks[0].needsStartTime;
    if(reads===3)next.receiptTasks[1].needsStartTime=true;
    else delete next.receiptTasks[1].needsStartTime;
    context.value=next;
  },initial,'project=p_school',false,true);
  const receipt=()=>nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='plan-receipt-heading');
  const link=label=>nodes(receipt()).find(node=>node.type==='a'&&text(node)===label);
  const tagged=()=>nodes(receipt()).filter(node=>node.type==='li'&&text(node).includes('Needs a start time'))
    .map(row=>nodes(row).find(node=>node.type==='a'&&node.props['data-handoff-task'])?.props['data-handoff-task']);
  try{
    await app.start();
    assert.match(text(receipt()),/2 activities need start times.*before they can appear on the run sheet/);
    assert.deepEqual(tagged(),['one','two']);
    assert.equal(link('Open Timeline')?.props.href,'/project?project=p_school&guide=1#timeline');
    assert.equal(link('Open Shared tasks')?.props.href,'/project?project=p_school&guide=1#tasks');
    assert.equal(nodes(receipt()).filter(node=>node.type==='a'&&node.props['data-handoff-task']&&!node.props['data-handoff-intent']).length,3);
    assert.deepEqual(nodes(receipt()).filter(node=>node.type==='a'&&text(node)==='Set start time').map(node=>node.props.href),[
      '/project?project=p_school&task=one&guide=1&review=schedule',
      '/project?project=p_school&task=two&guide=1&review=schedule',
    ]);
    await app.click('Refresh task handoff');
    assert.match(text(app.tree),/Could not confirm the latest handoff/);
    assert.equal(tagged().length,2);
    await app.click('Refresh task handoff');
    assert.match(text(receipt()),/1 activity needs a start time.*before it can appear on the run sheet/);
    assert.equal(tagged().length,1);
    assert.deepEqual(nodes(receipt()).filter(node=>node.type==='a'&&text(node)==='Set start time').map(node=>node.props['aria-label']),['Set start time for Fictional cleanup']);
    await app.click('Refresh task handoff');
    assert.equal(tagged().length,0);
    assert.equal(link('Set start time'),undefined);
    assert.doesNotMatch(text(receipt()),/run sheet/);
    assert.deepEqual(app.requests,Array.from({length:4},()=>({action:'get'})));
  }finally{app.dispose();}
});
test('a stalled handoff refresh stays in place, times out, and retries only on an explicit GET', async () => {
  const initial = fixture();
  initial.status = 'applied';
  initial.receipt = { taskIds: ['task-welcome'], generation: 'prior-generation', approvalHash: 'prior-approval' };
  initial.receiptTasks = [{ id: 'task-welcome', title: 'Welcome attendees', handoff: { state: 'needs-owner' } }];
  const originalTimeout = AbortSignal.timeout;
  const deadlines = [];
  const controllers = [];
  AbortSignal.timeout = duration => {
    deadlines.push(duration);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  };
  let reads = 0, heldSignal;
  const app = harness(context => {
    assert.equal(context.input, null);
    if (++reads === 2) {
      heldSignal = context.signal;
      return new Promise((_, reject) => heldSignal?.addEventListener('abort', () => reject(heldSignal.reason), { once: true }));
    }
    if (reads === 3) {
      const next = copy(context.saved);
      next.workspaceRevision++;
      next.receiptTasks[0].handoff = { state: 'accepted', ownerName: 'Fictional Planner' };
      context.value = next;
    }
  }, initial, 'project=p_school', false, true);
  const button = () => planButton(app.tree, 'Refresh task handoff');
  const status = () => app.find('plan-handoff-refresh-status');
  const currentTitle = () => planLink(app.tree, 'Welcome attendees');
  let held;
  try {
    await app.start();
    assert.equal(status()?.props.role, 'status');
    assert.ok(currentTitle());
    assert.match(text(app.tree), /Unassigned · choose an owner/);
    held = app.click('Refresh task handoff');
    await app.start();
    assert.deepEqual(deadlines, [15000]);
    assert.equal(heldSignal, controllers[0].signal);
    assert.equal(status().props.role, 'status');
    assert.match(text(status()), /check|refresh/i);
    assert.equal(button().props.disabled, true);
    assert.equal(button().props.focusableWhenDisabled, true);
    assert.ok(currentTitle());
    await button().props.onClick(); // A duplicate activation cannot start another request.
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }]);

    controllers[0].abort(new DOMException('Fictional handoff timeout', 'TimeoutError'));
    await held;
    assert.match(text(status()), /Could not refresh the task handoff.*last loaded task details are still shown.*Try again/);
    assert.match(text(app.tree), /Unassigned · choose an owner/);
    assert.ok(currentTitle());
    assert.equal(button().props.disabled, false);
    assert.deepEqual(app.focused, [], 'a refresh must not move focus away from its control');
    await app.click('Refresh task handoff');
    assert.match(text(status()), /Task handoff refreshed from the project/);
    assert.match(text(app.tree), /Accepted by Fictional Planner/);
    assert.ok(currentTitle());
    assert.deepEqual(deadlines, [15000, 15000]);
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }, { action: 'get' }]);
  } finally {
    for (const controller of controllers) controller.abort();
    AbortSignal.timeout = originalTimeout;
    app.dispose();
  }
});

test('the handoff refresh also times out while reading a response body', async () => {
  const initial = fixture();
  initial.status = 'applied';
  initial.receipt = { taskIds: ['task-welcome'] };
  initial.receiptTasks = [{ id: 'task-welcome', title: 'Welcome attendees', handoff: { state: 'needs-owner' } }];
  const originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  AbortSignal.timeout = () => controller.signal;
  let reads = 0, bodyStarted = false;
  const app = harness(context => {
    if (++reads !== 2) return;
    const body = new ReadableStream({
      start(stream) {
        bodyStarted = true;
        controller.signal.addEventListener('abort', () => stream.error(controller.signal.reason), { once: true });
      },
    });
    assert.equal(context.signal, controller.signal);
    return new Response(body, { status: 200 });
  }, initial, 'project=p_school', false, true);
  try {
    await app.start();
    const held = app.click('Refresh task handoff');
    await app.start();
    assert.equal(bodyStarted, true);
    assert.equal(planButton(app.tree, 'Refresh task handoff').props.disabled, true);
    controller.abort(new DOMException('Fictional body timeout', 'TimeoutError'));
    await held;
    assert.match(text(app.find('plan-handoff-refresh-status')), /Could not refresh the task handoff.*last loaded task details are still shown/);
    assert.equal(planButton(app.tree, 'Refresh task handoff').props.disabled, false);
    assert.ok(planLink(app.tree, 'Welcome attendees'));
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }]);
  } finally {
    controller.abort();
    AbortSignal.timeout = originalTimeout;
    app.dispose();
  }
});

test('handoff refresh rejects a different receipt and clears private data on access loss', async () => {
  for (const denied of [401, 403, 404]) {
    const initial = fixture();
    initial.status = 'applied';
    initial.receipt = { taskIds: ['task-one'], generation: 'prior-generation', approvalHash: 'prior-approval' };
    initial.receiptTasks = [{ id: 'task-one', title: 'Private receipt task', handoff: { state: 'needs-owner' } }];
    let reads = 0;
    const app = harness(context => {
      if (++reads === 2) return Response.json({ ...context.saved, workspaceRevision: context.saved.workspaceRevision + 1,
        receipt: { ...context.saved.receipt, approvalHash: 'other-approval' },
        receiptTasks: [{ ...context.saved.receiptTasks[0], title: 'Different receipt task' }] });
      if (reads === 3) return Response.json({ error: 'Project access changed.' }, { status: denied });
    }, initial, 'project=p_school', false, true);
    try {
      await app.start();
      await app.click('Refresh task handoff');
      assert.match(text(app.find('plan-handoff-refresh-status')), /Could not confirm the latest handoff/);
      assert.ok(planLink(app.tree, 'Private receipt task'));
      assert.equal(planLink(app.tree, 'Different receipt task'), undefined);

      await app.click('Refresh task handoff');
      assert.match(text(app.tree), /Project access changed/);
      assert.doesNotMatch(text(app.tree), /Private receipt task|Different receipt task/);
      assert.equal(app.find('plan-receipt-heading'), undefined);
      assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }, { action: 'get' }]);
    } finally { app.dispose(); }
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
test('the organizer handoff separates next actions and refresh moves the same tasks with a read only',async()=>{
  const initial=fixture();
  initial.status='applied';
  initial.receiptTasks=[
    {id:'task-accepted',title:'Confirm the room',handoff:{state:'accepted',ownerName:'Fictional Planner'}},
    {id:'task-amended',title:'Confirm handback',handoff:{state:'needs-amendment-review'}},
    {id:'task-returned',title:'Check supplier confirmation',handoff:{state:'changes-requested',ownerName:'Fictional Planner'}},
    {id:'task-unassigned',title:'Set up AV',handoff:{state:'needs-owner'}},
    {id:'task-acceptance',title:'Place the welcome table',handoff:{state:'awaiting-acceptance',ownerName:'Fictional Planner'}},
    {id:'task-unavailable',title:'Prepare the foyer',handoff:{state:'needs-reassignment'}},
    {id:'task-verification',title:'Print signs',handoff:{state:'needs-review'}},
    {id:'task-done',title:'Agree the schedule',handoff:{state:'complete'}},
    {id:'task-unknown',title:'Draft event notes'},
  ];
  initial.receipt={taskIds:[...initial.receiptTasks.map(task=>task.id),'task-deleted']};
  let reads=0;
  const app=harness(context=>{
    if(!context.input&&++reads===2){
      const next=copy(context.saved);
      next.workspaceRevision++;
      next.contextChanged=true;
      const updates={
        'task-unassigned':{state:'awaiting-acceptance',ownerName:'Fictional Planner'},
        'task-acceptance':{state:'accepted',ownerName:'Fictional Planner'},
        'task-amended':{state:'complete'},
        'task-verification':{state:'changes-requested',ownerName:'Fictional Planner'},
        'task-returned':{state:'needs-review',ownerName:'Fictional Planner'},
      };
      for (const task of next.receiptTasks) if (updates[task.id]) task.handoff=updates[task.id];
      context.value=next;
    }
  },initial,'project=p_school',false,true);
  const groups=[
    'Assign an owner','Review completion','Waiting for acceptance',
    'Waiting for a revised submission','Accepted or complete','Status unavailable',
  ];
  function checkReceipt(expected){
    const receipt=nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='plan-receipt-heading');
    assert.ok(receipt);
    assert.match(text(receipt),/10 tasks added to the project\. 1 is no longer available/);
    const all=nodes(receipt);
    const headings=all.filter(node=>/^h[2-6]$/.test(node.type)).flatMap(node=>{
      const group=groups.find(group=>text(node).startsWith(group));
      return group?[{node,group}]:[];
    });
    assert.deepEqual(headings.map(({group})=>group),groups);
    const namesById=new Map(initial.receiptTasks.map(task=>[task.id,task.title]));
    for (let i=0;i<headings.length;i++){
      const {node,group}=headings[i];
      const start=all.indexOf(node)+1,end=i+1<headings.length?all.indexOf(headings[i+1].node):all.length;
      const links=all.slice(start,end).filter(row=>row.type==='a'&&row.props.href?.includes('&task='));
      assert.deepEqual(links.map(row=>[text(row),row.props.href]),expected[group].map(id=>[
        namesById.get(id),'/project?project=p_school&task='+id+'&guide=1'+(group==='Assign an owner'?'&review=owner':group==='Review completion'?(id==='task-amended'?'&review=amendment':'&review=completion'):''),
      ]),group);
    }
    assert.equal(all.filter(row=>row.type==='a'&&row.props.href?.includes('&task=')).length,initial.receiptTasks.length);
    assert.doesNotMatch(text(receipt),/task-deleted/);
  }
  try{
    await app.start();
    checkReceipt({
      'Assign an owner':['task-unassigned','task-unavailable'],
      'Review completion':['task-amended','task-verification'],
      'Waiting for acceptance':['task-acceptance'],
      'Waiting for a revised submission':['task-returned'],
      'Accepted or complete':['task-accepted','task-done'],
      'Status unavailable':['task-unknown'],
    });
    assert.match(text(app.tree),/Assigned to Fictional Planner · awaiting acceptance/);
    assert.match(text(app.tree),/Completion needs verification/);
    assert.match(text(app.tree),/Complete · updated evidence needs review/);
    await app.click('Refresh task handoff');
    assert.deepEqual(app.requests,[{action:'get'},{action:'get'}]);
    checkReceipt({
      'Assign an owner':['task-unavailable'],
      'Review completion':['task-returned'],
      'Waiting for acceptance':['task-unassigned'],
      'Waiting for a revised submission':['task-verification'],
      'Accepted or complete':['task-accepted','task-amended','task-acceptance','task-done'],
      'Status unavailable':['task-unknown'],
    });
    assert.match(text(app.tree),/Accepted by Fictional Planner/);
    assert.match(text(app.tree),/Task handoff refreshed from the project/);
    assert.doesNotMatch(text(app.tree),/Choose a fresh starter|Generate a new draft before adding it/);
  }finally{app.dispose();}
});
test('the handoff shows verification blockers separately and the same link moves back to review on refresh',async()=>{
  const initial=fixture();
  initial.status='applied';
  initial.receipt={taskIds:['task-blocked','task-amended']};
  initial.receiptTasks=[
    {id:'task-blocked',title:'Confirm foyer handoff',handoff:{state:'review-blocked'}},
    {id:'task-amended',title:'Confirm room handback',handoff:{state:'needs-amendment-review'}},
  ];
  let reads=0;
  const app=harness(context=>{
    if(!context.input&&++reads===2){
      const next=copy(context.saved);
      next.receiptTasks[0].handoff.state='needs-review';
      context.value=next;
    }
  },initial,'project=p_school',false,true);
  const group=id=>nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='handoff-'+id);
  const taskLink=section=>nodes(section).find(node=>node.props?.href==='/project?project=p_school&task=task-blocked&guide=1&review=completion');
  try{
    await app.start();
    const blocked=group('required-work'),review=group('review');
    assert.match(text(blocked),/Review required work.*Task relationships.*report is still on file.*Verification waiting on required work/);
    assert.equal(text(taskLink(blocked)),'Confirm foyer handoff');
    assert.equal(taskLink(review),undefined);
    assert.match(text(review),/Confirm room handback.*updated evidence needs review/);
    await app.click('Refresh task handoff');
    assert.equal(group('required-work'),undefined);
    assert.equal(text(taskLink(group('review'))),'Confirm foyer handoff');
    assert.match(text(group('review')),/Completion needs verification/);
    assert.deepEqual(app.requests,[{action:'get'},{action:'get'}]);
  }finally{app.dispose();}
});
test('the receipt separates schedule reacceptance from new assignments, even when a start time was removed',async()=>{
  const initial=fixture();
  initial.status='applied';
  initial.receipt={taskIds:['task-changed','task-first']};
  initial.receiptTasks=[
    {id:'task-changed',title:'Welcome desk',needsStartTime:true,handoff:{state:'awaiting-schedule-acceptance',ownerName:'Fictional Planner'}},
    {id:'task-first',title:'Check supplies',handoff:{state:'awaiting-acceptance',ownerName:'Fictional Planner'}},
  ];
  let reads=0;
  const app=harness(context=>{
    if(!context.input&&++reads===2){
      const next=copy(context.saved);
      next.workspaceRevision++;
      next.receiptTasks[0].handoff.state='accepted';
      context.value=next;
    }
  },initial,'project=p_school',false,true);
  const group=id=>nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='handoff-'+id);
  const changedLink=()=>nodes(app.tree).filter(node=>node.type==='a'&&text(node)==='Welcome desk');
  try{
    await app.start();
    assert.match(text(group('schedule-acceptance')),/Waiting for renewed acceptance.*Schedule changed · Fictional Planner needs to accept again.*Needs a start time/);
    assert.match(text(group('acceptance')),/Check supplies.*awaiting acceptance/);
    assert.doesNotMatch(text(group('acceptance')),/Welcome desk/);
    assert.deepEqual(changedLink().map(node=>node.props.href),['/project?project=p_school&task=task-changed&guide=1']);
    await app.click('Refresh task handoff');
    assert.equal(group('schedule-acceptance'),undefined);
    assert.match(text(group('settled')),/Welcome desk.*Accepted by Fictional Planner.*Needs a start time/);
    assert.match(text(group('acceptance')),/Check supplies/);
    assert.equal(changedLink().length,1);
    assert.deepEqual(app.requests,[{action:'get'},{action:'get'}]);
  }finally{app.dispose();}
});
test('receipt review hints are limited to real project plan handoffs',async()=>{
  for(const [query,expected] of [
    ['project=p_school','/project?project=p_school&task=task-a&review=amendment'],
    ['project=p_school&mode=suggestions','/project?project=p_school&task=task-a'],
    ['project=p_school&mode=assistant','/project?project=p_school&task=task-a'],
    ['demo=1','/demo?as=jack&task=task-a'],
  ]){
    const initial=fixture();
    initial.receipt={taskIds:['task-a']};
    initial.receiptTasks=[{id:'task-a',title:'Fictional task',handoff:{state:'needs-amendment-review'}}];
    const app=harness(null,initial,query);
    try{
      await app.start();
      assert.equal(nodes(app.tree).find(node=>node.type==='a'&&text(node)==='Fictional task')?.props.href,expected);
    }finally{app.dispose();}
  }
});

test('owner review links are limited to real standalone plan receipts and preserve the guide', async () => {
  for (const [query, embedded, guided, projectHref, hint] of [
    ['project=p_school', false, false, '/project?project=p_school', true],
    ['project=p_school', false, true, '/project?project=p_school', true],
    ['project=p_school', true, true, '/project?project=p_school', false],
    ['project=p_school&mode=suggestions', false, true, '/project?project=p_school', false],
    ['project=p_school&mode=assistant', false, true, '/project?project=p_school', false],
    ['demo=1', false, true, '/demo?as=jack', false],
  ]) {
    const initial = fixture();
    initial.receiptTasks = [
      { id: 'task-unassigned', title: 'Set up AV', handoff: { state: 'needs-owner' } },
      { id: 'task-reassign', title: 'Prepare foyer', handoff: { state: 'needs-reassignment' } },
      { id: 'task-pending', title: 'Check signs', handoff: { state: 'awaiting-acceptance' } },
    ];
    initial.receipt = { taskIds: initial.receiptTasks.map(task => task.id) };
    const app = harness(undefined, initial, query, embedded, guided);
    try {
      await app.start();
      for (const [index, task] of initial.receiptTasks.entries()) {
        const link = planLink(app.tree, task.title);
        assert.equal(link?.props.href, projectHref + '&task=' + task.id +
          (guided && hint ? '&guide=1' : '') + (hint && index < 2 ? '&review=owner' : ''),
        `${query}, embedded=${embedded}, guided=${guided}: ${task.handoff.state}`);
        assert.equal(link.props.target, embedded ? '_top' : undefined);
        assert.equal(link.props.onClick, undefined);
      }
      assert.deepEqual(app.requests, [{ action: 'get' }]);
    } finally { app.dispose(); }
  }
});

test('untimed activity shortcuts are separate from task review links and limited to real standalone plans', async () => {
  for (const [query, embedded, guided, shortcut] of [
    ['project=p_school', false, false, true],
    ['project=p_school', false, true, true],
    ['project=p_school', true, true, false],
    ['project=p_school&mode=suggestions', false, true, false],
    ['project=p_school&mode=assistant', false, true, false],
    ['demo=1', false, true, false],
  ]) {
    const initial = fixture();
    initial.receiptTasks = [
      { id: 'task-unassigned', title: 'Fictional welcome desk', needsStartTime: true, handoff: { state: 'needs-owner' } },
      { id: 'task-review', title: 'Fictional rehearsal', needsStartTime: true, handoff: { state: 'needs-review' } },
      { id: 'task-scheduled', title: 'Fictional scheduled activity', handoff: { state: 'accepted' } },
      { id: 'bad task', title: 'Fictional invalid activity', needsStartTime: true, handoff: { state: 'needs-owner' } },
    ];
    initial.receipt = { taskIds: initial.receiptTasks.map(task => task.id) };
    const app = harness(undefined, initial, query, embedded, guided);
    try {
      await app.start();
      const links = nodes(app.tree).filter(node => node.type === 'a' && text(node) === 'Set start time');
      assert.equal(links.length, shortcut ? 2 : 0, `${query}, embedded=${embedded}, guided=${guided}`);
      if (shortcut) {
        const base = '/project?project=p_school&task=';
        const suffix = guided ? '&guide=1' : '';
        for (const [id, title, review] of [
          ['task-unassigned', 'Fictional welcome desk', 'owner'],
          ['task-review', 'Fictional rehearsal', 'completion'],
        ]) {
          const task = planLink(app.tree, title);
          const schedule = links.find(node => node.props['aria-label'] === `Set start time for ${title}`);
          assert.equal(task?.props.href, base + id + suffix + '&review=' + review);
          assert.equal(task.props['data-handoff-task'], id);
          assert.equal(schedule?.props.href, base + id + suffix + '&review=schedule');
          assert.equal(schedule.props['data-handoff-task'], id);
          assert.equal(schedule.props['data-handoff-intent'], 'schedule', 'secondary link retains its distinct focus intent');
          assert.equal(schedule.props.onClick, undefined);
        }
      }
      assert.deepEqual(app.requests, [{ action: 'get' }]);
    } finally { app.dispose(); }
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
test('a selected proposal shows the exact shared prerequisite before Add and can remove only that private link', async () => {
  const initial = fixture();
  const existing = { id: 'shared-confirmation', title: 'Confirm activities', start: '' };
  initial.existingTasks = [existing];
  initial.draft.items = [
    { ...copy(item), included: false },
    { ...copy(item), id: 'two', title: 'Prepare arrival', dependsOn: ['one'] },
    { ...copy(item), id: 'three', title: 'Draft follow-up', dependsOn: ['one'], included: false },
  ];
  const app = harness(context => {
    if (context.input?.action === 'save') context.value = {
      ...context.saved, revision: context.saved.revision + 1,
      draft: { ...context.saved.draft, items: context.input.items },
    };
  }, initial, 'project=p_school', false, true);
  try {
    await app.start();
    const groups = existingPrerequisites(app.tree);
    assert.equal(groups.length, 1, 'only the selected proposal shows its resolved links');
    assert.ok(!nodes(app.tree).some(node => node.type === 'details' && nodes(node).includes(groups[0])),
      'the organizer does not need to expand Details to review the shared prerequisite');
    assertExistingTaskLink(existingTaskLinks(groups[0], existing.title)[0],
      '/project?project=p_school&task=shared-confirmation&guide=1');
    assert.equal(existingTaskLinks(app.tree, existing.title).length, 2, 'the match is inspectable from the candidate and selected proposal');
    await app.edit('note-two', 'Keep the private arrival note.');
    const remove = nodes(groups[0]).find(node =>
      node.type === 'button' && node.props['aria-label'] === 'Remove link to prerequisite: Confirm activities');
    assert.ok(remove);
    assert.equal(text(remove), 'Remove link');
    const button = {}, focus = [];
    globalThis.document.activeElement = button;
    globalThis.document.getElementById = id => ({ focus: options => focus.push({ id, options }) });
    await remove.props.onClick({ currentTarget: button });
    assert.deepEqual(focus, [{ id: 'include-two', options: { preventScroll: true } }]);
    await app.start();
    assert.deepEqual(app.requests.map(({ action }) => action), ['get'], 'preview and removal do not write');
    assert.equal(existingPrerequisites(app.tree).length, 0);
    assert.equal(app.find('required-two:one').props.checked, false);
    assert.equal(app.find('required-three:one').props.checked, true);
    assert.equal(app.find('note-two').props.value, 'Keep the private arrival note.');
    await app.click('Add 1 selected items to project');
    const apply = app.requests.at(-1);
    assert.equal(apply.action, 'apply');
    assert.deepEqual(apply.items.find(row => row.id === 'two').dependsOn, []);
    assert.deepEqual(apply.items.find(row => row.id === 'three').dependsOn, ['one']);
  } finally {
    app.dispose();
  }
});
test('ambiguous exact matches and invalid semantic reuse never appear as resolved prerequisites', async () => {
  for (const invalidReuse of [false, true]) {
    const initial = fixture();
    const exact = { id: 'existing', title: item.title, start: '' };
    initial.existingTasks = invalidReuse ? [exact] : [exact, { ...exact, id: 'ambiguous' }];
    initial.draft.items = [
      { ...copy(item), included: false, ...(invalidReuse ? { duplicateChoice: 'reuse' } : {}) },
      { ...copy(item), id: 'two', title: 'Prepare arrival', dependsOn: ['one'] },
    ];
    const app = harness(undefined, initial);
    try {
      await app.start();
      assert.equal(existingTaskLinks(app.tree).length, 0);
      assert.equal(existingPrerequisites(app.tree).length, 0);
      const add = nodes(app.tree).find(node =>
        node.type === 'button' && text(node) === 'Add 1 selected items to project');
      assert.ok(add?.props.disabled);
      assert.deepEqual(app.requests.map(({ action }) => action), ['get']);
    } finally {
      app.dispose();
    }
  }
});
test('a new exact candidate does not replace an existing explicit reuse choice in the preview', async () => {
  const initial = fixture();
  initial.contextChanged = true;
  initial.existingTasks = [
    { id: 'chosen', title: 'Finalize activities', start: '' },
    { id: 'new-exact', title: item.title, start: '' },
  ];
  initial.draft.duplicateSuggestions = [{
    itemId: 'one', taskId: 'chosen', taskIdentity: 'finalize activities|',
    itemIdentity: JSON.stringify([item.title, item.kind, item.note, item.dueDate, item.start, item.end, item.location, item.category]),
  }];
  initial.draft.items = [
    { ...copy(item), included: false, duplicateChoice: 'reuse' },
    { ...copy(item), id: 'two', title: 'Prepare arrival', dependsOn: ['one'] },
  ];
  const app = harness(undefined, initial);
  try {
    await app.start();
    assert.match(text(app.tree), /exact match also exists.*earlier choice points to a different task/);
    const links = existingTaskLinks(app.tree);
    assert.equal(links.length, 2);
    for (const link of links) assertExistingTaskLink(link, '/project?project=p_example&task=chosen');
    assert.match(text(app.tree), /These are the current matches.*Recheck the draft/);
    assert.equal(nodes(app.tree).find(node => text(node) === 'Add 1 selected items to project' && node.type === 'button').props.disabled, true);
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
      assertExistingTaskLink(existingTaskLinks(app.tree, 'Finalize activities')[0],
        '/project?project=p_example&task=existing');
      assert.equal(existingPrerequisites(app.tree).length, 0, 'possible match is not a selected dependency until reused');
      const add = () => nodes(app.tree).find(node => node.type === 'button' && /^Add \d+ selected/.test(text(node)));
      assert.equal(add().props.disabled, true);
      await app.click(choice === 'reuse' ? 'Use existing: Finalize activities' : 'Keep separate: Confirm activities');
      // The server trims these fields; harmless whitespace must retain the choice.
      await app.edit('title-one', item.title + ' ');
      await app.edit('note-one', item.note + ' ');
      assert.equal(app.find('include-one').props.checked, choice === 'keep');
      assert.equal(!!add().props.disabled, false);
      assert.doesNotMatch(text(app.tree), /depends on unchecked/);
      const links = existingTaskLinks(existingPrerequisites(app.tree)[0]);
      if (choice === 'reuse') {
        assert.equal(links.length, 1);
        assert.equal(links[0].props['aria-label'], 'Open existing task: Finalize activities (opens in a new tab)');
        assertExistingTaskLink(links[0], '/project?project=p_example&task=existing');
      } else {
        assert.equal(links.length, 0, 'keeping separate work does not resolve to an existing task');
      }
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

test('the selected-items preview updates draft-only scheduling impacts and disappears after approval', async () => {
  const initial = fixture();
  initial.draft.source = 'starter';
  initial.draft.starterVersion = 5;
  const timed = { ...copy(item), id: 'arrival', kind: 'activity', title: 'Welcome guests', start: '2030-10-04T09:00', location: 'Fictional arrival area' };
  const untimed = { ...copy(item), id: 'cleanup', kind: 'activity', title: 'Close the venue', location: 'Fictional cleanup area' };
  const unchecked = { ...copy(untimed), id: 'unchecked', title: 'Unchecked proposal', included: false };
  const reused = { ...copy(untimed), id: 'reuse', title: 'Prepare refreshments', included: false, duplicateChoice: 'reuse' };
  initial.draft.items = [copy(item), timed, untimed, unchecked, reused];
  initial.existingTasks = [{ id: 'existing', title: 'Set up refreshments', start: '' }];
  initial.existingTaskCount = 1;
  initial.draft.duplicateSuggestions = [{ itemId: 'reuse', taskId: 'existing', taskIdentity: 'set up refreshments|',
    itemIdentity: JSON.stringify([reused.title, reused.kind, reused.note, reused.dueDate, reused.start, reused.end, reused.location, reused.category]) }];
  const app = harness(context => {
    const { input, saved } = context;
    if (input?.action === 'save') context.value = { ...saved, revision: 3, draft: { ...saved.draft, items: input.items } };
    if (input?.action === 'apply') {
      assert.deepEqual(input.items.find(row => row.id === unchecked.id), unchecked);
      assert.deepEqual(input.items.find(row => row.id === reused.id), reused);
      assert.deepEqual(input.items.filter(row => row.included).map(row => row.id), [item.id, timed.id, untimed.id]);
      context.value = { ...saved, status: 'applied', receipt: { generation: input.generation,
        approvalHash: approvalHash(input), taskIds: ['saved-one', 'saved-arrival', 'saved-cleanup'] } };
    }
  }, initial, 'project=p_example', false, true);
  const preview = () => app.find('plan-approval-impact');
  const summary = () => text(preview());
  const untimedDisclosure = () => nodes(preview()).find(node => node.type === 'details');
  const untimedTitles = () => nodes(untimedDisclosure()).filter(node => node.type === 'li').map(text);
  try {
    await app.start();
    assert.equal(preview()?.type, 'section');
    assert.match(summary(), /Selected items preview/);
    assert.ok(nodes(preview()).some(node => node.type === 'strong' && text(node) === '1 preparation task'));
    assert.match(summary(), /1 event-day activity with a start time entered/);
    assert.match(summary(), /if the time passes validation/);
    assert.match(summary(), /1 event-day activity without a start time/);
    assert.match(summary(), /Needs a start time before appearing on the timetable or run sheet/i);
    assert.match(summary(), /Locations entered without a start time go into shared task notes, not Timeline locations/);
    assert.doesNotMatch(summary(), /Fictional (?:arrival|cleanup) area|Prepare refreshments|Set up refreshments/);
    assert.match(text(untimedDisclosure()), /See activities that need a start time/);
    assert.deepEqual(untimedTitles(), [untimed.title]);

    await app.check('include-cleanup', false);
    assert.doesNotMatch(summary(), /event-day activity without a start time|go into shared task notes/);
    assert.equal(untimedDisclosure(), undefined);
    await app.edit('date-arrival', '');
    assert.match(summary(), /1 event-day activity without a start time/);
    assert.doesNotMatch(summary(), /activity with a start time entered/);
    assert.deepEqual(untimedTitles(), [timed.title]);
    await app.edit('location-arrival', '');
    assert.doesNotMatch(summary(), /go into shared task notes/);
    await app.click('Select none');
    assert.ok(preview(), 'the preview remains visible when nothing is selected');
    assert.doesNotMatch(summary(), /event-day activit|preparation tasks?\b/);
    assert.equal(planButton(app.tree, 'Add 0 selected items to project').props.disabled, true);

    await app.check('include-one', true);
    await app.check('include-arrival', true);
    await app.check('include-cleanup', true);
    assert.match(summary(), /2 event-day activities without a start time/);
    assert.deepEqual(untimedTitles(), [timed.title, untimed.title]);
    assert.equal(app.find('include-unchecked').props.checked, false);
    assert.equal(app.find('include-reuse').props.checked, false);
    assert.deepEqual(app.requests, [{ action: 'get' }], 'preview and edits do not write or call AI');
    assert.deepEqual(app.saved, initial, 'no preview or draft edit changes shared facts');

    await app.click('Add 3 selected items to project');
    assert.deepEqual(app.requests.map(row => row.action), ['get', 'save', 'apply']);
    assert.ok(app.find('plan-receipt-heading'));
    assert.equal(preview(), undefined, 'the approval preview ends once the receipt exists');
  } finally { app.dispose(); }
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
