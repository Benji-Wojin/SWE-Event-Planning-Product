import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';

const get = (store, id) => store.getState().tasks.find(task => task.id === id);
const create = () => GatherStore.createStore({ storage: null });
const unchanged = (store, action) => {
  const before = store.exportState();
  assert.throws(action, /required work/);
  assert.equal(store.exportState(), before);
};
const pair = (store, requiresVerification = false) => {
  const prerequisite = store.addTask({ title: 'Approve hall readiness', owner: 'jules', requiresVerification: true });
  const dependent = store.addTask({ title: 'Prepare arrival area', owner: 'maya', requiresVerification });
  store.addDependency(dependent.id, { taskId: prerequisite.id }, 'maya');
  return { prerequisite, dependent };
};

test('owner reports and organizer completion wait for all required work and verification', () => {
  for (const requiresVerification of [false, true]) {
    const store = create(), { prerequisite, dependent } = pair(store, requiresVerification);
    unchanged(store, () => store.reportCompletion(dependent.id, 'Arrival area ready.', 'maya'));
    if (!requiresVerification) unchanged(store, () => store.updateTask(dependent.id, { status: 'done', note: 'Ready.' }));
    store.reportCompletion(prerequisite.id, 'Hall inspected.', 'jules');
    unchanged(store, () => store.reportCompletion(dependent.id, 'Arrival area ready.', 'maya'));
    store.verifyTask(prerequisite.id);
    store.reportCompletion(dependent.id, 'Arrival area ready.', 'maya');
    assert.equal(get(store, dependent.id).status, requiresVerification ? 'progress' : 'done');
    if (requiresVerification) store.verifyTask(dependent.id);
    assert.equal(get(store, dependent.id).status, 'done');
  }
});

test('a reopened prerequisite prevents verification of a pending dependent report', () => {
  const store = create(), { prerequisite, dependent } = pair(store, true);
  store.reportCompletion(prerequisite.id, 'Hall inspected.', 'jules');
  store.verifyTask(prerequisite.id);
  store.reportCompletion(dependent.id, 'Arrival area ready.', 'maya');
  store.updateTask(prerequisite.id, { status: 'progress', note: 'A new inspection is needed.' });
  unchanged(store, () => store.verifyTask(dependent.id));
  assert.ok(get(store, dependent.id).reportedAt);
  store.reportCompletion(prerequisite.id, 'Hall inspected again.', 'jules');
  store.verifyTask(prerequisite.id);
  store.verifyTask(dependent.id);
  store.updateTask(prerequisite.id, { status: 'progress' });
  const completed = get(store, dependent.id);
  store.verifyTask(dependent.id); // A retry does not rewrite historical completion.
  store.updateTask(dependent.id, { title: 'Arrival area preparation' });
  assert.equal(get(store, dependent.id).verifiedAt, completed.verifiedAt);
  assert.equal(get(store, dependent.id).status, 'done');
});

test('reviewed completion emails cannot bypass prerequisites or consume the pending email', () => {
  for (const requiresVerification of [false, true]) {
    const store = create(), { prerequisite, dependent } = pair(store, requiresVerification);
    const message = store.addMessage({ sender: 'Maya Singh', subject: 'Arrival area ready', taskId: dependent.id, body: 'This task is complete.' });
    unchanged(store, () => store.applyMessage(message.id, { status: 'done', note: 'Ready from email.' }));
    assert.equal(store.getState().messages.find(item => item.id === message.id).appliedTaskId, undefined);
    // An unrelated progress update may still be reviewed and saved.
    store.applyMessage(message.id, { status: 'progress', note: 'Waiting for hall approval.' });
    assert.equal(get(store, dependent.id).reportedAt, '');
    assert.equal(get(store, prerequisite.id).status, 'todo');
  }
});

test('related-only links do not gate completion and explicit unlinking preserves the prerequisite', () => {
  const store = create(), { prerequisite, dependent } = pair(store);
  store.removeDependency(dependent.id, prerequisite.id, 'maya');
  store.reportCompletion(dependent.id, 'No longer depends on the hall.', 'maya');
  assert.equal(get(store, prerequisite.id).status, 'todo');
  assert.ok(get(store, dependent.id).comments.some(item => item.kind === 'dependency-removed'));
  const data = JSON.parse(store.exportState());
  const subject = data.tasks.find(task => task.id === dependent.id);
  Object.assign(subject, { status: 'progress', verifiedAt: '', reportedAt: '', dependencies: [{ taskId: prerequisite.id, kind: 'related' }] });
  const reloaded = GatherStore.createStore({ storage: { getItem: key => key === GatherStore.STORAGE_KEY ? JSON.stringify(data) : null, setItem() {} } });
  reloaded.reportCompletion(dependent.id, 'Related work can continue separately.', 'maya');
  assert.equal(get(reloaded, dependent.id).status, 'done');
});

test('missing required work fails closed but can be explicitly unlinked without a partial mutation', () => {
  const source = create(), { prerequisite, dependent } = pair(source);
  const data = JSON.parse(source.exportState());
  data.tasks = data.tasks.filter(task => task.id !== prerequisite.id);
  let raw = JSON.stringify(data), writes = 0, notifications = 0;
  const store = GatherStore.createStore({ storage: { getItem: key => key === GatherStore.STORAGE_KEY ? raw : null, setItem: (_key, value) => { raw = value; writes++; } } });
  store.subscribe(() => notifications++);
  const saved = raw, writeCount = writes;
  unchanged(store, () => store.reportCompletion(dependent.id, 'Ready.', 'maya'));
  assert.equal(raw, saved); assert.equal(writes, writeCount); assert.equal(notifications, 0);
  const before = store.exportState();
  assert.throws(() => store.removeDependency(dependent.id, prerequisite.id, 'dev'), /owner or the organizer/);
  assert.equal(store.exportState(), before);
  store.removeDependency(dependent.id, prerequisite.id, 'maya');
  assert.equal(get(store, dependent.id).dependencies.length, 0);
  assert.equal(JSON.parse(raw).tasks.find(task => task.id === dependent.id).dependencies.length, 0);
  assert.equal(notifications, 1);
  store.reportCompletion(dependent.id, 'Ready after the obsolete link was removed.', 'maya');
  assert.equal(get(store, dependent.id).status, 'done');
});
