import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';

const now = '2026-11-13T17:30:00.000Z';
const archivedAt = '2026-11-12T12:00:00.000Z';

function openFixture(snapshot) {
  let raw = JSON.stringify(snapshot);
  let writes = 0;
  const storage = {
    getItem: key => key === GatherStore.STORAGE_KEY ? raw : null,
    setItem(key, value) {
      if (key !== GatherStore.STORAGE_KEY) return;
      raw = value;
      writes++;
    },
  };
  const store = GatherStore.createStore({ storage, now });
  const loadWrites = writes;
  return {
    store,
    reopen: () => GatherStore.createStore({ storage, now }),
    writes: () => writes - loadWrites,
  };
}

function planningFixture() {
  const seed = GatherStore.createStore({ storage: null, now });
  seed.updateEvent({
    name: 'Fictional outdoor volunteer event',
    outdoor: true,
    transportNeeded: true,
    cateringDeadline: '2026-11-14',
    dietaryOutstanding: 3,
  });
  const memory = seed.addMemory({ change: 'Prepare backup entry signs', scope: 'always' });
  const snapshot = seed.getState();
  snapshot.tasks = [];
  snapshot.dismissed = [];
  return { ...openFixture(snapshot), memory };
}

test('archived work no longer counts as coverage for active rule checks or gets returned as accepted work', () => {
  const { store, memory } = planningFixture();
  const checkIds = ['rain', 'accessibility', 'quiet', 'dietary-cutoff', 'lesson-' + memory.id];
  for (const id of checkIds) {
    assert.ok(store.getSuggestions().some(item => item.id === id), id + ' starts uncovered');
    assert.ok(store.acceptSuggestion(id)?.id, id + ' is saved by an explicit request');
  }
  assert.deepEqual(store.getSuggestions(), []);
  const snapshot = store.getState();
  snapshot.tasks = snapshot.tasks.map(task => ({ ...task, archivedAt }));
  const reopened = openFixture(snapshot);
  const before = reopened.store.exportState();
  assert.deepEqual(reopened.store.getSuggestions().map(item => item.id).sort(), [...checkIds].sort());
  assert.equal(reopened.store.exportState(), before);
  assert.equal(reopened.writes(), 0, 'surfacing uncovered checks does not add tasks');

  for (const [index, id] of checkIds.entries()) {
    const historical = snapshot.tasks.find(task => task.suggestionId === id);
    const live = reopened.store.acceptSuggestion(id);
    assert.ok(live && !live.archivedAt, id + ' returns active work');
    assert.notEqual(live.id, historical.id);
    assert.equal(live.title, historical.title, 'an exact historical title does not block present work');
    assert.equal(live.suggestionId, id);
    if (id.startsWith('lesson-')) assert.equal(live.memoryId, memory.id);
    assert.equal(reopened.store.acceptSuggestion(id).id, live.id, 'retry resolves to active work');
    assert.equal(reopened.writes(), index + 1);
  }
  const current = reopened.reopen();
  assert.deepEqual(current.getSuggestions(), []);
  assert.equal(current.getState().tasks.length, checkIds.length * 2);
  for (const historical of snapshot.tasks)
    assert.deepEqual(current.getState().tasks.find(task => task.id === historical.id), historical);
  assert.deepEqual(current.getState().memories, snapshot.memories);
});

test('stale acceptance never resolves to archived work, and active matches and dismissals stay intact', () => {
  const { store } = planningFixture();
  const historical = store.addTask({ title: 'Former rain plan', note: 'Historical weather handover' });
  const live = store.addTask({ title: 'Confirm the rain backup', note: 'Current weather handover' });
  const snapshot = store.getState();
  // Deliberately put the archive first so retry lookup must skip it, rather
  // than succeeding only because the live record happens to be found first.
  snapshot.tasks = [
    { ...snapshot.tasks.find(task => task.id === historical.id), archivedAt },
    snapshot.tasks.find(task => task.id === live.id),
  ];
  const mixed = openFixture(snapshot);
  assert.ok(!mixed.store.getSuggestions().some(item => item.id === 'rain'));
  assert.equal(mixed.store.acceptSuggestion('rain').id, live.id);
  assert.equal(mixed.writes(), 0, 'existing active work needs no write');

  const archiveOnly = openFixture({ ...snapshot, tasks: [snapshot.tasks[0]], event: { ...snapshot.event, outdoor: false } });
  assert.ok(!archiveOnly.store.getSuggestions().some(item => item.id === 'rain'));
  assert.equal(archiveOnly.store.acceptSuggestion('rain'), null, 'stale click does not resurrect a historical match');
  assert.equal(archiveOnly.writes(), 0);

  const dismissible = openFixture({ ...snapshot, tasks: [snapshot.tasks[0]] });
  assert.ok(dismissible.store.getSuggestions().some(item => item.id === 'rain'));
  assert.equal(dismissible.store.dismissSuggestion('rain'), true);
  assert.ok(!dismissible.reopen().getSuggestions().some(item => item.id === 'rain'));
  assert.deepEqual(dismissible.store.getState().tasks, [snapshot.tasks[0]], 'dismissal neither updates nor recreates archived work');
});
