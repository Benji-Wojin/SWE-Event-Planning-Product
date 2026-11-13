import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const actor = 'fictional-organizer';
const initialLesson = { id: 'fictional-lesson', active: true, outcome: 'helped', change: 'Keep the earlier welcome process.',
  editedAt: '2030-10-04T16:00:00Z' };
const latestLesson = { ...initialLesson, change: 'Revise the welcome process for next time.', editedAt: '2030-10-04T17:00:00Z' };
const values = { title: 'Confirm the welcome checklist', owner: '', dueDate: '2030-10-15', category: 'Venue', status: 'todo',
  scope: 'A teammate has reviewed the checklist.', note: 'My unfinished follow-up notes.' };
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture() {
  const reads = [], writes = [], focus = [];
  const ui = { view: 'memory', dialogKind: 'lesson-follow-up', actor, wrapMine: true };
  const window = { GatherMode: { projectId: 'fictional-project' }, GatherAccessLost: false };
  const document = { hidden: false, activeElement: null };
  let current = { memories: [structuredClone(initialLesson)], event: { membersCanCreateTasks: true }, demoGeneration: 1 };
  let canCreate = true, revision = 5, stale = false;
  function node(tagName, dataset = {}, attrs = {}) {
    const attributes = new Map();
    return { tagName: tagName.toUpperCase(), dataset, hidden: false, disabled: false, isConnected: true,
      children: [], textContent: '', ...attrs,
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; },
      prepend(...children) { for (const child of children) child.parentElement = this; this.children.unshift(...children); },
      contains(other) { for (let el = other; el; el = el.parentElement) if (el === this) return true; return false; },
      setAttribute(key, value) { attributes.set(key, String(value)); },
      removeAttribute(key) { attributes.delete(key); },
      getAttribute(key) { return attributes.get(key) ?? null; },
      focus() { focus.push(this); document.activeElement = this; },
      matches(selector) {
        if (selector === '[hidden],[inert]') return this.hidden || this.inert;
        if (selector === ':disabled') return this.disabled;
        if (selector === 'form' || selector === 'blockquote') return this.tagName === selector.toUpperCase();
        if (selector.startsWith('#')) return this.id === selector.slice(1);
        if (selector === 'button[type="submit"]' || selector === '[type="submit"]') return this.type === 'submit';
        const fields = [...selector.matchAll(/\[data-([a-z-]+)(?:="([^"]*)")?\]/g)];
        return fields.length > 0 && fields.every(([, name, value]) => {
          const key = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          return value === undefined ? Object.hasOwn(this.dataset, key) : this.dataset[key] === value;
        });
      },
      closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; },
    };
  }
  const dialog = node('div', {}, { id: 'dialog' });
  const backdrop = node('div', {}, { id: 'dialogBackdrop' });
  const heading = node('h2', {}, { id: 'dialogTitle' });
  const reference = node('blockquote', {}, { id: 'lessonDraftReference', textContent: initialLesson.change });
  const status = node('p', {}, { id: 'lessonDraftStatus' });
  const latestQuote = node('blockquote');
  const latestDetails = node('p', { lessonDraftDetails: '' });
  const latest = node('div', {}, { id: 'lessonDraftLatest', hidden: true }).append(latestQuote,latestDetails);
  const check = node('button', { action: 'refresh-lesson-draft' });
  const accept = node('button', { action: 'use-latest-lesson' }, { hidden: true });
  const panel = node('div', {}, { id: 'lessonDraftRecovery', hidden: true }).append(status, latest, check, accept);
  const save = node('button', {}, { type: 'submit' });
  const form = node('form', { lessonFollowUp: initialLesson.id, lessonEditedAt: initialLesson.editedAt }, { id: 'newTaskForm' });
  form.elements = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
  form.append(panel, save);
  const root = node('main').append(backdrop.append(dialog.append(heading, reference, form)));
  const query = (selector, from = root) => from.children.flatMap(function walk(child) {
    return [child, ...child.children.flatMap(walk)];
  }).filter(el => el.matches(selector));
  const $ = (selector, from) => query(selector, from)[0] ?? null;
  const store = {
    getState: () => current, getSnapshotRevision: () => revision,
    addTask(...args) { writes.push(args); throw new Error('A refresh must not add a task'); },
    refresh(gate, options) {
      return new Promise((resolve, reject) => reads.push({ options, reject,
        complete(state, { verified = true, candidateRevision = revision + 1 } = {}) {
          const allowed = gate(candidateRevision, state);
          if (allowed && verified) { current = state; revision = candidateRevision; }
          resolve(allowed && verified ? { verified: true, changed: true } : { pending: true, newerRevision: candidateRevision });
        },
      }));
    },
  };
  const context = vm.createContext({ ui, window, document, store, $, $$: query, h,
    canCreateTasks: () => canCreate, isOrganizer: () => canCreate,
    workspaceUpdatesPending: () => stale,
    recoveryConflictPending: () => stale, scheduleRevisionIsStale: () => false,
    rememberNewerSchedule: () => {}, showPendingUpdate: () => {}, render: () => {}, toast: () => {},
    focusScheduleTarget: target => (target.focus(), true),
  });
  vm.runInContext(fragment('  function isActionableLesson(', '  function openLessonFollowUp('), context);
  return { context, ui, window, document, dialog, backdrop, heading, $, node, reads, writes, focus,
    form, reference, panel, status, latest, latestQuote, latestDetails, check, accept, save,
    mark(options) { context.markLessonDraftForReview(form, options); },
    refresh() { return context.refreshLessonDraft(check); },
    use() { return context.useLatestLesson(accept); },
    draft() { return Object.fromEntries(Object.entries(form.elements).map(([name, field]) => [name, field.value])); },
    advance(lesson) { current = { ...current, memories: [structuredClone(lesson)] }; revision++; },
    replace() {
      form.isConnected = false;
      dialog.children = dialog.children.filter(child => child !== form);
      dialog.append(node('form', { lessonFollowUp: 'different' }, { id: 'newTaskForm' }));
    },
    set permitted(value) { canCreate = value; },
    set stale(value) { stale = value; },
    stateWith(lesson = latestLesson) { return { ...current, memories: lesson ? [structuredClone(lesson)] : [] }; },
  };
}

const isLocked = fixture => fixture.save.getAttribute('aria-disabled') === 'true';

test('a changed source is shown separately and requires explicit adoption without rewriting the draft', async () => {
  const f = fixture();
  f.mark();
  assert.equal(f.panel.hidden, false);
  assert.equal(isLocked(f), true);
  const pending = f.refresh();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0].options.requireFresh, true);
  assert.equal(isLocked(f), true);
  f.reads[0].complete(f.stateWith(latestLesson));
  await pending;
  assert.equal(isLocked(f), true);
  assert.equal(f.accept.hidden, false);
  assert.equal(f.form.dataset.lessonEditedAt, initialLesson.editedAt);
  assert.equal(f.reference.textContent, initialLesson.change);
  assert.equal(f.latest.hidden, false);
  assert.equal(f.latestQuote.textContent, latestLesson.change);
  assert.deepEqual(f.draft(), values);
  assert.deepEqual(f.writes, []);

  await f.use();
  assert.equal(isLocked(f), false);
  assert.equal(f.form.dataset.lessonEditedAt, latestLesson.editedAt);
  assert.equal(f.reference.textContent, latestLesson.change);
  assert.deepEqual(f.draft(), values);
  assert.deepEqual(f.writes, []);
});

test('an uncertain write cannot be retried, and an older snapshot cannot clear a known conflict', async () => {
  const uncertain = fixture();
  uncertain.mark({ uncertain: true });
  assert.equal(isLocked(uncertain), true);
  assert.equal(uncertain.check.hidden, true);
  assert.match(uncertain.status.textContent, /couldn’t confirm.*Check Shared tasks/);
  uncertain.mark();
  await uncertain.refresh();
  assert.equal(uncertain.use(), false);
  assert.deepEqual(uncertain.reads, []);
  assert.deepEqual(uncertain.writes, []);
  assert.deepEqual(uncertain.draft(), values);

  const stale = fixture();
  stale.mark({ afterRevision: 5 });
  const refresh = stale.refresh();
  stale.reads[0].complete(stale.stateWith(initialLesson), { candidateRevision: 5 });
  await refresh;
  assert.equal(isLocked(stale), true);
  assert.match(stale.status.textContent, /Couldn’t confirm/);
  const retry = stale.refresh();
  stale.reads[1].complete(stale.stateWith(initialLesson), { candidateRevision: 6 });
  await retry;
  assert.equal(isLocked(stale), false);
  assert.deepEqual(stale.writes, []);
  assert.deepEqual(stale.draft(), values);
});

test('a verified unchanged source makes the existing form ready again without a write or fresh draft', async () => {
  const f = fixture();
  f.mark();
  const pending = f.refresh();
  assert.equal(f.reads[0].options.requireFresh, true);
  f.reads[0].complete(f.stateWith(initialLesson), { candidateRevision: 5 });
  await pending;
  assert.equal(isLocked(f), false);
  assert.equal(f.accept.hidden, true);
  assert.equal(f.form.dataset.lessonEditedAt, initialLesson.editedAt);
  assert.equal(f.reference.textContent, initialLesson.change);
  assert.deepEqual(f.draft(), values);
  assert.deepEqual(f.writes, []);
});

test('metadata-only edits show current context and require explicit review', async () => {
  const f = fixture();
  f.mark();
  const pending = f.refresh();
  f.reads[0].complete(f.stateWith({ ...initialLesson, editedAt: latestLesson.editedAt,
    scope: 'outdoor', context: 'Fictional <markup> to display literally.', outcome: 'untested' }));
  await pending;
  assert.equal(isLocked(f), true);
  assert.equal(f.latestQuote.textContent, f.reference.textContent);
  assert.match(f.latestDetails.textContent, /Outdoor events only\nOutcome: Not evaluated\nContext: Fictional <markup>/);
  assert.equal(f.use(), true);
  assert.deepEqual(f.draft(), values);
  assert.deepEqual(f.writes, []);
});

test('a newer snapshot observed while hidden prevents a later older read from unlocking Save', async () => {
  const f = fixture();
  f.mark();
  const pending = f.refresh();
  f.document.hidden = true;
  f.reads[0].complete(f.stateWith(latestLesson), { candidateRevision: 8 });
  await pending;
  f.document.hidden = false;
  const older = f.refresh();
  f.reads[1].complete(f.stateWith(initialLesson), { candidateRevision: 6 });
  await older;
  assert.equal(isLocked(f), true);
  assert.equal(f.accept.hidden, true);
  assert.deepEqual(f.draft(), values);
});

test('a failed or no-longer-available source never re-enables Save', async () => {
  for (const reason of ['network', 'missing', 'retired', 'unhelpful', 'permission']) {
    const f = fixture();
    f.mark();
    const pending = f.refresh();
    if (reason === 'network') f.reads[0].reject(new Error('Fictional network failure'));
    else if (reason === 'permission') {
      f.permitted = false;
      f.reads[0].complete(f.stateWith(latestLesson));
    } else {
      const lesson = reason === 'missing' ? null : { ...latestLesson,
        ...(reason === 'retired' ? { active: false } : { outcome: 'did-not-help' }) };
      f.reads[0].complete(f.stateWith(lesson));
    }
    await pending;
    assert.equal(isLocked(f), true, reason);
    assert.equal(f.accept.hidden, true, reason);
    assert.equal(f.form.dataset.lessonEditedAt, initialLesson.editedAt, reason);
    assert.deepEqual(f.draft(), values, reason);
    assert.deepEqual(f.writes, [], reason);
  }
});

test('late refresh results cannot enable a replaced or hidden form, and adoption rechecks the reviewed revision', async () => {
  for (const reason of ['replace', 'hidden', 'access', 'project', 'actor']) {
    const f = fixture();
    f.mark();
    const pending = f.refresh();
    if (reason === 'replace') f.replace();
    if (reason === 'hidden') f.document.hidden = true;
    if (reason === 'access') f.window.GatherAccessLost = true;
    if (reason === 'project') f.window.GatherMode.projectId = 'different-project';
    if (reason === 'actor') f.ui.actor = 'different-account';
    f.reads[0].complete(f.stateWith(initialLesson));
    await pending;
    assert.equal(isLocked(f), true, reason);
    assert.equal(f.accept.hidden, true, reason);
    assert.equal(f.form.dataset.lessonEditedAt, initialLesson.editedAt, reason);
    assert.deepEqual(f.writes, [], reason);
  }

  const f = fixture();
  f.mark();
  const pending = f.refresh();
  f.reads[0].complete(f.stateWith(latestLesson));
  await pending;
  assert.equal(f.accept.hidden, false);
  f.advance({ ...latestLesson, editedAt: '2030-10-04T18:00:00Z' });
  await f.use();
  assert.equal(isLocked(f), true);
  assert.equal(f.accept.hidden, true);
  assert.equal(f.latest.hidden, true);
  assert.match(f.status.textContent, /Check the latest lesson/);
  assert.equal(f.document.activeElement, f.check);
  assert.equal(f.form.dataset.lessonEditedAt, initialLesson.editedAt);
  assert.equal(f.reference.textContent, initialLesson.change);
  assert.deepEqual(f.draft(), values);
  assert.deepEqual(f.writes, []);
});
