import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/planning-ui.js';

const row = (sourceTitle, patch = {}) => ({ sourceTitle, title: sourceTitle, scope: '', selected: false, ...patch });
const reconcile = (titles, previous, sameText) => GatherPlanningUI.reconcileRelatedChecklist(titles, previous, sameText);

test('manual checklist reconciliation preserves exact positions for an unchanged parsed list, including duplicates', () => {
  const previous = [row('Set up signs', { title: 'Print signs', scope: 'Print large type.', selected: true }),
    row('Set up signs', { title: 'Post signs', scope: 'Use the accessible route.', selected: false }), row('Brief volunteers')];
  const before = structuredClone(previous);
  const titles = GatherPlanningUI.relatedChecklistTitles('- [x] Set up signs\n2. Set up signs\n• Brief volunteers');
  const current = reconcile(titles, previous, true);
  assert.deepEqual(current, { rows: before, discarded: false });
  assert.deepEqual(previous, before);
  assert.deepEqual(titles, ['Set up signs', 'Set up signs', 'Brief volunteers']);
  assert.deepEqual(reconcile(titles, previous, false), { rows: titles.map(title => row(title)), discarded: true },
    'edited source text cannot transfer duplicate choices by position even if parsed titles are identical');
});

test('a changed checklist carries edits only for titles unique in both versions', () => {
  const keep = row('Confirm route', { title: 'Walk route with lead', scope: 'Check the step-free entrance.', selected: true });
  const previous = [row('Set up signs', { title: 'Print signs', selected: true }), row('Set up signs'), keep,
    row('Check weather', { scope: 'Find a backup.', selected: true }), row('Renamed old', { title: 'Edited old title' }), row('Only old')];
  const before = structuredClone(previous);
  const titles = ['New step', 'Confirm route', 'Set up signs', 'Check weather', 'Check weather', 'Renamed new'];
  assert.deepEqual(reconcile(titles, previous), {
    rows: [row('New step'), keep, row('Set up signs'), row('Check weather'), row('Check weather'), row('Renamed new')],
    discarded: true,
  });
  assert.deepEqual(previous, before);
});

test('only a dropped title edit, outcome or selection triggers a discard notice', () => {
  assert.deepEqual(reconcile(['New step'], [row('Old step')]), { rows: [row('New step')], discarded: false });
  assert.deepEqual(reconcile(['New step'], []), { rows: [row('New step')], discarded: false });
  for (const edit of [{ title: 'Edited step' }, { scope: 'A different outcome.' }, { selected: true }]) {
    const previous = row('Old step', edit);
    assert.equal(reconcile([], [previous]).discarded, true, JSON.stringify(edit));
    assert.deepEqual(reconcile(['Added', 'Old step'], [previous]), { rows: [row('Added'), previous], discarded: false });
  }
});

const source = readFileSync('legacy/app.js', 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
function flow() {
  const task = { id: 'fictional-task', title: 'Prepare arrival', revision: 7, status: 'todo' };
  const ui = { actor: 'jack', dialogKind: 'task' }, window = { GatherMode: { projectId: 'p_fictional', demo: true } };
  const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const calls = [], frames = [];
  const dialog = { querySelector(selector) { return selector === '[data-related-draft="true"]' && form?.dataset.relatedDraft === 'true' ? form : null; } };
  const heading = { focus() { calls.push('focus heading'); } };
  let form, body = '', allow = true;
  window.confirm = message => { calls.push(['confirm', message]); return allow; };
  const input = value => ({ tagName: 'INPUT', type: 'text', value, defaultValue: value });
  const checkbox = checked => ({ tagName: 'INPUT', type: 'checkbox', checked, defaultChecked: checked });
  const fieldset = (title, scope, checked = false) => ({ title: input(title), scope: input(scope), include: checkbox(checked), dataset: {} });
  const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, c) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[c]);
  function openDialog(_title, markup, _footer, _wide, kind) {
    if (form) form.isConnected = false;
    body = markup;
    ui.dialogKind = kind;
    const formTag = markup.match(/<form\b([^>]+)>/)[1];
    const dataset = Object.fromEntries([...formTag.matchAll(/data-([\w-]+)="([^"]*)"/g)].map(([, name, value]) =>
      [name.replace(/-([a-z])/g, (_match, c) => c.toUpperCase()), decode(value)]));
    const raw = decode(markup.match(/<textarea\b[^>]*name="checklist"[^>]*>([\s\S]*?)<\/textarea>/)?.[1] || '');
    form = { id: kind === 'related-review' ? 'relatedReviewForm' : 'relatedChecklistForm', dataset, isConnected: true,
      elements: { checklist: { ...input(raw), tagName: 'TEXTAREA', focus() { calls.push('focus checklist'); } } }, rows: [] };
    if (kind === 'related-review') {
      form.rows = [...markup.matchAll(/<fieldset\b[^>]*data-related-row[^>]*>([\s\S]*?)<\/fieldset>/g)].map(([, rowMarkup]) => {
        const title = rowMarkup.match(/<input\b[^>]*data-related-title[^>]*value="([^"]*)"/)?.[1] || '';
        const scope = rowMarkup.match(/<textarea\b[^>]*data-related-scope[^>]*>([\s\S]*?)<\/textarea>/)?.[1] || '';
        const checked = /<input\b[^>]*data-related-include[^>]*\bchecked\b/.test(rowMarkup);
        return fieldset(decode(title), decode(scope), checked);
      });
    }
  }
  const ctx = vm.createContext({
    ui, window, h, GatherPlanningUI, isOrganizer: () => true, store: { getState: () => ({ tasks: [task] }) },
    openDialog, formError: (_form, error) => calls.push(['formError', error.message]), toast: message => calls.push(['toast', message]),
    activeRelatedReview: candidate => candidate === form && candidate.isConnected && ui.dialogKind === 'related-review',
    relatedReviewKey: () => 'fictional', unconfirmedRelatedSaves: new Map(), paintRelatedSaveState: () => {},
    requestAnimationFrame: callback => frames.push(callback),
    $(selector, root) {
      if (selector === '#relatedChecklistForm' || selector === '#relatedReviewForm') return form?.id === selector.slice(1) ? form : null;
      if (selector === '#dialog') return dialog;
      if (selector === '#dialogTitle') return heading;
      return ({ '[data-related-title]': root?.title, '[data-related-scope]': root?.scope, '[data-related-include]': root?.include,
        '[name="checklist"]': form?.elements.checklist, 'textarea[name="checklist"]': form?.elements.checklist })[selector] || null;
    },
    $$(selector, root) {
      if (selector === '[data-related-row]') return (root || form).rows;
      if (selector === 'input,textarea,select') return (root === dialog ? form : root).rows.flatMap(r => [r.title, r.scope, r.include]);
      return [];
    },
  });
  vm.runInContext(section('  function openRelatedBatch(', '  function activeRelatedReview(') +
    section('  function hasUnsavedFields(', '  function hasAcceptanceReturnDraft('), ctx);
  return { ctx, task, ui, calls, dialog, get body() { return body; }, get form() { return form; },
    set allow(value) { allow = value; }, flush() { for (const frame of frames.splice(0)) frame(); } };
}

test('manual Back restores raw text; revising the checklist preserves kept values and protects dropped choices', () => {
  const f = flow();
  f.ctx.openRelatedBatch(f.task.id);
  const raw = '  - [x] Confirm route\r\n2. Put up signs\n';
  f.form.elements.checklist.value = raw;
  f.ctx.reviewRelatedBatch(f.form);
  assert.equal(f.ui.dialogKind, 'related-review');
  assert.match(f.body, /data-action="back-related-checklist">Back to checklist/);
  assert.equal(f.form.rows[0].include.checked, false);
  f.form.rows[0].title.value = 'Confirm accessible route';
  f.form.rows[0].scope.value = 'Step-free entrance checked.';
  f.form.rows[0].include.checked = true;
  f.form.rows[1].include.checked = true;
  f.ctx.backToRelatedChecklist(f.form);
  assert.equal(f.ui.dialogKind, 'related-checklist');
  assert.equal(f.form.elements.checklist.value, raw);
  assert.equal(f.form.dataset.relatedDraft, 'true');
  assert.equal(f.ctx.hasUnsavedFields(f.dialog), true);
  f.flush();
  assert.equal(f.calls.at(-1), 'focus checklist');

  f.form.elements.checklist.value = 'Confirm route\nNew step';
  const sourceForm = f.form;
  f.allow = false;
  f.ctx.reviewRelatedBatch(sourceForm);
  assert.equal(f.form, sourceForm, 'cancel retains the source editor');
  assert.equal(f.form.elements.checklist.value, 'Confirm route\nNew step');
  f.allow = true;
  f.ctx.reviewRelatedBatch(sourceForm);
  assert.equal(f.ui.dialogKind, 'related-review');
  assert.deepEqual(f.form.rows.map(r => [r.title.value, r.scope.value, r.include.checked]), [
    ['Confirm accessible route', 'Step-free entrance checked.', true], ['New step', '', false],
  ]);
  assert.equal(f.calls.filter(event => event[0] === 'confirm').length, 2);
  assert.equal(f.ctx.hasUnsavedFields(f.dialog), true);
});

test('stale or AI-only review cannot open the manual source editor', () => {
  const f = flow();
  f.ctx.openRelatedBatch(f.task.id);
  f.form.elements.checklist.value = 'Confirm route';
  f.ctx.reviewRelatedBatch(f.form);
  const review = f.form;
  f.task.revision++;
  f.ctx.backToRelatedChecklist(review);
  assert.equal(f.form, review);
  assert.match(f.calls.find(event => event[0] === 'formError')?.[1] || '', /changed/i);

  f.ctx.showRelatedReview(f.task, [{ title: 'Fictional AI proposal', scope: '' }], true);
  assert.doesNotMatch(f.body, /data-action="back-related-checklist"|Back to checklist/);
  assert.equal(f.form.dataset.relatedDraft, undefined);
});
