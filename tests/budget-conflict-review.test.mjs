import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import '../legacy/budget.js';

const B = globalThis.GatherBudget;
const source = readFileSync('legacy/budget-ui.js', 'utf8');
const costId = 'fictional-cost';
const opening = { id: costId, title: 'Tent rental', estimate: 12000, committed: null, paid: null, owner: '', taskId: '', dueDate: '', status: 'active' };
const saved = changes => ({ ...opening, ...changes });
const actor = 'fictional-organizer';
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

test('normalized cost comparison retains disjoint or identical edits and never silently chooses a conflicting value', () => {
  const latest = saved({ title: 'Weather canopy', estimate: 15000, paid: 0 });
  const draft = saved({ committed: 14000, paid: 0 });
  const before = structuredClone([opening, latest, draft]);
  const clean = B.compareCostEdits(opening, latest, draft);
  assert.deepEqual(clean.conflicts, []);
  assert.equal(clean.coupled, false);
  assert.deepEqual(clean.changed, ['title', 'estimate', 'paid']);
  assert.equal(clean.merged.title, 'Weather canopy');
  assert.equal(clean.merged.estimate, 15000);
  assert.equal(clean.merged.committed, 14000);
  assert.equal(clean.merged.paid, 0, 'explicit zero is different from blank');
  const same = B.compareCostEdits(opening, latest, latest);
  assert.deepEqual(same.conflicts, []);
  assert.equal(same.merged.paid, 0);
  const unresolved = B.compareCostEdits(opening, latest, saved({ estimate: 11000, paid: 9000 }));
  assert.deepEqual([...unresolved.conflicts].sort(), ['estimate', 'paid']);
  assert.equal(unresolved.merged.estimate, latest.estimate);
  assert.equal(unresolved.merged.paid, latest.paid);
  const cancelled = saved({ status: 'cancelled' }), changedAmount = saved({ paid: 1000 });
  assert.equal(B.compareCostEdits(opening, cancelled, changedAmount).coupled, true);
  assert.equal(B.compareCostEdits(opening, changedAmount, cancelled).coupled, true);
  assert.equal(B.compareCostEdits(opening, cancelled, saved({ title: 'Tent option' })).coupled, false);
  assert.deepEqual([opening, latest, draft], before, 'comparison does not mutate a saved row or draft');
});

function element(attrs = {}) {
  return { children: [], dataset: {}, listeners: {}, disabled: false, hidden: false, isConnected: true, value: '', ...attrs,
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() { this.isConnected = false; },
    getAttribute(name) { return this[name] ?? null; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    toggleAttribute(name, force) { if (force) this[name] = ''; else delete this[name]; },
    closest() { return null; },
    focus() {},
  };
}

async function harness() {
  const requests = [], notices = [];
  const host = element({ innerHTML: '', contains: () => false, querySelector: () => null, querySelectorAll: () => [] });
  const initialBudget = { ...B.initial(), enabled: true, items: [opening] };
  let response = { revision: 7, identity: { admin: true, actor }, budget: initialBudget };
  let form, poll, nextPost = 409, nextRead = 200, closed = 0, releaseRead;
  const window = { GatherBudget: B, GatherMode: { projectId: 'fictional-event' } };
  const document = { hidden: false, activeElement: null, getElementById: () => form, createElement: tag => element({ tagName: tag.toUpperCase() }) };
  function payload(row) {
    return Object.fromEntries(Object.entries(row).filter(([key]) => ['title','estimate','committed','paid','owner','taskId','dueDate','status'].includes(key))
      .map(([key, value]) => [key, ['estimate','committed','paid'].includes(key) ? B.inputAmount(value, response.budget.currency) : value]));
  }
  class SuccessfulFormData extends Map {
    constructor(form) { super(Object.entries(form.values).filter(([, control]) => !control.disabled).map(([key, control]) => [key, control.value])); }
  }
  function makeForm(markup) {
    const values = Object.fromEntries(Object.entries(payload(opening)).map(([key, value]) => [key, element({ name: key, value })]));
    for (const key of ['taskId', 'owner']) {
      values[key].options = [element({ value: '' })];
      values[key].append = function (option) { this.options.push(option); };
    }
    const controls = new Map();
    for (const key of Array.from(markup.matchAll(/\b(data-budget-[\w-]+)/g), match => match[1])) controls.set(`[${key}]`, element());
    const error = element({ innerHTML: '' });
    let message = '';
    Object.defineProperty(error, 'textContent', { get: () => message, set(value) { message = value; error.replaceChildren(); } });
    const submit = element({ type: 'submit' });
    return element({ values, controls, error, submit, markup,
      elements: { namedItem: name => values[name] ?? null },
      querySelector(selector) {
        if (selector === '.form-error') return error;
        if (selector.includes('type="submit"') || selector.includes('type=submit')) return submit;
        const named = selector.match(/^\[name="([^"]+)"\]$/);
        if (named) return values[named[1]] ?? null;
        return controls.get(selector) ?? null;
      },
      querySelectorAll: () => Object.values(values),
      closest: selector => selector === '#dialog' ? form : null,
    });
  }
  vm.runInNewContext(source, { window, document, FormData: SuccessfulFormData, URLSearchParams, AbortController, setTimeout, clearTimeout,
    setInterval: fn => (poll = fn, 1), clearInterval() {}, crypto,
    fetch: async (_url, options) => {
      const method = options.method;
      requests.push({ method, payload: options.body ? JSON.parse(options.body) : undefined });
      if (method === 'GET' && releaseRead) await releaseRead;
      const status = method === 'POST' ? nextPost : nextRead;
      return { ok: status === 200, status, json: async () => status === 200 ? structuredClone(response) : { error: status === 409 ? 'Budget changed. Reload it.' : 'Fixture cannot read Budget.' } };
    },
  });
  const ui = window.GatherBudgetUI.create({ h, getActor: () => actor, isDialogOpen: () => !!form, getWorkspace: () => ({ tasks: [], members: [] }),
    toast: notice => notices.push(notice),
    openDialog: (_title, markup) => { form = makeForm(markup); },
    closeDialog() { if (form) form.isConnected = false; form = null; closed++; },
    saveLock() {
      const current = form;
      Object.values(current.values).forEach(control => { control.disabled = true; });
      return () => Object.values(current.values).forEach(control => { control.disabled = false; });
    },
  });
  ui.mount(host);
  await setImmediate();
  const event = target => ({ currentTarget: target, submitter: target?.submit, preventDefault() {}, stopPropagation() {} });
  host.listeners.click({ target: { closest: () => ({ dataset: { budgetEdit: costId }, hasAttribute: () => false }) } });
  assert.ok(form, 'cost edit dialog is mounted');
  return { requests, notices, window, get form() { return form; }, get closed() { return closed; },
    get posts() { return requests.filter(({ method }) => method === 'POST').map(({ payload }) => payload); },
    get reads() { return requests.filter(({ method }) => method === 'GET').length; },
    update(row, { revision = 8, currency = 'USD', admin = true, enabled = true, responseActor = actor } = {}) {
      response = { revision, identity: { admin, actor: responseActor }, budget: { ...initialBudget, currency, enabled, items: row ? [row] : [] } };
    },
    set nextPost(value) { nextPost = value; },
    set nextRead(value) { nextRead = value; },
    set pendingRead(value) { releaseRead = value; },
    draft(changes) { for (const [key, value] of Object.entries(changes)) form.values[key].value = value; },
    values() { return Object.fromEntries(Object.entries(form.values).map(([key, control]) => [key, control.value])); },
    control(selector) { return form.querySelector(selector) ?? form.error.children.find(child => child.getAttribute(selector.slice(1,-1)) !== null); },
    submit() { return form.listeners.submit(event(form)); },
    async click(selector) {
      const node = this.control(selector);
      assert.ok(node?.listeners.click, `missing listener for ${selector}`);
      await node.listeners.click(event(node));
      await setImmediate();
    },
    async poll() { poll(); await setImmediate(); },
  };
}

const check = '[data-budget-check-current]';
const adopt = '[data-budget-adopt-current]';

test('a definitive conflict blocks repeat POST; a disjoint review and explicit adoption preserve draft until explicit Save', async () => {
  const f = await harness();
  f.draft({ title: 'My tent rental', committed: '140.00' });
  const before = f.values();
  await f.submit();
  assert.ok(f.control(check));
  assert.equal(f.control(adopt), undefined);
  assert.equal(f.closed, 0);
  await f.submit();
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].revision, 7);

  f.update(saved({ estimate: 15000, paid: 0 }));
  await f.click(check);
  assert.equal(f.reads, 2);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), before);
  assert.match(f.form.error.textContent, /Estimate.*Payment recorded/);
  assert.ok(f.control(adopt));
  await f.submit();
  assert.equal(f.posts.length, 1, 'checked but not adopted is not permission to save');
  await f.click(adopt);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), { ...before, estimate: '150.00', paid: '0.00' });
  assert.match(f.form.error.textContent, /choose Save/);
  assert.equal(f.closed, 0);
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[1].revision, 8);
  assert.notEqual(f.posts[0].requestId, f.posts[1].requestId);
  assert.deepEqual(f.posts[1].item, { ...before, estimate: '150.00', paid: '0.00' });
  assert.equal(f.closed, 1);
  assert.equal(f.notices.length, 1);
});

test('an edit made after checking is re-compared; unequal overlap never adopts or posts', async () => {
  const f = await harness();
  f.draft({ committed: '140.00' });
  await f.submit();
  f.update(saved({ estimate: 15000 }));
  await f.click(check);
  assert.ok(f.control(adopt));
  f.draft({ estimate: '160.00' });
  const before = f.values();
  await f.click(adopt);
  assert.match(f.form.error.textContent, /same fields: Estimate.*\$150\.00/);
  assert.equal(f.control(adopt), undefined);
  assert.deepEqual(f.values(), before);
  await f.submit();
  assert.equal(f.posts.length, 1);
  assert.equal(f.closed, 0);

  f.draft({ estimate: '150' });
  await f.click(check);
  assert.ok(f.control(adopt), 'normalized equal amounts are not a conflict');
  await f.click(adopt);
  assert.equal(f.values().estimate, '150.00');
  assert.equal(f.posts.length, 1);
});

test('an incompatible or unavailable current row cannot unlock the existing draft', async () => {
  for (const [row, options] of [
    [null, {}], [saved({ archivedAt: '2026-11-22T16:00:00Z' }), {}], [opening, { admin: false }],
    [opening, { enabled: false }], [opening, { currency: 'EUR' }], [opening, { revision: 6 }],
  ]) {
    const f = await harness();
    f.draft({ committed: '140.00' });
    const before = f.values();
    await f.submit();
    f.update(row, options);
    await f.click(check);
    assert.equal(f.control(adopt), undefined);
    assert.match(f.form.error.textContent, /cannot be safely refreshed/);
    assert.deepEqual(f.values(), before);
    await f.submit();
    assert.equal(f.posts.length, 1);
    assert.equal(f.closed, 0);
  }
});

test('status and amount changes are not automatically combined, even in separate fields', async () => {
  const f = await harness();
  f.draft({ paid: '30.00' });
  const before = f.values();
  await f.submit();
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'true');
  f.update(saved({ status: 'cancelled' }));
  await f.click(check);
  assert.match(f.form.error.textContent, /Status and amount changes affect the forecast together.*Status: cancelled/);
  assert.equal(f.control(adopt), undefined);
  assert.deepEqual(f.values(), before);
  await f.submit();
  assert.equal(f.posts.length, 1);
});

test('a definitive same-revision conflict uses a fresh key after verification, but an uncertain retry keeps its key', async () => {
  const f = await harness();
  f.draft({ paid: '12.00' });
  f.nextPost = 503;
  await f.submit();
  assert.equal(f.control(check), undefined);
  f.nextPost = 409;
  await f.submit();
  assert.equal(f.posts[1].requestId, f.posts[0].requestId);
  f.update(opening, { revision: 7 });
  await f.click(check);
  await f.click(adopt);
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'false');
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts[2].revision, 7);
  assert.notEqual(f.posts[2].requestId, f.posts[1].requestId);
  assert.deepEqual(f.posts[2].item, f.posts[1].item);
});

test('a failed read does not unlock or reset the draft; an outstanding read cannot update a closed form', async () => {
  const f = await harness();
  f.draft({ paid: '12.00' });
  const before = f.values();
  await f.submit();
  f.nextRead = 503;
  await f.click(check);
  assert.match(f.form.error.textContent, /Could not review/);
  assert.deepEqual(f.values(), before);
  assert.equal(f.control(adopt), undefined);
  await f.submit();
  assert.equal(f.posts.length, 1);

  f.nextRead = 200;
  f.update(saved({ estimate: 15000 }));
  let finishRead;
  f.pendingRead = new Promise(resolve => { finishRead = resolve; });
  const oldForm = f.form;
  const outstanding = f.click(check);
  const oldText = oldForm.error.textContent;
  await f.click('[data-budget-close]');
  finishRead();
  await outstanding;
  assert.equal(f.closed, 1);
  assert.equal(oldForm.error.textContent, oldText);
  assert.equal(f.posts.length, 1);
});

test('a recovery GET that denies access clears the open form and replaces the old Budget panel', async () => {
  for (const status of [401, 403, 404]) {
    const f = await harness();
    f.draft({ paid: '12.00' });
    await f.submit();
    f.nextRead = status;
    await f.click(check);
    assert.equal(f.form, null);
    assert.equal(f.closed, 1);
    assert.equal(f.reads, 3);
    assert.equal(f.posts.length, 1);
  }
  const f = await harness();
  await f.submit();
  f.update(saved({ estimate: 15000 }), { responseActor: 'other-fixture-actor' });
  await f.click(check);
  assert.equal(f.form, null);
  assert.equal(f.posts.length, 1);
});
