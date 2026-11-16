import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';

const archivedAt = '2026-10-01T12:00:00Z';
const ref = ({ id, revision }) => ({ id, revision });
const taskById = (store, id) => store.getState().tasks.find(task => task.id === id);
function storageFor(snapshot) {
  let raw = JSON.stringify(snapshot);
  return {
    getItem: key => key === GatherStore.STORAGE_KEY ? raw : null,
    setItem(key, value) {
      if (key === GatherStore.STORAGE_KEY) raw = value;
    },
  };
}

test('archived tasks cannot be claimed or accepted, and mixed owner batches fail atomically', () => {
  const baseline = GatherStore.createStore({ storage: null });
  const archivedUnassigned = baseline.addTask({ title: 'Retired unassigned task', note: 'Keep the saved context.' });
  const archivedOwned = baseline.addTask({ title: 'Retired assignment', owner: 'maya', status: 'progress' });
  const activeOwned = baseline.addTask({ title: 'Current assignment', owner: 'maya' });
  const activeUnassigned = baseline.addTask({ title: 'Current unassigned task' });
  const snapshot = baseline.getState();
  for (const task of snapshot.tasks) {
    if ([archivedUnassigned.id, archivedOwned.id].includes(task.id)) task.archivedAt = archivedAt;
  }
  const storage = storageFor(snapshot);
  const store = GatherStore.createStore({ storage });
  const before = store.exportState();
  const persisted = storage.getItem(GatherStore.STORAGE_KEY);
  let notifications = 0;
  store.subscribe(() => { notifications++; });

  assert.throws(() => store.claimTask(archivedUnassigned.id, 'maya'), /archived/i);
  assert.throws(() => store.acceptTask(archivedOwned.id, 'maya'), /archived/i);
  for (const tasks of [[ref(activeOwned), ref(archivedOwned)], [ref(archivedOwned), ref(activeOwned)]]) {
    assert.throws(() => store.acceptTasks(tasks, 'maya'), /archived/i);
    assert.throws(() => store.assignTasks({ owner: 'dev', tasks }), /archived/i);
  }
  assert.equal(store.exportState(), before);
  assert.equal(storage.getItem(GatherStore.STORAGE_KEY), persisted);
  assert.equal(notifications, 0);

  assert.equal(store.claimTask(activeUnassigned.id, 'maya').owner, 'maya');
  assert.equal(store.acceptTasks([ref(activeOwned)], 'maya')[0].acceptedBy, 'maya');
  assert.equal(store.assignTasks({ owner: 'dev', tasks: [ref(taskById(store, activeOwned.id))] }).changedTaskCount, 1);
  for (const id of [archivedUnassigned.id, archivedOwned.id]) {
    assert.deepEqual(taskById(store, id), JSON.parse(before).tasks.find(task => task.id === id));
  }
});

test('an archive-only schedule survives persisting and reloading a cleared event time zone', () => {
  const baseline = GatherStore.createStore({ storage: null });
  baseline.completeSetup({ name: 'Fictional archive workspace', timeZone: 'UTC' });
  const activity = baseline.addTask({
    title: 'Historical activity',
    schedule: { start: '2026-10-03T16:00', end: '2026-10-03T17:00', location: 'Fictional hall' },
  });
  const snapshot = baseline.getState();
  snapshot.tasks = [{ ...snapshot.tasks.find(task => task.id === activity.id), archivedAt }];
  const storage = storageFor(snapshot);
  const store = GatherStore.createStore({ storage });

  store.updateEvent({ timeZone: '' });
  const reloaded = GatherStore.createStore({ storage });
  assert.equal(reloaded.getState().persistence, 'saved');
  assert.equal(reloaded.getState().event.name, 'Fictional archive workspace');
  assert.equal(reloaded.getState().event.timeZone, '');
  assert.deepEqual(taskById(reloaded, activity.id), taskById(store, activity.id));

  const valid = reloaded.getState();
  for (const task of [
    { ...valid.tasks[0], archivedAt: '' },
    { ...valid.tasks[0], schedule: { ...activity.schedule, end: '2026-10-03T15:00' } },
  ]) {
    const invalidStorage = storageFor({ ...valid, tasks: [task] });
    const invalid = invalidStorage.getItem(GatherStore.STORAGE_KEY);
    const rejected = GatherStore.createStore({ storage: invalidStorage });
    assert.equal(rejected.getState().persistence, 'unavailable');
    assert.equal(taskById(rejected, activity.id), undefined);
    assert.equal(invalidStorage.getItem(GatherStore.STORAGE_KEY), invalid, 'invalid persisted data remains intact');
  }
});
