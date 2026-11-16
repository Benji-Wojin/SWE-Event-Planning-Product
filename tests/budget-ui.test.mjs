import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import '../legacy/budget.js';

const entities = { '&':'amp', '<':'lt', '>':'gt', '"':'quot', "'":'#39' };
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) =>
  Object.keys(entities).find(character => entities[character] === entity));

async function harness(admin = true, { demo = false, refreshWorkspace } = {}) {
  const budget = GatherBudget.initial(),
    requests = [],
    methods = [],
    renderedLinks = new WeakMap();
  let snapshot = { revision: 1, identity: { admin, actor: 'organizer' }, budget },
    form,
    formMarkup,
    workspace = { tasks: [], members: [] },
    fail = null, failRead = false, readReply, loads = 0,
    closed = 0,
    poll,
    renders = 0,
    markup = '';
  const host = {
    isConnected: true,
    innerHTML: '',
    listeners: {},
    contains(element) { return renderedLinks.get(element) === renders; },
    addEventListener(event, fn) {
      this.listeners[event] = fn;
    },
  };
  const window = { GatherBudget, GatherMode: { projectId: 'main', ...(demo ? { demo: true, actor: 'organizer' } : {}) } };
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
            ([, control]) => !control.disabled && control.value !== undefined &&
              (!control.options || control.options.some(option => option.value === control.value && !option.disabled)),
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
      createElement: () => ({
        addEventListener(name, fn) { this[name] = fn; },
        setAttribute(name, value) { this[name] = value; },
      }),
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
      methods.push(options.method);
      if (!options.body)
        return failRead ? {ok:false,status:503,json:async()=>({error:'Budget unavailable'})}
          : { ok: true, json: async () => structuredClone(readReply ?? snapshot) };
      const data = JSON.parse(options.body);
      requests.push(data);
      if (fail) {
        const failure=fail;
        fail=null;
        return {
          ok: failure === 'bad-success',
          status: failure === 'bad-success' ? 200 : failure.status ?? failure,
          json: async () => failure === 'bad-success' ? {revision: snapshot.revision + 1}
            : {error:'Request failed.', ...(failure.code ? {code:failure.code} : {})},
        };
      }
      snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      return { ok: true, json: async () => structuredClone(snapshot) };
    },
  });
  const ui = window.GatherBudgetUI.create({
    h: (value) => String(value).replace(/[&<>"']/g, character => `&${entities[character]};`),
    isDialogOpen: () => false,
    getWorkspace: () => workspace,
    refreshWorkspace: refreshWorkspace && (guard => {
      methods.push('WORKSPACE GET');
      return refreshWorkspace(guard, next => { workspace = next; });
    }),
    onLoaded() { loads++; },
    toast() {},
    closeDialog: () => {
      closed++;
    },
    openDialog(_title, markup) {
      formMarkup = markup;
      const error = {
        children: [],
        set textContent(value) { this.message=value; this.children=[]; },
        get textContent() { return this.message; },
        append(child) { this.children.push(child); },
        focus() {},
      }, close = { addEventListener(name, fn) { this[name]=fn; } };
      const save = { setAttribute(name, value) { this[name]=value; } };
      const archive = {
        addEventListener(name, fn) { this[name]=fn; },
        setAttribute(name, value) { this[name]=value; },
      };
      form = {
        dataset: {},
        values: {},
        listeners: {},
        querySelector: (selector) =>
          selector === '.form-error'
            ? error
            : selector === '[data-budget-close]'
              ? close
              : selector === 'button[type="submit"]'
                ? save
                : selector === '[data-budget-archive]' && markup.includes('data-budget-archive') ? archive : null,
        elements: { namedItem: name => form.values[name] ?? null },
        error,
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
    methods,
    click,
    ui,
    link(costId) {
      const markup = [...host.innerHTML.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
        .find(markup => markup.includes(`data-budget-task="${costId}"`));
      if (!markup) return null;
      const dataset = Object.fromEntries(Array.from(markup.matchAll(/\bdata-([\w-]+)="([^"]*)"/g),
        ([, key, value]) => [key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), decode(value)]));
      const button = { dataset, isConnected: true, closest: () => null };
      renderedLinks.set(button, renders);
      return button;
    },
    setFailRead(value) { failRead=value; },
    setReadReply(value) { readReply=value; },
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
    setBudget(changes, revision = snapshot.revision) {
      snapshot = { ...snapshot, revision, budget: { ...budget, enabled: true, ...changes } };
    },
    setWorkspace(value) {
      workspace = value;
    },
    failOnce(failure=503) {
      fail = failure;
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
    window,
    control(attribute) {
      return form.error.children.find(button=>button[attribute] === '');
    },
    async reviewLinks() {
      const control = this.control('data-budget-refresh-links');
      assert.ok(control, 'refresh choices control');
      await control.click();
    },
    chooseLink(name, value) {
      const field = form.values[name];
      assert.ok(field.options.some(option => option.value === value && !option.disabled), 'current link or explicit None must be selectable');
      field.value = value;
      form.listeners.change({target:field});
    },
    async retryOriginal() {
      await form.error.children.find(button=>button['data-budget-retry-original'] === '').click();
    },
    async archive() {
      const control=form.querySelector('[data-budget-archive]');
      await control.click({preventDefault(){},stopPropagation(){},currentTarget:control});
    },
    async submit(values) {
      if (values) {
        form.values = Object.fromEntries(Object.entries(values).map(([name, value]) => {
          const field = {name, value, disabled: false,
            getAttribute(key) { return this[key] ?? null; },
            setAttribute(key, input) { this[key]=input; },
            removeAttribute(key) { delete this[key]; },
            focus() {},
          };
          if (['owner','taskId','status'].includes(name)) {
            field.options = optionsFor(formMarkup,name).map(option=>({...option,disabled:false,defaultSelected:option.selected}));
            field.append = option => field.options.push(option);
          }
          return [name,field];
        }));
      }
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
test('a malformed success pins the original settings and never submits changed values', async () => {
  const h = await harness();
  h.click('data-budget-settings');
  h.failOnce('bad-success');
  const original={enabled:'on',currency:'USD',target:'500'};
  await h.submit(original);
  assert.equal(h.form.dataset.budgetUnconfirmed, 'true');
  await h.submit({...original,target:'750'});
  assert.equal(h.requests.length,1);
  await h.retryOriginal();
  assert.deepEqual(h.requests,[h.requests[0],h.requests[0]]);
  assert.equal(h.form.values.target.value,'750');
  assert.match(h.form.error.textContent,/original change saved.*newer edits were not saved/i);
  assert.equal(h.closed,0);
  await h.submit({...original,target:'750'});
  assert.equal(h.requests.length,2);
});
test('an unconfirmed new cost cannot be duplicated by saving newer fields', async () => {
  const h = await harness();
  h.enable();
  await setImmediate();
  h.click('data-budget-add');
  const original={title:'Fictional deposit',estimate:'40.00'};
  h.failOnce();
  await h.submit(original);
  await h.submit({...original,estimate:'80.00'});
  assert.equal(h.requests.length,1);
  await h.retryOriginal();
  assert.deepEqual(h.requests,[h.requests[0],h.requests[0]]);
  await h.submit({...original,estimate:'80.00'});
  assert.equal(h.requests.length,2);
  assert.equal(h.form.values.estimate.value,'80.00');
  assert.equal(h.closed,0);
});
test('an uncertain archive keeps the original archive body instead of submitting edited amounts', async () => {
  const h=await harness();
  h.setBudget({items:[{title:'Fictional venue',estimate:4000,committed:null,paid:null,id:'venue',owner:'',taskId:'',dueDate:'',status:'active'}]});
  await h.poll();
  h.click('data-budget-edit','venue');
  h.failOnce();
  await h.archive();
  assert.deepEqual(h.requests.map(row=>[row.action,row.id,row.archived]),[['budgetArchive','venue',true]]);
  await h.submit({title:'New venue label'});
  assert.equal(h.requests.length,1);
  await h.retryOriginal();
  assert.deepEqual(h.requests,[h.requests[0],h.requests[0]]);
  assert.equal(h.form.values.title.value,'New venue label');
  assert.equal(h.closed,0);
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

const archiveAt = '2026-11-19T19:00:00Z';
const projectChoices = {
  members: [
    { id: 'actor-organizer', name: 'Fictional organizer', role: 'Organizer' },
    { id: 'actor-active', name: 'Current teammate', role: 'Teammate', active: true },
    { id: 'actor-inactive', name: 'Inactive teammate', role: 'Teammate', active: false },
    { id: 'actor-former', name: 'Former teammate', role: 'Former teammate', active: true },
    { id: 'actor-sample', name: 'Example assistant', role: 'Teammate · example', active: true },
  ],
  tasks: [
    { id: 'task-open', title: 'Open task', status: 'todo' },
    { id: 'task-done', title: 'Completed task', status: 'done' },
    { id: 'task-archive', title: 'Teardown checklist', status: 'done', archivedAt: archiveAt },
  ],
};

function optionsFor(markup, name) {
  const select = markup.match(new RegExp(`<select\\b[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)<\\/select>`));
  assert.ok(select, `${name} selector is present`);
  return Array.from(select[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"([^>]*)>([^<]*)<\/option>/g),
    ([, value, attrs, label]) => ({ value, label, selected: /(?:^|\s)selected(?:\s|$)/.test(attrs) }));
}

const newCostDraft = {
  title: 'Fictional lighting deposit', estimate: '120.50', committed: '100.00', paid: '0',
  owner: 'actor-active', taskId: 'task-open', dueDate: '2026-11-24', status: 'cancelled',
};
const staleLinkFailure = { status: 400, code: 'budget_link_unavailable' };
const draftValues = form => Object.fromEntries(Object.entries(form.values).map(([key,field])=>[key,field.value]));
function archiveSelectedTask() {
  return { ...projectChoices, tasks: projectChoices.tasks.map(task=>task.id==='task-open' ? {...task,archivedAt:archiveAt}:task) };
}

test('new cost recovery keeps both stale links visibly unresolved until each replacement or None is explicit', async () => {
  const newer = archiveSelectedTask();
  newer.members = newer.members.map(member=>member.id==='actor-active' ? {...member,active:false}:member);
  const h = await harness(true,{refreshWorkspace(guard,publish) {
    assert.equal(guard(10,newer),true);
    publish(newer);
    return {verified:true};
  }});
  h.setWorkspace(projectChoices);
  h.setBudget({items:[]});
  await h.poll();
  h.click('data-budget-add');
  h.failOnce(staleLinkFailure);
  await h.submit(newCostDraft);
  const original = h.requests[0];
  assert.deepEqual(original.item,newCostDraft);
  assert.match(h.form.error.textContent,/Refresh the choices without losing your draft/);
  assert.equal(h.form.querySelector('button[type="submit"]')['aria-disabled'],'true');
  h.setBudget({items:[]},4);
  const beforeRefresh = h.methods.slice();
  await h.reviewLinks();
  assert.deepEqual(h.methods,[...beforeRefresh,'GET','WORKSPACE GET']);
  assert.deepEqual(draftValues(h.form),newCostDraft);
  for (const key of ['owner','taskId']) {
    const field = h.form.values[key];
    const selected = field.options.find(option=>option.value===field.value);
    assert.ok(selected?.disabled);
    assert.match(selected.textContent,/Previous selection.*no longer available/i);
    assert.equal(field.getAttribute('aria-invalid'),'true');
    assert.ok(field.options.some(option=>option.value===''&&!option.disabled),'None is a separate choice');
  }
  await h.submit();
  h.chooseLink('owner','actor-organizer');
  await h.submit();
  assert.equal(h.requests.length,1,'a stale selection cannot be submitted as an empty field');
  assert.equal(h.form.values.owner.getAttribute('aria-invalid'),null);
  assert.equal(h.form.values.taskId.getAttribute('aria-invalid'),'true');
  h.chooseLink('taskId','');
  assert.equal(h.form.values.taskId.getAttribute('aria-invalid'),null);
  assert.equal(h.form.querySelector('button[type="submit"]')['aria-disabled'],'false');
  assert.equal(h.requests.length,1,'choosing None does not submit the draft');
  assert.match(h.form.error.textContent,/choose Save/);
  await h.submit();
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].revision,4);
  assert.notEqual(h.requests[1].requestId,original.requestId);
  assert.deepEqual(h.requests[1].item,{...newCostDraft,owner:'actor-organizer',taskId:''});
  assert.equal(h.closed,1);
});

test('new cost recovery preserves the full draft and choices through failed reads and keeps a still-current link', async () => {
  const newer = archiveSelectedTask();
  let workspaceAttempts = 0;
  const h = await harness(true,{refreshWorkspace(guard,publish) {
    if (++workspaceAttempts===1) return {pending:true,verified:false};
    assert.equal(guard(10,newer),true);
    publish(newer);
    return {verified:true};
  }});
  h.setWorkspace(projectChoices);
  h.setBudget({items:[]});
  await h.poll();
  h.click('data-budget-add');
  h.failOnce(staleLinkFailure);
  await h.submit(newCostDraft);
  const openedOptions = ['owner','taskId'].map(key=>h.form.values[key].options.slice());
  const assertDraftUnchanged = () => {
    assert.deepEqual(draftValues(h.form),newCostDraft);
    for (const [index,key] of ['owner','taskId'].entries()) {
      const actual = h.form.values[key].options;
      assert.equal(actual.length,openedOptions[index].length);
      assert.ok(actual.every((option,i)=>option===openedOptions[index][i]));
    }
    assert.equal(h.requests.length,1);
  };
  h.setFailRead(true);
  await h.reviewLinks();
  assert.match(h.form.error.textContent,/Could not refresh project choices.*draft is unchanged/);
  assert.equal(workspaceAttempts,0);
  assertDraftUnchanged();
  h.setFailRead(false);
  for (const reply of [
    {revision:2},
    {revision:2,identity:{actor:'organizer',admin:true},budget:{enabled:true,currency:'USD'}},
  ]) {
    h.setReadReply(reply);
    await h.reviewLinks();
    assert.match(h.form.error.textContent,/draft is unchanged/i);
    assert.equal(h.closed,0,'a malformed success is not a confirmed loss of project access');
    assert.equal(workspaceAttempts,0);
    assertDraftUnchanged();
  }
  h.setReadReply(undefined);
  h.setBudget({items:[],currency:'EUR'},2);
  await h.reviewLinks();
  assert.match(h.form.error.textContent,/Could not confirm the current Budget settings.*draft is unchanged/);
  assert.equal(workspaceAttempts,0);
  assertDraftUnchanged();
  h.setBudget({items:[]},3);
  await h.reviewLinks();
  assert.match(h.form.error.textContent,/Could not confirm the latest project choices.*draft is unchanged/);
  assert.equal(workspaceAttempts,1);
  await h.submit();
  assertDraftUnchanged();
  await h.reviewLinks();
  assert.equal(workspaceAttempts,2);
  assert.deepEqual(draftValues(h.form),newCostDraft);
  assert.equal(h.form.values.owner.getAttribute('aria-invalid'),null);
  assert.ok(h.form.values.owner.options.some(option=>option.value===newCostDraft.owner&&!option.disabled));
  assert.equal(h.form.values.taskId.getAttribute('aria-invalid'),'true');
  h.chooseLink('taskId','task-done');
  await h.submit();
  assert.equal(h.requests[1].revision,3);
  assert.deepEqual(h.requests[1].item,{...newCostDraft,taskId:'task-done'});
});

test('a definitive new cost revision conflict safely refreshes and makes the original draft savable without an automatic write', async () => {
  const h = await harness(true,{refreshWorkspace(guard,publish) {
    assert.equal(guard(10,projectChoices),true);
    publish(projectChoices);
    return {verified:true};
  }});
  h.setWorkspace(projectChoices);
  h.setBudget({items:[]});
  await h.poll();
  h.click('data-budget-add');
  h.failOnce(409);
  await h.submit(newCostDraft);
  assert.match(h.form.error.textContent,/Budget changed.*without losing your draft/);
  h.setBudget({items:[],target:22000},2);
  await h.reviewLinks();
  assert.deepEqual(draftValues(h.form),newCostDraft);
  assert.equal(h.form.querySelector('button[type="submit"]')['aria-disabled'],'false');
  assert.equal(h.requests.length,1);
  await h.submit();
  assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].revision,2);
  assert.notEqual(h.requests[1].requestId,h.requests[0].requestId);
  assert.deepEqual(h.requests[1].item,newCostDraft);
});

test('new costs link only to current people and non-archived tasks, keeping completed tasks eligible', async () => {
  for (const demo of [false, true]) {
    const h = await harness(true, { demo });
    h.setWorkspace(projectChoices);
    h.setBudget({ items: [] });
    await h.poll();
    const before = h.methods.slice();
    h.click('data-budget-add');
    const expected = ['', 'actor-organizer', 'actor-active', ...(demo ? ['actor-sample'] : [])];
    assert.deepEqual(optionsFor(h.formMarkup, 'owner').map(option => option.value), expected);
    assert.deepEqual(optionsFor(h.formMarkup, 'taskId').map(option => option.value), ['', 'task-open', 'task-done']);
    assert.deepEqual(h.methods, before, 'opening the draft does not request or mutate anything');
  }
});

test('previously saved sample owner and archived task remain selected but are not offered on other costs', async () => {
  const h = await harness();
  const historical = { id: 'cost-archive-link', title: 'Fictional stage deposit', paid: 2000, estimate: null,
    committed: null, status: 'active', owner: 'actor-sample', taskId: 'task-archive', dueDate: '' };
  const other = { ...historical, id: 'cost-current-link', owner: 'actor-active', taskId: 'task-done' };
  h.setWorkspace(projectChoices);
  h.setBudget({ items: [historical, other] });
  await h.poll();
  const before = h.methods.slice();

  assert.match(h.host.innerHTML, /Example assistant[^<]*(?:example|not assignable)/i);
  assert.match(h.host.innerHTML, /data-budget-task="cost-archive-link"[^>]*>[^<]*(?:Archived task|archived)/i);
  const archivedTaskOpener = h.link(historical.id);
  assert.ok(archivedTaskOpener);
  assert.equal(h.ui.resolveLinkedTask(archivedTaskOpener), historical.taskId);
  const app = readFileSync('legacy/app.js', 'utf8');
  const from = app.indexOf('  function openBudgetLinkedTask('), to = app.indexOf('  function focusTaskRecovery(', from);
  assert.ok(from >= 0 && to > from);
  const ui = { view: 'budget' }, dialogCalls = [];
  const dialog = vm.runInNewContext(`${app.slice(from, to)}\nopenBudgetLinkedTask;`, {
    window: {}, $: () => ({ hidden: true }), ui, projectBudget: h.ui,
    taskDialog(id, ...args) { dialogCalls.push([id, args.at(-1).readOnly]); ui.dialogKind = 'task'; ui.detailId = id; },
  });
  assert.equal(dialog(historical.taskId, archivedTaskOpener), true);
  assert.deepEqual(dialogCalls, [[historical.taskId, true]]);
  assert.equal(ui.lastFocus, archivedTaskOpener);
  assert.deepEqual(h.methods, before, 'the archived link resolves locally without a request');

  h.click('data-budget-edit', other.id);
  assert.ok(!optionsFor(h.formMarkup, 'owner').some(option => option.value === historical.owner));
  assert.ok(!optionsFor(h.formMarkup, 'taskId').some(option => option.value === historical.taskId));
  h.click('data-budget-edit', historical.id);
  const retainedOwner = optionsFor(h.formMarkup, 'owner').find(option => option.value === historical.owner);
  const retainedTask = optionsFor(h.formMarkup, 'taskId').find(option => option.value === historical.taskId);
  assert.ok(retainedOwner?.selected);
  assert.match(retainedOwner.label, /(?:example|sample|unavailable)\b.*(?:not assignable|kept unless changed|reference only)/i);
  assert.ok(retainedTask?.selected);
  assert.match(retainedTask.label, /archived/i);
  assert.notEqual(retainedTask.label, projectChoices.tasks.at(-1).title, 'the form marks the old task as a historical selection');
  assert.match(h.formMarkup, /clear or replace/i);

  const values = { title: 'Edited stage deposit', estimate: '', committed: '', paid: '20.00',
    owner: retainedOwner.value, taskId: retainedTask.value, dueDate: '', status: 'active' };
  await h.submit(values);
  assert.deepEqual(h.requests.map(row => [row.action, row.id, row.item]), [['budgetItem', historical.id, values]]);
  assert.deepEqual(h.methods, [...before, 'POST']);
});
