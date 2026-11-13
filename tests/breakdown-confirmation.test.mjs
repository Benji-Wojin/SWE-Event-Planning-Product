import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const http = status => Object.assign(new Error('Fictional save error'), { status });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture() {
  const actual = GatherStore.createStore({ storage: null });
  const parent = actual.addTask({ title: 'Prepare event', owner: 'jack', status: 'progress', note: 'FICTIONAL PARENT NOTE' });
  const existing = actual.addTask({ title: 'Old related step' });
  actual.addDependency(parent.id, { taskId: existing.id, kind: 'related', reason: 'Parallel work.' });
  const get = id => actual.getState().tasks.find(task => task.id === id);
  const current = () => get(parent.id);
  const items = [{ title: 'New <reviewed> step', scope: 'FICTIONAL REVIEWED OUTCOME' }];
  const ui = { view: 'tasks', actor: 'jack', dialogKind: 'related-review', detailId: parent.id };
  const window = { GatherMode: { projectId: 'p_fictional' } };
  const calls = [], frames = [];
  const makeControl = () => ({
    isConnected: true, disabled: false, hidden: false, textContent: '', innerHTML: '', dataset: {}, attrs: new Map(),
    focus() { calls.push(['focus', this]); },
    replaceChildren() { this.innerHTML = ''; },
    setAttribute(name, value) { this.attrs.set(name, value); },
    removeAttribute(name) { this.attrs.delete(name); },
  });
  const notice = makeControl(), message = makeControl(), status = makeControl(), check = makeControl(), submit = makeControl();
  const result = makeControl(), heading = makeControl(), backdrop = makeControl(), dialog = makeControl(), sync = makeControl();
  sync.hidden = true; notice.hidden = true;
  const form = { ...makeControl(), id: 'relatedReviewForm', dataset: { id: parent.id, revision: String(current().revision), actor: ui.actor, project: window.GatherMode.projectId } };
  let activeForm = form, organizer = true, revision = 4;
  const actualSave = (id, data, actor) => { const children = actual.addRelatedTasks(id, data, actor); revision++; return children; };
  const f = { actual, current, existing, parent, items, ui, window, calls, form, notice, message, status, check, submit, result, heading,
    actualSave, add: actualSave, refresh: canApply => ({ changed: canApply(), verified: canApply() }),
    replaceForm() { activeForm = { ...form, dataset: { ...form.dataset } }; },
    setOrganizer(value) { organizer = value; },
    advanceRevision() { revision++; },
  };
  const store = {
    getState: actual.getState, getSnapshotRevision: () => revision,
    addRelatedTasks(...args) { calls.push(['write', ...args]); return f.add(...args); },
    refresh(canApply, options) { calls.push(['read', options?.requireFresh]); return f.refresh(canApply, options); },
  };
  const ctx = vm.createContext({
    h, store, ui, window, unconfirmedRelatedSaves: new Map(), document: { hidden: false, activeElement: null },
    isOrganizer: () => organizer,
    render: () => calls.push(['render']),
    taskDialog: (...args) => { calls.push(['taskDialog', ...args]); ui.dialogKind = 'task'; },
    toast: message => calls.push(['toast', message]),
    formError: (_form, error) => calls.push(['formError', error.message]),
    showPendingUpdate: () => { sync.hidden = false; calls.push(['showPendingUpdate']); },
    workspaceUpdatesPending: () => !sync.hidden,
    scheduleRevisionIsStale: () => false,
    unsavedReview: () => false,
    requestAnimationFrame: callback => frames.push(callback),
    $: selector => ({
      '#relatedReviewForm': activeForm, '#dialog': dialog, '#dialogBackdrop': backdrop, '#workspaceSyncNotice': sync,
      '#dialogTitle': heading, '#relatedReceiptHeading': heading, '#dialog .task-dependencies h3': heading,
      '[data-related-check-panel]': notice, '[data-related-save-message]': message,
      '[data-action="check-related-review"]': check, '[data-related-check-status]': status, '[data-related-current-links]': result,
      'button[type="submit"]': submit,
    })[selector] ?? null,
    $$: () => [],
  });
  const start = source.indexOf('  function activeRelatedReview('), end = source.indexOf('  async function relatedAi(', start);
  assert.ok(start >= 0 && end > start, 'breakdown confirmation helpers');
  vm.runInContext(source.slice(start, end), ctx);
  return { ...f, ctx, store, flushFocus() { for (const frame of frames.splice(0)) frame(); },
    set add(handler) { f.add = handler; }, set refresh(handler) { f.refresh = handler; },
  };
}

const events = (f, kind) => f.calls.filter(([name]) => name === kind);

test('ambiguous, stale and access-denied saves stop replays without claiming success or replacing reviewed fields', async () => {
  for (const [status, expected] of [[undefined, 'unknown'], [408, 'unknown'], [503, 'unknown'], [409, 'stale'], [403, 'access']]) {
    const f = fixture(), before = f.actual.exportState();
    f.add = async () => { throw http(status); };
    f.form.reviewedTitle = 'Keep these fictional edits.';
    await f.ctx.saveRelatedReview(f.form, f.items);
    assert.equal(f.form.dataset.saveUnconfirmed, expected, String(status));
    assert.equal(f.submit.disabled, true, String(status));
    assert.equal(f.notice.hidden, false, String(status));
    assert.equal(f.check.hidden, status === 403, String(status));
    assert.equal(f.form.reviewedTitle, 'Keep these fictional edits.');
    assert.equal(events(f, 'render').length, 0);
    assert.equal(events(f, 'taskDialog').length, 0);
    assert.ok(!events(f, 'toast').some(([, copy]) => /task(?:s)? added/i.test(copy)));
    await f.ctx.saveRelatedReview(f.form, f.items);
    assert.equal(events(f, 'write').length, 1);
    assert.equal(events(f, 'read').length, 0);
    if (status === 403) {
      await f.ctx.checkRelatedReview(f.form);
      assert.equal(events(f, 'read').length, 0, 'denied access cannot read links');
    }
    assert.equal(f.actual.exportState(), before);
  }
});

test('validation failure stays editable and an acknowledged retry opens only its returned children', async () => {
  const f = fixture();
  f.add = async () => { throw http(400); };
  await assert.rejects(f.ctx.saveRelatedReview(f.form, f.items), /Fictional save error/);
  assert.equal(f.form.dataset.saveUnconfirmed, undefined);
  assert.equal(f.submit.disabled, false);
  const before = f.current();
  let saved;
  f.add = async (...args) => (saved = f.actualSave(...args));
  await f.ctx.saveRelatedReview(f.form, f.items);
  assert.equal(events(f, 'write').length, 2);
  const opened = events(f, 'taskDialog');
  assert.equal(opened.length, 1);
  assert.deepEqual(opened[0].slice(1, 6), [f.parent.id, '', true, false, '']);
  assert.deepEqual(Array.from(opened[0][6]), saved.map(task => task.id));
  f.flushFocus();
  assert.deepEqual(events(f, 'focus'), [['focus', f.heading]]);
  assert.deepEqual([f.current().status, f.current().note], [before.status, before.note]);
  assert.equal(f.current().dependencies.filter(link => link.kind === 'related').length, 2);

  const markup = f.ctx.relatedReceiptMarkup(f.current(), f.actual.getState(), [saved[0].id, 'not-present']);
  assert.match(markup, /relatedReceiptHeading/);
  assert.match(markup, /New &lt;reviewed&gt; step/);
  assert.match(markup, new RegExp(`data-id="${saved[0].id}"`));
  assert.doesNotMatch(markup, /Old related step|FICTIONAL (?:PARENT NOTE|REVIEWED OUTCOME)|not-present|<reviewed>/);
  const unlinked = { ...f.current(), dependencies: f.current().dependencies.map(link => link.taskId === saved[0].id ? { ...link, kind: 'dependency' } : link) };
  assert.doesNotMatch(f.ctx.relatedReceiptMarkup(unlinked, f.actual.getState(), [saved[0].id]), /New &lt;reviewed&gt; step/);
});

test('a verified read shows current linked work without treating even a same-title task as a save receipt', async () => {
  const f = fixture();
  f.add = async (...args) => { f.actualSave(...args); throw http(503); };
  await f.ctx.saveRelatedReview(f.form, f.items);
  assert.equal(f.form.dataset.saveUnconfirmed, 'unknown');
  await f.ctx.checkRelatedReview(f.form);
  assert.deepEqual(events(f, 'read'), [['read', true]]);
  assert.match(f.result.innerHTML, /Old related step/);
  assert.match(f.result.innerHTML, /New &lt;reviewed&gt; step/);
  assert.doesNotMatch(f.result.innerHTML, /relatedReceiptHeading|FICTIONAL REVIEWED OUTCOME|<reviewed>/);
  assert.match(f.status.textContent + f.result.innerHTML, /does not confirm|doesn’t confirm|doesn’t verify|does not prove|doesn’t prove|can’t confirm|could not confirm/i);
  assert.equal(f.submit.disabled, true, 'checking cannot unlock an unconfirmed attempt');
  assert.equal(events(f, 'taskDialog').length, 0);
  assert.ok(!events(f, 'toast').some(([, copy]) => /task(?:s)? added/i.test(copy)));
  await f.ctx.saveRelatedReview(f.form, f.items);
  assert.equal(events(f, 'write').length, 1);
});

test('a malformed or preexisting write result cannot create a receipt, and an unverified read keeps the review', async () => {
  for (const result of [() => undefined, () => [], () => [{ id: 'not-linked' }], f => [{ id: f.existing.id }]]) {
    const f = fixture();
    f.add = async () => result(f);
    await f.ctx.saveRelatedReview(f.form, f.items);
    assert.equal(f.form.dataset.saveUnconfirmed, 'unknown');
    assert.equal(f.submit.disabled, true);
    assert.equal(events(f, 'taskDialog').length, 0);

    f.refresh = async () => ({ changed: false, verified: false });
    await f.ctx.checkRelatedReview(f.form);
    assert.deepEqual(events(f, 'read'), [['read', true]]);
    assert.match(f.status.textContent, /Could not check.*review is unchanged/);
    assert.equal(f.result.innerHTML, '');
    assert.equal(f.submit.disabled, true);
    assert.equal(f.ui.syncing, false);
    assert.equal(f.check.attrs.has('aria-disabled'), false);
  }
});

test('a stale save stays locked across reopened forms until a check sees a newer revision', async () => {
  const f = fixture();
  f.add = async () => { throw http(409); };
  await f.ctx.saveRelatedReview(f.form, f.items);
  const key = f.ctx.relatedReviewKey(f.form);
  await f.ctx.checkRelatedReview(f.form);
  assert.equal(f.result.innerHTML, '');
  assert.match(f.status.textContent, /Could not check/);
  assert.equal(f.ctx.unconfirmedRelatedSaves.has(key), true);
  f.replaceForm();
  const reopened = vm.runInContext("$('#relatedReviewForm')", f.ctx);
  delete reopened.dataset.saveUnconfirmed;
  await f.ctx.saveRelatedReview(reopened, f.items);
  assert.equal(events(f, 'write').length, 1);
  reopened.dataset.saveUnconfirmed = 'stale';
  f.advanceRevision();
  await f.ctx.checkRelatedReview(reopened);
  assert.match(f.result.innerHTML, /Old related step/);
  assert.equal(f.ctx.unconfirmedRelatedSaves.has(key), false);
  await f.ctx.saveRelatedReview(reopened, f.items);
  assert.equal(events(f, 'write').length, 1, 'the reviewed form itself remains locked');
});

test('late save or read completion cannot update a replaced review, another project, actor, or lost access', async () => {
  for (const invalid of [
    f => f.replaceForm(), f => { f.ui.actor = 'maya'; }, f => { f.window.GatherMode.projectId = 'p_other'; },
    f => { f.window.GatherAccessLost = true; }, f => f.setOrganizer(false),
  ]) {
    let f = fixture(), wait = deferred();
    f.add = () => wait.promise;
    const saving = f.ctx.saveRelatedReview(f.form, f.items);
    invalid(f);
    wait.resolve([{ id: 'late-child', title: 'Late fictional child' }]);
    await saving;
    assert.equal(events(f, 'render').length, 0);
    assert.equal(events(f, 'taskDialog').length, 0);

    f = fixture(); wait = deferred();
    f.add = async () => { throw http(503); };
    await f.ctx.saveRelatedReview(f.form, f.items);
    let canApply;
    f.refresh = predicate => { canApply = predicate; return wait.promise; };
    const checking = f.ctx.checkRelatedReview(f.form);
    invalid(f);
    assert.equal(canApply(), false);
    wait.resolve({ changed: true, verified: true });
    await checking;
    assert.equal(f.result.innerHTML, '');
    assert.equal(events(f, 'taskDialog').length, 0);
    assert.equal(f.ui.syncing, false);
  }
});
