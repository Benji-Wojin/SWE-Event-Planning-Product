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
  return { children: [], dataset: {}, listeners: {}, checked: false, disabled: false, hidden: false, isConnected: true, value: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    remove() { this.isConnected = false; },
    getAttribute(name) { return this[name] ?? null; },
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
    toggleAttribute(name, force) { if (force) this[name] = ''; else delete this[name]; },
    querySelectorAll(selector) {
      const match = selector.match(/^([\w-]+)?((?:\[[^\]]+\])*)(:checked)?$/);
      if (!match) return [];
      const [, tag, attributes, checked] = match;
      function accepts(node) {
        return (!tag || node.tagName === tag.toUpperCase()) && (!checked || node.checked) &&
          Array.from(attributes.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every(([, name, value]) =>
            node.getAttribute(name) !== null && (value === undefined || node.getAttribute(name) === value));
      }
      return this.children.flatMap(child => typeof child === 'object'
        ? [...(accepts(child) ? [child] : []), ...child.querySelectorAll(selector)] : []);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    closest() { return null; },
    focus() {},
    ...attrs,
  };
}

async function harness({ confirm = () => true, demo=false, openingCost=opening, workspace={ tasks: [], members: [] }, refreshWorkspace } = {}) {
  const requests = [], notices = [];
  const host = element({ innerHTML: '', contains: () => false, querySelector: () => null, querySelectorAll: () => [] });
  const initialBudget = { ...B.initial(), enabled: true, items: [openingCost] };
  let response = { revision: 7, identity: { admin: true, actor }, budget: initialBudget };
  let form, poll, nextPost = 409, nextRead = 200, closed = 0, releaseRead;
  const window = { GatherBudget: B, GatherMode: { projectId: 'fictional-event', demo, actor } };
  const document = { hidden: false, activeElement: null, getElementById: () => form, createElement: tag => element({ tagName: tag.toUpperCase() }) };
  function payload(row) {
    return Object.fromEntries(Object.entries(row).filter(([key]) => ['title','estimate','committed','paid','owner','taskId','dueDate','status'].includes(key))
      .map(([key, value]) => [key, ['estimate','committed','paid'].includes(key) ? B.inputAmount(value, response.budget.currency) : value]));
  }
  class SuccessfulFormData extends Map {
    constructor(form) {
      super([...Object.entries(form.values).filter(([, control]) => !control.disabled &&
        (!control.options || control.options.some(option => option.value === control.value && !option.disabled)))
        .map(([key, control]) => [key, control.value]),
      ...form.error.querySelectorAll('input[type="radio"]:checked').filter(control => !control.disabled).map(control => [control.name, control.value])]);
    }
  }
  function makeForm(markup) {
    const values = Object.fromEntries(Object.entries(payload(openingCost)).map(([key, value]) => [key, element({ name: key, value, defaultValue: value, tagName: 'INPUT' })]));
    for (const key of ['taskId', 'owner', 'status']) {
      values[key].tagName = 'SELECT';
      const selectMarkup = markup.match(new RegExp(`<select name="${key}">([\\s\\S]*?)<\\/select>`))?.[1] ?? '';
      values[key].options = [...selectMarkup.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)]
        .map(([, value, attrs, textContent]) => element({ value, textContent, defaultSelected: attrs.includes('selected'), disabled: attrs.includes('disabled') }));
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
        return controls.get(selector) ?? error.querySelector(selector);
      },
      querySelectorAll: selector => [...Object.values(values).filter(control => !selector || ['input','select','input,select,textarea'].includes(selector)), ...error.querySelectorAll(selector ?? '')],
      closest: selector => selector === '#dialog' ? form : null,
    });
  }
  vm.runInNewContext(source, { window, document, FormData: SuccessfulFormData, URLSearchParams, AbortController, setTimeout, clearTimeout,
    setInterval: fn => (poll = fn, 1), clearInterval() {}, crypto,
    fetch: async (_url, options) => {
      const method = options.method;
      requests.push({ method, payload: options.body ? JSON.parse(options.body) : undefined });
      if (method === 'GET' && releaseRead) await releaseRead;
      const configured = method === 'POST' ? nextPost : nextRead;
      const { status, body } = typeof configured === 'object' ? configured : { status: configured };
      if (status === 'network') throw new TypeError('Fixture connection closed before response');
      return { ok: status === 200, status, json: async () => status === 200 ? structuredClone(response) :
        structuredClone(body ?? { error: status === 409 ? 'Budget changed. Reload it.' : 'Fixture cannot read Budget.' }) };
    },
  });
  const ui = window.GatherBudgetUI.create({ h, getActor: () => actor, isDialogOpen: () => !!form, getWorkspace: () => workspace,
    refreshWorkspace: refreshWorkspace && (guard => refreshWorkspace(guard, next => { workspace = next; })),
    toast: notice => notices.push(notice),
    confirmClose: () => confirm(form),
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
    update(row, { revision = 8, currency = 'USD', admin = true, enabled = true, responseActor = actor, history = [] } = {}) {
      response = { revision, identity: { admin, actor: responseActor }, budget: { ...initialBudget, currency, enabled, items: row ? [row] : [], history } };
    },
    set nextPost(value) { nextPost = value; },
    set nextRead(value) { nextRead = value; },
    set pendingRead(value) { releaseRead = value; },
    draft(changes) { for (const [key, value] of Object.entries(changes)) form.values[key].value = value; },
    values() { return Object.fromEntries(Object.entries(form.values).map(([key, control]) => [key, control.value])); },
    control(selector) { return form.querySelector(selector) ?? form.error.children.find(child => child.getAttribute(selector.slice(1,-1)) !== null); },
    choices(key) { return form.error.querySelectorAll(`input[name="budget-resolution-${key}"]`); },
    choose(key, value) {
      const controls = this.choices(key);
      assert.ok(controls.some(choice => choice.value === value), `missing ${key}=${value} choice`);
      for (const choice of controls) choice.checked = choice.value === value;
      const selected = controls.find(choice => choice.checked);
      selected.listeners.change?.({ target: selected });
      form.listeners.change?.({ target: selected });
    },
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
const apply = '[data-budget-apply-choices]';
const retryOriginal = '[data-budget-retry-original]';
const checkOriginal = '[data-budget-check-original]';
const receiptFor = (attempt, after, changes = {}) => ({ id: attempt.requestId, action: attempt.action, actor, name: 'Fictional organizer',
  at: '2026-11-22T16:00:00Z', before: opening, after, ...changes });

const archiveAt = '2026-11-21T16:00:00Z';
const former = { id: 'former-owner', name: 'Former organizer aide', role: 'Former teammate', active: false };
const archived = { id: 'old-archived-task', title: 'Old tent delivery', archivedAt: archiveAt };
const sample = { id: 'example-owner', name: 'Fictional sample actor', role: 'Logistics · example' };
const newerArchived = { id: 'new-archived-task', title: 'Saved tent delivery', archivedAt: archiveAt };
const teammate = { id: 'current-owner', name: 'Fictional teammate', role: 'Teammate', active: true };
const completed = { id: 'completed-task', title: 'Confirm quote', status: 'done' };
const staleLink = { status: 400, body: { error: 'Choose a current linked task.', code: 'budget_link_unavailable' } };

test('disjoint cost recovery adopts the latest historical links without clearing the organizer’s amount or title', async () => {
  const initial = saved({ owner: former.id, taskId: archived.id });
  const workspace = { members: [former, teammate], tasks: [archived, completed] };
  const refreshed = { members: [former, sample, teammate], tasks: [archived, newerArchived, completed] };
  const workspaceReads = [];
  const f = await harness({ openingCost: initial, workspace, refreshWorkspace(guard, publish) {
    workspaceReads.push('GET');
    assert.equal(guard(12, refreshed), true);
    publish(refreshed);
    return { verified: true };
  } });
  f.draft({ title: 'Updated tent cost', paid: '42.50' });
  const draft = f.values();
  await f.submit();
  assert.deepEqual(f.posts[0].item, draft);
  const latest = saved({ owner: sample.id, taskId: newerArchived.id });
  f.update(latest);
  await f.click(check);
  assert.deepEqual(workspaceReads, ['GET']);
  assert.equal(f.reads, 2);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), draft);
  assert.match(f.form.error.textContent, /Fictional sample actor \(example only\).*Archived task: Saved tent delivery/);
  assert.ok(f.control(adopt), 'an untouched historical link changed elsewhere is not an overlapping edit');

  await f.click(adopt);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), { ...draft, owner: sample.id, taskId: newerArchived.id });
  for (const [key, prior, savedId, current] of [['owner',former.id,sample.id,teammate.id],['taskId',archived.id,newerArchived.id,completed.id]]) {
    const options = f.form.values[key].options;
    assert.deepEqual(options.map(option => option.value), ['', savedId, current]);
    assert.ok(!options.some(option => option.value === prior));
    const historical = options.find(option => option.value === savedId);
    assert.equal(historical.disabled, false, 'the saved reference must serialize through FormData');
    assert.equal(historical.defaultSelected, true);
    assert.match(historical.textContent, /kept unless changed/);
  }

  f.update({ ...latest, title: draft.title, paid: 4250 }, { revision: 9 });
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts.length, 2);
  assert.notEqual(f.posts[0].requestId, f.posts[1].requestId);
  assert.equal(f.posts[1].revision, 8);
  assert.deepEqual(f.posts[1].item, { ...draft, owner: sample.id, taskId: newerArchived.id });
  assert.equal(f.closed, 1);
});

test('a now-unavailable draft link needs an explicit current decision without losing unrelated edits', async () => {
  const localOwner = { id: former.id, name: former.name, role: 'Teammate', active: true };
  const localTask = { id: archived.id, title: archived.title };
  const workspace = { members: [localOwner, teammate], tasks: [localTask, completed] };
  const refreshed = { members: [former, teammate], tasks: [archived, completed] };
  const f = await harness({ workspace, refreshWorkspace(guard, publish) {
    assert.equal(guard(12, refreshed), true);
    publish(refreshed);
    return { verified: true };
  } });
  f.draft({ owner: localOwner.id, taskId: localTask.id, title: 'Keep this draft title', paid: '34.75' });
  const draft = f.values();
  await f.submit();
  f.update(saved({ estimate: 14500 }));
  await f.click(check);
  assert.match(f.form.error.textContent, /No longer available in your draft: Owner, Linked task/);
  assert.deepEqual(f.values(), draft);
  assert.equal(f.control(adopt), undefined);
  for (const key of ['owner', 'taskId']) {
    const options = f.choices(key);
    assert.deepEqual(options.map(option => [option.value,option.disabled]), [['saved',false],['draft',true]]);
  }
  assert.equal(f.posts.length, 1);
  await f.click(apply);
  assert.deepEqual(f.values(), draft, 'no link is silently cleared');
  await f.submit();
  assert.equal(f.posts.length, 1);
  f.choose('owner', 'saved');
  f.choose('taskId', 'saved');
  await f.click(apply);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), { ...draft, owner: '', taskId: '', estimate: '145.00' });
  assert.deepEqual(f.form.values.owner.options.map(option => option.value), ['',teammate.id]);
  assert.deepEqual(f.form.values.taskId.options.map(option => option.value), ['',completed.id]);
  f.draft({ owner: teammate.id, taskId: completed.id });
  f.update(saved({ title: draft.title, paid: 3475, estimate: 14500, owner: teammate.id, taskId: completed.id }), { revision: 9 });
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts.length, 2);
  assert.deepEqual(f.posts[1].item, { ...draft, owner: teammate.id, taskId: completed.id, estimate: '145.00' });
});

test('a typed stale-link rejection can review current choices without discarding or sending the draft', async () => {
  const initiallyAvailable = { id: archived.id, title: archived.title };
  const workspace = { members: [teammate], tasks: [initiallyAvailable, completed] };
  const refreshed = { members: [teammate], tasks: [archived, completed] };
  let workspaceReads = 0;
  const f = await harness({ workspace, refreshWorkspace(guard, publish) {
    workspaceReads++;
    assert.equal(guard(12, refreshed), true);
    publish(refreshed);
    return { verified: true };
  } });
  f.nextPost = staleLink;
  f.draft({ title: 'Keep this tent draft', paid: '34.75', taskId: initiallyAvailable.id });
  const draft = f.values();
  await f.submit();
  const [rejected] = f.posts;
  assert.deepEqual(rejected.item, draft);
  assert.ok(f.control(check));
  assert.equal(f.control(checkOriginal), undefined);
  assert.equal(f.form.dataset.budgetUnconfirmed, undefined);
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'true');
  assert.equal(f.reads, 1, 'rejection waits for explicit review');
  assert.equal(workspaceReads, 0);
  assert.deepEqual(f.values(), draft);

  await f.submit();
  await f.click('[data-budget-archive]');
  assert.deepEqual(f.posts, [rejected]);
  f.update(opening, { revision: 7 }); // A task can change without the budget revision changing.
  await f.click(check);
  assert.equal(f.reads, 2);
  assert.equal(workspaceReads, 1);
  assert.match(f.form.error.textContent, /No longer available in your draft: Linked task/);
  assert.deepEqual(f.values(), draft);
  assert.deepEqual(f.choices('taskId').map(option => [option.value, option.disabled]), [['saved', false], ['draft', true]]);
  f.choose('taskId', 'draft');
  await f.click(apply);
  assert.deepEqual(f.values(), draft, 'invalid draft link is never applied or silently removed');
  assert.deepEqual(f.posts, [rejected]);
  f.choose('taskId', 'saved');
  await f.click(apply);
  assert.deepEqual(f.values(), { ...draft, taskId: '' });
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'false');
  assert.deepEqual(f.posts, [rejected], 'review never sends the replacement without Save');

  f.draft({ taskId: completed.id });
  f.update(saved({ title: draft.title, paid: 3475, taskId: completed.id }));
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[1].revision, 7);
  assert.notEqual(f.posts[1].requestId, rejected.requestId);
  assert.deepEqual(f.posts[1].item, { ...draft, taskId: completed.id });
  assert.equal(f.closed, 1);
});

test('an untyped or unrelated 400 stays a regular editable budget validation error', async () => {
  for (const code of [undefined, 'unrelated_validation_error']) {
    const f = await harness();
    f.nextPost = { status: 400, body: { error: staleLink.body.error, ...(code ? { code } : {}) } };
    f.draft({ title: 'Regular draft', estimate: '120.60' });
    const before = f.values();
    await f.submit();
    assert.equal(f.form.error.textContent, staleLink.body.error, 'the exact message alone must not trigger link recovery');
    assert.equal(f.control(check), undefined);
    assert.equal(f.control(checkOriginal), undefined);
    assert.deepEqual(f.values(), before);
    assert.equal(f.reads, 1);
    f.draft({ estimate: '130.00' });
    f.update(saved({ title: before.title, estimate: 13000 }));
    f.nextPost = 200;
    await f.submit();
    assert.equal(f.posts.length, 2);
    assert.notEqual(f.posts[1].requestId, f.posts[0].requestId);
    assert.equal(f.posts[1].item.estimate, '130.00');
    assert.equal(f.closed, 1);
  }
});

test('an unconfirmed workspace refresh preserves the link draft, stays blocked, and can be retried read-only', async () => {
  const workspace = { members: [teammate], tasks: [completed] };
  let attempts = 0;
  const f = await harness({ workspace, refreshWorkspace(guard, publish) {
    if (++attempts === 1) return { verified: false, pending: true };
    assert.equal(guard(12, workspace), true);
    publish(workspace);
    return { verified: true };
  } });
  f.draft({ title: 'Keep this title', owner: teammate.id, taskId: completed.id });
  const draft = f.values();
  await f.submit();
  f.update(saved({ estimate: 15000 }));
  await f.click(check);
  assert.match(f.form.error.textContent, /Could not confirm the latest project members and tasks.*draft is unchanged/);
  assert.equal(f.control(adopt), undefined);
  assert.deepEqual(f.values(), draft);
  await f.submit();
  assert.equal(f.posts.length, 1);
  await f.click(check);
  assert.ok(f.control(adopt));
  assert.equal(attempts, 2);
  assert.equal(f.reads, 3);
  assert.equal(f.posts.length, 1);
  assert.deepEqual(f.values(), draft);
});

test('a delayed workspace refresh cannot publish or adopt Budget choices after Cancel or project change', async () => {
  for (const interrupt of ['cancel', 'project']) {
    const workspace = { members: [teammate], tasks: [completed] };
    let finish, verified, started;
    const waiting = new Promise(resolve => { finish = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    const f = await harness({ workspace, async refreshWorkspace(guard, publish) {
      started();
      await waiting;
      verified = guard(12, workspace);
      if (verified) publish(workspace);
      return { verified };
    } });
    f.draft({ title: 'Keep this title', owner: teammate.id, taskId: completed.id });
    const draft = f.values();
    await f.submit();
    f.update(saved({ estimate: 15000 }));
    const outstanding = f.click(check);
    await requested;
    if (interrupt === 'cancel') await f.click('[data-budget-close]');
    else f.window.GatherMode.projectId = 'another-fictional-project';
    finish();
    await outstanding;
    assert.equal(verified, false);
    assert.equal(f.posts.length, 1);
    assert.equal(f.reads, 2);
    if (interrupt === 'cancel') assert.equal(f.closed, 1);
    else {
      assert.equal(f.control(adopt), undefined);
      assert.deepEqual(f.values(), draft);
    }
  }
});

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
  f.update(saved({ title: 'My tent rental', estimate: 15000, committed: 14000, paid: 0 }), { revision: 9 });
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
  assert.match(f.form.error.textContent, /Estimate/);
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
  assert.match(f.form.error.textContent, /Status and amount changes affect the forecast together/);
  assert.equal(f.control(adopt), undefined);
  assert.deepEqual(f.values(), before);
  await f.submit();
  assert.equal(f.posts.length, 1);
});

test('each overlapping cost field needs an explicit choice; applying choices only updates the draft', async () => {
  const f = await harness();
  f.draft({ title: 'My draft tent', estimate: '160.00', paid: '20.00' });
  const before = f.values();
  await f.submit();
  f.update(saved({ title: 'Saved tent <XL>', estimate: 15000, committed: 17000, paid: 0 }));
  await f.click(check);
  assert.equal(f.control(adopt), undefined);
  assert.ok(f.control(apply));
  for (const key of ['title', 'estimate', 'paid']) {
    assert.deepEqual(f.choices(key).map(({ value }) => value).sort(), ['draft', 'saved']);
    assert.equal(f.choices(key).some(({ checked }) => checked), false, `no automatic ${key} choice`);
  }
  assert.deepEqual(f.choices('committed'), [], 'a non-overlapping change needs no conflict choice');
  await f.click(apply);
  assert.deepEqual(f.values(), before);
  assert.equal(f.posts.length, 1);
  f.choose('title', 'draft');
  f.choose('estimate', 'saved');
  await f.click(apply);
  assert.deepEqual(f.values(), before);
  await f.submit();
  assert.equal(f.posts.length, 1);
  f.choose('paid', 'draft');
  await f.click(apply);
  assert.equal(f.posts.length, 1, 'applying choices is not a save');
  const combined = { ...before, estimate: '150.00', committed: '170.00' };
  assert.deepEqual(f.values(), combined);
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'false');
  f.update(saved({ title: combined.title, estimate: 15000, committed: 17000, paid: 2000 }), { revision: 9 });
  f.nextPost = 200;
  await f.submit();
  assert.deepEqual(f.posts[1].item, combined, 'choice control fields must never enter the save body');
  assert.equal(f.posts[1].revision, 8);
  assert.equal(f.closed, 1);
});

test('status and amounts are chosen atomically, with other conflicts decided separately', async () => {
  for (const side of ['draft', 'saved']) {
    const f = await harness();
    f.draft({ title: 'My draft tent', paid: '30.00', estimate: '170.00', dueDate: '2026-11-30' });
    const before = f.values();
    await f.submit();
    f.update(saved({ title: 'Saved tent', status: 'cancelled', paid: 2000, committed: 15000 }));
    await f.click(check);
    assert.equal(f.control(adopt), undefined);
    assert.deepEqual(f.choices('forecast').map(({ value }) => value).sort(), ['draft', 'saved']);
    assert.equal(f.choices('forecast').some(({ checked }) => checked), false);
    for (const key of ['status', 'estimate', 'committed', 'paid']) assert.deepEqual(f.choices(key), [], `${key} may not be split from forecast choice`);
    f.choose('forecast', side);
    await f.click(apply);
    assert.deepEqual(f.values(), before, 'unresolved title blocks applying any part of the draft');
    f.choose('title', 'saved');
    await f.click(apply);
    const expected = side === 'draft' ? { ...before, title: 'Saved tent' }
      : { ...before, title: 'Saved tent', status: 'cancelled', estimate: '120.00', committed: '150.00', paid: '20.00' };
    assert.deepEqual(f.values(), expected);
    assert.equal(f.posts.length, 1);
    f.update(saved({ title: expected.title, status: expected.status, estimate: B.amount(expected.estimate, 'USD'),
      committed: B.amount(expected.committed, 'USD'), paid: B.amount(expected.paid, 'USD'), dueDate: expected.dueDate }), { revision: 9 });
    f.nextPost = 200;
    await f.submit();
    assert.deepEqual(f.posts[1].item, expected);
    assert.equal(f.posts[1].revision, 8);
    assert.equal(f.closed, 1);
  }
});

test('changing a cost draft after choices were shown invalidates previous choices and cannot post', async () => {
  const f = await harness();
  f.draft({ estimate: '160.00' });
  await f.submit();
  f.update(saved({ estimate: 15000 }));
  await f.click(check);
  f.choose('estimate', 'draft');
  const oldApply = f.control(apply);
  f.draft({ estimate: '180.00' });
  const before = f.values();
  await f.click(apply);
  assert.deepEqual(f.values(), before);
  assert.match(f.form.error.textContent, /Your draft changed/);
  assert.equal(f.choices('estimate').some(({ checked }) => checked), false);
  await f.submit();
  assert.equal(f.posts.length, 1);
  assert.equal(f.closed, 0);
  f.choose('estimate', 'saved');
  const updatedApply = f.control(apply);
  oldApply.listeners.click();
  assert.equal(f.control(apply), updatedApply, 'the old control cannot clear or apply the new choices');
  assert.deepEqual(f.values(), before);
  await f.click(apply);
  assert.equal(f.values().estimate, '150.00');
  assert.equal(f.posts.length, 1);
});

test('an initial definitive same-revision conflict uses a fresh key after verification', async () => {
  const f = await harness();
  f.draft({ paid: '12.00' });
  await f.submit();
  assert.equal(f.posts.length, 1);
  assert.ok(f.control(check));
  f.update(opening, { revision: 7 });
  await f.click(check);
  await f.click(adopt);
  assert.equal(f.form.submit.getAttribute('aria-disabled'), 'false');
  f.nextPost = 200;
  await f.submit();
  assert.equal(f.posts[1].revision, 7);
  assert.notEqual(f.posts[1].requestId, f.posts[0].requestId);
  assert.deepEqual(f.posts[1].item, f.posts[0].item);
});

test('uncertain Budget saves pin an exact request across network, 408, 429 and server failures', async () => {
  for (const status of ['network', 408, 429, 500, 503]) {
    const f = await harness();
    f.draft({ title: 'Original tent request', paid: '12.00' });
    f.nextPost = status;
    await f.submit();
    const [original] = f.posts;
    assert.ok(original.requestId, String(status));
    assert.ok(f.control(retryOriginal), String(status));
    assert.equal(f.closed, 0);
    f.draft({ paid: '25.00' });
    await f.submit();
    await f.click('[data-budget-archive]');
    assert.deepEqual(f.posts, [original], `${status}: no other save or archive while original is uncertain`);
    assert.equal(f.values().paid, '25.00');

    f.draft({ paid: '12.00' });
    f.update(saved({ title: 'Original tent request', paid: 1200 }));
    f.nextPost = 200;
    await f.submit();
    assert.deepEqual(f.posts, [original, original], `${status}: exact same retry body, revision and key`);
    assert.equal(f.closed, 1);
    assert.equal(f.notices.length, 1);
  }
});

test('explicit confirmation retries the original save and never writes newer draft fields', async () => {
  const f = await harness();
  f.nextPost = 503;
  f.draft({ title: 'Original tent request', paid: '12.00' });
  await f.submit();
  const [original] = f.posts;
  f.draft({ title: 'A newer draft title', paid: '25.00' });
  const newer = f.values();
  await f.submit();
  assert.equal(f.posts.length, 1);
  f.nextPost = 200;
  f.update(saved({ title: 'Original tent request', paid: 1200 }));
  await f.click(retryOriginal);
  assert.deepEqual(f.posts, [original, original]);
  assert.equal(f.closed, 0);
  assert.deepEqual(f.values(), newer);
  assert.doesNotMatch(f.notices.join(' '), /^Budget saved\./, 'the newer input was not saved');
});

test('checking for the original is GET-only and only a matching history record unlocks the newer cost draft', async () => {
  const f = await harness();
  f.nextPost = 503;
  f.draft({ paid: '12.00' });
  await f.submit();
  const [original] = f.posts;
  const originallySaved = saved({ paid: 1200 });
  f.draft({ paid: '25.00' });
  const newer = f.values();
  for (const history of [[],
    [receiptFor(original, originallySaved, { id: 'different-request' })],
    [receiptFor(original, originallySaved, { actor: 'different-actor' })],
    [receiptFor(original, originallySaved, { action: 'budgetArchive' })],
    [receiptFor(original, { ...originallySaved, id: 'different-cost' })],
  ]) {
    f.update(originallySaved, { history });
    await f.click(checkOriginal);
    assert.ok(f.control(retryOriginal), 'no exact receipt: original remains unconfirmed');
    assert.equal(f.closed, 0);
    assert.deepEqual(f.values(), newer);
    await f.submit();
    assert.deepEqual(f.posts, [original]);
  }
  const beforeCheck = f.reads;
  f.update(originallySaved, { history: [receiptFor(original, originallySaved)] });
  await f.click(checkOriginal);
  assert.equal(f.reads, beforeCheck + 1);
  assert.deepEqual(f.posts, [original]);
  assert.equal(f.closed, 0);
  assert.deepEqual(f.values(), newer);
  assert.equal(f.control(retryOriginal), undefined);
  assert.ok(f.control(check));
  await f.submit();
  assert.deepEqual(f.posts, [original], 'newer input still needs normal review');
});

test('confirmation compares newer edits against the original saved values, not a later snapshot', async () => {
  for (const confirmBy of [checkOriginal, retryOriginal]) {
    const f = await harness();
    f.nextPost = 503;
    f.draft({ paid: '12.00' });
    await f.submit();
    const [attempt] = f.posts;
    const originallySaved = saved({ paid: 1200 });
    const later = saved({ paid: 1800 });
    f.draft({ paid: '25.00' });
    f.update(later, { revision: 9, history: [receiptFor(attempt, originallySaved)] });
    f.nextPost = 200;
    await f.click(confirmBy);
    const confirmedCount = confirmBy === retryOriginal ? 2 : 1;
    assert.equal(f.posts.length, confirmedCount);
    assert.equal(f.closed, 0);
    assert.equal(f.values().paid, '25.00');
    await f.click(check);
    assert.equal(f.control(adopt), undefined, 'overlap with an intervening payment requires a choice');
    assert.match(f.form.error.textContent, /same fields: Payment recorded.*\$18\.00/);
    assert.equal(f.choices('paid').length, 2);
    assert.equal(f.choices('paid').some(choice => choice.checked), false);
    await f.submit();
    assert.equal(f.posts.length, confirmedCount);
  }
});

test('an exact GET confirmation closes an unchanged form without another POST', async () => {
  const f = await harness();
  f.nextPost = 'network';
  f.draft({ paid: '12.00' });
  await f.submit();
  const [attempt] = f.posts;
  const after = saved({ paid: 1200 });
  f.update(after, { history: [receiptFor(attempt, after)] });
  await f.click(checkOriginal);
  assert.equal(f.reads, 2);
  assert.deepEqual(f.posts, [attempt]);
  assert.equal(f.closed, 1);
  assert.equal(f.notices.length, 1);
});

test('a late original confirmation is ignored after Cancel or a project scope change', async () => {
  for (const interrupt of ['close', 'scope']) {
    const f = await harness();
    f.nextPost = 503;
    f.draft({ paid: '12.00' });
    await f.submit();
    const [attempt] = f.posts, form = f.form;
    const after = saved({ paid: 1200 });
    f.update(after, { history: [receiptFor(attempt, after)] });
    let finishRead;
    f.pendingRead = new Promise(resolve => { finishRead = resolve; });
    const outstanding = f.click(checkOriginal);
    const waiting = form.error.textContent;
    if (interrupt === 'close') await f.click('[data-budget-close]');
    else f.window.GatherMode.projectId = 'other-fictional-event';
    finishRead();
    await outstanding;
    assert.equal(f.closed, Number(interrupt === 'close'));
    assert.equal(form.error.textContent, waiting);
    assert.equal(form.dataset.budgetUnconfirmed, 'true');
    assert.equal(f.notices.length, 0);
    assert.deepEqual(f.posts, [attempt]);
  }
});

test('a retry conflict after uncertainty does not prove that the original did not save', async () => {
  const f = await harness();
  f.nextPost = 503;
  await f.submit();
  const [original] = f.posts;
  f.nextPost = 409;
  await f.click(retryOriginal);
  assert.deepEqual(f.posts, [original, original]);
  assert.ok(f.control(checkOriginal));
  assert.equal(f.control(check), undefined, 'ordinary rebase does not unlock an unconfirmed write');
  f.draft({ paid: '25.00' });
  await f.submit();
  assert.equal(f.posts.length, 2);
});

test('a typed stale-link error on retry never unlocks an earlier unconfirmed save', async () => {
  let workspaceReads = 0;
  const f = await harness({ workspace: { members: [], tasks: [completed] }, refreshWorkspace() {
    workspaceReads++;
    return { verified: true };
  } });
  f.draft({ title: 'Original tent request', paid: '12.00', taskId: completed.id });
  f.nextPost = 503;
  await f.submit();
  const [original] = f.posts;
  f.draft({ title: 'New draft title', paid: '25.00' });
  const draft = f.values();

  f.nextPost = staleLink;
  await f.click(retryOriginal);
  assert.deepEqual(f.posts, [original, original], 'retry must send the exact body and key of the uncertain original');
  assert.equal(f.form.dataset.budgetUnconfirmed, 'true');
  assert.ok(f.control(checkOriginal));
  assert.equal(f.control(check), undefined);
  assert.deepEqual(f.values(), draft);
  assert.equal(f.reads, 1);
  assert.equal(workspaceReads, 0);

  f.update(opening); // A newer revision alone cannot confirm the uncertain receipt.
  await f.click(checkOriginal);
  assert.match(f.form.error.textContent, /No matching save was found.*original could still have saved/i);
  assert.equal(f.form.dataset.budgetUnconfirmed, 'true');
  assert.equal(f.control(check), undefined);
  assert.equal(workspaceReads, 0);
  assert.equal(f.reads, 2);
  f.nextPost = 200;
  await f.submit();
  await f.click('[data-budget-archive]');
  assert.equal(f.closed, 0);
  assert.deepEqual(f.values(), draft);
  assert.deepEqual(f.posts, [original, original]);
});

test('the demo can check an unconfirmed write but cannot replay it after a reset', async () => {
  const f = await harness({demo:true});
  f.nextPost = 503;
  await f.submit();
  assert.equal(f.control(retryOriginal), undefined);
  assert.ok(f.control(checkOriginal));
  f.nextPost = 200;
  await f.submit();
  await f.click('[data-budget-archive]');
  await f.click(checkOriginal);
  assert.equal(f.posts.length, 1);
  assert.equal(f.reads, 2);
  assert.match(f.form.error.textContent,/demo may have been reset/);
});

test('a newer draft equal to the original form defaults still prompts before discarding', async () => {
  const app = readFileSync('legacy/app.js', 'utf8');
  const from = app.indexOf('  function hasUnsavedFields('), to = app.indexOf('  function confirmDiscard(', from);
  const context = vm.createContext({ $$: (_selector, form) => Object.values(form.values) });
  vm.runInContext(app.slice(from,to),context);
  const f = await harness({confirm:form=>!context.hasUnsavedFields(form)});
  f.nextPost = 503;
  f.draft({paid:'12.00'});
  await f.submit();
  f.draft({paid:B.inputAmount(opening.paid,'USD')});
  const after = saved({paid:1200});
  f.update(after,{history:[receiptFor(f.posts[0],after)]});
  await f.click(checkOriginal);
  assert.equal(f.form.dataset.budgetUnconfirmed,undefined);
  assert.equal(f.form.dataset.budgetRecoveryDraft,'true');
  assert.ok(context.hasUnsavedFields(f.form));
  await f.click('[data-budget-close]');
  assert.equal(f.closed,0);
  await f.click(check);
  await f.click(adopt);
  assert.equal(f.form.dataset.budgetRecoveryDraft,undefined);
  assert.ok(context.hasUnsavedFields(f.form),'adoption updates the form defaults');
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

test('adoption sets the saved defaults, so reverting an adopted amount is dirty and Cancel confirms', async () => {
  const app = readFileSync('legacy/app.js', 'utf8');
  const from = app.indexOf('  function hasUnsavedFields('), to = app.indexOf('  function confirmDiscard(', from);
  assert.ok(from >= 0 && to > from);
  const context = vm.createContext({ $$: (_selector, form) => Object.values(form.values) });
  vm.runInContext(app.slice(from, to), context);
  const prompted = [];
  let discard = false;
  const f = await harness({ confirm: form => {
    if (!context.hasUnsavedFields(form)) return true;
    prompted.push(form.values.estimate.value);
    return discard;
  } });
  f.draft({ title: 'My draft tent' });
  await f.submit();
  f.update(saved({ estimate: 15000, status: 'cancelled' }));
  await f.click(check);
  await f.click(adopt);
  assert.equal(f.form.values.estimate.defaultValue, '150.00');
  assert.deepEqual(f.form.values.status.options.filter(option => option.defaultSelected).map(option => option.value), ['cancelled']);
  f.draft({ title: opening.title });
  assert.equal(context.hasUnsavedFields(f.form), false);
  f.draft({ estimate: '120.00' });
  assert.equal(context.hasUnsavedFields(f.form), true);
  await f.click('[data-budget-close]');
  assert.deepEqual(prompted, ['120.00']);
  assert.equal(f.closed, 0);
  assert.equal(f.form.values.estimate.value, '120.00');
  discard = true;
  await f.click('[data-budget-close]');
  assert.equal(f.closed, 1);
  assert.equal(f.posts.length, 1);
});
