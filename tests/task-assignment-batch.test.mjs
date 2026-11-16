import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const create = () => GatherStore.createStore({ storage: null });
const get = (store, id) => store.getState().tasks.find((t) => t.id === id);
const ref = (task) => ({ id: task.id, revision: task.revision });
test('reviewed owner changes save once, reset commitments and preserve actual work', () => {
  const store = create(),
    a = store.addTask({
      title: 'School dance access check',
      owner: 'maya',
      status: 'progress',
      note: 'Walkthrough in progress.',
      dueDate: '2027-01-04',
      requiresVerification: true,
    }),
    b = store.addTask({ title: 'Corporate room preparation' }),
    excluded = store.addTask({ title: 'Not selected', owner: 'dev' });
  store.completeSetup({ timeZone: 'America/Los_Angeles' });
  store.setTaskSchedule(a.id, {
    start: '2027-01-05T09:00',
    end: '2027-01-05T10:00',
    location: 'School hall',
  });
  store.addDependency(a.id, {
    taskId: b.id,
    kind: 'related',
    reason: 'Share room details.',
  });
  store.acceptTask(a.id, 'maya');
  store.setNextUp(a.id, { enabled: true }, 'maya');
  store.requestRecovery(
    a.id,
    { kind: 'help', note: 'Need access to the room.' },
    'maya',
  );
  const before = store.getState(),
    selected = [get(store, a.id), get(store, b.id)];
  let saves = 0;
  store.subscribe(() => saves++);
  const result = store.assignTasks({
      owner: 'jules',
      tasks: selected.map(ref),
    }),
    after = store.getState();
  assert.equal(saves, 1);
  assert.equal(result.changedTaskCount, 2);
  for (const old of selected) {
    const task = get(store, old.id);
    assert.equal(task.owner, 'jules');
    assert.equal(task.revision, old.revision + 1);
    for (const field of [
      'acceptedAt',
      'acceptedBy',
      'acceptedSourceId',
      'acceptedRecordedBy',
      'nextUpAt',
      'nextUpBy',
      'ownerRespondedAt',
      'planReviewAfter',
      'followupAfter',
      'followupSentAt',
    ])
      assert.equal(task[field], '', field);
    for (const field of [
      'title',
      'category',
      'status',
      'note',
      'dueDate',
      'schedule',
      'dependencies',
      'requiresVerification',
      'updatedAt',
      'updatedBy',
      'reportedAt',
      'verifiedAt',
      'completedAt',
      'comments',
    ])
      assert.deepEqual(task[field], old[field], field);
  }
  assert.equal(get(store, a.id).recoveryRequests.at(-1).status, 'superseded');
  assert.deepEqual(
    get(store, excluded.id),
    before.tasks.find((t) => t.id === excluded.id),
  );
  assert.equal(after.activity.length, before.activity.length + 2);
  assert.ok(
    after.activity
      .slice(0, 2)
      .every((item) => item.type === 'assigned' && item.actor === 'jack'),
  );
  assert.deepEqual(after.event, before.event);
  store.acceptTasks(result.tasks.map(ref), 'jules');
  assert.equal(get(store, a.id).acceptedBy, 'jules');
  assert.equal(get(store, a.id).status, 'progress');
});
test('same-owner selections are exact no-ops including acceptance and history', () => {
  const store = create(),
    a = store.addTask({ title: 'Already assigned', owner: 'maya' });
  store.acceptTask(a.id, 'maya');
  store.setNextUp(a.id, { enabled: true }, 'maya');
  const before = store.exportState();
  let saves = 0;
  store.subscribe(() => saves++);
  assert.equal(
    store.assignTasks({ owner: 'maya', tasks: [ref(get(store, a.id))] })
      .changedTaskCount,
    0,
  );
  assert.equal(store.exportState(), before);
  assert.equal(saves, 0);
});
test('all selected tasks are validated before any assignment or activity', () => {
  for (const invalid of ['missing', 'stale', 'reported', 'done', 'verified']) {
    const store = create(),
      a = store.addTask({ title: 'First', owner: 'maya' }),
      b = store.addTask({
        title: 'Second',
        owner: 'dev',
        requiresVerification: true,
      });
    let second = ref(b);
    if (invalid === 'missing') second.id = 'absent';
    if (invalid === 'stale')
      store.updateTask(b.id, { title: 'Changed after review' });
    if (invalid === 'reported' || invalid === 'verified') {
      store.reportCompletion(b.id, 'Work reported.', 'dev');
      if (invalid === 'verified') store.verifyTask(b.id);
      second = ref(get(store, b.id));
    }
    if (invalid === 'done') {
      store.updateTask(b.id, { requiresVerification: false });
      store.updateTask(b.id, { status: 'done' });
      second = ref(get(store, b.id));
    }
    const before = store.exportState();
    assert.throws(() =>
      store.assignTasks({ owner: 'jules', tasks: [ref(a), second] }),
    );
    assert.equal(store.exportState(), before, invalid);
  }
});
test('batch assignment is bounded, organizer-only and rejects forged fields or inactive owners', () => {
  const store = create(),
    a = store.addTask({ title: 'Formal event handoff' }),
    r = ref(a),
    before = store.exportState();
  const valid = { owner: 'maya', tasks: [r] };
  for (const input of [
    null,
    [],
    {},
    { ...valid, owner: '' },
    { ...valid, owner: 'unknown' },
    { ...valid, actor: 'jack' },
    { ...valid, tasks: [] },
    { ...valid, tasks: [r, r] },
    { ...valid, tasks: Array(101).fill(r) },
    { ...valid, tasks: [{ ...r, revision: '1' }] },
    { ...valid, tasks: [{ ...r, owner: 'maya' }] },
    { ...valid, tasks: [{ ...r, revision: 0 }] },
  ]) {
    assert.throws(() => store.assignTasks(input));
    assert.equal(store.exportState(), before);
  }
  for (const actor of ['maya', 'absent']) {
    assert.throws(() => store.assignTasks(valid, actor));
    assert.equal(store.exportState(), before);
  }
  const raw = store.getState();
  raw.members.find((m) => m.id === 'maya').active = false;
  const inactive = GatherStore.createStore({
    storage: { getItem: () => JSON.stringify(raw), setItem: () => {} },
  });
  const stable = inactive.exportState();
  assert.throws(() => inactive.assignTasks(valid));
  assert.equal(inactive.exportState(), stable);
});
const app = readFileSync('legacy/app.js', 'utf8');
test('dialog is filtered, bounded, escaped, organizer-only and never preselects work or owner', () => {
  let markup,
    opened = 0;
  const state = {
    event: { timeZone: 'Asia/Tokyo' },
    members: [
      { id: 'jack', name: 'Jack', role: 'Organizer' },
      { id: 'maya', name: '<Maya>', role: 'Teammate' },
      { id: 'old', name: 'Old', active: false },
      { id: 'example', name: 'Example', role: 'Teammate · example' },
    ],
    tasks: [
      {
        id: 'a',
        title: '<script>task</script>',
        note: '<img>',
        owner: '',
        status: 'blocked',
        dueDate: '',
        revision: 3,
      },
      { id: 'done', status: 'done' },
      { id: 'reported', status: 'progress', reportedAt: 'date' },
    ],
  };
  let organizer = true;
  const context = vm.createContext({
    ui: { actor: 'jack' },
    isOrganizer: () => organizer,
    window: { GatherMode: { demo: false } },
    store: { getState: () => state, getSnapshotRevision: () => 16 },
    acceptanceReviewPending: () => false,
    recovery: { ownerLoad: () => '' },
    eventReviewScope: () => ({mine:false,actor:'jack'}),
    schedule: {reviewAssignmentTasks(s,scope,key){
      assert.equal(s,state);assert.equal(scope.actor,'jack');
      return key==='owner-unavailable'?[{...state.tasks[0],id:'formerly-owned',owner:'old'}]:[];
    }},
    filteredTasks: (s) => s.tasks,
    h: (v) =>
      String(v ?? '')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;'),
    statuses: { blocked: 'Blocked' },
    options: (entries, selected) => entries.map(([id,label]) =>
      '<option value="'+id+'"'+(id===selected?' selected':'')+'>'+String(label).replaceAll('<','&lt;')+'</option>',
    ).join(''),
    member: (id) => state.members.find((m) => m.id === id),
    dayLabel: (v) => v,
    openDialog: (_title, body) => {
      markup = body;
      opened++;
    },
    toast: () => {},
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function assignableTaskOwner('),
      app.indexOf('  const ownerOptions ='),
    ) + app.slice(
      app.indexOf('  function assignmentCandidates('),
      app.indexOf('  function acceptanceCandidates('),
    ) + 'assignmentDialog();',
    context,
  );
  assert.equal(opened, 1);
  assert.match(markup, /value="a" data-revision="3"/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;img&gt;/);
  assert.doesNotMatch(
    markup,
    / checked|<script>|<img>|value="(?:done|reported|old|example)"/,
  );
  assert.match(markup, /Choose a teammate/);
  assert.match(markup, /id="assignmentSubmit"[^>]*disabled/);
  assert.match(markup, /No messages are sent/);
  vm.runInContext('assignmentDialog("owner-unavailable")',context);
  assert.equal(opened,2);
  assert.match(markup,/data-return-to="event-review"/);
  assert.match(markup,/Current owner: Old · Inactive teammate/);
  assert.match(markup,/data-action="before-event-review" data-id="owner-unavailable">Back to event review/);
  assert.match(markup,/value="formerly-owned"/);
  assert.doesNotMatch(markup,/value="a"| checked/);
  assert.equal(
    vm.runInContext(
      'assignmentCandidates(Array.from({length:101},()=>({status:"todo"}))).length',
      context,
    ),
    100,
  );
  const checked = id => new RegExp('name="assignTask" value="'+id+'"[^>]* checked');
  state.tasks[0].schedule={start:'2026-11-14T12:00'};
  const ordinary={...state.tasks[0],id:'plain',schedule:undefined};
  state.tasks.push(ordinary);
  context.resume={
    selected:[
      {id:'a',revision:3,ownerLabel:'Unassigned'},
      {id:'plain',revision:3,ownerLabel:'Unassigned'},
      {id:'missing',revision:8,ownerLabel:'Old owner'},
    ],
    owner:'maya',ownerName:'<Maya>',timeZone:'Asia/Tokyo',
  };
  vm.runInContext('assignmentDialog("",resume)',context);
  assert.equal(opened,3);
  assert.match(markup,checked('a'));
  assert.match(markup,checked('plain'));
  assert.match(markup,/value="maya" selected/);
  assert.match(markup,/2 kept · 1 cleared/);
  assert.match(markup,/name="confirmed" required>/);
  assert.match(markup,/id="assignmentSubmit"[^>]*disabled/);

  state.event.timeZone='America/Los_Angeles';
  state.members[1].name='Maya Renamed';
  vm.runInContext('assignmentDialog("",resume)',context);
  assert.equal(opened,4);
  assert.doesNotMatch(markup,checked('a'));
  assert.match(markup,checked('plain'));
  assert.doesNotMatch(markup,/value="maya" selected/);
  assert.match(markup,/1 kept · 2 cleared/);
  assert.match(markup,/previous recipient changed or is no longer available/);

  // Workspace metadata can change without an individual task revision changing.
  state.members[2].active=true;
  context.resume.selected=[{id:'formerly-owned',revision:3,ownerLabel:'Old · Inactive teammate'}];
  vm.runInContext('assignmentDialog("owner-unavailable",resume)',context);
  assert.equal(opened,5);
  assert.doesNotMatch(markup,checked('formerly-owned'));
  assert.match(markup,/0 kept · 1 cleared/);
  organizer = false;
  vm.runInContext('assignmentDialog()', context);
  assert.equal(opened, 5);
});
test('confirmation and an actual owner change bind the exact recipient and task revisions before submit', () => {
  const selected = [],
    owner = { value: '' },
    confirmed = { checked: false },
    count = {},
    button = {},
    form = {dataset:{}};
  let stale = false;
  const context = vm.createContext({
    form,
    $$: () => selected,
    acceptanceReviewPending: () => stale,
    paintAssignmentRefresh: () => {},
    $: (s) =>
      s.startsWith('select')
        ? owner
        : s.startsWith('input')
          ? confirmed
          : s === '#assignmentCount'
            ? count
            : button,
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function assignmentCountText('),
      app.indexOf('  function paintAssignmentRefresh('),
    ),
    context,
  );
  const sync = (confirming = false) => context.syncAssignmentSelection(form, confirming);
  sync();
  assert.equal(button.disabled, true);
  const first={value:'a',dataset:{owner:'maya',revision:'4',ownerLabel:'Maya'}};
  const second={value:'b',dataset:{owner:'',revision:'9',ownerLabel:'Unassigned'}};
  selected.push(first);
  owner.value = 'maya';
  confirmed.checked = true;
  sync(true);
  assert.equal(button.disabled, true);
  assert.equal(confirmed.checked, false);
  owner.value = 'dev';
  confirmed.checked = true;
  sync();
  assert.equal(button.disabled, true);
  confirmed.checked = true;
  sync(true);
  assert.equal(button.disabled, false);
  assert.equal(count.textContent, '1 task selected; 1 owner change.');
  assert.deepEqual(JSON.parse(form.dataset.confirmedBatch), ['dev', [['a',4]]]);
  assert.equal(context.assignmentSelection(form,true)[0].ownerLabel,'Maya');

  owner.value='maya';
  selected.push(second);
  sync();
  assert.equal(button.disabled,true);
  assert.equal(confirmed.checked,false);
  confirmed.checked=true;
  sync(true);
  selected.reverse();
  sync();
  assert.equal(button.disabled,false,'input order does not alter the reviewed batch');
  assert.equal(count.textContent,'2 tasks selected; 1 owner change.');
  first.dataset.revision='5';
  sync();
  assert.equal(button.disabled,true);
  assert.equal(form.dataset.confirmedBatch,undefined);
  confirmed.checked=true;
  sync(true);
  owner.value='jack';
  sync();
  assert.equal(button.disabled,true,'recipient changes invalidate an otherwise identical batch');
  assert.match(count.textContent,/The batch changed\. Confirm again before assigning\./);
  confirmed.checked=true;
  sync(true);
  selected.pop();
  sync();
  assert.equal(button.disabled,true,'a removed selection requires explicit reconfirmation');
  confirmed.checked=true;
  sync(true);
  stale=true;
  sync();
  assert.equal(button.disabled,true);
  assert.equal(form.dataset.confirmedBatch,undefined);
});
function assignmentRefreshFixture(reviewGroup='owner-unavailable'){
  const ui={actor:'jack',view:reviewGroup?'timeline':'tasks',tab:'shared',dialogKind:'assignment',
    timelineMode:'schedule',scheduleMine:true,toolUpdatePending:true};
  const window={GatherMode:{projectId:'fictional-project'}},document={hidden:false};
  const attrs=new Map(),status={},sync={hidden:false},backdrop={hidden:false};
  const button={isConnected:true,setAttribute:(name,value)=>attrs.set(name,value),
    removeAttribute:name=>attrs.delete(name),getAttribute:name=>attrs.get(name)};
  const selected=[{value:'retained',dataset:{revision:'7',ownerLabel:'Old · Inactive teammate'}}];
  let form={dataset:{actor:'jack',timeZone:'UTC',reviewGroup}};
  let revision=11,known=13;
  const calls=[],reads=[];
  const context=vm.createContext({
    ui,window,document,
    $:selector=>({'#assignTasksForm':form,'#assignmentRefreshStatus':status,
      '#assignmentRefresh':button,'#dialogBackdrop':backdrop,'#workspaceSyncNotice':sync,
      'select[name="owner"]':{value:'maya',selectedOptions:[{textContent:'Maya'}]}})[selector],
    $$:()=>selected,
    isOrganizer:()=>true,
    eventReviewScope:()=>({mine:ui.scheduleMine,actor:ui.actor}),
    acceptanceReviewPending:()=>true,
    recoveryConflictPending:candidate=>candidate===13,
    scheduleRevisionIsStale:candidate=>candidate<known,
    rememberNewerSchedule:(_snapshot,candidate)=>{if(Number.isSafeInteger(candidate))known=Math.max(known,candidate);},
    render:()=>calls.push('render'),
    assignmentDialog:(...args)=>calls.push(args),
    store:{
      getSnapshotRevision:()=>revision,
      assignTasks(){assert.fail('Refreshing must not assign tasks');},
      refresh(canApply,options){
        return new Promise((resolve,reject)=>reads.push({canApply,options,reject,finish(candidate,result={changed:true,verified:true}){
          if(canApply(candidate)&&result.verified&&!result.pending)revision=candidate;
          resolve(result);
        }}));
      },
    },
  });
  const start=app.indexOf('  function assignmentCountText(');
  const end=app.indexOf('  function focusAfterAcceptance(',start);
  vm.runInContext(app.slice(start,end),context);
  return {ui,window,document,button,attrs,status,sync,selected,calls,reads,
    refresh:()=>context.refreshAssignmentReview(button),
    replaceForm(){form={...form};},
    isStale:candidate=>context.scheduleRevisionIsStale(candidate),
  };
}

test('verified assignment refresh keeps the exact event review or task-list context without writing',async()=>{
  for(const reviewGroup of ['owner-unavailable','']){
    const f=assignmentRefreshFixture(reviewGroup);
    const pending=f.refresh();
    const [read]=f.reads;
    assert.equal(read.options.requireFresh,true);
    assert.equal(read.canApply(12),false,'below known newer revision');
    assert.equal(read.canApply(13),false,'write conflict remains stale');
    assert.equal(read.canApply(14),true);
    assert.equal(f.attrs.get('aria-disabled'),'true');
    assert.match(f.status.textContent,/Refreshing assignment review/);
    await f.refresh();
    assert.equal(f.reads.length,1,'duplicate refresh does not race');
    assert.deepEqual(f.calls,[]);
    read.finish(14);
    await pending;
    assert.equal(f.sync.hidden,true);
    assert.equal(f.ui.toolUpdatePending,false);
    assert.equal(f.attrs.has('aria-disabled'),false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),['render',[reviewGroup,{
      selected:[{id:'retained',revision:7,ownerLabel:'Old · Inactive teammate'}],
      owner:'maya',ownerName:'Maya',timeZone:'UTC',
    }]]);
  }
});

test('failed or superseded assignment refresh preserves the old form and never redraws stale choices',async()=>{
  for(const reason of ['failure','unverified','pending','hidden','project','scope','form']){
    const f=assignmentRefreshFixture();
    const pending=f.refresh();
    const [read]=f.reads;
    if(reason==='failure')read.reject(new Error('fictional failure'));
    else if(reason==='unverified')read.finish(14,{changed:false});
    else if(reason==='pending')read.finish(14,{pending:true,newerRevision:15});
    else{
      if(reason==='hidden')f.document.hidden=true;
      if(reason==='project')f.window.GatherMode.projectId='other';
      if(reason==='scope')f.ui.scheduleMine=false;
      if(reason==='form')f.replaceForm();
      assert.equal(read.canApply(14),false,reason);
      read.finish(14);
    }
    await pending;
    assert.deepEqual(f.calls,[],reason);
    assert.equal(f.sync.hidden,false,reason);
    assert.equal(f.attrs.has('aria-disabled'),false,reason);
    assert.equal(f.selected[0].value,'retained',reason);
    if(reason==='pending')assert.equal(f.isStale(14),true,'known newer revision is not forgotten');
    if(['failure','unverified','pending','hidden'].includes(reason))
      assert.match(f.status.textContent,/choices are still here/,reason);
  }
});
test('assignment submit fails closed on changed confirmation, rejected recipient, or stale revision',async()=>{
  const tasks=[{id:'retained',revision:7}];
  const data=[['owner','maya'],['confirmed','on']];
  for(const rejection of [
    {status:400,message:'Choose an active teammate.'},
    {status:400,message:'Choose an active project teammate.'},
    {status:409,message:'Project changed.'},
    null,
  ]){
    const form={id:'assignTasksForm',isConnected:true,dataset:{actor:'jack'},closest:()=>null};
    const ui={actor:'jack',dialogKind:'assignment'};
    let submit,attempts=0,locks=0,paints=0;
    const conflicts=[],errors=[];
    const context=vm.createContext({
      ui,window:{},
      document:{addEventListener:(type,handler)=>{if(type==='submit')submit=handler;}},
      FormData:class{constructor(){return data;}},
      $:selector=>selector==='#assignTasksForm'?form:null,
      acceptanceReviewPending:f=>f.dataset.reviewNeedsRefresh==='true',
      assignmentSelection:()=>tasks,
      isOrganizer:()=>true,
      saveLock(){locks++;return()=>locks--;},
      paintAssignmentRefresh:()=>paints++,
      showRecoveryWriteConflict:revision=>conflicts.push(revision),
      store:{
        getSnapshotRevision:()=>16,
        assignTasks(request,actor){
          assert.deepEqual(JSON.parse(JSON.stringify(request)),{owner:'maya',tasks});
          assert.equal(actor,'jack');
          attempts++;
          if(rejection)throw Object.assign(new Error(rejection.message),rejection);
          assert.fail('A changed confirmation must never reach the store');
        },
      },
      formError:(_form,error)=>errors.push(error.message),
      toast:()=>{},
    });
    const start=app.indexOf("  document.addEventListener('submit'");
    const end=app.indexOf("  document.addEventListener('change'",start);
    vm.runInContext(app.slice(app.indexOf('  function assignmentConfirmationKey('),
      app.indexOf('  function syncAssignmentSelection('))+app.slice(start,end),context);
    form.dataset.confirmedBatch=context.assignmentConfirmationKey(rejection?'maya':'previous-recipient',tasks);
    const event={target:form,preventDefault(){}};
    await submit(event);
    assert.equal(locks,0);
    if(!rejection){
      assert.equal(attempts,0);
      assert.deepEqual(errors,['Confirm the selected tasks and recipient before assigning.']);
    }else if(rejection.status===400){
      assert.equal(attempts,1);
      assert.equal(form.dataset.reviewNeedsRefresh,'true');
      assert.equal(paints,2);
      await submit(event);
      assert.equal(attempts,1,'a second submit cannot bypass the sticky review lock');
      assert.deepEqual(errors,[]);
    }else{
      assert.equal(attempts,1);
      assert.deepEqual(conflicts,[16]);
      assert.deepEqual(errors,[]);
    }
  }
});
test('acceptance restores lost keyboard focus after saving without stealing a new focus or view', () => {
  const body = {},
    control = {},
    pending = [],
    ui = { view: 'tasks' };
  let focused = 0;
  const context = vm.createContext({
    ui,
    document: { body, activeElement: body },
    queueMicrotask: (fn) => pending.push(fn),
    skipToContent: () => focused++,
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function focusAfterAcceptance('),
      app.indexOf('  function acceptanceCandidates('),
    ),
    context,
  );
  const queue = () => vm.runInContext('focusAfterAcceptance()', context);
  queue();
  assert.equal(focused, 0);
  pending.shift()();
  assert.equal(focused, 1);
  queue();
  context.document.activeElement = control;
  pending.shift()();
  assert.equal(focused, 1);
  context.document.activeElement = body;
  queue();
  ui.view = 'timeline';
  pending.shift()();
  assert.equal(focused, 1);
  assert.match(app, /closeDialog\(\);render\(\);focusAfterAcceptance\(document\.activeElement\);/);
});
test('prepared client awaits one actor-free batch mutation and captures refs before locking', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const hosted = readFileSync('public/gather-assets/app.js', 'utf8'),
    proxy = readFileSync('legacy/hosted-store.js', 'utf8');
  assert.match(
    hosted,
    /const result=await store\.assignTasks\(\{owner:data.owner,tasks:data.tasks\},ui.actor\)/,
  );
  assert.match(proxy, /'assignTasks'/);
  assert.match(proxy, /assignTasks: 1/);
  const capture = app.indexOf("if(form.id==='assignTasksForm')data.tasks=assignmentSelection(form);");
  assert.ok(
    capture > 0 &&
      capture < app.indexOf('const release=saveLock(form.closest', capture),
  );
  assert.match(
    app,
    /if\(!isOrganizer\(\)\|\|window.GatherAccessLost\|\|form.dataset.actor!==ui.actor\)throw new Error\('Your account changed. Reopen task assignment.'/,
  );
  assert.match(app,/form\.dataset\.confirmedBatch!==assignmentConfirmationKey\(data\.owner,data\.tasks\)/);
  assert.match(app, /const replacesDialog=\[[^\n]*'review-assignments'/);
});
