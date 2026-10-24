import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const create = () => GatherStore.createStore({ storage: null });
const get = (store, id) => store.getState().tasks.find((t) => t.id === id);
const ref = (task) => ({ id: task.id, revision: task.revision });
test('reviewed owner changes save once, reset commitments and preserve actual work', () => {
  const store = create(),
    a = store.addTask({
      title: 'School dance access check',
      owner: 'maya',
      status: 'progress',
      note: 'Walkthrough in progress.',
      dueDate: '2027-01-04',
      requiresVerification: true,
    }),
    b = store.addTask({ title: 'Corporate room preparation' }),
    excluded = store.addTask({ title: 'Not selected', owner: 'dev' });
  store.completeSetup({ timeZone: 'America/Los_Angeles' });
  store.setTaskSchedule(a.id, {
    start: '2027-01-05T09:00',
    end: '2027-01-05T10:00',
    location: 'School hall',
  });
  store.addDependency(a.id, {
    taskId: b.id,
    kind: 'related',
    reason: 'Share room details.',
  });
  store.acceptTask(a.id, 'maya');
  store.setNextUp(a.id, { enabled: true }, 'maya');
  store.requestRecovery(
    a.id,
    { kind: 'help', note: 'Need access to the room.' },
    'maya',
  );
  const before = store.getState(),
    selected = [get(store, a.id), get(store, b.id)];
  let saves = 0;
  store.subscribe(() => saves++);
  const result = store.assignTasks({
      owner: 'jules',
      tasks: selected.map(ref),
    }),
    after = store.getState();
  assert.equal(saves, 1);
  assert.equal(result.changedTaskCount, 2);
  for (const old of selected) {
    const task = get(store, old.id);
    assert.equal(task.owner, 'jules');
    assert.equal(task.revision, old.revision + 1);
    for (const field of [
      'acceptedAt',
      'acceptedBy',
      'acceptedSourceId',
      'acceptedRecordedBy',
      'nextUpAt',
      'nextUpBy',
      'ownerRespondedAt',
      'planReviewAfter',
      'followupAfter',
      'followupSentAt',
    ])
      assert.equal(task[field], '', field);
    for (const field of [
      'title',
      'category',
      'status',
      'note',
      'dueDate',
      'schedule',
      'dependencies',
      'requiresVerification',
      'updatedAt',
      'updatedBy',
      'reportedAt',
      'verifiedAt',
      'completedAt',
      'comments',
    ])
      assert.deepEqual(task[field], old[field], field);
  }
  assert.equal(get(store, a.id).recoveryRequests.at(-1).status, 'superseded');
  assert.deepEqual(
    get(store, excluded.id),
    before.tasks.find((t) => t.id === excluded.id),
  );
  assert.equal(after.activity.length, before.activity.length + 2);
  assert.ok(
    after.activity
      .slice(0, 2)
      .every((item) => item.type === 'assigned' && item.actor === 'jack'),
  );
  assert.deepEqual(after.event, before.event);
  store.acceptTasks(result.tasks.map(ref), 'jules');
  assert.equal(get(store, a.id).acceptedBy, 'jules');
  assert.equal(get(store, a.id).status, 'progress');
});
test('same-owner selections are exact no-ops including acceptance and history', () => {
  const store = create(),
    a = store.addTask({ title: 'Already assigned', owner: 'maya' });
  store.acceptTask(a.id, 'maya');
  store.setNextUp(a.id, { enabled: true }, 'maya');
  const before = store.exportState();
  let saves = 0;
  store.subscribe(() => saves++);
  assert.equal(
    store.assignTasks({ owner: 'maya', tasks: [ref(get(store, a.id))] })
      .changedTaskCount,
    0,
  );
  assert.equal(store.exportState(), before);
  assert.equal(saves, 0);
});
test('all selected tasks are validated before any assignment or activity', () => {
  for (const invalid of ['missing', 'stale', 'reported', 'done', 'verified']) {
    const store = create(),
      a = store.addTask({ title: 'First', owner: 'maya' }),
      b = store.addTask({
        title: 'Second',
        owner: 'dev',
        requiresVerification: true,
      });
    let second = ref(b);
    if (invalid === 'missing') second.id = 'absent';
    if (invalid === 'stale')
      store.updateTask(b.id, { title: 'Changed after review' });
    if (invalid === 'reported' || invalid === 'verified') {
      store.reportCompletion(b.id, 'Work reported.', 'dev');
      if (invalid === 'verified') store.verifyTask(b.id);
      second = ref(get(store, b.id));
    }
    if (invalid === 'done') {
      store.updateTask(b.id, { requiresVerification: false });
      store.updateTask(b.id, { status: 'done' });
      second = ref(get(store, b.id));
    }
    const before = store.exportState();
    assert.throws(() =>
      store.assignTasks({ owner: 'jules', tasks: [ref(a), second] }),
    );
    assert.equal(store.exportState(), before, invalid);
  }
});
test('batch assignment is bounded, organizer-only and rejects forged fields or inactive owners', () => {
  const store = create(),
    a = store.addTask({ title: 'Formal event handoff' }),
    r = ref(a),
    before = store.exportState();
  const valid = { owner: 'maya', tasks: [r] };
  for (const input of [
    null,
    [],
    {},
    { ...valid, owner: '' },
    { ...valid, owner: 'unknown' },
    { ...valid, actor: 'jack' },
    { ...valid, tasks: [] },
    { ...valid, tasks: [r, r] },
    { ...valid, tasks: Array(101).fill(r) },
    { ...valid, tasks: [{ ...r, revision: '1' }] },
    { ...valid, tasks: [{ ...r, owner: 'maya' }] },
    { ...valid, tasks: [{ ...r, revision: 0 }] },
  ]) {
    assert.throws(() => store.assignTasks(input));
    assert.equal(store.exportState(), before);
  }
  for (const actor of ['maya', 'absent']) {
    assert.throws(() => store.assignTasks(valid, actor));
    assert.equal(store.exportState(), before);
  }
  const raw = store.getState();
  raw.members.find((m) => m.id === 'maya').active = false;
  const inactive = GatherStore.createStore({
    storage: { getItem: () => JSON.stringify(raw), setItem: () => {} },
  });
  const stable = inactive.exportState();
  assert.throws(() => inactive.assignTasks(valid));
  assert.equal(inactive.exportState(), stable);
});
const app = readFileSync('legacy/app.js', 'utf8');
test('dialog is filtered, bounded, escaped, organizer-only and never preselects work or owner', () => {
  let markup,
    opened = 0;
  const state = {
    event: { timeZone: 'Asia/Tokyo' },
    members: [
      { id: 'jack', name: 'Jack', role: 'Organizer' },
      { id: 'maya', name: '<Maya>', role: 'Teammate' },
      { id: 'old', name: 'Old', active: false },
      { id: 'example', name: 'Example', role: 'Teammate · example' },
    ],
    tasks: [
      {
        id: 'a',
        title: '<script>task</script>',
        note: '<img>',
        owner: '',
        status: 'blocked',
        dueDate: '',
        revision: 3,
      },
      { id: 'done', status: 'done' },
      { id: 'reported', status: 'progress', reportedAt: 'date' },
    ],
  };
  let organizer = true;
  const context = vm.createContext({
    ui: { actor: 'jack' },
    isOrganizer: () => organizer,
    window: { GatherMode: { demo: false } },
    store: { getState: () => state },
    filteredTasks: (s) => s.tasks,
    h: (v) =>
      String(v ?? '')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;'),
    statuses: { blocked: 'Blocked' },
    options: (entries) =>
      entries
        .map(
          ([id, label]) =>
            `<option value="${id}">${String(label).replaceAll('<', '&lt;')}</option>`,
        )
        .join(''),
    member: (id) => state.members.find((m) => m.id === id),
    dayLabel: (v) => v,
    openDialog: (_title, body) => {
      markup = body;
      opened++;
    },
    toast: () => {},
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function assignmentCandidates('),
      app.indexOf('  function acceptanceCandidates('),
    ) + 'assignmentDialog();',
    context,
  );
  assert.equal(opened, 1);
  assert.match(markup, /value="a" data-revision="3"/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;img&gt;/);
  assert.doesNotMatch(
    markup,
    / checked|<script>|<img>|value="(?:done|reported|old|example)"/,
  );
  assert.match(markup, /Choose a teammate/);
  assert.match(markup, /id="assignmentSubmit"[^>]*disabled/);
  assert.match(markup, /No messages are sent/);
  assert.equal(
    vm.runInContext(
      'assignmentCandidates(Array.from({length:101},()=>({status:"todo"}))).length',
      context,
    ),
    100,
  );
  organizer = false;
  vm.runInContext('assignmentDialog()', context);
  assert.equal(opened, 1);
});
test('confirmation and an actual owner change are required before submit', () => {
  const selected = [],
    owner = { value: '' },
    confirmed = { checked: false },
    count = {},
    button = {};
  const context = vm.createContext({
    $$: () => selected,
    $: (s) =>
      s.startsWith('select')
        ? owner
        : s.startsWith('input')
          ? confirmed
          : s === '#assignmentCount'
            ? count
            : button,
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function syncAssignmentSelection('),
      app.indexOf('  function acceptanceCandidates('),
    ),
    context,
  );
  const sync = () => vm.runInContext('syncAssignmentSelection({})', context);
  sync();
  assert.equal(button.disabled, true);
  selected.push({ dataset: { owner: 'maya' } });
  owner.value = 'maya';
  confirmed.checked = true;
  sync();
  assert.equal(button.disabled, true);
  owner.value = 'dev';
  confirmed.checked = false;
  sync();
  assert.equal(button.disabled, true);
  confirmed.checked = true;
  sync();
  assert.equal(button.disabled, false);
  assert.equal(count.textContent, '1 task selected; 1 owner change.');
});
test('prepared client awaits one actor-free batch mutation and captures refs before locking', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const hosted = readFileSync('public/gather-assets/app.js', 'utf8'),
    proxy = readFileSync('legacy/hosted-store.js', 'utf8');
  assert.match(
    hosted,
    /const result=await store\.assignTasks\(\{owner:data.owner,tasks:data.tasks\},ui.actor\)/,
  );
  assert.match(proxy, /'assignTasks'/);
  assert.match(proxy, /assignTasks: 1/);
  const capture = app.indexOf("if(form.id==='assignTasksForm')data.tasks=");
  assert.ok(
    capture > 0 &&
      capture < app.indexOf('const release=saveLock(form.closest', capture),
  );
  assert.match(
    app,
    /if\(!isOrganizer\(\)\|\|window.GatherAccessLost\|\|form.dataset.actor!==ui.actor\)throw new Error\('Your account changed. Reopen task assignment.'/,
  );
  assert.match(app, /const replacesDialog=\[[^\n]*'review-assignments'/);
});
