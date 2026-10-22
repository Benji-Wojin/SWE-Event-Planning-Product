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
    fail = 0,
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
        return { ok: true, json: async () => structuredClone(snapshot) };
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
    getWorkspace: () => ({ tasks: [], members: [] }),
    toast() {},
    closeDialog: () => {
      closed++;
    },
    openDialog() {
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
  const click = (attr) =>
    host.listeners.click({
      target: {
        closest: () => ({ dataset: {}, hasAttribute: (key) => key === attr }),
      },
    });
  return {
    host,
    requests,
    click,
    ui,
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
    failOnce() {
      fail = 1;
    },
    get form() {
      return form;
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
