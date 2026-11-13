import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import '../legacy/budget.js';

const source = readFileSync('legacy/budget-ui.js', 'utf8');
const B = globalThis.GatherBudget;
const cost = (id, patch = {}) => ({ id, title: `Cost ${id}`, status: 'active', estimate: null, committed: null, paid: null, ...patch });
const archive = { archivedAt: '2026-11-21T16:00:00Z' };
const cases = [
  [cost('unpriced'), { minimum: 0, missing: 'planned' }],
  [cost('active-zero', { estimate: 0 }), { minimum: 0, missing: '' }],
  [cost('paid-zero-without-plan', { paid: 0 }), { minimum: 0, missing: 'planned' }],
  [cost('only-deposit', { paid: 50000 }), { minimum: 50000, missing: 'planned' }],
  [cost('known-estimate', { estimate: 8000 }), { minimum: 8000, missing: '' }],
  [cost('zero-commitment-beats-estimate', { estimate: 8000, committed: 0, paid: 1000 }), { minimum: 1000, missing: '' }],
  [cost('archived-commitment', { ...archive, committed: 2000, paid: 4000 }), { minimum: 4000, missing: '' }],
  [cost('cancelled-no-payment', { ...archive, status: 'cancelled', estimate: 7000, committed: 6000 }), { minimum: 0, missing: 'payment' }],
  [cost('cancelled-zero', { status: 'cancelled', paid: 0, estimate: 7000 }), { minimum: 0, missing: '' }],
  [cost('cancelled-paid', { status: 'cancelled', paid: 3000, committed: 6000 }), { minimum: 3000, missing: '' }],
];
const uiRows = [
  cost('active-complete-zero', { estimate: 0 }),
  cost('active-first-incomplete', { paid: 50000 }),
  cost('active-second-incomplete'),
  cost('archive-complete-zero', { ...archive, paid: 0, status: 'cancelled' }),
  cost('archive-first-incomplete', { ...archive, estimate: 5000, status: 'cancelled' }),
  cost('archive-second-incomplete', { ...archive, paid: 35000 }),
];

test('a single forecast rule distinguishes unknown plans and cancelled payments, and does not change totals', () => {
  for (const [row, expected] of cases) assert.deepEqual(B.forecastAmount(row), expected, row.id);
  const budget = { ...B.initial(), enabled: true, target: 100000, items: cases.map(([row]) => row) };
  assert.deepEqual(B.totals(budget).forecast, { known: 66000, unknown: 4 });
  assert.equal(B.totals(budget).remaining, null);
  const complete = { ...budget, items: cases.filter(([, forecast]) => !forecast.missing).map(([row]) => row) };
  assert.deepEqual(B.totals(complete).forecast, { known: 16000, unknown: 0 });
  assert.equal(B.totals(complete).remaining, 84000);
});

async function harness(items = uiRows, { admin = true, enabled = true } = {}) {
  const document = { hidden: false }, requests = [], focused = [];
  let snapshot = { revision: 3, identity: { admin }, budget: { ...B.initial(), enabled, items, target: 20000 } }, poll, actor = 'fixture-member';
  const camel = name => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  const chars = { amp:'&',lt:'<',gt:'>',quot:'"','#39':"'" };
  const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => chars[entity]);
  const h = value => String(value ?? '').replace(/[&<>"']/g, char => `&${Object.keys(chars).find(key => chars[key] === char)};`);
  function node(tag, attributes = {}) {
    const element = {
      tagName: tag.toUpperCase(), id: attributes.id, isConnected: true, children: [], listeners: {},
      attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
      dataset: Object.fromEntries(Object.entries(attributes).filter(([name]) => name.startsWith('data-')).map(([name, value]) => [camel(name.slice(5)), value])),
      addEventListener(name, listener) { this.listeners[name] = listener; },
      hasAttribute(name) { return Object.hasOwn(attributes, name); },
      getAttribute(name) { return attributes[name] ?? null; },
      focus() { document.activeElement = this; focused.push(this); },
      matches(selector) {
        return selector.split(',').some(term => {
          if (term === ':disabled') return !!this.disabled;
          const match = term.trim().match(/^(?:#([\w-]+)|([\w-]+))?((?:\[[^\]]+\])*)$/);
          if (!match) return false;
          const [, id, name, attrs] = match;
          return (!id || id === this.id) && (!name || name.toUpperCase() === this.tagName) &&
            Array.from(attrs.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every(([, key, value]) => this.hasAttribute(key) && (value === undefined || value === this.getAttribute(key)));
        });
      },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; },
      contains(child) { for (let current = child; current; current = current.parentElement) if (current === this) return true; return false; },
      getClientRects() { return this.isConnected ? [{}] : []; },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    };
    return element;
  }
  document.body = node('body');
  document.activeElement = document.body;
  function detach(el) {
    if (document.activeElement === el) document.activeElement = document.body;
    el.isConnected = false;
    el.children.forEach(detach);
  }
  function newHost() {
    const root = node('div', { id: 'eventBudget' });
    let html = '';
    Object.defineProperty(root, 'innerHTML', {
      get: () => html,
      set(markup) {
        html = markup;
        root.children.forEach(detach);
        root.children = [];
        const parents = [root];
        for (const [, close, name, attrs] of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
          if (close) {
            const parent = parents.findLastIndex(el => el.tagName === name.toUpperCase());
            if (parent > 0) parents.length = parent;
          } else {
            const parsed = Object.fromEntries(Array.from(attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g), ([, key, value]) => [key, decode(value ?? '')]));
            const child = node(name, parsed);
            child.parentElement = parents.at(-1);
            child.parentElement.children.push(child);
            if (!['input', 'br', 'hr', 'img'].includes(name)) parents.push(child);
          }
        }
      },
    });
    return root;
  }
  const window = { GatherBudget: B, GatherMode: { projectId: 'fictional-budget-review' } };
  vm.runInNewContext(source, { window, document, URLSearchParams, AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: callback => callback(), setInterval: callback => (poll = callback, 1), clearInterval() {},
    fetch: async (_url, options) => { requests.push(options.method); return { ok: true, json: async () => structuredClone(snapshot) }; },
  });
  const ui = window.GatherBudgetUI.create({ h, getActor: () => actor, isDialogOpen: () => false,
    focusControl: el => (el.focus(), true), getWorkspace: () => ({ tasks: [], members: [] }),
    openDialog() { assert.fail('navigating to a missing cost must not open an edit dialog'); },
  });
  let host = newHost();
  ui.mount(host);
  await setImmediate();
  return { get host() { return host; }, window, document, requests, focused, ui,
    control: mode => host.querySelector(`[data-budget-review-incomplete="${mode}"]`),
    heading: id => host.querySelector(`[data-budget-cost-heading="${id}"]`),
    click(target) { host.listeners.click({ target, preventDefault() {} }); },
    changeActor(value) { actor = value; },
    remount() {
      ui.unmount(true);
      detach(host);
      host = newHost();
      host.innerHTML = ui.markup();
      ui.mount(host);
    },
    async update(items, enabled = true) {
      snapshot = { ...snapshot, revision: snapshot.revision + 1, budget: { ...snapshot.budget, items, enabled } };
      poll();
      await setImmediate();
    },
  };
}

const rowHtml = (host, id) => Array.from(host.innerHTML.matchAll(/<li>[\s\S]*?<\/li>/g), match => match[0])
  .find(markup => markup.includes(`data-budget-cost-heading="${id}"`));

test('the expected total counts both lists, and each read-only action focuses the first incomplete cost in that list', async () => {
  const f = await harness(uiRows, { admin: false });
  assert.match(f.host.innerHTML, /At least \$850\.00/);
  assert.match(f.host.innerHTML, /4 costs are still incomplete/);
  assert.match(f.host.innerHTML, /At least \$650\.00 over target/);
  assert.ok(f.control('active') && f.control('archived'));
  assert.deepEqual(JSON.parse(f.control('archived').dataset.budgetScope), [false, 'fictional-budget-review', 'fixture-member']);
  assert.doesNotMatch(rowHtml(f.host, 'active-complete-zero'), /budget-incomplete-cost/);
  assert.match(rowHtml(f.host, 'active-first-incomplete'), /Incomplete forecast\..*The payment is only a minimum\./);
  assert.match(rowHtml(f.host, 'active-second-incomplete'), /Incomplete forecast\..*Missing an estimate or committed amount\./);
  assert.equal(f.heading('archive-first-incomplete'), null);

  f.click(f.control('active'));
  assert.equal(f.document.activeElement, f.heading('active-first-incomplete'));
  const descriptionId = f.document.activeElement.getAttribute('aria-describedby');
  assert.ok(descriptionId && f.host.querySelector(`#${descriptionId}`)?.getAttribute('class') === 'budget-incomplete-cost');
  f.click(f.control('archived'));
  assert.equal(f.document.activeElement, f.heading('archive-first-incomplete'));
  assert.match(f.host.innerHTML, /data-budget-archived\s+checked/);
  assert.equal(f.heading('active-first-incomplete'), null);
  assert.doesNotMatch(rowHtml(f.host, 'archive-complete-zero'), /budget-incomplete-cost/);
  assert.match(rowHtml(f.host, 'archive-first-incomplete'), /Incomplete forecast\..*Cancelled: no net payment recorded\./);
  assert.match(rowHtml(f.host, 'archive-second-incomplete'), /The payment is only a minimum/);
  assert.match(f.host.innerHTML, /At least \$850\.00/);
  f.click(f.control('active'));
  assert.equal(f.document.activeElement, f.heading('active-first-incomplete'));
  assert.deepEqual(f.requests, ['GET']);
  assert.doesNotMatch(f.host.innerHTML, /data-budget-edit|data-budget-add/);
});

test('archived-only incompleteness offers one valid shortcut; complete or disabled Budget offers none', async () => {
  const onlyArchived = [uiRows[0], uiRows[3], uiRows[4]];
  const f = await harness(onlyArchived);
  assert.equal(f.control('active'), null);
  assert.match(f.host.innerHTML, /1 cost is still incomplete/);
  const archivedControl = f.control('archived');
  assert.ok(archivedControl);
  f.click(archivedControl);
  assert.equal(f.document.activeElement, f.heading('archive-first-incomplete'));

  await f.update([uiRows[0], uiRows[3], { ...uiRows[4], paid: 0 }]);
  assert.equal(f.control('archived'), null);
  assert.equal(f.control('active'), null);
  assert.doesNotMatch(f.host.innerHTML, /still incomplete|budget-incomplete-cost/);
  const before = f.focused.length;
  f.click(archivedControl);
  assert.equal(f.focused.length, before, 'stale shortcut cannot move focus');
  assert.deepEqual(f.requests, ['GET', 'GET']);

  await f.update(onlyArchived, false);
  assert.equal(f.control('archived'), null);
  assert.equal(f.control('active'), null);
  assert.doesNotMatch(f.host.innerHTML, /budget-incomplete-cost/);
});

test('a shortcut resolves against the latest cost order and never acts on lost access', async () => {
  const f = await harness();
  const old = f.control('active');
  const rows = uiRows.map(row => row.id === 'active-first-incomplete' ? { ...row, estimate: row.paid } : row);
  await f.update(rows);
  const current = f.control('active');
  assert.notEqual(current, old);
  const before = f.focused.length;
  f.click(old);
  f.window.GatherAccessLost = true;
  f.click(current);
  assert.equal(f.focused.length, before);
  f.window.GatherAccessLost = false;
  f.click(current);
  assert.equal(f.document.activeElement, f.heading('active-second-incomplete'));
  assert.deepEqual(f.requests, ['GET', 'GET']);
});

test('passive redraw retains the same shortcut while present, otherwise focuses the Costs heading', async () => {
  const f = await harness();
  const archivedShortcut = f.control('archived');
  archivedShortcut.focus();
  await f.update(uiRows.map(row => row.id === 'active-second-incomplete' ? { ...row, title: 'Changed unrelated cost' } : row));
  assert.notEqual(f.control('archived'), archivedShortcut);
  assert.equal(f.document.activeElement, f.control('archived'));
  await f.update(uiRows.filter(row => !row.archivedAt || !B.forecastAmount(row).missing));
  assert.equal(f.control('archived'), null);
  assert.ok(f.control('active'));
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetCostsHeading'));
});

test('a remount queues focus for the exact shortcut only in the original project and account', async () => {
  const f = await harness();
  const previous = f.control('archived');
  previous.focus();
  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(previous), true);
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
  await setImmediate();
  assert.equal(f.document.activeElement, f.control('archived'));
  assert.notEqual(f.document.activeElement, previous);

  for (const change of [
    () => { f.window.GatherMode.projectId = 'other-fictional-budget'; },
    () => { f.changeActor('different-fixture-member'); },
  ]) {
    const original = f.control('archived');
    original.focus();
    change();
    const count = f.focused.length;
    f.click(original);
    assert.equal(f.focused.length, count, 'a visible shortcut from the old scope cannot navigate');
    f.remount();
    assert.equal(f.ui.restoreLinkedTaskFocus(original), false);
    await setImmediate();
    assert.equal(f.document.activeElement, f.document.body);
    assert.ok(f.control('archived'));
  }
});
