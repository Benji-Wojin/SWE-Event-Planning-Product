import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const create = () => GatherStore.createStore({ storage: null });
const ref = (task) => ({ id: task.id, revision: task.revision });
test('selected owned commitments save once, preserve work and have per-task attribution', () => {
  const store = create(),
    a = store.addTask({
      title: 'Prepare corporate room',
      owner: 'maya',
      status: 'blocked',
      note: 'Waiting on AV.',
      dueDate: '2027-01-02',
      requiresVerification: true,
    }),
    b = store.addTask({ title: 'Brief guests', owner: 'maya' }),
    excluded = store.addTask({ title: 'Not selected', owner: 'maya' });
  store.addDependency(a.id, {
    taskId: b.id,
    reason: 'Need briefing materials.',
  });
  const before = store.getState(),
    selected = before.tasks.filter((t) => [a.id, b.id].includes(t.id));
  let saves = 0;
  store.subscribe(() => saves++);
  const result = store.acceptTasks(selected.map(ref), 'maya'),
    after = store.getState();
  assert.equal(saves, 1);
  assert.equal(result.length, 2);
  for (const old of selected) {
    const current = after.tasks.find((t) => t.id === old.id);
    assert.ok(current.acceptedAt);
    assert.equal(current.acceptedBy, 'maya');
    assert.equal(current.revision, old.revision + 1);
    for (const field of [
      'status',
      'owner',
      'note',
      'dueDate',
      'dependencies',
      'requiresVerification',
      'reportedAt',
      'verifiedAt',
      'completedAt',
      'updatedAt',
    ])
      assert.deepEqual(current[field], old[field], field);
  }
  assert.deepEqual(
    after.tasks.find((t) => t.id === excluded.id),
    before.tasks.find((t) => t.id === excluded.id),
  );
  assert.equal(after.activity.length, before.activity.length + 2);
  assert.ok(
    after.activity
      .slice(0, 2)
      .every((a) => a.type === 'accepted' && a.actor === 'maya'),
  );
  const stable = store.exportState();
  store.acceptTasks(result.map(ref), 'maya');
  assert.equal(store.exportState(), stable);
  assert.equal(saves, 1);
});
test('every selection is validated before any local acceptance or activity is changed', () => {
  for (const invalid of ['foreign', 'missing', 'stale', 'reported', 'done']) {
    const store = create(),
      a = store.addTask({ title: 'First', owner: 'maya' }),
      b = store.addTask({
        title: 'Second',
        owner: invalid === 'foreign' ? 'dev' : 'maya',
        requiresVerification: true,
      });
    let second = ref(b);
    if (invalid === 'missing') second.id = 'absent';
    if (invalid === 'stale') {
      store.updateTask(b.id, { title: 'Revised commitment' });
    }
    if (invalid === 'reported') {
      store.reportCompletion(
        b.id,
        'Reported, not independently verified.',
        'maya',
      );
      second = ref(store.getState().tasks.find((t) => t.id === b.id));
    }
    if (invalid === 'done') {
      store.updateTask(b.id, { requiresVerification: false });
      store.updateTask(b.id, { status: 'done' });
      second = ref(store.getState().tasks.find((t) => t.id === b.id));
    }
    const before = store.exportState();
    assert.throws(() => store.acceptTasks([ref(a), second], 'maya'));
    assert.equal(store.exportState(), before, invalid);
  }
});
test('batch input is bounded, distinct, revision-bound and cannot forge the actor', () => {
  const store = create(),
    a = store.addTask({ title: 'Owned work', owner: 'maya' }),
    r = ref(a),
    before = store.exportState();
  for (const selection of [
    null,
    [],
    [a.id],
    [r, r],
    [{ ...r, revision: 0 }],
    [{ ...r, revision: '1' }],
    [{ ...r, actor: 'maya' }],
    Array(101).fill(r),
  ]) {
    assert.throws(() => store.acceptTasks(selection, 'maya'));
    assert.equal(store.exportState(), before);
  }
  assert.throws(() => store.acceptTasks([r], 'jack'), /assigned owner/);
  assert.equal(store.exportState(), before);
  assert.throws(() => store.acceptTasks([r], 'absent'), /member/);
  assert.equal(store.exportState(), before);
});

const app = readFileSync('legacy/app.js', 'utf8');
test('API validates bounds and duplicates before cloning one ownership snapshot', () => {
  const source = readFileSync('lib/workspace.ts', 'utf8');
  const start = source.indexOf("  if (method === 'acceptTasks') {");
  const end = source.indexOf("  if (user.role !== 'admin'", start);
  const guard = source.slice(start, end).replaceAll('(task: any)', '(task)');
  let reads = 0;
  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const context = vm.createContext({
    method: 'acceptTasks',
    user: { actorId: 'maya' },
    HttpError,
    store: {
      getState() {
        reads++;
        return {
          tasks: [
            { id: 'a', owner: 'maya' },
            { id: 'b', owner: 'maya' },
            { id: 'other', owner: 'jack' },
          ],
        };
      },
    },
  });
  for (const a of [
    [],
    Array(1000).fill({ id: 'a', revision: 1 }),
    [
      { id: 'a', revision: 1 },
      { id: 'a', revision: 1 },
    ],
    null,
    [{ id: 'a', revision: '1' }],
  ]) {
    context.a = a;
    assert.throws(
      () => vm.runInContext(guard, context),
      (error) => error.status === 400,
    );
    assert.equal(reads, 0);
  }
  context.a = [
    { id: 'a', revision: 1 },
    { id: 'b', revision: 1 },
  ];
  vm.runInContext(guard, context);
  assert.equal(reads, 1);
  context.a = [{ id: 'other', revision: 1 }];
  assert.throws(
    () => vm.runInContext(guard, context),
    (error) => error.status === 403,
  );
  assert.equal(reads, 2);
});
test('review is current-view owned/open/unaccepted only, escaped and selected by nobody by default', () => {
  const tasks = [
    {
      id: 'a',
      revision: 4,
      title: '<script>title</script>',
      note: '<img src=x>',
      owner: 'maya',
      status: 'blocked',
      dueDate: '',
    },
    { id: 'other', owner: 'dev', status: 'todo' },
    { id: 'accepted', owner: 'maya', acceptedAt: 'date', status: 'todo' },
    { id: 'done', owner: 'maya', status: 'done' },
    { id: 'reported', owner: 'maya', status: 'progress', reportedAt: 'date' },
    { id: 'verified', owner: 'maya', status: 'progress', verifiedAt: 'date' },
  ];
  let markup;
  const context = vm.createContext({
    ui: { actor: 'maya' },
    store: { getState: () => ({ event: { timeZone: 'UTC' }, tasks }) },
    filteredTasks: (s) => s.tasks,
    h: (value) =>
      String(value ?? '')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;'),
    statuses: { blocked: 'Blocked' },
    dayLabel: (s) => s,
    openDialog: (_title, body) => (markup = body),
    toast: () => {},
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function acceptanceCandidates('),
      app.indexOf('  function inboxView('),
    ) + 'acceptanceDialog();',
    context,
  );
  assert.match(markup, /value="a" data-revision="4"/);
  assert.match(markup, /&lt;script&gt;title/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(
    markup,
    / checked|value="(?:other|accepted|done|reported|verified)"|<script>|<img/,
  );
  assert.match(markup, /Nothing is selected for you/);
  assert.match(markup, /id="acceptanceSubmit"[^>]*disabled/);
  assert.match(markup, /does not mark work complete/);
  assert.equal(
    vm.runInContext(
      'acceptanceCandidates(Array.from({length:101},(_,i)=>({id:String(i),owner:"maya",status:"todo"}))).length',
      context,
    ),
    100,
  );
});
test('selection state enables deliberate submit and serializes all reviewed revisions before save lock', () => {
  const count = { textContent: '' },
    button = { disabled: true },
    selected = [];
  const context = vm.createContext({
    $$: () => selected,
    $: (selector) => (selector === '#acceptanceCount' ? count : button),
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function syncAcceptanceSelection('),
      app.indexOf('  function inboxView('),
    ),
    context,
  );
  vm.runInContext('syncAcceptanceSelection({})', context);
  assert.equal(button.disabled, true);
  selected.push({});
  vm.runInContext('syncAcceptanceSelection({})', context);
  assert.equal(button.disabled, false);
  assert.equal(count.textContent, '1 task selected.');
  const serialization = app.indexOf(
    "if(form.id==='acceptTasksForm')data.selections=",
  );
  assert.ok(serialization > 0);
  assert.ok(
    serialization <
      app.indexOf('const release=saveLock(form.closest', serialization),
  );
  assert.match(app, /form\.dataset\.actor!==ui\.actor/);
  assert.match(app, /store\.acceptTasks\(data\.selections,ui\.actor\)/);
});
test('prepared hosted UI awaits one registered batch action without actor parameters', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const hosted = readFileSync('public/gather-assets/app.js', 'utf8'),
    proxy = readFileSync('legacy/hosted-store.js', 'utf8');
  assert.match(
    hosted,
    /await store\.acceptTasks\(data\.selections,ui\.actor\);closeDialog/,
  );
  assert.match(proxy, /'acceptTasks'/);
  assert.match(proxy, /acceptTasks: 1/);
});
