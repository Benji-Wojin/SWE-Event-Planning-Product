import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

function fixture() {
  const store = GatherStore.createStore({ storage: null });
  const parent = store.addTask({ title: 'Fictional arrival', owner: 'jack' });
  const old = store.addLinkedTask(parent.id, { title: 'Existing related step', owner: '', note: '', kind: 'related', reason: 'Fictional parallel work.' });
  const get = id => store.getState().tasks.find(task => task.id === id);
  const ids = store.addRelatedTasks(parent.id, { revision: get(parent.id).revision,
    items: [{ title: 'Review entrance' }, { title: 'Walk arrival route' }],
  }).map(task => task.id);
  const batch = { actor: 'jack', project: 'p_fictional', view: 'tasks', parentId: parent.id, ids, childId: '' };
  const ui = { actor: 'jack', view: 'tasks', dialogKind: 'task', detailId: parent.id, relatedBatch: batch };
  const window = { GatherMode: { projectId: batch.project } };
  const events = [], frames = [];
  let organizer = true;
  const focusable = (name, dataset = {}) => ({ name, dataset, isConnected: true,
    focus(options) { events.push(['focus', name, options]); }, scrollIntoView() {} });
  const child = focusable('first receipt child', { action: 'open-related-batch-child', id: ids[0] });
  const otherChild = focusable('second receipt child', { action: 'open-related-batch-child', id: ids[1] });
  const unrelated = focusable('outside receipt', { action: 'open-related-batch-child', id: ids[0] });
  const receiptHeading = focusable('receipt heading'), parentHeading = focusable('parent heading');
  const dialog = {}, backdrop = { hidden: false };
  let visibleActions = [otherChild, child], visibleReceiptHeading = receiptHeading, visibleParentHeading = parentHeading;
  const receipt = { contains: node => visibleActions.includes(node), querySelectorAll: () => visibleActions };
  const ctx = vm.createContext({
    ui, window, store, h, isOrganizer: () => organizer, dayLabel: value => value,
    taskDialog(...args) { events.push(['open', ...args]); ui.detailId = args[0]; },
    closeDialog() { events.push(['close']); ui.dialogKind = ''; }, toast: value => events.push(['toast', value]),
    requestAnimationFrame: callback => frames.push(callback),
    $(selector) {
      return ({ '#dialog': dialog, '#dialogBackdrop': backdrop, '#relatedReceipt': receipt,
        '#relatedReceiptHeading': visibleReceiptHeading, '#dialogTitle': visibleParentHeading })[selector] ?? null;
    },
    $$(selector) { return selector === '[data-action="open-related-batch-child"]' ? visibleActions : []; },
  });
  const relatedHelpers = source.indexOf('  function relatedTasksFor(');
  const handoff = source.indexOf('  function relatedBatchInScope(');
  const end = source.indexOf('  function paintRelatedSaveState(', handoff);
  assert.ok(relatedHelpers >= 0 && handoff >= 0 && end > handoff, 'task breakdown handoff helpers');
  vm.runInContext(source.slice(Math.min(relatedHelpers, handoff), end), ctx);
  return { ctx, store, get, ui, window, parent, old, ids, batch, child, otherChild, unrelated, events,
    set organizer(value) { organizer = value; },
    set actions(value) { visibleActions = value; },
    set receiptHeading(value) { visibleReceiptHeading = value; },
    flush() { for (const frame of frames.splice(0)) frame(); },
  };
}

test('only an exact current receipt button opens its still-related child', () => {
  const f = fixture(), before = f.store.exportState();
  assert.equal(f.ctx.relatedBatchInScope(f.batch), true);
  f.ctx.openRelatedBatchChild(f.ids[0], f.unrelated);
  f.ctx.openRelatedBatchChild(f.old.id, f.child);
  assert.deepEqual(f.events, []);
  f.ctx.openRelatedBatchChild(f.ids[0], f.child);
  assert.deepEqual(f.events, [['open', f.ids[0], '', false, true]]);
  assert.equal(f.batch.childId, f.ids[0]);
  assert.equal(f.store.exportState(), before);

  const stale = fixture();
  stale.store.removeDependency(stale.parent.id, stale.ids[0]);
  stale.ctx.openRelatedBatchChild(stale.ids[0], stale.child);
  assert.ok(stale.events.every(([event]) => event !== 'open'));
  assert.equal(stale.batch.childId, '');
});

test('a receipt child has distinct return and task-edit actions; scope changes reject handoff', () => {
  const f = fixture();
  f.batch.childId = f.ids[0];
  const markup = f.ctx.relatedBatchChildMarkup(f.batch, f.get(f.ids[0]));
  assert.match(markup, /Back to added tasks/);
  assert.match(markup, /Edit owner and due date/);
  assert.equal((markup.match(/<button\b/g) || []).length, 2);
  for (const id of [f.parent.id, f.ids[1], f.old.id]) {
    assert.doesNotMatch(f.ctx.relatedBatchChildMarkup(f.batch, f.get(id)), /Back to added tasks|Edit owner and due date/);
  }

  for (const change of [
    state => { state.ui.actor = 'maya'; }, state => { state.ui.view = 'timeline'; },
    state => { state.window.GatherMode.projectId = 'p_other'; }, state => { state.window.GatherAccessLost = true; },
    state => { state.organizer = false; },
  ]) {
    const scoped = fixture();
    scoped.ctx.openRelatedBatchChild(scoped.ids[0], scoped.child);
    scoped.events.length = 0;
    change(scoped);
    assert.equal(scoped.ctx.relatedBatchInScope(scoped.batch), false);
    assert.equal(scoped.ctx.returnToRelatedBatch(), false);
    assert.deepEqual(scoped.events, []);
  }
});

test('the receipt reads the current owner and due date without mixing in old or disconnected work', () => {
  const f = fixture();
  const render = () => f.ctx.relatedReceiptMarkup(f.get(f.parent.id), f.store.getState(), f.ids);
  assert.match(render(), /Review entrance<\/button><p[^>]*>Unassigned · No due date/);
  const owner = f.store.getState().members.find(person => person.id === 'maya').name;
  f.store.updateTask(f.ids[0], { owner: 'maya', dueDate: '2026-11-20' });
  const before = f.store.exportState();
  const assigned = render();
  assert.ok(assigned.includes(`${h(owner)} · Due 2026-11-20`));
  assert.match(assigned, /Walk arrival route<\/button><p[^>]*>Unassigned · No due date/);
  assert.doesNotMatch(assigned, /Existing related step/);
  assert.equal(f.store.exportState(), before);
  f.store.removeDependency(f.parent.id, f.ids[0]);
  assert.match(render(), /Smaller tasks still linked/);
  assert.doesNotMatch(render(), /Review entrance|Due 2026-11-20/);
});

test('return reopens the receipt and focuses the original child or the next appropriate heading', () => {
  for (const [visible, target] of [['child', 'first receipt child'], ['receipt', 'receipt heading'], ['parent', 'parent heading']]) {
    const f = fixture();
    f.ctx.openRelatedBatchChild(f.ids[0], f.child);
    f.events.length = 0;
    if (visible !== 'child') f.actions = [f.otherChild];
    if (visible === 'parent') f.receiptHeading = null;
    assert.equal(f.ctx.returnToRelatedBatch(), true);
    assert.equal(f.batch.childId, '');
    assert.deepEqual(f.events, [['open', f.parent.id, '', false, true]]);
    f.flush();
    assert.deepEqual(f.events.filter(([type]) => type === 'focus').map(([, name]) => name), [target]);
  }
});

test('return does not reopen a deleted parent or steal focus from a later dialog', () => {
  const f = fixture();
  f.ctx.openRelatedBatchChild(f.ids[0], f.child);
  f.events.length = 0;
  f.store.deleteTask(f.parent.id, f.get(f.parent.id).revision);
  f.ctx.returnToRelatedBatch();
  assert.ok(f.events.some(([event]) => event === 'close'));
  assert.ok(f.events.some(([event]) => event === 'toast'));
  assert.ok(f.events.every(([event]) => event !== 'open'));

  const moved = fixture();
  moved.ctx.openRelatedBatchChild(moved.ids[0], moved.child);
  assert.equal(moved.ctx.returnToRelatedBatch(), true);
  moved.ui.detailId = moved.old.id;
  moved.flush();
  assert.ok(moved.events.every(([event]) => event !== 'focus'));
});

test('the hosted task editor returns to the batch only after the confirmed save, without losing sibling drafts', async () => {
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const generated = readFileSync('public/gather-assets/app.js', 'utf8');
  const start = generated.indexOf("      if(form.id==='taskDetailForm'){");
  const end = generated.indexOf("      if(form.id==='priorityForm')", start);
  assert.ok(start >= 0 && end > start);
  const update = vm.runInNewContext('(async function(form,data){'+generated.slice(start,end)+'})', {
    store: {
      getState: () => ({tasks: [{id:'fictional-step',status:'todo'}]}),
      async updateTask(id,data,actor) {
        events.push(['save',id,data.owner,data.dueDate,actor]);
        await response;
      },
    },
    ui: {actor:'jack'}, window: {},
    confirmFixedDate: () => true, confirmTaskOwnerChange: () => approved,
    protectCompletionDraft: () => true, taskCompletionDraftContext: () => [],
    taskDrafts: () => drafts, taskDialog: (...args) => events.push(['edit',...args]),
    render: () => events.push(['render']),
    returnToRelatedBatch: () => {events.push(['batch']);return true;},
    returnToEventTaskReview: () => {throw Error('must prefer the batch return');},
    closeDialog: () => {throw Error('must keep the batch open');},
    toast: () => {}, member: () => ({name:'Organizer'}),
  });
  const events = [];
  let resolve, approved = false, drafts = [];
  const response = new Promise(done => {resolve=done;});
  const form = {id:'taskDetailForm',dataset:{id:'fictional-step'}}, data = {owner:'maya',dueDate:'2026-11-20'};
  await update(form,data);
  assert.deepEqual(events,[],'canceling reassignment makes no changes');
  approved = true;
  const pending = update(form,data);
  assert.deepEqual(events,[['save','fictional-step','maya','2026-11-20','jack']]);
  resolve();
  await pending;
  assert.deepEqual(events.slice(1),[['render'],['batch']]);
  events.length = 0;
  drafts = [{form:'commentForm'}];
  await update(form,data);
  assert.deepEqual(events.slice(1),[['render'],['edit','fictional-step','taskDetailForm']]);
});
