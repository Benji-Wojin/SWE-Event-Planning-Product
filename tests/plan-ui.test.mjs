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
function harness(server, initial = fixture(), query = 'project=p_example', embedded = false, guided = false, receiptTask, receiptHandoff = true, starterPreviews) {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
    hooks: globalThis.__planHooks,
  };
  const state = [],
    timers = new Map(),
    requests = [], listeners=new Map(), parentMessages=[], focused=[], navigations=[];
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
  const body = { matches: () => false };
  globalThis.document={getElementById:()=>null,body,activeElement:body};
  globalThis.window = {
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    location:{origin:'https://weft.example',assign(href){
      let prompted = false;
      for (const listener of listeners.get('beforeunload') || []) listener({ preventDefault() { prompted = true; } });
      navigations.push({ href, prompted });
    }},
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
    tree = PlanReview({ query, embedded, guided, receiptTask, receiptHandoff, starterPreviews });
    // The hook renderer has no real DOM; attach focus refs before effects.
    for (const target of nodes(tree).filter(node => node.props?.ref && ['plan-receipt-heading', 'plan-receipt-return-status', 'plan-brief'].includes(node.props.id))) {
      target.props.ref.current = {
        focus: () => focused.push(target.props.id),
        closest: () => ({ querySelectorAll: () => nodes(tree).filter(node => node.type === 'a' && node.props['data-handoff-task']).map(node => ({
          dataset: { handoffTask: node.props['data-handoff-task'], handoffIntent: node.props['data-handoff-intent'] },
          focus: () => focused.push('task:' + node.props['data-handoff-task'] + (node.props['data-handoff-intent'] ? ':' + node.props['data-handoff-intent'] : '')),
        })) }),
      };
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
    navigations,
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

const saveAndReturn = 'Save and return to guide';
const saveDraftAndReturn = 'Save draft and return to guide';
const guidedProject = '/project?project=p_example&guide=1';
const normalizeSavedRow = row => ({ ...row, title: row.title.trim(), note: row.note.trim(), scope: (row.scope ?? '').trim(), location: row.location.trim() });
function pausedPlanResult(input, saved) {
  return { ...saved, revision: saved.revision + 1, brief: { ...input.brief, description: input.brief.description.trim() },
    draft: saved.draft ? { ...saved.draft, items: input.items.map(normalizeSavedRow) } : null };
}

test('guided pause saves the first edited brief privately and returns only after an exact acknowledgment', async () => {
  const initial = { ...fixture(), revision: 0, brief: { ...brief, description: '' }, draft: null, status: 'empty' };
  let finish;
  const app = harness(context => {
    if (context.input?.action !== 'save') return;
    return new Promise(resolve => { finish = () => {
      context.value = pausedPlanResult(context.input, context.saved);
      resolve(Response.json(context.value));
    }; });
  }, initial, 'project=p_example', false, true);
  try {
    await app.start();
    assertGuideReturn(app.tree);
    assert.equal(planButton(app.tree, saveAndReturn), undefined);
    await app.edit('plan-brief', '  Fictional first brief to pick up later.  ');
    const saving = app.click(saveAndReturn);
    await app.start();
    assert.ok(finish);
    assert.deepEqual(app.navigations, [], 'do not leave before the private save returns');
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'save', revision: 0,
      brief: { ...initial.brief, description: '  Fictional first brief to pick up later.  ' }, items: [] }]);
    finish();
    await saving;
    assert.deepEqual(app.navigations, [{ href: guidedProject, prompted: false }]);
    assert.equal(app.saved.brief.description, 'Fictional first brief to pick up later.');
    assert.equal(app.saved.draft, null);
    assert.equal(app.saved.receipt, null);
  } finally { app.dispose(); }
});

test('guided review footer saves draft edits and selection without generating or applying', async () => {
  const initial = fixture();
  initial.draft.items.push({ ...copy(item), id: 'two', title: 'Prepare signs' });
  const app = harness(context => {
    if (context.input?.action === 'save') context.value = pausedPlanResult(context.input, context.saved);
  }, initial, 'project=p_example', false, true);
  try {
    await app.start();
    await app.edit('title-one', '  Confirm the fictional venue  ');
    await app.edit('note-two', '  Keep the private edited note.  ');
    await app.check('include-two', false);
    assert.equal(planButton(app.tree, saveAndReturn)?.props.disabled, false);
    assert.equal(planButton(app.tree, saveDraftAndReturn)?.props.disabled, false);
    await app.click(saveDraftAndReturn);
    assert.deepEqual(app.requests.map(({ action }) => action), ['get', 'save']);
    assert.equal(app.requests[1].generation, initial.draft.generation);
    assert.equal(app.requests[1].revision, initial.revision);
    assert.deepEqual(app.saved.draft.items.map(({ title, note, included }) => [title, note, included]), [
      ['Confirm the fictional venue', item.note, true], ['Prepare signs', 'Keep the private edited note.', false],
    ]);
    assert.equal(app.saved.receipt, null);
    assert.deepEqual(app.navigations, [{ href: guidedProject, prompted: false }]);
  } finally { app.dispose(); }
});

test('guided pause cannot navigate after an unconfirmed or mismatched private save and keeps local edits', async () => {
  for (const scenario of ['network', 'conflict', 'revision', 'generation', 'brief', 'item', 'selection', 'applied', 'status']) {
    const initial = fixture();
    const app = harness(context => {
      if (context.input?.action !== 'save') return;
      if (scenario === 'network') throw new Error('Fictional connection lost');
      if (scenario === 'conflict') return Response.json({ error: 'Fictional draft conflict' }, { status: 409 });
      const result = pausedPlanResult(context.input, context.saved);
      if (scenario === 'revision') result.revision++;
      if (scenario === 'generation') result.draft.generation = 'different-generation';
      if (scenario === 'brief') result.brief.description = 'Fictional other-tab brief';
      if (scenario === 'item') result.draft.items[0].note = 'Fictional other-tab edit';
      if (scenario === 'selection') result.draft.items[0].included = true;
      if (scenario === 'applied') result.receipt = { taskIds: ['other-tab-task'] };
      if (scenario === 'status') result.status = 'interrupted';
      return Response.json(result);
    }, initial, 'project=p_example', false, true);
    try {
      await app.start();
      await app.edit('plan-brief', 'Keep this fictional brief.');
      await app.edit('note-one', 'Keep this fictional unsaved note.');
      await app.check('include-one', false);
      await app.click(saveAndReturn);
      assert.deepEqual(app.requests.map(({ action }) => action), ['get', 'save'], scenario);
      assert.deepEqual(app.navigations, [], scenario);
      assert.equal(app.find('plan-brief').props.value, 'Keep this fictional brief.', scenario);
      assert.equal(app.find('note-one').props.value, 'Keep this fictional unsaved note.', scenario);
      assert.equal(app.find('include-one').props.checked, false, scenario);
      const alert = nodes(app.tree).find(node => node.props.role === 'alert');
      assert.match(text(alert), /Fictional (?:connection lost|draft conflict)|couldn’t confirm this version was saved/i, scenario);
    } finally { app.dispose(); }
  }
});

test('unimported checklist text or a blank brief cannot be lost through the guided save and return shortcuts', async () => {
  for (const [field, value, editDraft, help] of [
    ['plan-pasted-checklist', '- Fictional item not yet imported', false, /Import or clear your pasted checklist/],
    ['plan-pasted-checklist', '- Fictional item and separately edited draft', true, /Import or clear your pasted checklist/],
    ['plan-brief', '   ', true, /Add a short event description/],
  ]) {
    const app = harness(undefined, fixture(), 'project=p_example', false, true);
    try {
      await app.start();
      if (editDraft) await app.edit('note-one', 'Fictional edited proposal.');
      await app.edit(field, value);
      assert.equal(planButton(app.tree, saveAndReturn)?.props.disabled, true, field);
      assert.equal(planButton(app.tree, saveDraftAndReturn)?.props.disabled, true, field);
      assert.match(text(app.find('guide-pause-help')), help);
      assert.equal(app.find(field).props.value, value);
      assert.deepEqual(app.requests, [{ action: 'get' }]);
      assert.deepEqual(app.navigations, []);
    } finally { app.dispose(); }
  }
  const plain = harness();
  try {
    await plain.start();
    await plain.edit('note-one', 'Fictional edited proposal.');
    assert.equal(planButton(plain.tree, saveAndReturn), undefined);
    assert.equal(planButton(plain.tree, saveDraftAndReturn), undefined);
  } finally { plain.dispose(); }
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
    assert.ok(nodes(starterCard(app.tree)).includes(app.find('plan-starter')), 'the guided anchor lands in the dedicated checklist card');
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

const starterPreviews = {
  school: { preparationCount: 7, activityCount: 3, sampleTitles: ['Check school accessibility', 'Prepare the school welcome desk'] },
  trip: { preparationCount: 5, activityCount: 2, sampleTitles: ['Confirm the trip pickup spots', 'Pack the trip materials'] },
  party: { preparationCount: 9, activityCount: 4, sampleTitles: ['Plan the party entrance', 'Choose the party music'] },
};
const eventBriefFieldset = tree => nodes(tree).findLast(node => node.type==='fieldset' &&
  nodes(node).some(child=>child.props?.id==='plan-brief'));
const starterCard = tree => nodes(tree).findLast(node => ['article','section'].includes(node.type) &&
  nodes(node).some(child=>child.props?.id==='plan-starter') &&
  nodes(node).some(child=>child.type==='button'&&/starter checklist/.test(text(child))));

test('the full planner leads with a separate no-AI starter checklist and one shared event type',async()=>{
  const initial={...fixture(),draft:null,status:'empty',brief:{...brief,description:''}};
  const active=harness(context=>{
    if(context.input?.action!=='starter')return;
    assert.deepEqual(context.input.brief,{...initial.brief,kind:'party',description:'Example event'});
    assert.equal(context.input.revision,initial.revision);
    assert.equal(context.input.workspaceRevision,initial.workspaceRevision);
    assert.equal(context.input.replace,false);
    assert.equal(context.input.includeActivities,true);
    assert.ok(context.input.requestId);
    context.value={...context.saved,revision:3,status:'ready',brief:context.input.brief,
      draft:{...fixture().draft,source:'starter',brief:context.input.brief}};
  },initial,'project=p_example',false,false,undefined,true,starterPreviews);
  try{
    await active.start();
    const ordered=nodes(active.tree);
    const kind=active.find('plan-kind'), ai=eventBriefFieldset(active.tree), starter=starterCard(active.tree);
    assert.ok(starter,'the starter checklist is a distinct card');
    assert.ok(ai,'the optional AI brief remains available');
    assert.equal(kind?.type,'select');
    assert.equal(ordered.filter(node=>node.props?.id==='plan-kind').length,1);
    assert.ok(nodes(starter).includes(kind),'the shared event type is visible next to the starter options');
    assert.ok(!nodes(ai).includes(kind),'the shared event type is not duplicated inside the AI brief');
    assert.ok(ordered.indexOf(starter)<ordered.indexOf(ai),'the starter checklist comes before the optional brief');
    assert.ok(planButton(starter,'Use starter checklist'));
    assert.ok(planButton(ai,'Generate draft'));
    assert.match(text(active.tree),/Draft with AI \(optional\)/);
    assert.match(text(starter),/No AI call or AI quota is used/);
    assert.doesNotMatch(text(starter),/Groq|Generate draft/);
    assert.match(text(ai),/Groq/);

    await active.check('starter-activities',true);
    for(const [kind,preview] of Object.entries(starterPreviews)){
      if(kind!==initial.brief.kind)await active.edit('plan-kind',kind);
      const card=starterCard(active.tree), copy=text(card);
      const count=nodes(card).find(node=>node.props?.role==='status');
      assert.equal(active.find('plan-kind').props.value,kind);
      assert.equal(text(count),preview.preparationCount+' preparation tasks · '+preview.activityCount+' optional event-day activities');
      for(const example of preview.sampleTitles)assert.ok(copy.includes(example),example);
      for(const other of Object.keys(starterPreviews).filter(value=>value!==kind)){
        for(const example of starterPreviews[other].sampleTitles)assert.ok(!copy.includes(example),example);
      }
      assert.deepEqual(active.requests.map(row=>row.action),['get'],'preview controls send no requests');
      assert.deepEqual(active.saved,initial);
    }
    await active.click('Use starter checklist');
    assert.deepEqual(active.requests.map(row=>row.action),['get','starter']);
    assert.match(text(active.tree),/no shared tasks were added/);
    assert.equal(planLink(active.tree,'Jump to proposed items')?.props.href,'#plan-proposed-items');
    assert.equal(planLink(starterCard(active.tree),'Review your saved checklist')?.props.href,'#plan-proposed-items');
    assert.equal(active.find('plan-proposed-items')?.props.tabIndex,-1);
    assert.equal(active.saved.receipt,null);
  }finally{active.dispose();}
});

test('suggestion mode keeps its event type in its own brief and never exposes the starter card',async()=>{
  const active=harness(undefined,{...fixture(),draft:null,status:'empty'},'project=p_example&mode=suggestions',false,false,undefined,true,starterPreviews);
  try{
    await active.start();
    const ordered=nodes(active.tree);
    const kind=active.find('plan-kind'), ai=eventBriefFieldset(active.tree);
    assert.equal(ordered.filter(node=>node.props?.id==='plan-kind').length,1);
    assert.ok(nodes(ai).includes(kind));
    assert.equal(active.find('plan-starter'),undefined);
    assert.equal(active.find('starter-activities'),undefined);
    assert.equal(starterCard(active.tree),undefined);
    assert.ok(planButton(ai,'Find next steps with AI'));
    const saved=copy(active.saved);
    await active.edit('plan-kind','trip');
    assert.equal(active.find('plan-kind').props.value,'trip');
    assert.deepEqual(active.requests.map(row=>row.action),['get']);
    assert.deepEqual(active.saved,saved);
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
  try{
    await active.start();
    const saved=copy(active.saved);
    await active.edit('plan-kind','trip');
    globalThis.window.confirm=message=>{
      assert.match(message,/Replace the saved private draft/);
      return false;
    };
    await active.click('Replace with starter checklist');
    assert.equal(active.find('plan-kind').props.value,'trip');
    assert.deepEqual(active.requests.map(r=>r.action),['get']);
    assert.deepEqual(active.saved,saved);
  }
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
    next.receiptTasks[0].scheduleDay=reads===4?'2030-10-05':'2030-10-04';
    if(reads===3)next.receiptTasks[1].needsStartTime=true;
    else {
      delete next.receiptTasks[1].needsStartTime;
      next.receiptTasks[1].scheduleDay='2030-10-06';
    }
    context.value=next;
  },initial,'project=p_school',false,true);
  const receipt=()=>nodes(app.tree).find(node=>node.props?.['aria-labelledby']==='plan-receipt-heading');
  const link=label=>nodes(receipt()).find(node=>node.type==='a'&&text(node)===label);
  const timelineLinks=()=>nodes(receipt()).filter(node=>node.type==='a'&&text(node)==='Show in Timeline').map(node=>node.props.href);
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
      '/project?project=p_school&task=one&guide=1&review=schedule&from=plan-receipt',
      '/project?project=p_school&task=two&guide=1&review=schedule&from=plan-receipt',
    ]);
    assert.deepEqual(timelineLinks(),[]);
    await app.click('Refresh task handoff');
    assert.match(text(app.tree),/Could not confirm the latest handoff/);
    assert.equal(tagged().length,2);
    assert.deepEqual(timelineLinks(),[],'regressed workspace cannot add row shortcuts');
    await app.click('Refresh task handoff');
    assert.match(text(receipt()),/1 activity needs a start time.*before it can appear on the run sheet/);
    assert.equal(tagged().length,1);
    assert.deepEqual(nodes(receipt()).filter(node=>node.type==='a'&&text(node)==='Set start time').map(node=>node.props['aria-label']),['Set start time for Fictional cleanup']);
    assert.deepEqual(timelineLinks(),['/project?project=p_school&activity=one&guide=1']);
    await app.click('Refresh task handoff');
    assert.equal(tagged().length,0);
    assert.equal(link('Set start time'),undefined);
    assert.deepEqual(timelineLinks(),[
      '/project?project=p_school&activity=one&guide=1',
      '/project?project=p_school&activity=two&guide=1',
    ],'the moved activity keeps its stable target, and the newly scheduled row gets its own');
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

test('return to a plan receipt focuses the exact current primary task row, not a matching title or secondary action', async () => {
  const initial = { ...fixture(), status: 'applied', receipt: { taskIds: ['same-title', 'task-return'] }, receiptTasks: [
    { id: 'same-title', title: 'Fictional reception', handoff: { state: 'needs-owner' } },
    { id: 'task-return', title: 'Fictional reception', needsStartTime: true, handoff: { state: 'needs-owner' } },
  ] };
  const urls = [];
  const app = harness(({ url }) => { urls.push(url); }, initial, 'project=p_example', false, true, 'task-return');
  try {
    await app.start();
    assert.deepEqual(app.focused, ['task:task-return']);
    assert.equal(nodes(app.tree).filter(node => node.type === 'a' && node.props['data-handoff-task'] === 'task-return').length, 2);
    assert.equal(planLink(app.tree, 'Return to your guide')?.props.href, guidedProject);
    assert.doesNotMatch(text(app.tree), /no longer (?:in|available)/);
    await app.start();
    assert.deepEqual(app.focused, ['task:task-return'], 'exact return focus is one-shot');
    assert.deepEqual(app.requests, [{ action: 'get' }]);
    assert.deepEqual(urls, ['/api/plan?project=p_example']);
  } finally { app.dispose(); }
});

test('plan receipt returns distinguish a deleted member task from an unrelated or missing receipt', async () => {
  const existing = { id: 'other', title: 'Different task', handoff: { state: 'needs-owner' } };
  for (const [variant, receipt, receiptTasks, focus, notice] of [
    ['deleted member', { taskIds: ['other', 'task-return'] }, [existing], ['plan-receipt-heading'], /This task is no longer available in the project/],
    ['not a member', { taskIds: ['other'] }, [existing], ['plan-receipt-return-status'], /This task is no longer in the current plan receipt/],
    ['inconsistent live row without membership', { taskIds: ['other'] }, [existing, { ...existing, id: 'task-return' }], ['plan-receipt-return-status'], /This task is no longer in the current plan receipt/],
    ['no receipt', null, [], ['plan-receipt-return-status'], /This task is no longer in the current plan receipt/],
  ]) {
    const initial = { ...fixture(), status: receipt ? 'applied' : 'ready', receipt, receiptTasks };
    const app = harness(undefined, initial, 'project=p_example', false, false, 'task-return');
    try {
      await app.start();
      assert.deepEqual(app.focused, focus, variant);
      assert.match(text(app.tree), notice, variant);
      assert.deepEqual(app.requests, [{ action: 'get' }], variant);
    } finally { app.dispose(); }
  }
});

test('a synthesized main-project query cannot opt in to a standalone receipt handoff', async () => {
  const initial = { ...fixture(), status: 'applied', receipt: { taskIds: ['task-return'] }, receiptTasks: [
    { id: 'task-return', title: 'Fictional reception', needsStartTime: true, handoff: { state: 'needs-owner' } },
  ] };
  const app = harness(undefined, initial, 'project=main', false, false, 'task-return', false);
  try {
    await app.start();
    const task = planLink(app.tree, 'Fictional reception');
    assert.equal(task?.props.href, '/project?project=main&task=task-return&review=owner');
    assert.equal(planLink(app.tree, 'Set start time')?.props.href, '/project?project=main&task=task-return&review=schedule');
    assert.deepEqual(app.focused, []);
    assert.equal(app.find('plan-receipt-return-status'), undefined);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
  } finally { app.dispose(); }
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
        namesById.get(id),'/project?project=p_school&task='+id+'&guide=1'+(group==='Assign an owner'?'&review=owner&from=plan-receipt':group==='Review completion'?(id==='task-amended'?'&review=amendment':'&review=completion'):''),
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
          (guided && hint ? '&guide=1' : '') + (hint && index < 2 ? '&review=owner&from=plan-receipt' : ''),
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
          assert.equal(task?.props.href, base + id + suffix + '&review=' + review + (review === 'owner' ? '&from=plan-receipt' : ''));
          assert.equal(task.props['data-handoff-task'], id);
          assert.equal(schedule?.props.href, base + id + suffix + '&review=schedule&from=plan-receipt');
          assert.equal(schedule.props['data-handoff-task'], id);
          assert.equal(schedule.props['data-handoff-intent'], 'schedule', 'secondary link retains its distinct focus intent');
          assert.equal(schedule.props.onClick, undefined);
        }
      }
      assert.deepEqual(app.requests, [{ action: 'get' }]);
    } finally { app.dispose(); }
  }
});

test('scheduled receipt shortcuts target the exact activity without replacing task review links', async () => {
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
      { id: 'welcome', title: 'Welcome desk', scheduleDay: '2030-10-04', handoff: { state: 'needs-owner' } },
      { id: 'rehearsal', title: 'Run rehearsal', scheduleDay: '2030-10-05', handoff: { state: 'needs-review' } },
      { id: 'amendment', title: 'Check venue handback', scheduleDay: '2030-10-06', handoff: { state: 'needs-amendment-review' } },
      { id: 'untimed', title: 'Unscheduled activity', needsStartTime: true, handoff: { state: 'accepted' } },
      { id: 'prep', title: 'Review the checklist', handoff: { state: 'complete' } },
      { id: 'bad-day', title: 'Invalid date', scheduleDay: '2030-02-30', handoff: { state: 'accepted' } },
      { id: 'bad task', title: 'Invalid task ID', scheduleDay: '2030-10-04', handoff: { state: 'accepted' } },
    ];
    initial.receipt = { taskIds: initial.receiptTasks.map(task => task.id) };
    const app = harness(undefined, initial, query, embedded, guided);
    try {
      await app.start();
      const links = nodes(app.tree).filter(node => node.type === 'a' && text(node) === 'Show in Timeline');
      assert.equal(links.length, shortcut ? 3 : 0, `${query}, embedded=${embedded}, guided=${guided}`);
      if (shortcut) {
        const suffix = guided ? '&guide=1' : '';
        for (const [id, title, review] of [
          ['welcome', 'Welcome desk', 'owner'],
          ['rehearsal', 'Run rehearsal', 'completion'],
          ['amendment', 'Check venue handback', 'amendment'],
        ]) {
          const task = planLink(app.tree, title);
          const timeline = links.find(node => node.props['aria-label'] === `Show ${title} in Timeline`);
          assert.equal(task?.props.href, '/project?project=p_school&task=' + id + suffix + '&review=' + review + (review === 'owner' ? '&from=plan-receipt' : ''));
          assert.equal(task.props['data-handoff-task'], id);
          assert.equal(timeline?.props.href, '/project?project=p_school&activity=' + id + suffix);
          assert.equal(timeline.props['data-handoff-task'], id);
          assert.equal(timeline.props['data-handoff-intent'], 'timeline');
          assert.equal(timeline.props.onClick, undefined);
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

function sharedPrerequisiteReferencesFixture() {
  const initial = fixture();
  const exact = { ...copy(item), included: false };
  const alias = { ...exact, id: 'alias', title: 'Confirm the event program', duplicateChoice: 'reuse' };
  const supplies = { ...exact, id: 'supplies', title: 'Reserve volunteer supplies' };
  initial.existingTasks = [
    { id: 'saved-program', title: exact.title, start: '' },
    { id: 'saved-supplies', title: supplies.title, start: '' },
  ];
  initial.draft.duplicateSuggestions = [{
    itemId: alias.id,
    taskId: 'saved-program',
    taskIdentity: 'confirm activities|',
    itemIdentity: JSON.stringify([alias.title, alias.kind, alias.note, alias.dueDate, alias.start, alias.end, alias.location, alias.category]),
  }];
  initial.draft.items = [exact, alias, supplies,
    { ...copy(item), id: 'arrival', title: 'Prepare arrival', dependsOn: [exact.id, supplies.id, alias.id] },
    { ...copy(item), id: 'hosts', title: 'Brief hosts', dependsOn: [alias.id, exact.id] },
  ];
  return initial;
}

test('two private references to the same shared prerequisite appear as one link per dependent and can be removed together', async () => {
  const initial = sharedPrerequisiteReferencesFixture();
  const app = harness(undefined, initial, 'project=p_school', false, true);
  const groupFor = id => {
    const card = nodes(app.tree).find(node => node.type === 'article' && nodes(node).includes(app.find('include-' + id)));
    return existingPrerequisites(card)[0];
  };
  const groupLinks = id => existingTaskLinks(groupFor(id)).map(link => link.props.href);
  const add = () => planButton(app.tree, 'Add 2 selected items to project');
  try {
    await app.start();
    assert.equal(existingPrerequisites(app.tree).length, 2);
    assert.deepEqual(groupLinks('arrival'), [
      '/project?project=p_school&task=saved-program&guide=1',
      '/project?project=p_school&task=saved-supplies&guide=1',
    ]);
    assert.deepEqual(groupLinks('hosts'), ['/project?project=p_school&task=saved-program&guide=1']);
    for (const id of ['arrival', 'hosts']) {
      assert.match(text(groupFor(id)), /2 draft references point to this task\./i);
      assert.match(text(groupFor(id)), /One required link will be added\./i);
      assertExistingTaskLink(existingTaskLinks(groupFor(id), item.title)[0],
        '/project?project=p_school&task=saved-program&guide=1');
    }
    assert.equal(add().props.disabled, false, 'reusing one shared task through two draft references does not block approval');

    await app.edit('note-arrival', 'Keep this private arrival note.');
    const removals = nodes(groupFor('arrival')).filter(node => node.type === 'button' &&
      node.props['aria-label'] === `Remove link to prerequisite: ${item.title}`);
    assert.equal(removals.length, 1);
    const button = {}, focus = [];
    globalThis.document.activeElement = button;
    globalThis.document.getElementById = id => ({ focus: options => focus.push({ id, options }) });
    await removals[0].props.onClick({ currentTarget: button });
    await app.start();
    assert.deepEqual(focus, [{ id: 'include-arrival', options: { preventScroll: true } }]);
    assert.deepEqual(groupLinks('arrival'), ['/project?project=p_school&task=saved-supplies&guide=1']);
    assert.deepEqual(groupLinks('hosts'), ['/project?project=p_school&task=saved-program&guide=1']);
    for (const [id, checked] of [
      ['arrival:one', false], ['arrival:alias', false], ['arrival:supplies', true],
      ['hosts:one', true], ['hosts:alias', true],
    ]) assert.equal(app.find('required-' + id).props.checked, checked, id);
    assert.equal(app.find('note-arrival').props.value, 'Keep this private arrival note.');
    assert.equal(add().props.disabled, false);
    assert.deepEqual(app.requests, [{ action: 'get' }], 'previewing and removing a grouped link do not write');
    assert.deepEqual(app.saved, initial);
  } finally { app.dispose(); }
});

test('grouped prerequisite matches do not override stale-draft recheck', async () => {
  const initial = sharedPrerequisiteReferencesFixture();
  initial.contextChanged = true;
  const app = harness(undefined, initial);
  try {
    await app.start();
    const groups = existingPrerequisites(app.tree);
    assert.equal(groups.length, 2);
    assert.match(text(app.tree), /These are the current matches.*Recheck the draft/i);
    for (const group of groups) {
      assert.equal(existingTaskLinks(group, item.title).length, 1);
      assert.doesNotMatch(text(group), /One required link will be added\./i);
    }
    assert.equal(planButton(app.tree, 'Add 2 selected items to project').props.disabled, true);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
  } finally { app.dispose(); }
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

test('draft prerequisite choices stop direct and indirect loops, including through unchecked and reused proposals', async () => {
  const initial = fixture();
  const reused = { ...copy(item), id: 'venue', title: 'Review the venue options', included: false,
    duplicateChoice: 'reuse', dependsOn: ['contract'] };
  const unchecked = { ...copy(item), id: 'contract', title: 'Inspect the draft contract', included: false, dependsOn: ['one'] };
  initial.draft.items.push(reused, unchecked);
  initial.existingTasks = [{ id: 'shared-venue', title: 'Finalize venue options', start: '' }];
  initial.draft.duplicateSuggestions = [{ itemId: reused.id, taskId: 'shared-venue', taskIdentity: 'finalize venue options|',
    itemIdentity: JSON.stringify([reused.title, reused.kind, reused.note, reused.dueDate, reused.start, reused.end, reused.location, reused.category]) }];
  const app = harness(context => {
    const { input, saved } = context;
    if (input?.action === 'save') context.value = pausedPlanResult(input, saved);
    if (input?.action === 'apply') context.value = { ...saved, status: 'applied', receipt: {
      generation: input.generation, approvalHash: approvalHash(input), taskIds: ['added-program'],
    } };
  }, initial);
  const checkbox = id => app.find('required-' + id);
  const choiceText = id => {
    const field = checkbox(id);
    const label = nodes(app.tree).find(node => node.type === 'label' && (nodes(node).includes(field) || node.props.htmlFor === field.props.id));
    const descriptions = (field.props['aria-describedby'] ?? '').split(/\s+/).filter(Boolean).map(id => text(app.find(id)));
    return [text(label), ...descriptions].join(' ');
  };
  try {
    await app.start();
    assert.equal(app.find('include-venue').props.checked, false);
    assert.equal(app.find('include-contract').props.checked, false);
    for (const id of ['one:contract', 'one:venue']) {
      assert.equal(checkbox(id).props.disabled, true, id);
      assert.match(choiceText(id), /would create a loop/i);
      assert.match(text(app.find(checkbox(id).props['aria-describedby'])), /would create a loop/i,
        'the disabled option exposes its reason through an accessible description');
      // The harness dispatches the handler directly; even that must not add a disabled choice.
      await app.check('required-' + id, true);
      assert.equal(checkbox(id).props.checked, false, id);
    }
    assert.equal(!!checkbox('contract:one').props.disabled, false, 'the existing edge can be removed');
    await app.check('required-contract:one', false);
    assert.equal(checkbox('contract:one').props.checked, false);
    assert.equal(!!checkbox('one:venue').props.disabled, false, 'removing one edge reopens the indirect path');
    assert.equal(!!checkbox('one:contract').props.disabled, false, 'removing one edge reopens the direct choice');
    assert.doesNotMatch(choiceText('one:venue'), /would create a loop/i);
    await app.check('required-one:venue', true);
    assert.equal(checkbox('one:venue').props.checked, true);
    assert.equal(checkbox('venue:contract').props.checked, true, 'the other private link was not changed');
    assert.deepEqual(app.requests, [{ action: 'get' }]);
    assert.deepEqual(app.saved, initial);

    await app.click('Add 1 selected items to project');
    assert.deepEqual(app.requests.map(row => row.action), ['get', 'save', 'apply']);
    for (const request of app.requests.slice(1)) {
      assert.deepEqual(request.items.map(row => [row.id, row.dependsOn]), [
        ['one', ['venue']], ['venue', ['contract']], ['contract', []],
      ]);
      assert.equal(request.items.find(row => row.id === 'venue').duplicateChoice, 'reuse');
    }
    assert.ok(app.find('plan-receipt-heading'));
  } finally { app.dispose(); }
});

test('the draft prerequisite limit allows an existing choice to be removed and replaced before saving', async () => {
  const initial = fixture();
  const candidates = Array.from({ length: 9 }, (_, index) => ({
    ...copy(item), id: `candidate-${index + 1}`, title: `Check arrangement ${index + 1}`,
  }));
  initial.draft.items[0].dependsOn = candidates.slice(0, 7).map(row => row.id);
  initial.draft.items.push(...candidates);
  const app = harness(context => {
    if (context.input?.action === 'save') context.value = pausedPlanResult(context.input, context.saved);
  }, initial);
  const checkbox = n => app.find(`required-one:candidate-${n}`);
  const details = () => nodes(app.tree).find(node => node.type === 'details' && nodes(node).includes(checkbox(9)));
  try {
    await app.start();
    assert.match(text(details()), /7 of 8 draft prerequisites selected/i);
    assert.equal(!!checkbox(8).props.disabled, false);
    const previouslyAllowedNinthChange = checkbox(9).props.onChange;
    await app.check('required-one:candidate-8', true);
    assert.match(text(details()), /8 of 8 draft prerequisites selected/i);
    assert.match(text(details()), /remove .*first|remove .*before (?:adding|selecting)/i);
    assert.equal(checkbox(9).props.disabled, true, 'a ninth reference cannot be added');
    assert.match(text(app.find(checkbox(9).props['aria-describedby'])), /8 of 8 draft prerequisites selected/i);
    await app.check('required-one:candidate-9', true);
    assert.equal(checkbox(9).props.checked, false);
    previouslyAllowedNinthChange({ target: { checked: true } });
    await app.start();
    assert.equal(checkbox(9).props.checked, false, 'an earlier render cannot bypass the current draft limit');
    assert.equal(!!checkbox(1).props.disabled, false, 'a selected reference can be removed at the cap');
    await app.check('required-one:candidate-1', false);
    assert.match(text(details()), /7 of 8 draft prerequisites selected/i);
    assert.equal(!!checkbox(9).props.disabled, false);
    await app.check('required-one:candidate-9', true);
    assert.equal(checkbox(9).props.checked, true);
    assert.match(text(details()), /8 of 8 draft prerequisites selected/i);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
    assert.deepEqual(app.saved, initial);

    await app.click('Save draft');
    assert.deepEqual(app.requests.map(row => row.action), ['get', 'save']);
    assert.deepEqual(app.requests[1].items[0].dependsOn, candidates.slice(1).map(row => row.id));
    assert.deepEqual(app.saved.draft.items[0].dependsOn, candidates.slice(1).map(row => row.id));
    assert.equal(app.saved.workspaceRevision, initial.workspaceRevision, 'private save does not update shared tasks');
  } finally { app.dispose(); }
});

test('prerequisite option names and descriptions stay unique with similarly named draft IDs', async () => {
  const initial = fixture();
  initial.draft.items.push(
    { ...copy(item), id: 'contract', title: 'Check the contract', dependsOn: ['one'] },
    { ...copy(item), id: 'contract-label', title: 'Prepare the folder' },
    { ...copy(item), id: 'loop-one', title: 'Open the room' },
  );
  const app = harness(undefined, initial);
  try {
    await app.start();
    const choice = app.find('required-one:contract');
    const editorIds = nodes(app.tree).map(node => node.props?.id).filter(id => id?.includes(':') && /^(required-|prerequisite-)/.test(id));
    assert.equal(new Set(editorIds).size, editorIds.length);
    assert.equal(text(app.find(choice.props['aria-labelledby'])), 'Check the contract');
    assert.match(text(app.find(choice.props['aria-describedby'])), /Would create a loop/);
  } finally { app.dispose(); }
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
  const untimedTitles = () => nodes(untimedDisclosure()).filter(node => node.type === 'li').map(row =>
    text([row.props.children].flat().find(child => child?.type === 'span')));
  const startActions = () => nodes(untimedDisclosure()).filter(node => node.type === 'button' && text(node) === 'Set start time');
  try {
    await app.start();
    assert.equal(preview()?.type, 'section');
    assert.match(summary(), /Selected items preview/);
    assert.ok(nodes(preview()).some(node => node.type === 'strong' && text(node) === '1 preparation task'));
    assert.match(summary(), /1 event-day activity with a start time entered/);
    assert.match(summary(), /Timeline timetable and run sheet/);
    assert.doesNotMatch(summary(), /if the time passes validation/);
    assert.match(summary(), /1 event-day activity without a start time/);
    assert.match(summary(), /Needs a start time before appearing on the timetable or run sheet/i);
    assert.match(summary(), /Locations entered without a start time go into shared task notes, not Timeline locations/);
    assert.doesNotMatch(summary(), /Fictional (?:arrival|cleanup) area|Prepare refreshments|Set up refreshments/);
    assert.match(text(untimedDisclosure()), /See activities that need a start time/);
    assert.deepEqual(untimedTitles(), [untimed.title]);
    assert.deepEqual(startActions().map(action => action.props['aria-label']), ['Set start time for Close the venue (item 3)']);

    await app.check('include-cleanup', false);
    assert.doesNotMatch(summary(), /event-day activity without a start time|go into shared task notes/);
    assert.equal(untimedDisclosure(), undefined);
    await app.edit('date-arrival', '');
    assert.match(summary(), /1 event-day activity without a start time/);
    assert.doesNotMatch(summary(), /activity with a start time entered/);
    assert.deepEqual(untimedTitles(), [timed.title]);
    assert.deepEqual(startActions().map(action => action.props['aria-label']), ['Set start time for Welcome guests (item 2)']);
    await app.edit('location-arrival', '');
    assert.doesNotMatch(summary(), /go into shared task notes/);
    await app.click('Select none');
    assert.ok(preview(), 'the preview remains visible when nothing is selected');
    assert.doesNotMatch(summary(), /event-day activit|preparation tasks?\b/);
    assert.deepEqual(startActions(), []);
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

const scheduleSummary = app => text(app.find('plan-approval-impact'));
const scheduleFixes = app => nodes(app.find('plan-approval-impact')).filter(node =>
  node.type === 'button' && /^Fix (start|end) time for /.test(node.props['aria-label'] || ''));
const disabledApproval = (app, count) => Boolean(planButton(app.tree, `Add ${count} selected items to project`).props.disabled);
function assertScheduleError(app, proposal, field, message) {
  const input = app.find(`${field === 'start' ? 'date' : 'end'}-${proposal}`);
  const errorId = `schedule-${field}-error-${proposal}`;
  assert.equal(String(input.props['aria-invalid']), 'true');
  assert.ok(input.props['aria-describedby']?.split(/\s+/).includes(errorId));
  assert.match(text(app.find(errorId)), message);
}

test('approval separates valid times from daylight-saving errors and never saves them on a blocked approval', async () => {
  const initial = fixture();
  initial.event.timeZone = 'America/Los_Angeles';
  const gap = { ...copy(item), id: 'gap', kind: 'activity', title: 'Open doors', start: '2030-03-10T02:15' };
  const repeatedEnd = { ...gap, id: 'repeated-end', start: '2030-11-03T00:30', end: '2030-11-03T01:15' };
  const valid = { ...gap, id: 'valid', title: 'Review room setup', start: '2030-10-04T09:00' };
  initial.draft.items = [gap, repeatedEnd, valid];
  const app = harness(context => {
    const { input, saved } = context;
    if (input?.action === 'save') {
      context.value = { ...saved, revision: 3, draft: { ...saved.draft, items: input.items } };
    } else if (input?.action === 'apply') {
      assert.deepEqual(input.items.filter(row => row.included).map(row => [row.id, row.start, row.end]), [
        [repeatedEnd.id, repeatedEnd.start, '2030-11-03T02:15'], [valid.id, valid.start, valid.end],
      ]);
      context.value = { ...saved, status: 'applied', receipt: { generation: input.generation,
        approvalHash: approvalHash(input), taskIds: ['added-doors', 'added-room'] } };
    }
  }, initial, 'project=p_example', true);
  try {
    await app.start();
    assert.match(scheduleSummary(app), /Review activity times before adding items/i);
    assert.match(scheduleSummary(app), /\b1 event-day activity with a start time/);
    assertScheduleError(app, gap.id, 'start', /does not exist/i);
    assertScheduleError(app, repeatedEnd.id, 'end', /occurs twice/i);
    assert.deepEqual(scheduleFixes(app).map(node => node.props['aria-label']), [
      'Fix start time for Open doors (item 1)', 'Fix end time for Open doors (item 2)',
    ]);
    assert.equal(disabledApproval(app, 3), true);

    const inputId = 'end-' + repeatedEnd.id;
    const renderedInput = app.find(inputId);
    assert.ok(nodes(app.tree).some(node => node.type === 'details' && node.props['data-plan-item-details'] && nodes(node).includes(renderedInput)),
      'the affected end time sits inside its item details disclosure');
    const editor = { open: false };
    let focused = false;
    globalThis.document.getElementById = id => id === inputId ? {
      localName: 'input', type: app.find(inputId).props.type,
      matches: () => false,
      closest: selector => selector === 'details[data-plan-item-details]' ? editor : null,
      focus() {
        assert.equal(editor.open, true, 'the end-time details open before moving focus');
        focused = true;
      },
      scrollIntoView() {},
    } : null;
    const fixEnd = scheduleFixes(app)[1];
    assert.equal(fixEnd.props.type, 'button');
    fixEnd.props.onClick();
    assert.equal(focused, true, 'the button targets this proposal’s end time, not the identical title’s start');
    await app.edit(inputId, '2030-11-03T02:15');
    assert.equal(app.find('schedule-end-error-' + repeatedEnd.id), undefined);
    assert.notEqual(String(app.find(inputId).props['aria-invalid']), 'true');
    assert.equal(disabledApproval(app, 3), true, 'the other selected item still has an invalid time');

    await app.check('include-' + gap.id, false);
    assert.doesNotMatch(scheduleSummary(app), /Review activity times before adding items/i);
    assert.deepEqual(scheduleFixes(app), []);
    assert.equal(disabledApproval(app, 2), false, 'an unchecked DST-invalid item is not going into the timetable');
    assert.deepEqual(app.requests, [{ action: 'get' }], 'reporting, focusing and correcting private fields never save or apply');
    assert.deepEqual(app.saved, initial);
    await app.click('Add 2 selected items to project');
    assert.deepEqual(app.requests.map(request => request.action), ['get', 'save', 'apply']);
    assert.ok(app.find('plan-receipt-heading'));
  } finally { app.dispose(); }
});

test('missing project time zone blocks timed approval but an organizer can leave an activity unscheduled', async () => {
  const initial = fixture();
  initial.event.timeZone = '';
  const activity = { ...copy(item), id: 'arrival', kind: 'activity', title: 'Welcome guests', start: '2030-10-04T09:00', end: '2030-10-04T09:30' };
  initial.draft.items = [activity];
  const app = harness(undefined, initial);
  try {
    await app.start();
    assert.equal(disabledApproval(app, 1), true);
    assert.match(scheduleSummary(app), /time zone.*Project settings|Project settings.*time zone/i);
    assertScheduleError(app, activity.id, 'start', /time zone/i);
    assert.deepEqual(scheduleFixes(app).map(node => node.props['aria-label']), ['Fix start time for Welcome guests (item 1)']);

    await app.edit('date-' + activity.id, '');
    assert.equal(app.find('end-' + activity.id).props.value, '', 'clearing the start also clears the end');
    assert.match(scheduleSummary(app), /1 event-day activity without a start time/);
    assert.doesNotMatch(scheduleSummary(app), /Review activity times before adding items/i);
    assert.equal(disabledApproval(app, 1), false);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
  } finally { app.dispose(); }
});

test('an end before its start or without a start must be corrected even in an unchecked private item', async () => {
  const initial = fixture();
  const order = { ...copy(item), id: 'order', kind: 'activity', title: 'Open the foyer', start: '2030-10-04T09:00', included: false };
  const orphanEnd = { ...order, id: 'orphan-end', title: 'Host welcome', start: '' };
  initial.draft.items = [copy(item), order, orphanEnd];
  const app = harness(undefined, initial, 'project=p_example', false, true);
  try {
    await app.start();
    assert.equal(disabledApproval(app, 1), false);
    await app.edit('end-' + order.id, '2030-10-04T09:00');
    await app.edit('end-' + orphanEnd.id, '2030-10-04T09:30');
    assert.equal(app.find('include-' + order.id).props.checked, false);
    assert.equal(app.find('include-' + orphanEnd.id).props.checked, false);
    assert.equal(disabledApproval(app, 1), true);
    assert.equal(planButton(app.tree, saveDraftAndReturn).props.disabled, true, 'the whole draft must be valid before pausing the guide');
    assertScheduleError(app, order.id, 'end', /after.*start|later.*start/i);
    assertScheduleError(app, orphanEnd.id, 'end', /start/i);
    assert.match(scheduleSummary(app), /Review activity times before adding items/i);
    assert.deepEqual(scheduleFixes(app).map(node => node.props['aria-label']), [
      'Fix end time for Open the foyer (item 2)', 'Fix end time for Host welcome (item 3)',
    ]);
    await app.edit('end-' + order.id, '2030-10-04T09:30');
    assert.equal(disabledApproval(app, 1), true);
    await app.edit('end-' + orphanEnd.id, '');
    assert.equal(disabledApproval(app, 1), false);
    assert.equal(planButton(app.tree, saveDraftAndReturn).props.disabled, false);
    assert.deepEqual(scheduleFixes(app), []);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
  } finally { app.dispose(); }
});

test('approval preview start-time shortcuts identify exact private activities, even with duplicate titles', async () => {
  const initial = fixture();
  const activity = { ...copy(item), id: 'activity-one', kind: 'activity', title: 'Open doors' };
  const other = { ...activity, id: 'activity-two' };
  initial.draft.items = [copy(item), activity, other];
  const app = harness(undefined, initial, 'project=p_example', false, true);
  const actions = () => nodes(app.find('plan-approval-impact')).filter(node =>
    node.type === 'button' && text(node) === 'Set start time');
  try {
    await app.start();
    assert.deepEqual(actions().map(action => action.props['aria-label']), [
      'Set start time for Open doors (item 2)', 'Set start time for Open doors (item 3)',
    ]);
    assert.ok(actions().every(action => action.props.type === 'button'));
    const operations = [];
    const fields = new Map([activity, other].map(proposal => {
      const id = 'date-' + proposal.id;
      const rendered = app.find(id);
      const editor = nodes(app.tree).find(node => node.type === 'details' && nodes(node).includes(rendered));
      assert.ok(editor?.props['data-plan-owner-date']);
      const disclosure = { open: false };
      return [id, {
        localName: rendered.type,
        type: rendered.props.type,
        matches: selector => {
          assert.equal(selector, ':disabled');
          return false;
        },
        closest: selector => {
          assert.equal(selector, 'details[data-plan-owner-date]');
          return disclosure;
        },
        focus: options => {
          assert.equal(disclosure.open, true, 'opens this activity editor before moving focus');
          operations.push({ id, op: 'focus', options });
        },
        scrollIntoView: options => operations.push({ id, op: 'scroll', options }),
      }];
    }));
    globalThis.document.getElementById = id => fields.get(id) ?? null;
    const setSecond = actions()[1];
    assert.equal(app.find('date-activity-two').props['aria-label'], 'Activity start for Open doors (item 3)');
    setSecond.props.onClick();
    assert.deepEqual(operations, [
      { id: 'date-activity-two', op: 'focus', options: { preventScroll: true } },
      { id: 'date-activity-two', op: 'scroll', options: { block: 'center', inline: 'nearest' } },
    ]);
    assert.deepEqual(app.requests, [{ action: 'get' }], 'moving focus is not a request');
    await app.edit('date-activity-two', '2030-10-04T10:30');
    assert.equal(app.find('date-activity-one').props.value, '');
    assert.equal(app.find('date-activity-two').props.value, '2030-10-04T10:30');
    assert.deepEqual(actions().map(action => action.props['aria-label']), ['Set start time for Open doors (item 2)']);
    assert.deepEqual(app.requests, [{ action: 'get' }]);
    assert.deepEqual(app.saved, initial);
  } finally { app.dispose(); }

  const locked = harness(undefined, { ...initial, status: 'generating' });
  try {
    await locked.start();
    const lockedPreview = locked.find('plan-approval-impact');
    assert.match(text(lockedPreview), /2 event-day activities without a start time/);
    assert.equal(planButton(lockedPreview, 'Set start time'), undefined);
    assert.deepEqual(locked.requests, [{ action: 'get' }]);
  } finally { locked.dispose(); }
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

test('owner recovery after a roster refresh keeps draft edits and focuses the exact assignment before approval', async () => {
  const initial = fixture();
  const removed = { id: 'prior-owner', name: 'Fictional departed planner' };
  const replacement = { id: 'current-owner', name: 'Fictional current planner' };
  initial.members.push(removed, replacement);
  initial.draft.items = [
    { ...copy(item), owner: removed.id },
    { ...copy(item), id: 'unchecked', title: 'Consider a follow-up', owner: removed.id, included: false },
    { ...copy(item), id: 'active', title: 'Coordinate the foyer', owner: 'jack' },
  ];
  let reads = 0;
  const app = harness(context => {
    const { input, saved } = context;
    if (!input && ++reads === 2) {
      context.value = { ...saved, workspaceRevision: 5, members: saved.members.filter(member => member.id !== removed.id) };
    }
    if (input?.action === 'save') context.value = pausedPlanResult(input, saved);
    if (input?.action === 'apply') context.value = { ...saved, status: 'applied', receipt: {
      generation: input.generation, approvalHash: approvalHash(input), taskIds: ['saved-one', 'saved-active'],
    } };
  }, initial, 'project=p_example', true);
  const approvals = () => planButton(app.tree, 'Add 2 selected items to project');
  const shortcuts = () => nodes(app.tree).filter(node => node.type === 'button' && node.props['aria-label']?.startsWith('Review owner for '));
  try {
    await app.start();
    assert.equal(Boolean(approvals().props.disabled), false);
    await app.edit('note-one', 'Keep this updated programme note.');
    await app.click('Refresh project context');
    assert.equal(app.find('note-one').props.value, 'Keep this updated programme note.');
    assert.equal(app.find('owner-one').props.value, removed.id, 'refresh does not silently clear the existing private choice');
    assert.equal(app.find('owner-unchecked').props.value, removed.id);
    assert.equal(app.find('owner-one').props['aria-invalid'], true);
    assert.equal(app.find('owner-one').props['aria-describedby'], 'plan-owner-error-one');
    assert.ok(text(app.find('plan-owner-error-one')).length > 0);
    assert.notEqual(app.find('owner-unchecked').props['aria-invalid'], true, 'only selected proposals need an owner review before adding');
    assert.match(text(app.tree), /Review unavailable owners before adding items/);
    assert.doesNotMatch(text(app.tree), /Fictional departed planner/);
    assert.deepEqual(shortcuts().map(node => node.props['aria-label']), ['Review owner for Confirm activities (item 1)']);
    assert.equal(approvals().props.disabled, true);

    const ownerSelect = app.find('owner-one');
    const ownerEditor = nodes(app.tree).find(node => node.type === 'details' && nodes(node).includes(ownerSelect));
    assert.ok(ownerEditor?.props['data-plan-owner-date']);
    const disclosure = { open: false };
    const focused = [];
    globalThis.document.getElementById = id => id === 'owner-one' ? {
      localName: 'select', tagName: 'SELECT', type: 'select-one', matches: () => false,
      closest: selector => {
        assert.equal(selector, 'details[data-plan-owner-date]');
        return disclosure;
      },
      focus: () => {
        assert.equal(disclosure.open, true, 'the owner disclosure opens before focusing its select');
        focused.push(id);
      },
      scrollIntoView: () => {},
    } : null;
    await shortcuts()[0].props.onClick();
    assert.deepEqual(focused, ['owner-one']);
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }]);
    assert.equal(app.saved.draft.items[0].note, item.note);

    await app.edit('owner-one', replacement.id);
    assert.equal(Boolean(approvals().props.disabled), false);
    assert.notEqual(app.find('owner-one').props['aria-invalid'], true);
    assert.equal(app.find('plan-owner-error-one'), undefined);
    assert.equal(shortcuts().length, 0);
    assert.equal(app.find('owner-unchecked').props.value, removed.id);
    assert.deepEqual(app.requests, [{ action: 'get' }, { action: 'get' }]);
    await app.click('Add 2 selected items to project');
    assert.deepEqual(app.requests.map(request => request.action), ['get', 'get', 'save', 'apply']);
    assert.equal(app.requests.at(-1).workspaceRevision, 5);
    for (const request of app.requests.slice(-2)) {
      assert.deepEqual(request.items.map(row => [row.id, row.owner, row.included]), [
        ['one', replacement.id, true], ['unchecked', removed.id, false], ['active', 'jack', true],
      ]);
      assert.equal(request.items[0].note, 'Keep this updated programme note.');
    }
    assert.ok(app.find('plan-receipt-heading'));
  } finally { app.dispose(); }
});

test('an unavailable draft owner does not prevent private save and can be explicitly left unassigned', async () => {
  const initial = fixture();
  const inactive = { id: 'inactive-owner', name: 'Fictional inactive planner', active: false };
  initial.members.push(inactive, { id: 'current-owner', name: 'Fictional current planner', active: true });
  initial.draft.items = [
    { ...copy(item), owner: inactive.id },
    { ...copy(item), id: 'unchecked', title: 'Consider a follow-up', owner: 'unknown-owner', included: false },
  ];
  const app = harness(context => {
    const { input, saved } = context;
    if (input?.action === 'save') context.value = pausedPlanResult(input, saved);
    if (input?.action === 'apply') context.value = { ...saved, status: 'applied', receipt: {
      generation: input.generation, approvalHash: approvalHash(input), taskIds: ['saved-one'],
    } };
  }, initial);
  const choices = id => nodes(app.find(id)).filter(node => node.type === 'option' && !node.props.disabled).map(node => node.props.value);
  const approval = () => planButton(app.tree, 'Add 1 selected items to project');
  try {
    await app.start();
    assert.equal(approval().props.disabled, true);
    assert.equal(app.find('owner-one').props['aria-invalid'], true);
    assert.equal(app.find('owner-one').props.value, inactive.id);
    assert.deepEqual(choices('owner-one'), ['', 'jack', 'current-owner']);
    assert.deepEqual(choices('batch-owner'), ['jack', 'current-owner']);
    assert.doesNotMatch(text(app.tree), /Fictional inactive planner/);
    await app.edit('note-one', 'Save this private note first.');
    assert.equal(Boolean(planButton(app.tree, 'Save draft').props.disabled), false);
    await app.click('Save draft');
    assert.deepEqual(app.requests.map(request => request.action), ['get', 'save']);
    assert.equal(app.saved.draft.items[0].owner, inactive.id);
    assert.equal(app.saved.draft.items[0].note, 'Save this private note first.');
    assert.equal(approval().props.disabled, true);

    await app.edit('owner-one', '');
    assert.equal(Boolean(approval().props.disabled), false);
    assert.doesNotMatch(text(app.tree), /Review unavailable owners before adding items/);
    assert.deepEqual(app.requests.map(request => request.action), ['get', 'save']);
    await app.click('Add 1 selected items to project');
    assert.deepEqual(app.requests.map(request => request.action), ['get', 'save', 'save', 'apply']);
    assert.equal(app.requests.at(-1).items[0].owner, '');
    assert.equal(app.requests.at(-1).items[1].owner, 'unknown-owner');
    assert.equal(app.requests.at(-1).items[1].included, false);
    assert.ok(app.find('plan-receipt-heading'));
  } finally { app.dispose(); }
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
