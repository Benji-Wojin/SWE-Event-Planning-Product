import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';

const create = () => GatherStore.createStore({ storage: null });
const ref = (task) => ({ id: task.id, revision: task.revision });
test('selected owned commitments save once, preserve work and have per-task attribution', () => {
  const store = create(),
    a = store.addTask({
      title: 'Prepare corporate room',
      owner: 'maya',
      status: 'blocked',
      note: 'Waiting on AV.',
      dueDate: '2027-01-02',
      requiresVerification: true,
    }),
    b = store.addTask({ title: 'Brief guests', owner: 'maya' }),
    excluded = store.addTask({ title: 'Not selected', owner: 'maya' });
  store.addDependency(a.id, {
    taskId: b.id,
    reason: 'Need briefing materials.',
  });
  const before = store.getState(),
    selected = before.tasks.filter((t) => [a.id, b.id].includes(t.id));
  let saves = 0;
  store.subscribe(() => saves++);
  const result = store.acceptTasks(selected.map(ref), 'maya'),
    after = store.getState();
  assert.equal(saves, 1);
  assert.equal(result.length, 2);
  for (const old of selected) {
    const current = after.tasks.find((t) => t.id === old.id);
    assert.ok(current.acceptedAt);
    assert.equal(current.acceptedBy, 'maya');
    assert.equal(current.revision, old.revision + 1);
    for (const field of [
      'status',
      'owner',
      'note',
      'dueDate',
      'dependencies',
      'requiresVerification',
      'reportedAt',
      'verifiedAt',
      'completedAt',
      'updatedAt',
    ])
      assert.deepEqual(current[field], old[field], field);
  }
  assert.deepEqual(
    after.tasks.find((t) => t.id === excluded.id),
    before.tasks.find((t) => t.id === excluded.id),
  );
  assert.equal(after.activity.length, before.activity.length + 2);
  assert.ok(
    after.activity
      .slice(0, 2)
      .every((a) => a.type === 'accepted' && a.actor === 'maya'),
  );
  const stable = store.exportState();
  store.acceptTasks(result.map(ref), 'maya');
  assert.equal(store.exportState(), stable);
  assert.equal(saves, 1);
});
test('every selection is validated before any local acceptance or activity is changed', () => {
  for (const invalid of ['foreign', 'missing', 'stale', 'reported', 'done']) {
    const store = create(),
      a = store.addTask({ title: 'First', owner: 'maya' }),
      b = store.addTask({
        title: 'Second',
        owner: invalid === 'foreign' ? 'dev' : 'maya',
        requiresVerification: true,
      });
    let second = ref(b);
    if (invalid === 'missing') second.id = 'absent';
    if (invalid === 'stale') {
      store.updateTask(b.id, { title: 'Revised commitment' });
    }
    if (invalid === 'reported') {
      store.reportCompletion(
        b.id,
        'Reported, not independently verified.',
        'maya',
      );
      second = ref(store.getState().tasks.find((t) => t.id === b.id));
    }
    if (invalid === 'done') {
      store.updateTask(b.id, { requiresVerification: false });
      store.updateTask(b.id, { status: 'done' });
      second = ref(store.getState().tasks.find((t) => t.id === b.id));
    }
    const before = store.exportState();
    assert.throws(() => store.acceptTasks([ref(a), second], 'maya'));
    assert.equal(store.exportState(), before, invalid);
  }
});
test('batch input is bounded, distinct, revision-bound and cannot forge the actor', () => {
  const store = create(),
    a = store.addTask({ title: 'Owned work', owner: 'maya' }),
    r = ref(a),
    before = store.exportState();
  for (const selection of [
    null,
    [],
    [a.id],
    [r, r],
    [{ ...r, revision: 0 }],
    [{ ...r, revision: '1' }],
    [{ ...r, actor: 'maya' }],
    Array(101).fill(r),
  ]) {
    assert.throws(() => store.acceptTasks(selection, 'maya'));
    assert.equal(store.exportState(), before);
  }
  assert.throws(() => store.acceptTasks([r], 'jack'), /assigned owner/);
  assert.equal(store.exportState(), before);
  assert.throws(() => store.acceptTasks([r], 'absent'), /member/);
  assert.equal(store.exportState(), before);
});

const app = readFileSync('legacy/app.js', 'utf8');
test('API validates bounds and duplicates before cloning one ownership snapshot', () => {
  const source = readFileSync('lib/workspace.ts', 'utf8');
  const start = source.indexOf("  if (method === 'acceptTasks') {");
  const end = source.indexOf("  if (user.role !== 'admin'", start);
  const guard = source.slice(start, end).replaceAll('(task: any)', '(task)');
  let reads = 0;
  class HttpError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  const context = vm.createContext({
    method: 'acceptTasks',
    user: { actorId: 'maya' },
    HttpError,
    store: {
      getState() {
        reads++;
        return {
          tasks: [
            { id: 'a', owner: 'maya' },
            { id: 'b', owner: 'maya' },
            { id: 'other', owner: 'jack' },
          ],
        };
      },
    },
  });
  for (const a of [
    [],
    Array(1000).fill({ id: 'a', revision: 1 }),
    [
      { id: 'a', revision: 1 },
      { id: 'a', revision: 1 },
    ],
    null,
    [{ id: 'a', revision: '1' }],
  ]) {
    context.a = a;
    assert.throws(
      () => vm.runInContext(guard, context),
      (error) => error.status === 400,
    );
    assert.equal(reads, 0);
  }
  context.a = [
    { id: 'a', revision: 1 },
    { id: 'b', revision: 1 },
  ];
  vm.runInContext(guard, context);
  assert.equal(reads, 1);
  context.a = [{ id: 'other', revision: 1 }];
  assert.throws(
    () => vm.runInContext(guard, context),
    (error) => error.status === 403,
  );
  assert.equal(reads, 2);
});
test('review is current-view owned/open/unaccepted only, escaped and selected by nobody by default', () => {
  const tasks = [
    {
      id: 'a',
      revision: 4,
      title: '<script>title</script>',
      note: '<img src=x>',
      owner: 'maya',
      status: 'blocked',
      dueDate: '',
      eventActivity: true,
    },
    { id: 'other', owner: 'dev', status: 'todo' },
    { id: 'timed', revision: 2, title: 'Welcome crew', owner: 'maya', status: 'todo',
      schedule: {start:'2030-11-10T09:00',end:'2030-11-10T10:30',location:'East <Hall>'} },
    { id: 'accepted', owner: 'maya', acceptedAt: 'date', status: 'todo' },
    { id: 'done', owner: 'maya', status: 'done' },
    { id: 'reported', owner: 'maya', status: 'progress', reportedAt: 'date' },
    { id: 'verified', owner: 'maya', status: 'progress', verifiedAt: 'date' },
  ];
  let markup;
  const context = vm.createContext({
    ui: { actor: 'maya' },
    window: {GatherAccessLost:false},
    GatherPriorities, GatherScheduleUI,
    eventReviewScope: () => ({mine:false,actor:'maya'}),
    schedule: {reviewAcceptanceTasks:(_state,scope)=>{
      assert.equal(scope.actor,'maya');return tasks.filter(task=>task.id==='a');
    }},
    store: { getState: () => ({ event: { timeZone: 'UTC' }, tasks }) },
    filteredTasks: (s) => s.tasks,
    h: (value) =>
      String(value ?? '')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;'),
    statuses: { blocked: 'Blocked' },
    dayLabel: (s) => s,
    openDialog: (_title, body) => (markup = body),
    toast: () => {},
    workspaceUpdatesPending: () => false,
    scheduleRevisionIsStale: () => false,
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function acceptanceCandidates('),
      app.indexOf('  function inboxView('),
    ) + 'acceptanceDialog();',
    context,
  );
  assert.match(markup, /value="a" data-revision="4"/);
  assert.match(markup, /&lt;script&gt;title/);
  assert.match(markup, /&lt;img/);
  assert.doesNotMatch(
    markup,
    / checked|value="(?:other|accepted|done|reported|verified)"|<script>|<img/,
  );
  assert.match(markup, /Nothing is selected for you/);
  assert.match(markup, /id="acceptanceSubmit"[^>]*disabled/);
  assert.match(markup, /does not mark work complete/);
  assert.match(markup, /data-action="inspect-acceptance-task" data-id="a"/);
  assert.match(markup, /id="accept-activity-timed">Activity: .*9:00 AM – 10:30 AM · UTC · East &lt;Hall&gt;/);
  vm.runInContext('acceptanceDialog(true);',context);
  assert.match(markup,/data-return-to="event-review"/);
  assert.match(markup,/Planned activity · start time not set/);
  assert.match(markup,/data-action="before-event-review">Back to event review/);
  assert.doesNotMatch(markup,/value="other"| checked/);
  assert.equal(
    vm.runInContext(
      'acceptanceCandidates(Array.from({length:101},(_,i)=>({id:String(i),owner:"maya",status:"todo"}))).length',
      context,
    ),
    100,
  );
});
test('returning to an assignment review keeps only unchanged, still-eligible selections in the same source',()=>{
  const owned=(id,revision,extra={})=>({id,revision,title:id,owner:'maya',status:'todo',...extra});
  const tasks=[owned('same',2),owned('changed',5),owned('outside-scope',3),owned('new-unselected',1),
    owned('accepted',2,{acceptedAt:'2030-11-01'}),owned('reassigned',2,{owner:'dev'}),owned('completed',3,{status:'done'})];
  const selected=[{id:'same',revision:2},{id:'changed',revision:4},{id:'outside-scope',revision:3},
    {id:'accepted',revision:2},{id:'reassigned',revision:2},{id:'completed',revision:3},{id:'removed',revision:1}];
  const state={event:{timeZone:'UTC'},tasks},resume={selected,openerId:'same',timeZone:'UTC'},before=structuredClone({state,resume});
  const scoped=tasks.filter(task=>task.id!=='outside-scope');
  const dialog={},title={},frames=[],sync={hidden:true};
  let markup,opens=0,notice;
  const form={dataset:{}},status={},refresh={focus(){}},submit={};
  const kept={checked:true,disabled:false};
  const document={activeElement:null,createElement:()=>({})};
  const context=vm.createContext({
    ui:{actor:'maya',dialogKind:''},window:{GatherAccessLost:false},GatherPriorities,
    store:{getState:()=>state,acceptTasks(){throw Error('Returning is read-only');}},
    eventReviewScope:()=>({mine:true,actor:'maya'}),
    schedule:{reviewAcceptanceTasks(current,scope){assert.equal(current,state);assert.equal(scope.mine,true);return scoped;}},
    filteredTasks(){throw Error('Must keep the event review source');},
    h:String,statuses:{todo:'To do'},dayLabel:value=>value,
    $:selector=>({'#dialog':dialog,'#dialogTitle':title,'#workspaceSyncNotice':sync,'#acceptTasksForm':form,
      '#dialogStaleNotice':notice,'#acceptanceRefreshStatus':status,'#acceptanceRefresh':refresh,
      '.dialog-body':{prepend:node=>{notice=node;}}})[selector]??null,
    $$:()=>[kept,submit],
    document,
    workspaceUpdatesPending:()=>!sync.hidden,
    scheduleRevisionIsStale:()=>false,
    requestAnimationFrame:frame=>frames.push(frame),
    openDialog(_title,body,_footer,_wide,kind){opens++;markup=body;context.ui.dialogKind=kind;},
    toast(){throw Error('No toast for an available review');},
  });
  vm.runInContext(app.slice(app.indexOf('  function acceptanceCandidates('),app.indexOf('  function inboxView(')),context);
  context.acceptanceDialog(true,resume);
  assert.equal(opens,1);
  assert.match(markup,/from this event review/);
  assert.match(markup,/data-return-to="event-review"/);
  assert.match(markup,/data-action="before-event-review">Back to event review/);
  assert.match(markup,/6 selections were cleared because the task changed or is no longer in this review/);
  assert.match(markup,/id="acceptanceCount"[^>]*>1 task selected\./);
  assert.doesNotMatch(markup,/id="acceptanceSubmit"[^>]*disabled/);
  const inputs=[...markup.matchAll(/<input[^>]*name="acceptTask"[^>]*value="([^"]+)"[^>]*>/g)];
  assert.deepEqual(inputs.map(([,id])=>id),['same','changed','new-unselected']);
  assert.deepEqual(inputs.filter(([tag])=>/\bchecked\b/.test(tag)).map(([,id])=>id),['same']);
  assert.match(markup,/value="changed" data-revision="5"/);
  assert.match(markup,/data-action="inspect-acceptance-task" data-id="same"/);
  assert.deepEqual({state,resume},before);
  sync.hidden=false;
  context.acceptanceDialog(true,resume);
  assert.match(status.textContent,/Newer project changes are available/);
  assert.match(notice.innerHTML,/data-action="(?:refresh-acceptance-review|reload-workspace)"/);
  assert.match(markup,/id="acceptanceSubmit"[^>]*disabled/);
  assert.match(markup,/value="same" data-revision="2"[^>]*\bchecked\b/);
  assert.equal(kept.checked,true);
  assert.equal(kept.disabled,true);
  assert.equal(submit.disabled,true);
  sync.hidden=true;
  assert.equal(context.acceptanceReviewPending(form),true,'clearing the banner does not bypass the locked review');
  assert.deepEqual({state,resume},before);
});

test('refresh clears a checked assignment if a newly loaded prerequisite state changes the reviewed readiness at the same task revision',()=>{
  const store=create();
  const prerequisite=store.addTask({title:'Fictional room booking',owner:'jack',requiresVerification:false});
  const dependent=store.addTask({title:'Fictional room setup',owner:'maya'});
  const stable=store.addTask({title:'Fictional welcome sign',owner:'maya'});
  store.addDependency(dependent.id,{taskId:prerequisite.id,reason:'The room must be available.'});
  store.updateTask(prerequisite.id,{status:'done'});
  const candidate=store.getState();
  const selected=candidate.tasks.filter(task=>[dependent.id,stable.id].includes(task.id)).map(task=>({...ref(task),readiness:''}));
  // Model a loaded snapshot whose prerequisite changed without the related task's
  // delivery comment. Normal store reopening also bumps the dependent revision.
  candidate.tasks.find(task=>task.id===prerequisite.id).status='todo';
  const saved=store.exportState();
  let html='';
  const context=vm.createContext({ui:{actor:'maya'},window:{},store:{getState:()=>candidate},GatherPriorities,
    schedule:{},filteredTasks:state=>state.tasks,workspaceUpdatesPending:()=>false,scheduleRevisionIsStale:()=>false,
    h:String,statuses:{todo:'To do'},dayLabel:String,openDialog:(_title,markup)=>{html=markup;},
  });
  vm.runInContext(app.slice(app.indexOf('  function acceptanceCandidates('),app.indexOf('  function inboxView(')),context);
  context.acceptanceDialog(false,{selected});
  const check=id=>html.match(new RegExp('<input[^>]*value="'+id+'"[^>]*>'))?.[0];
  assert.match(check(dependent.id),/data-readiness="Waiting on 1 required task before completion\."/);
  assert.doesNotMatch(check(dependent.id),/\bchecked\b/);
  assert.match(check(stable.id),/\bchecked\b/);
  assert.match(html,/1 selection was cleared/);
  assert.equal(store.exportState(),saved);
});

test('a changed event time zone clears selected activity reviews but not unchanged preparation work',()=>{
  const timed={id:'timed',revision:2,title:'Timed',owner:'maya',status:'todo',
    schedule:{start:'2030-11-10T09:00',end:'',location:'Fixture hall'}};
  const prep={id:'prep',revision:4,title:'Preparation',owner:'maya',status:'todo'};
  const tasks=[timed,prep];
  const state={event:{timeZone:'America/New_York'},tasks};
  const resume={timeZone:'UTC',selected:tasks.map(ref)};
  let markup;
  const context=vm.createContext({
    ui:{actor:'maya'},window:{GatherAccessLost:false},GatherPriorities,GatherScheduleUI,
    schedule:GatherScheduleUI.create({h:String,options:()=>'',statusBadge:()=>''}),
    store:{getState:()=>state,acceptTasks(){assert.fail('Review does not accept tasks');}},
    filteredTasks:()=>tasks, workspaceUpdatesPending:()=>false, scheduleRevisionIsStale:()=>false, h:String, statuses:{todo:'To do'}, dayLabel:String,
    $:()=>null, requestAnimationFrame(){}, openDialog(_title,body){markup=body;},
  });
  vm.runInContext(app.slice(app.indexOf('  function acceptanceCandidates('),app.indexOf('  function inboxView(')),context);
  context.acceptanceDialog(false,resume);
  const checked=Array.from(markup.matchAll(/<input[^>]*name="acceptTask"[^>]*value="([^"]+)"[^>]*>/g))
    .filter(([tag])=>/\bchecked\b/.test(tag)).map(([,id])=>id);
  assert.deepEqual(checked,['prep']);
  assert.match(markup,/America\/New_York/);
  assert.match(markup,/1 task selected/);
});

function acceptanceRefreshFixture({fromEventReview=true}={}){
  const ui={actor:'maya',view:fromEventReview?'timeline':'tasks',tab:'mine',dialogKind:'acceptance',
    timelineMode:'schedule',scheduleMine:true,scheduleDate:'2030-11-10',toolUpdatePending:true};
  const window={GatherAccessLost:false,GatherMode:{projectId:'fixture-project'}},document={hidden:false};
  const attrs=new Map(), status={textContent:''},sync={hidden:false},backdrop={hidden:false},dialog={};
  const button={isConnected:true,setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name),getAttribute:name=>attrs.get(name)};
  const selected=[{checked:true,value:'retained',dataset:{revision:'7'}},{checked:true,value:'changed',dataset:{revision:'2'}}];
  const submit={disabled:true},count={textContent:''};
  const title={};
  let form={isConnected:true,dataset:{actor:'maya',timeZone:'UTC',...(fromEventReview?{returnTo:'event-review'}:{})},
    contains:element=>element===button};
  let revision=11,known=13,recoveryFloor=-1,zone='UTC';
  const reads=[],events=[];
  const context=vm.createContext({
    ui,window,document, h:String,
    $:selector=>({'#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,
      '#acceptTasksForm':form,'#acceptanceRefreshStatus':status,'#acceptanceRefresh':button,
      '[data-action="refresh-acceptance-review"]':button,'#workspaceSyncNotice':sync,
      '#acceptanceSubmit':submit,'#acceptanceCount':count})[selector]??null,
    $$:selector=>selector.includes('acceptTask')?selected:[],
    eventReviewScope:()=>({mine:ui.scheduleMine,actor:ui.actor}),
    workspaceUpdatesPending:()=>!sync.hidden,
    recoveryConflictPending:(candidate=revision)=>candidate<=recoveryFloor,
    scheduleRevisionIsStale:candidate=>candidate<known,
    rememberNewerSchedule:(_snapshot,candidate)=>{if(Number.isSafeInteger(candidate))known=Math.max(known,candidate);},
    showPendingUpdate:()=>events.push('pending'),
    render:()=>events.push('render'),
    toast:message=>events.push(['toast',message]),
    store:{
      getState:()=>({event:{timeZone:zone},tasks:[]}),getSnapshotRevision:()=>revision,
      acceptTasks(){assert.fail('Refresh does not accept tasks');},
      refresh(canApply,options){
        return new Promise((resolve,reject)=>reads.push({canApply,options,reject,finish(candidate,result={changed:candidate!==revision,verified:true}){
          if(canApply(candidate)&&result.verified&&!result.pending)revision=candidate;
          resolve(result);
        }}));
      },
    },
    acceptanceDialog:(...args)=>events.push(['dialog',...args]),
  });
  const start=app.indexOf('  function acceptanceSelections(');
  assert.ok(start>=0,'the refresh handler is present');
  const end=app.indexOf('  function inboxView(',start);
  vm.runInContext(app.slice(start,end),context);
  return {ui,window,document,button,attrs,status,sync,selected,reads,events,backdrop,submit,
    refresh:()=>context.refreshAcceptanceReview(button),
    isPending:()=>context.acceptanceReviewPending(form),
    set reviewedRevision(value){form.dataset.workspaceRevision=String(value);},
    set knownRevision(value){known=value;},
    set recoveryFloor(value){recoveryFloor=value;},
    set zone(value){zone=value;},
    replaceForm(){form={...form};},
  };
}

test('a verified assignment refresh keeps source and reviewed selections without writes',async()=>{
  for(const fromEventReview of [false,true]){
    const f=acceptanceRefreshFixture({fromEventReview});
    f.recoveryFloor=13;
    const pending=f.refresh();
    assert.equal(f.reads.length,1);
    const [read]=f.reads;
    assert.equal(read.options.requireFresh,true);
    assert.equal(read.canApply(12),false,'old revision cannot publish');
    assert.equal(read.canApply(13),false,'a write-conflict floor cannot publish');
    assert.equal(read.canApply(14),true);
    assert.equal(f.attrs.get('aria-disabled'),'true');
    assert.match(f.status.textContent,/Refreshing/);
    await f.refresh();
    assert.equal(f.reads.length,1,'a duplicate refresh does not race the first');
    assert.deepEqual(f.events,[]);
    f.zone='America/New_York';
    read.finish(14);
    await pending;
    assert.equal(f.sync.hidden,true);
    assert.equal(f.ui.toolUpdatePending,false);
    const opened=f.events.find(event=>Array.isArray(event)&&event[0]==='dialog');
    assert.equal(opened[1],fromEventReview);
    assert.deepEqual(JSON.parse(JSON.stringify(opened[2].selected)),[{id:'retained',revision:7},{id:'changed',revision:2}]);
    assert.equal(opened[2].timeZone,'UTC','retain the reviewed zone, not the newly loaded one');
    assert.equal(f.events[0],'render');
  }
});

test('a changed loaded workspace revision requires review even without the sync banner',()=>{
  const f=acceptanceRefreshFixture();
  f.sync.hidden=true;
  f.recoveryFloor=0;
  f.knownRevision=11;
  f.reviewedRevision=11;
  assert.equal(f.isPending(),false);
  f.reviewedRevision=10;
  assert.equal(f.isPending(),true);
});

test('failed, unverified or superseded refreshes keep the old locked selection form',async()=>{
  for(const interrupt of ['failure','unverified','pending','hidden','actor','project','view','form']){
    const f=acceptanceRefreshFixture();
    const pending=f.refresh();
    assert.equal(f.reads.length,1,interrupt);
    const [read]=f.reads;
    if(interrupt==='failure')read.reject(new Error('Fictional read failed'));
    else if(interrupt==='unverified')read.finish(13,{changed:false});
    else if(interrupt==='pending')read.finish(13,{pending:true,newerRevision:14});
    else{
      if(interrupt==='hidden')f.document.hidden=true;
      if(interrupt==='actor')f.ui.actor='dev';
      if(interrupt==='project')f.window.GatherMode.projectId='other-project';
      if(interrupt==='view')f.ui.view='overview';
      if(interrupt==='form')f.replaceForm();
      assert.equal(read.canApply(14),false,interrupt);
      read.finish(14);
    }
    await pending;
    assert.equal(f.sync.hidden,false,interrupt);
    assert.ok(f.selected.every(input=>input.checked),interrupt);
    assert.equal(f.submit.disabled,true,interrupt);
    assert.ok(f.events.every(event=>event!=='render'&&event[0]!=='dialog'),interrupt);
  }
});

test('known-stale assignment controls cannot write, and a conflicting save keeps the reviewed choices locked',async()=>{
  const start=app.indexOf("  document.addEventListener('submit'"),end=app.indexOf("  document.addEventListener('change'",start);
  const clickStart=app.indexOf("      if(action==='acceptance-select')"),clickEnd=app.indexOf("      if(action==='report-task')",clickStart);
  assert.ok(start>=0&&end>start&&clickStart>=0&&clickEnd>clickStart);
  const selected=[{value:'kept',checked:true,dataset:{revision:'4'}},{value:'unchecked',checked:false,dataset:{revision:'5'}}];
  const control={},form={id:'acceptTasksForm',dataset:{actor:'maya'},isConnected:true,contains:element=>element===control,closest:()=>null};
  let submit,stale=true,revision=12;
  const events=[];
  const context=vm.createContext({
    ui:{actor:'maya',dialogKind:'acceptance'},window:{},action:'acceptance-select',id:'all',el:control,
    document:{addEventListener(_type,handler){submit=handler;}},
    FormData:class{constructor(){return [];}},
    $:selector=>selector==='#acceptTasksForm'?form:null,$$:()=>selected,
    acceptanceReviewPending:()=>stale,
    captureAcceptanceHandoff:()=>null,
    syncAcceptanceSelection:()=>events.push('changed choices'),
    acceptanceSelections:()=>selected.filter(input=>input.checked).map(input=>({id:input.value,revision:Number(input.dataset.revision)})),
    saveLock:()=>{events.push('lock');return ()=>events.push('release');},
    store:{getSnapshotRevision:()=>revision,async acceptTasks(selections,actor){events.push(['write',selections,actor]);revision=13;throw Object.assign(new Error('Fictional 409'),{status:409});}},
    showRecoveryWriteConflict:submitted=>{stale=true;events.push(['conflict',submitted]);},
    formError:(candidate,error)=>{assert.equal(candidate,form);events.push(['error',error.message]);},
    toast:()=>{},paintAcceptanceRefresh:()=>events.push(['paint',stale]),
  });
  vm.runInContext(app.slice(start,end).replace('store.acceptTasks(', 'await store.acceptTasks('),context);
  const choose=()=>vm.runInContext(app.slice(clickStart,clickEnd),context);
  const event=()=>({target:form,preventDefault(){},submitter:{}});
  choose();
  await submit(event());
  assert.deepEqual(events,[['paint',true],['paint',true]]);
  assert.deepEqual(selected.map(input=>input.checked),[true,false]);

  stale=false;
  await submit(event());
  assert.deepEqual(events.slice(2),['lock',['write',[{id:'kept',revision:4}],'maya'],['conflict',12],'release',['paint',true]]);
  assert.deepEqual(selected.map(input=>input.checked),[true,false]);
  choose();
  await submit(event());
  assert.equal(events.filter(item=>Array.isArray(item)&&item[0]==='write').length,1);
  assert.deepEqual(selected.map(input=>input.checked),[true,false]);
});
test('selection state enables deliberate submit and serializes all reviewed revisions before save lock', () => {
  const count = { textContent: '' },
    button = { disabled: true },
    selected = [];
  const context = vm.createContext({
    $$: () => selected,
    $: (selector) => (selector === '#acceptanceCount' ? count : button),
    workspaceUpdatesPending: () => false,
    scheduleRevisionIsStale: () => false,
    store: {},
  });
  vm.runInContext(
    app.slice(
      app.indexOf('  function syncAcceptanceSelection('),
      app.indexOf('  function inboxView('),
    ),
    context,
  );
  vm.runInContext('syncAcceptanceSelection({})', context);
  assert.equal(button.disabled, true);
  selected.push({});
  vm.runInContext('syncAcceptanceSelection({})', context);
  assert.equal(button.disabled, false);
  assert.equal(count.textContent, '1 task selected.');
  const serialization = app.indexOf(
    "if(form.id==='acceptTasksForm')data.selections=",
  );
  assert.ok(serialization > 0);
  assert.ok(
    serialization <
      app.indexOf('const release=saveLock(form.closest', serialization),
  );
  assert.match(app, /form\.dataset\.actor!==ui\.actor/);
  assert.match(app, /store\.acceptTasks\(data\.selections,ui\.actor\)/);
});
test('prepared hosted UI awaits one registered batch action without actor parameters', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const hosted = readFileSync('public/gather-assets/app.js', 'utf8'),
    proxy = readFileSync('legacy/hosted-store.js', 'utf8');
  assert.match(
    hosted,
    /const accepted=await store\.acceptTasks\(data\.selections,ui\.actor\);\s*if\(form\.dataset\.returnTo==='event-review'\)\{render\(\);beforeEventReview\(\);\}/,
  );
  assert.match(proxy, /'acceptTasks'/);
  assert.match(proxy, /acceptTasks: 1/);
});
