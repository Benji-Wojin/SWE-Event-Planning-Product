import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const prepare = readFileSync('scripts/prepare.mjs', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const original = {
  id: 'lesson-fictional-01', change: 'Review <hall> and tell "everyone"', active: true, outcome: 'not-evaluated',
  wentWell: 'HIDDEN LESSON SUCCESS', context: 'HIDDEN LESSON CONTEXT', outcomeNote: 'HIDDEN LESSON OUTCOME',
  category: 'HIDDEN CATEGORY', at: '2026-11-20T16:00:00Z', owner: 'HIDDEN OWNER', dueDate: '2030-11-21',
};
const hidden = /HIDDEN LESSON|HIDDEN CATEGORY|HIDDEN OWNER|2030-11-21|2026-11-20T16:00:00Z/;
function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

test('the lesson is an escaped reference outside a blank existing task form', () => {
  const events = [], ui = { actor: 'maya', view: 'memory', wrapMine: true };
  const context = vm.createContext({ ui, h, guidedWorkspace: false, canCreateTasks: () => true, isOrganizer: () => true,
    ownerOptions: selected => `<option value=""${selected ? '' : ' selected'}>Unassigned</option>`,
    options: () => '<option>Default</option>', statusOptions: value => `<option value="${value}">To do</option>`,
    store: {}, openDialog(...args) { events.push(args); },
  });
  vm.runInContext(fragment('  function newTaskDialog(', '  function followupDialog('), context);
  const before = structuredClone(original);
  context.newTaskDialog(false, original);
  assert.equal(events.length, 1);
  const html = events[0][1], form = html.match(/<form\b[^>]*id="newTaskForm"[^>]*>[\s\S]*?<\/form>/)?.[0];
  assert.ok(form, 'reuses the existing task creation form');
  assert.ok(html.includes(h(original.change)), 'the sole lesson reference is visible and escaped');
  assert.match(html, /aria-label="Source lesson"/);
  assert.match(form, /data-lesson-follow-up="lesson-fictional-01" data-lesson-edited-at=""/);
  assert.doesNotMatch(html, hidden);
  assert.doesNotMatch(html, /<hall>/);
  assert.doesNotMatch(form, /Review &lt;hall&gt;|name="(?:lesson|lessonId|lessonChange|memoryId)"/);
  for (const name of ['title', 'dueDate']) assert.doesNotMatch(form.match(new RegExp(`<input\\b[^>]*name="${name}"[^>]*>`))?.[0] ?? 'missing', /missing|\bvalue="[^"]+"/);
  for (const name of ['scope', 'note']) assert.match(form, new RegExp(`<textarea\\b[^>]*name="${name}"[^>]*><\\/textarea>`));
  assert.match(form, /<select name="owner"><option value="" selected>Unassigned<\/option>/);
  assert.match(form, /type="button"[^>]+data-action="close-dialog">Cancel/);
  assert.equal(events[0][4], 'lesson-follow-up');
  assert.deepEqual(original, before);
});

function openingFixture() {
  const ui = { view: 'memory', actor: 'maya', wrapMine: true };
  const window = { GatherAccessLost: false };
  const events = [], permissions = { canCreate: true };
  const other = { ...original, id: 'other-lesson', change: 'Unrelated lesson' };
  const retired = { ...original, id: 'retired-lesson', active: false };
  const unsuccessful = { ...original, id: 'unsuccessful-lesson', outcome: 'did-not-help' };
  const blank = { ...original, id: 'blank-lesson', change: '   ' };
  const state = { memories: [original, other, retired, unsuccessful, blank], tasks: [] };
  const backdrop = { hidden: true };
  const root = { contains: card => card.current };
  const context = vm.createContext({ ui, window, h, guidedWorkspace: false,
    canCreateTasks: () => permissions.canCreate, isOrganizer: () => true,
    ownerOptions: () => '', options: () => '', statusOptions: () => '', timeLabel: () => '', icon: () => '',
    pageHeading: (...args) => args[3], GatherWrapUp: { markup: () => '' },
    $: selector => ({ '#dialogBackdrop': backdrop, '#viewRoot': root })[selector],
    store: { getState: () => state },
    openDialog: (...args) => events.push(['open', ...args]), render: () => events.push(['render']), toast: value => events.push(['toast', value]),
  });
  vm.runInContext(fragment('  function isActionableLesson(', '  function followupDialog('), context);
  vm.runInContext(fragment('  const wrapLessonHeadingId=', '  function reminderScope('), context);
  function opener(id = original.id, { cardId = id, current = true, hidden = false, connected = true } = {}) {
    return { isConnected: connected, dataset: { id, action: 'draft-lesson-follow-up' },
      closest: selector => selector === '[data-wrap-lesson-card]' ? { dataset: { id: cardId }, current } : hidden };
  }
  return { context, opener, ui, window, state, events, permissions, backdrop };
}

test('only current actionable Wrap up lesson cards with task creation permission can open the draft', () => {
  const { context, opener, ui, window, state, events, permissions, backdrop } = openingFixture();
  const buttons = () => Array.from(context.memoryView(state).matchAll(/data-action="draft-lesson-follow-up" data-id="([^"]+)" aria-describedby="wrap-lesson-([^"]+)"/g), match => match.slice(1));
  assert.deepEqual(buttons(), [[original.id, original.id], ['other-lesson', 'other-lesson']]);
  permissions.canCreate = false;
  assert.deepEqual(buttons(), []);
  assert.equal(context.openLessonFollowUp(original.id, opener()), false);
  permissions.canCreate = true;
  window.GatherAccessLost = true;
  assert.deepEqual(buttons(), []);
  assert.equal(context.openLessonFollowUp(original.id, opener()), false);
  window.GatherAccessLost = false;
  ui.view = 'tasks';
  assert.equal(context.openLessonFollowUp(original.id, opener()), false);
  ui.view = 'memory';
  backdrop.hidden = false;
  assert.equal(context.openLessonFollowUp(original.id, opener()), false);
  backdrop.hidden = true;
  assert.equal(context.openLessonFollowUp(original.id, opener('other-lesson')), false);
  for (const invalid of [{ cardId: 'other-lesson' }, { current: false }, { hidden: true }, { connected: false }]) {
    assert.equal(context.openLessonFollowUp(original.id, opener(original.id, invalid)), false);
  }
  assert.deepEqual(events, []);
  for (const id of ['retired-lesson', 'unsuccessful-lesson', 'blank-lesson', 'missing-lesson']) {
    assert.equal(context.openLessonFollowUp(id, opener(id)), false);
  }
  assert.ok(events.every(([action]) => action === 'render' || action === 'toast'));
  const valid = opener();
  assert.equal(context.openLessonFollowUp(original.id, valid), true);
  assert.equal(ui.lastFocus, valid);
  assert.equal(ui.wrapMine, true);
  assert.equal(events.filter(([action]) => action === 'open').length, 1);
});

test('cancel restores the same lesson button, with a heading fallback if that action disappears', () => {
  const ui = { view: 'memory', wrapMine: true, dialogKind: 'lesson-follow-up' };
  const window = { GatherAccessLost: false }, focused = [];
  const node = (data = {}) => ({ dataset: data, matches: () => false, closest: () => null });
  const previous = node({ action: 'draft-lesson-follow-up', id: original.id });
  const replaced = node(previous.dataset), wrong = node({ action: 'draft-lesson-follow-up', id: 'other-lesson' });
  const heading = node({ wrapLesson: original.id }), fallback = node();
  let buttons = [wrong, replaced], headings = [heading];
  const backdrop = { dataset: {}, classList: { remove() {} } }, shell = {}, dialog = { replaceChildren() {} };
  const root = { ...node(), querySelector: () => ({ focus: () => focused.push('generic') }) };
  const context = vm.createContext({ ui, window, document: { body: { style: {} } }, store: {},
    $: selector => ({ '#dialogBackdrop': backdrop, '#appShell': shell, '#dialog': dialog, '#viewRoot': root, '#wrapUpLessons': fallback })[selector],
    $$: selector => selector === '[data-wrap-lesson]' ? headings : buttons,
    focusScheduleTarget: target => (focused.push(target), true), isScheduleControl: () => false,
    render: () => {},
  });
  vm.runInContext(fragment('  function closeDialog(', '  function openOrganizerReview(') + fragment('  function finishWrapUpLesson(', '  function thoughtDialog('), context);
  ui.lastFocus = previous;
  context.closeDialog();
  assert.deepEqual(focused.splice(0), [replaced]);
  assert.equal(ui.lastFocus, null);
  buttons = [wrong];
  ui.lastFocus = previous;
  context.closeDialog();
  assert.deepEqual(focused.splice(0), [heading]);
  headings = [];
  ui.lastFocus = previous;
  context.closeDialog();
  assert.deepEqual(focused.splice(0), [fallback]);
  assert.equal(ui.wrapMine, true);
  ui.lastFocus = previous;
  headings = [heading];
  assert.equal(context.finishWrapUpLesson(original.id), true);
  assert.equal(focused.at(-1), heading);
});

test('hosted confirmation awaits the existing task write, sending only user fields and exact lesson identity', async () => {
  const ui = { dialogKind: 'lesson-follow-up', actor: 'maya', view: 'memory', wrapMine: true };
  const window = { GatherAccessLost: false, GatherMode: { projectId: 'fictional-project' } };
  const editedAt = '2026-11-21T16:00:00.000Z';
  const form = { id: 'newTaskForm', isConnected: true, dataset: { lessonFollowUp: original.id, lessonEditedAt: editedAt } };
  let currentForm = form;
  const data = { title: 'Verify loading area', owner: '', dueDate: '', category: 'Venue', status: 'todo', scope: '', note: '' };
  const linkedData = { ...data, lessonId: original.id, lessonEditedAt: editedAt };
  const events = [];
  let complete, fail;
  const nextWrite = () => new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  let write = nextWrite();
  const context = vm.createContext({ ui, window, guidedWorkspace: true, canCreateTasks: () => true,
    store: { addTask: (payload, actor) => { events.push(['write', { ...payload }, actor]); return write; } },
    $: selector => selector === '#newTaskForm' ? currentForm : {},
    finishWrapUpLesson: id => events.push(['finish', id]), toast: value => events.push(['toast', value]), syncGuide: () => {},
    focusWrapFollowUpReceipt: id => events.push(['receipt focus',id]),
  });
  assert.match(prepare, /'addTask'/);
  assert.match(prepare, /'await store\.\$1\('/);
  const submit = fragment("      if(form.id==='newTaskForm')", "      if(form.id==='scheduleForm'").replace('store.addTask(', 'await store.addTask(');
  vm.runInContext(`async function submit(form,data) {const lessonSave=null;${submit}}`, context);
  const save = context.submit(form, data);
  assert.deepEqual(events, [['write', linkedData, 'maya']]);
  assert.doesNotMatch(JSON.stringify(events), /Review <hall>|outcomeNote|memoryId/);
  assert.doesNotMatch(JSON.stringify(events), hidden);
  complete({ id: 'new-task' });
  await save;
  assert.deepEqual(events.slice(1), [['finish', original.id],['receipt focus','new-task'], ['toast', 'Follow-up task added. Find it in Shared tasks.']]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.wrapFollowUpReceipt)),{actor:'maya',project:'fictional-project',taskId:'new-task',lessonId:original.id});
  assert.equal(ui.wrapMine, true);

  events.length = 0;
  delete form.dataset.lessonEditedAt;
  await assert.rejects(context.submit(form, data), /Review the source lesson/);
  assert.deepEqual(events, []);
  form.dataset.lessonEditedAt = editedAt;
  window.GatherAccessLost = true;
  await assert.rejects(context.submit(form, data), /can no longer add a follow-up/);
  assert.deepEqual(events, []);
  window.GatherAccessLost = false;
  write = nextWrite();
  const unsuccessful = context.submit(form, data);
  fail(new Error('not saved'));
  await assert.rejects(unsuccessful, /not saved/);
  assert.deepEqual(events, [['write', linkedData, 'maya']]);

  events.length = 0;
  currentForm = { ...form };
  await assert.rejects(context.submit(form, data), /can no longer add a follow-up/);
  assert.deepEqual(events, []);
  for (const [change, reset] of [
    [() => { currentForm = { ...form }; }, () => { currentForm = form; }],
    [() => { window.GatherAccessLost = true; }, () => { window.GatherAccessLost = false; }],
    [() => { window.GatherMode.projectId = 'different'; }, () => { window.GatherMode.projectId = 'fictional-project'; }],
    [() => { ui.actor = 'another-user'; }, () => { ui.actor = 'maya'; }],
  ]) {
    currentForm = form;
    write = nextWrite();
    const pending = context.submit(form, data);
    change();
    complete({ id: 'new-task' });
    await pending;
    assert.deepEqual(events.splice(0), [['write', linkedData, 'maya']], 'never closes or relabels a replacement context');
    reset();
  }
});

test('generic Wrap up confirmation records a receipt while an ordinary task form does not',async()=>{
  const ui={actor:'maya',view:'memory',wrapMine:true,dialogKind:'wrap-follow-up'},window={GatherMode:{projectId:'fictional'}};
  const events=[],form={id:'newTaskForm',isConnected:true,dataset:{wrapFollowUp:'true'}};
  const ctx=vm.createContext({ui,window,guidedWorkspace:false,canCreateTasks:()=>true,$:()=>form,
    store:{addTask:async()=>({id:'confirmed-task'})},closeDialog:()=>events.push('close'),render:()=>events.push('render'),
    focusWrapFollowUpReceipt:id=>events.push(id),toast:()=>{},syncGuide:()=>{}});
  const submit=fragment("      if(form.id==='newTaskForm')","      if(form.id==='scheduleForm'").replace('store.addTask(','await store.addTask(');
  vm.runInContext(`async function submit(form,data){const lessonSave=null;${submit}}`,ctx);
  await ctx.submit(form,{title:'Manually written'});
  assert.deepEqual(events.splice(0),['close','render','confirmed-task']);
  assert.equal(ui.wrapFollowUpReceipt.taskId,'confirmed-task');
  assert.equal(ui.wrapFollowUpReceipt.lessonId,'');
  assert.equal(ui.wrapMine,true);
  ui.wrapFollowUpReceipt=null;ui.dialogKind='';ui.view='tasks';
  await ctx.submit({...form,dataset:{}},{title:'Ordinary task'});
  assert.deepEqual(events,['close','render']);
  assert.equal(ui.wrapFollowUpReceipt,null);
});
