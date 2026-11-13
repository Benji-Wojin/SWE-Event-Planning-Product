import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';

const now = '2026-11-13T17:30:00.000Z';
const fresh = () => GatherStore.createStore({ storage: null, now });
const reload = raw => GatherStore.createStore({ now, storage: { getItem: () => raw, setItem(_key, value) { raw = value; } } });
const args = (lesson, fields = {}) => ({ title: 'Brief a welcome lead', ...fields,
  lessonId: lesson.id, lessonEditedAt: lesson.editedAt || '' });

test('an explicit lesson link survives reload without copying lesson data or reinterpreting a literal note', () => {
  const store = fresh();
  const lesson = store.addMemory({ change: 'Fictional source lesson', wentWell: 'Lesson only', context: 'Keep the original context here' });
  const unrelated = store.addMemory({ change: 'A different fictional lesson' });
  const before = store.getState();
  const note = `Preserve this literal Event memory ${unrelated.id}: reference.`;
  const task = store.addTask(args(lesson, { note, scope: 'A reviewer is identified.' }));
  const state = store.getState();
  assert.equal(task.memoryId, lesson.id);
  assert.equal(task.suggestionId, '');
  assert.equal(task.revision, 1);
  assert.equal(task.note, note);
  assert.equal(task.scope, 'A reviewer is identified.');
  assert.equal(task.title, 'Brief a welcome lead');
  assert.equal(state.tasks.length, before.tasks.length + 1);
  assert.equal(state.activity.length, before.activity.length + 1);
  assert.deepEqual(state.memories, before.memories);
  assert.equal(Object.hasOwn(task, 'lessonId'), false);
  assert.equal(Object.hasOwn(task, 'lessonEditedAt'), false);
  assert.ok(!store.getSuggestions().some(item => item.id === `lesson-${lesson.id}`));
  assert.ok(store.getSuggestions().some(item => item.id === `lesson-${unrelated.id}`));

  const loaded = reload(store.exportState());
  assert.deepEqual(loaded.getState().tasks.find(item => item.id === task.id), task);
  assert.equal(loaded.acceptSuggestion(`lesson-${lesson.id}`).id, task.id);
  assert.equal(loaded.getState().tasks.length, state.tasks.length);
  loaded.updateMemory(lesson.id, { active: false });
  assert.equal(loaded.getState().tasks.find(item => item.id === task.id).memoryId, lesson.id);
});

test('only snapshots without structured provenance infer old note-based sources', () => {
  const store = fresh();
  const lesson = store.addMemory({ change: 'Fictional legacy lesson' });
  const note = `Event memory ${lesson.id}: legacy note`;
  const task = store.addTask({ title: 'Historical task', note });
  const saved = store.exportState(), modern = reload(saved);
  assert.equal(modern.getState().tasks.find(item => item.id === task.id).memoryId, '');
  assert.equal(modern.getState().tasks.find(item => item.id === task.id).note, note);
  assert.ok(modern.getSuggestions().some(item => item.id === `lesson-${lesson.id}`));
  const old = JSON.parse(saved);
  delete old.tasks.find(item => item.id === task.id).memoryId;
  const loaded = reload(JSON.stringify(old)).getState().tasks.find(item => item.id === task.id);
  assert.equal(loaded.memoryId, lesson.id);
  assert.equal(loaded.suggestionId, `lesson-${lesson.id}`);
  assert.equal(loaded.note, 'From event feedback: legacy note');
});

test('invalid, foreign, unavailable and edited lesson references leave the whole workspace untouched', () => {
  const store = fresh();
  const lesson = store.addMemory({ change: 'Fictional current lesson' });
  const other = fresh().addMemory({ change: 'Fictional lesson in another project' });
  const retired = store.updateMemory(store.addMemory({ change: 'Old practice' }).id, { active: false });
  const unsuccessful = store.updateMemory(store.addMemory({ change: 'Unsuccessful practice' }).id, { outcome: 'did-not-help' });
  const edited = store.updateMemory(lesson.id, { change: 'Current reviewed practice' });
  const editedAgain = store.updateMemory(lesson.id, { change: 'Newer practice on the same clock tick' });
  assert.notEqual(editedAgain.editedAt, edited.editedAt);
  const title = 'A task that must not be saved';
  const baseline = store.exportState();
  for (const [data, expected] of [
    [{ title, lessonId: lesson.id }, /Review the source lesson/],
    [{ title, lessonEditedAt: '' }, /Review the source lesson/],
    [{ title, lessonId: '', lessonEditedAt: '' }, /Review the source lesson/],
    [{ title, lessonId: lesson.id, lessonEditedAt: null }, /Review the source lesson/],
    [args(other), /no longer available/],
    [{ title, lessonId: 'private-record-id', lessonEditedAt: '' }, /no longer available/],
    [args(retired), /no longer available/],
    [args(unsuccessful), /no longer available/],
    [args(lesson), /lesson changed/],
    [args(edited), /lesson changed/],
  ]) {
    assert.throws(() => store.addTask(data), expected);
    assert.equal(store.exportState(), baseline);
  }
  assert.equal(store.addTask(args(editedAgain)).memoryId, lesson.id);
});

test('lesson links do not grant teammates task creation rights, assignment or progress', () => {
  const store = fresh();
  const lesson = store.addMemory({ change: 'Fictional team practice' });
  assert.throws(() => store.addTask(args(lesson), 'maya'), /organizer/);
  store.updateEvent({ membersCanCreateTasks: true });
  const baseline = store.exportState();
  for (const data of [args(lesson, { owner: 'jack' }), args(lesson, { status: 'done' }),
    { title: 'No direct injection', memoryId: lesson.id }]) {
    assert.throws(() => store.addTask(data, 'maya'));
    assert.equal(store.exportState(), baseline);
  }
  const own = store.addTask(args(lesson, { owner: 'maya' }), 'maya');
  assert.equal(own.owner, 'maya');
  assert.equal(own.updatedBy, 'maya');
  assert.equal(own.status, 'todo');
  assert.equal(own.memoryId, lesson.id);
  assert.equal(store.addTask({ title: 'Generic follow-up' }, 'maya').memoryId, '');
  assert.equal(store.addTask({ title: 'Untrusted direct memory field', memoryId: lesson.id }).memoryId, '');
  assert.equal(store.updateTask(own.id, { lessonId: 'other', lessonEditedAt: '', memoryId: 'other' }).memoryId, lesson.id);
});
