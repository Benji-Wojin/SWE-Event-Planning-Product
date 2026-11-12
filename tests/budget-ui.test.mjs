import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import '../legacy/budget.js';
async function harness(admin = true) {
  const budget = GatherBudget.initial(),
    requests = [];
  let snapshot = { revision: 1, identity: { admin }, budget },
    form,
    formMarkup,
    workspace = { tasks: [], members: [] },
    fail = 0, failRead = false, loads = 0,
    closed = 0,
    poll,
    renders = 0,
    markup = '';
  const host = {
    isConnected: true,
    innerHTML: '',
    listeners: {},
    addEventListener(event, fn) {
      this.listeners[event] = fn;
    },
  };
  const window = { GatherBudget, GatherMode: { projectId: 'main' } };
  Object.defineProperty(host, 'innerHTML', {
    get: () => markup,
    set(value) {
      markup = value;
      renders++;
    },
  });
  class SuccessfulFormData extends Map {
    constructor(form) {
      super(
        Object.entries(form.values)
          .filter(
            ([, control]) => !control.disabled && control.value !== undefined,
          )
          .map(([name, control]) => [name, control.value]),
      );
    }
  }
  vm.runInNewContext(readFileSync('legacy/budget-ui.js', 'utf8'), {
    window,
    document: {
      hidden: false,
      getElementById: () => form,
      createElement: () => ({ addEventListener() {} }),
    },
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval: (fn) => {
      poll = fn;
      return 1;
    },
    clearInterval() {},
    crypto,
    FormData: SuccessfulFormData,
    fetch: async (url, options) => {
      if (!options.body)
        return failRead ? {ok:false,status:503,json:async()=>({error:'Budget unavailable'})}
          : { ok: true, json: async () => structuredClone(snapshot) };
      const data = JSON.parse(options.body);
      requests.push(data);
      if (fail) {
        fail--;
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'Retry this save.' }),
        };
      }
      return { ok: true, json: async () => structuredClone(snapshot) };
    },
  });
  const ui = window.GatherBudgetUI.create({
    h: (value) => String(value),
    isDialogOpen: () => false,
    getWorkspace: () => workspace,
    onLoaded() { loads++; },
    toast() {},
    closeDialog: () => {
      closed++;
    },
    openDialog(_title, markup) {
      formMarkup = markup;
      const error = { textContent: '', append() {} },
        close = { addEventListener() {} };
      form = {
        dataset: {},
        values: {},
        listeners: {},
        querySelector: (selector) =>
          selector === '.form-error'
            ? error
            : selector === '[data-budget-close]'
              ? close
              : null,
        closest: () => form,
        addEventListener(event, fn) {
          this.listeners[event] = fn;
        },
      };
    },
    saveLock: (current) => {
      Object.values(current.values).forEach((control) => {
        control.disabled = true;
      });
      return () =>
        Object.values(current.values).forEach((control) => {
          control.disabled = false;
        });
    },
  });
  ui.mount(host);
  await setImmediate();
  const click = (attr, id) =>
    host.listeners.click({
      target: {
        closest: () => ({ dataset: id ? { budgetEdit: id } : {}, hasAttribute: (key) => key === attr }),
      },
    });
  return {
    host,
    requests,
    click,
    ui,
    setFailRead(value) { failRead=value; },
    get loads() { return loads; },
    get renders() {
      return renders;
    },
    async poll() {
      poll();
      await setImmediate();
    },
    enable() {
      snapshot = { ...snapshot, budget: { ...budget, enabled: true } };
      ui.mount(host);
    },
    setBudget(changes) {
      snapshot = { ...snapshot, budget: { ...budget, enabled: true, ...changes } };
    },
    setWorkspace(value) {
      workspace = value;
    },
    failOnce() {
      fail = 1;
    },
    get form() {
      return form;
    },
    get formMarkup() {
      return formMarkup;
    },
    get closed() {
      return closed;
    },
    async submit(values) {
      form.values = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          { value, disabled: false },
        ]),
      );
      await form.listeners.submit({
        preventDefault() {},
        stopPropagation() {},
        currentTarget: form,
      });
    },
  };
}
test('guide readiness does not fire for a failed budget load', async () => {
  const h = await harness();
  assert.equal(h.loads,1);
  h.setFailRead(true);
  h.click('data-budget-refresh');
  await setImmediate();
  assert.match(h.host.innerHTML,/Budget unavailable/);
  assert.equal(h.loads,1);
  h.setFailRead(false);
  h.click('data-budget-refresh');
  await setImmediate();
  assert.equal(h.loads,2);
});
test('settings serialize checked values before disabling controls; retry retains the same idempotency key', async () => {
  const h = await harness();
  h.click('data-budget-settings');
  h.failOnce();
  const values = { enabled: 'on', currency: 'USD', target: '500' };
  await h.submit(values);
  await h.submit(values);
  assert.deepEqual(h.requests[0].settings, {
    enabled: true,
    currency: 'USD',
    target: '500',
  });
  assert.equal(h.requests[0].requestId, h.requests[1].requestId);
  assert.equal(h.closed, 1);
});
test('Add cost sends form amounts and task fields, not an empty disabled-control form', async () => {
  const h = await harness();
  h.enable();
  await setImmediate();
  h.click('data-budget-add');
  const values = {
    title: 'Fictional corporate catering',
    estimate: '1200.50',
    committed: '',
    paid: '0',
    owner: '',
    taskId: '',
    dueDate: '',
    status: 'active',
  };
  await h.submit(values);
  assert.deepEqual(h.requests[0].item, values);
  assert.equal(h.requests[0].action, 'budgetItem');
});
test('teammate view offers no mutation controls, and unmount clears visible private snapshot state', async () => {
  const h = await harness(false);
  assert.doesNotMatch(h.host.innerHTML, /data-budget-settings|data-budget-add/);
  h.click('data-budget-settings');
  assert.equal(h.form, undefined);
  h.ui.unmount();
});
test('unchanged background refresh does not replace controls or collapse expanded details', async () => {
  const h = await harness(),
    renders = h.renders;
  await h.poll();
  assert.equal(h.renders, renders);
});
test('partial Budget totals show paid-only deposits and a certain minimum overage without suggesting money remains', async () => {
  const h = await harness(false);
  const money = value => GatherBudget.format(value, 'USD');
  const items = [{ title: 'Venue deposit', paid: 50000, committed: null, estimate: null, status: 'active' }];
  h.setBudget({ target: 30000, items });
  await h.poll();
  assert.ok(h.host.innerHTML.includes(`<h2>Expected total</h2><strong>At least ${money(50000)}<small>1 cost is still incomplete</small>`));
  assert.ok(h.host.innerHTML.includes(`<h2>Payments recorded</h2><strong>${money(50000)}</strong>`));
  assert.ok(h.host.innerHTML.includes(`<small>At least ${money(20000)} over target</small>`));
  assert.doesNotMatch(h.host.innerHTML, /below target|On target|data-budget-add/);
  for (const target of [50000, 60000]) {
    h.setBudget({ target, items });
    await h.poll();
    assert.match(h.host.innerHTML, /Target comparison incomplete/);
    assert.doesNotMatch(h.host.innerHTML, /below target|On target/);
  }
  h.setBudget({ target: 60000, items: [{ ...items[0], committed: 55000 }] });
  await h.poll();
  assert.ok(h.host.innerHTML.includes(`<h2>Expected total</h2><strong>${money(55000)}</strong>`));
  assert.ok(h.host.innerHTML.includes(`<small>${money(5000)} below target</small>`));
  assert.doesNotMatch(h.host.innerHTML, /At least|still incomplete/);
});
test('cost details explain historical links and keep them selected and editable', async () => {
  const h = await harness();
  const stale = { id: 'cost-a', title: 'Fictional deposit', paid: 2000, estimate: null, committed: null,
    status: 'active', owner: 'actor-former', taskId: 'task-removed', dueDate: '' };
  h.setWorkspace({
    tasks: [{ id: 'task-current', title: 'Current task' }],
    members: [
      { id: 'actor-former', name: 'Fictional former', role: 'Member', active: false },
      { id: 'actor-current', name: 'Fictional current', role: 'Member' },
    ],
  });
  h.setBudget({ items: [stale] });
  await h.poll();
  assert.match(h.host.innerHTML, /Fictional former \(former teammate\)/);
  assert.match(h.host.innerHTML, /Linked task is no longer available/);
  assert.doesNotMatch(h.host.innerHTML, /data-id="task-removed"/);
  h.click('data-budget-edit', stale.id);
  assert.match(h.formMarkup, /<option value="actor-former" selected>Unavailable owner \(kept unless changed\)<\/option>/);
  assert.match(h.formMarkup, /<option value="task-removed" selected>Unavailable task \(kept unless changed\)<\/option>/);
  assert.match(h.formMarkup, /<option value="" >No owner<\/option>/);
  assert.match(h.formMarkup, /<option value="" >No task<\/option>/);
  assert.match(h.formMarkup, /You can save other changes, or clear or replace the links here/);
  const values = { title: stale.title, estimate: '', committed: '', paid: '50',
    owner: stale.owner, taskId: stale.taskId, dueDate: '', status: 'active' };
  await h.submit(values);
  assert.deepEqual(h.requests[0].item, values);
  assert.equal(h.requests[0].id, stale.id);
});
