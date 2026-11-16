import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import '../legacy/budget.js';

const source = readFileSync('legacy/budget-ui.js', 'utf8');
const actor = 'fixture-organizer';
const project = 'fixture-project';
const taskId = 'fixture-task';
const replacementId = 'replacement-task';
const cost = (id, patch = {}) => ({ id, title: `Cost ${id}`, taskId, estimate: null, committed: null, paid: null, ...patch });
const item = cost('current-cost');
const earlier = cost('earlier-cost');
const archived = cost('archived-cost', { archivedAt: '2026-11-22T16:00:00Z' });

function harness(items = [earlier, item, archived]) {
  const document = { hidden: false }, focus = [], pending = [];
  let poll, dialogOpen = false;
  let workspace = { tasks: [{ id: taskId, title: 'Fictional linked task' }, { id: replacementId, title: 'Replacement task' }], members: [] };
  const window = { GatherBudget, GatherMode: { projectId: project }, GatherIdentity: { actorId: actor } };
  const budget = { ...GatherBudget.initial(), enabled: true };
  let snapshot = { budget: { ...budget, items }, identity: { admin: true, actor, actorId: actor }, revision: 2 };
  const camel = name => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  const unescape = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[entity]);

  function node(tagName, attrs = {}) {
    const dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [camel(key.slice(5)), value]));
    return { tagName: tagName.toUpperCase(), id: attrs.id || '', dataset, children: [], listeners: {}, attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
      isConnected: true, hidden: false, inert: false, checked: Object.hasOwn(attrs, 'checked'),
      append(child) { child.parentElement = this; this.children.push(child); },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      hasAttribute(name) { return Object.hasOwn(attrs, name); },
      getAttribute(name) { return attrs[name] ?? null; },
      matches(selector) {
        return selector.split(',').some(part => {
          part = part.trim();
          if (part === ':disabled') return !!this.disabled;
          if (part === '[hidden]') return this.hidden;
          if (part === '[inert]') return this.inert;
          const match = part.match(/^(?:#([\w-]+)|([\w-]+))?((?:\[[^\]]+\])*)$/);
          if (!match) return false;
          const [, id, tag, attributes] = match;
          return (!id || this.id === id) && (!tag || tag.toUpperCase() === this.tagName) && Array.from(attributes.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every(([, key, value]) => this.hasAttribute(key) && (value === undefined || value === this.getAttribute(key)));
        });
      },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; },
      contains(child) { for (let current = child; current; current = current.parentElement) if (current === this) return true; return false; },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      getClientRects() { return this.isConnected && !this.closest('[hidden],[inert]') ? [{}] : []; },
      focus() { document.activeElement = this; focus.push(this); },
    };
  }
  document.body = node('body');
  document.activeElement = document.body;
  function host() {
    const root = node('div', { id: 'eventBudget' });
    let html = '';
    function disconnect(el) {
      el.isConnected = false;
      if (document.activeElement === el) document.activeElement = document.body;
      el.children.forEach(disconnect);
    }
    Object.defineProperty(root, 'innerHTML', {
      get: () => html,
      set(markup) {
        html = markup;
        root.children.forEach(disconnect);
        root.children = [];
        const parents = [root];
        for (const [, closing, tag, attributes] of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/gi)) {
          if (closing) {
            const level = parents.findLastIndex(el => el.tagName === tag.toUpperCase());
            if (level > 0) parents.length = level;
          } else {
            const attrs = Object.fromEntries(Array.from(attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/g), ([, name, value]) => [name, unescape(value ?? '')]));
            const el = node(tag, attrs);
            parents.at(-1).append(el);
            if (!['input', 'br', 'hr', 'img'].includes(tag)) parents.push(el);
          }
        }
      },
    });
    root.detach = () => disconnect(root);
    document.body.append(root);
    return root;
  }

  vm.runInNewContext(source, { window, document, URLSearchParams, AbortController, setTimeout, clearTimeout,
    requestAnimationFrame: callback => callback(), setInterval: callback => (poll = callback, 1), clearInterval() {},
    fetch: (_url, options) => {
      assert.equal(options.method, 'GET', 'link resolution and focus restoration never write Budget');
      return new Promise(resolve => pending.push(resolve));
    },
  });
  const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const ui = window.GatherBudgetUI.create({ h, isDialogOpen: () => dialogOpen, getWorkspace: () => workspace,
    getActor: () => window.GatherIdentity.actorId,
    focusControl: el => (el.focus(), true), toast() {}, openDialog() {}, closeDialog() {},
  });
  function mount() {
    const current = host();
    current.innerHTML = ui.markup();
    ui.mount(current);
    return current;
  }
  let currentHost = mount();
  return {
    window, document, focus, ui, node,
    get host() { return currentHost; },
    link(id = item.id) { return currentHost.querySelector(`[data-budget-task="${id}"]`); },
    costHeading(id = item.id) { return currentHost.querySelector(`[data-budget-cost-heading="${id}"]`); },
    setWorkspace(value) { workspace = value; },
    setDialogOpen(value) { dialogOpen = value; },
    async reply(changes = {}, status = 200) {
      assert.ok(pending.length, 'there is a pending Budget read');
      snapshot = { ...snapshot, ...changes };
      pending.shift()({ ok: status === 200, status, json: async () => status === 200 ? structuredClone(snapshot) : { error: 'Fixture budget is unavailable.' } });
      await setImmediate();
    },
    replyCosts(items, enabled = true) { return this.reply({ budget: { ...budget, enabled, items } }); },
    archiveMode(enabled) {
      const target = currentHost.querySelector('[data-budget-archived]');
      assert.ok(target, 'Budget’s mounted archive checkbox exists');
      target.checked = enabled;
      currentHost.listeners.change({ target });
    },
    reload() { poll(); },
    remount(keepPendingFocus = true) {
      ui.unmount(keepPendingFocus);
      currentHost.detach();
      currentHost = mount();
    },
  };
}

test('only a live Budget cost can resolve its current linked task in the matching list and account', async () => {
  const f = harness();
  await f.reply();
  const opener = f.link();
  assert.equal(opener.dataset.action, 'budget-linked-task');
  assert.equal(opener.dataset.id, taskId);
  assert.equal(opener.dataset.budgetTask, item.id);
  assert.equal(opener.dataset.budgetMode, 'active');
  assert.deepEqual(JSON.parse(opener.dataset.budgetScope), [false, project, actor]);
  assert.equal(f.ui.resolveLinkedTask(opener), taskId);
  assert.equal(f.ui.resolveLinkedTask({ ...opener, parentElement: null }), '', 'an unmounted control cannot resolve a task');
  opener.hidden = true;
  assert.equal(f.ui.resolveLinkedTask(opener), '');
  opener.hidden = false;
  f.window.GatherAccessLost = true;
  assert.equal(f.ui.resolveLinkedTask(opener), '');
  f.window.GatherAccessLost = false;
  f.window.GatherIdentity.actorId = 'different-actor';
  assert.equal(f.ui.resolveLinkedTask(opener), '');
  f.window.GatherIdentity.actorId = actor;
  f.setWorkspace({ tasks: [], members: [] });
  assert.equal(f.ui.resolveLinkedTask(opener), '', 'the workspace task may disappear independently of Budget');
  f.setWorkspace({ tasks: [{ id: taskId, title: 'Fictional task' }], members: [] });
  f.archiveMode(true);
  const archivedLink = f.link(archived.id);
  assert.equal(f.ui.resolveLinkedTask(opener), '');
  assert.equal(archivedLink.dataset.budgetMode, 'archived');
  assert.equal(f.ui.resolveLinkedTask(archivedLink), taskId);
});

test('close returns to the same cost, not another cost pointing to the same task', async () => {
  const f = harness();
  await f.reply();
  const opener = f.link();
  f.reload();
  await f.replyCosts([{ ...earlier, title: 'Changed cost' }, item, archived]);
  assert.notEqual(f.link(), opener);
  assert.equal(f.ui.resolveLinkedTask(opener), '');
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  assert.equal(f.document.activeElement, f.link());
  assert.notEqual(f.document.activeElement, f.link(earlier.id));

  f.reload();
  await f.replyCosts([earlier, { ...item, taskId: replacementId }, archived]);
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  assert.equal(f.document.activeElement, f.costHeading());
  assert.notEqual(f.document.activeElement, f.link());

  f.reload();
  await f.replyCosts([earlier, archived]);
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetCostsHeading'));
  f.reload();
  await f.replyCosts([earlier, archived], false);
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
});

test('return queued while archived Budget reloads preserves the exact cost and does not steal newer focus', async () => {
  const f = harness();
  await f.reply();
  f.archiveMode(true);
  const opener = f.link(archived.id);
  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
  f.remount();
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
  await f.reply(); // Earlier host's response is superseded by the current request.
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
  await f.reply();
  assert.equal(f.document.activeElement, f.link(archived.id));
  assert.equal(f.link(), null, 'same-scope archive filter survives a remount');

  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  const elsewhere = f.node('button', { id: 'user-chosen-control' });
  f.document.body.append(elsewhere);
  elsewhere.focus();
  await f.reply();
  assert.equal(f.document.activeElement, elsewhere);

  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  f.setDialogOpen(true);
  elsewhere.focus();
  await f.reply();
  assert.equal(f.document.activeElement, elsewhere);
});

test('a queued return lands on the current Budget heading after a failed load', async () => {
  const f = harness();
  await f.reply();
  const opener = f.link();
  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), true);
  await f.reply({}, 503);
  assert.match(f.host.innerHTML, /Fixture budget is unavailable/);
  assert.equal(f.document.activeElement, f.host.querySelector('#budgetHeading'));
  assert.equal(f.link(), null);
});

test('a different project or archive mode cannot restore focus from the previous cost', async () => {
  const f = harness();
  await f.reply();
  const opener = f.link();
  f.archiveMode(true);
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), false);
  f.window.GatherMode.projectId = 'another-event';
  f.remount();
  assert.equal(f.ui.restoreLinkedTaskFocus(opener), false);
  await f.reply();
  assert.equal(f.link(archived.id), null, 'new project uses active view');
  assert.equal(f.document.activeElement, f.document.body);
});

test('Budget opens the exact linked task without automatic resource search, including same-task redraw', async () => {
  const f = harness();
  await f.reply();
  const app = readFileSync('legacy/app.js', 'utf8');
  const fragment = (start, end) => {
    const from = app.indexOf(start), to = app.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    return app.slice(from, to);
  };
  const ui = { view: 'budget' }, calls = [], backdrop = { hidden: true };
  const window = { ...f.window, GatherResourcesUI: { mount: (id, _, options) => calls.push(['resources', id, options.readOnly]) } };
  const context = vm.createContext({ ui, window, projectBudget: f.ui, $: () => backdrop,
    taskDialog(...args) { calls.push(['open', ...args]); ui.dialogKind = 'task'; ui.detailId = args[0]; },
  });
  vm.runInContext(fragment('  function openBudgetLinkedTask(', '  function focusTaskRecovery('), context);
  const opener = f.link();
  assert.equal(context.openBudgetLinkedTask(replacementId, opener), false);
  backdrop.hidden = false;
  assert.equal(context.openBudgetLinkedTask(taskId, opener), false);
  backdrop.hidden = true;
  assert.equal(context.openBudgetLinkedTask(taskId, opener), true);
  assert.deepEqual(calls[0].slice(0, -1), ['open', taskId, '', false, true, '', undefined, '']);
  assert.equal(calls[0].at(-1).readOnly, true);
  assert.equal(ui.lastFocus, opener);

  vm.runInContext(`function remountResources(id,readOnly=false) {${fragment('    const fromBudget=', '    if((batch||ui.overlapComparison||').replace('||fromWrapReceipt||', '||')}}`, context);
  context.remountResources(taskId);
  context.remountResources(replacementId);
  ui.view = 'tasks';
  context.remountResources(taskId);
  assert.deepEqual(calls.slice(1), [['resources', taskId, true], ['resources', replacementId, false], ['resources', taskId, false]]);
});
