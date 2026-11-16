import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';
import '../legacy/recovery-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'todo',dueDate:'',dependencies:[],...extra});
const state=tasks=>({tasks,event:{timeZone:'America/Los_Angeles'},members:[]});
const panel=(s,actor='maya',overview=false)=>GatherRecoveryUI.create({store:{getState:()=>s},ui:{actor},h,options:()=>'',dayLabel:h,member:id=>({name:id})}).nextUpPanel(s,{overview});
const suggestions=html=>{
  const section=html.match(/<details data-next-up-suggestions [^>]*class="next-up-suggestions"[^>]*>([\s\S]*?)<\/details>/)?.[1]||'';
  return [...section.matchAll(/<article>[\s\S]*?data-id="([^"]+)"[\s\S]*?<\/article>/g)]
    .map(([markup,id])=>({id,markup}));
};
const activityRow=(html,id)=>[...html.matchAll(/<article>\s*[\s\S]*?<\/article>/g)].map(([markup])=>markup)
  .find(markup=>markup.includes(`data-id="${id}"`))||'';
const activityCount=markup=>(markup.match(/class="next-up-activity"/g)||[]).length;
const text=markup=>markup.replace(/<[^>]*>/g,'');

test('empty Next up exposes up to three ranked ready tasks but never commits or assigns them',()=>{
  const tasks=[task('later',{dueDate:'2099-10-03'}),task('important',{priority:'high'}),task('third'),task('fourth'),
    task('other',{owner:'jules',priority:'high'}),task('blocked',{status:'blocked'}),task('complete',{status:'done'})];
  const s=state(tasks),before=structuredClone(s),html=panel(s);
  const expected=GatherPriorities.rank(tasks,new Date(),true,s.event.timeZone).filter(t=>t.owner==='maya'&&GatherPriorities.actionable(t,tasks)).slice(0,3);
  assert.match(html,/class="next-up-suggestions" open/);assert.match(html,/Choose up to three tasks/);
  assert.deepEqual([...html.matchAll(/data-id="([^"]+)"/g)].map(m=>m[1]),expected.map(t=>t.id));
  assert.doesNotMatch(html,/data-action="(?:claim|accept-task|toggle-task)"|<form/);assert.deepEqual(s,before);
});

test('existing commitments stay prominent, suggestions use only remaining slots, and full panels hide them',()=>{
  const tasks=Array.from({length:5},(_,i)=>task('task'+i)),s=state(tasks);
  tasks[0].nextUpAt='2026-10-01T12:00:00Z';
  let html=panel(s);assert.match(html,/1\/3/);assert.match(html,/class="next-up-suggestions"><summary data-next-up-origin="summary"/);
  assert.doesNotMatch(html,/next-up-suggestions" open|Choose up to/);
  assert.equal([...html.matchAll(/data-id=/g)].length,3);
  tasks[1].nextUpAt=tasks[0].nextUpAt;tasks[2].nextUpAt=tasks[0].nextUpAt;
  html=panel(s);assert.match(html,/3\/3/);assert.doesNotMatch(html,/Suggested next tasks/);
});

test('Next up identifies its origin and explains when a commitment also accepts responsibility',()=>{
  const store=GatherStore.createStore({storage:null});
  const created=store.addTask({title:'Fictional commitments task',owner:'maya'});
  const recovery=GatherRecoveryUI.create({store,ui:{actor:'maya'},h,options:()=>'',dayLabel:h,member:id=>({name:id})});
  const current=()=>store.getState().tasks.find(row=>row.id===created.id);
  const control=()=>recovery.responseMarkup(current(),false);
  assert.match(control(),/id="nextUpTaskState" tabindex="-1">Not committed to Next up/);
  assert.match(control(),/Committing also accepts responsibility for this task/);
  store.setNextUp(created.id,{enabled:true},'maya');
  assert.match(control(),/id="nextUpTaskState" tabindex="-1">Committed to Next up/);
  assert.doesNotMatch(control(),/also accepts responsibility/);
  assert.match(panel(store.getState()),/data-next-up-panel="mine" data-next-up-actor="maya"/);
  assert.match(panel(store.getState(),'maya',true),/data-next-up-panel="overview" data-next-up-actor="maya"/);
  assert.match(panel(store.getState()),new RegExp(`data-next-up-origin="task" data-id="${created.id}"`));
  store.setNextUp(created.id,{enabled:false},'maya');
  assert.match(control(),/Not committed to Next up/);
  assert.doesNotMatch(control(),/also accepts responsibility/);
  assert.ok(current().acceptedAt);
});

test('hosted Next up confirms and focuses the new state only after the save resolves',async()=>{
  const app=readFileSync('public/gather-assets/app.js','utf8');
  const start=app.indexOf("      if(form.id==='nextUpForm'){");
  const end=app.indexOf("      if(form.id==='recoveryDecisionForm')",start);
  assert.ok(start>=0&&end>start);
  const events=[],frames=[];
  let resolve,reject;
  const ui={actor:'maya',dialogKind:'task',detailId:'task-a'};
  const backdrop={hidden:false},title={},acceptance={},form={id:'nextUpForm',dataset:{id:'task-a'}};
  let currentForm=form;
  const ctx=vm.createContext({
    form,taskAcceptance:acceptance,taskAcceptanceButton:()=>acceptance,data:{enabled:'true',replaceTaskId:'task-b'},ui,window:{},
    store:{getState:()=>({tasks:[{id:'task-a',acceptedAt:''}]}),setNextUp:(id,data,actor)=>{
      events.push(['save',id,data.enabled,data.replaceTaskId,actor]);
      return new Promise((yes,no)=>{resolve=yes;reject=no;});
    }},
    render:()=>events.push('render'),taskDialog:(...args)=>events.push(['dialog',...args]),toast:value=>events.push(value),
    requestAnimationFrame:callback=>frames.push(callback),
    $:selector=>selector==='#dialogBackdrop'?backdrop:selector==='#dialogTitle'?title:
      selector==='#nextUpForm'?currentForm:selector==='#nextUpTaskState'?{focus:()=>events.push('focus-state')}:null,
  });
  const run=()=>vm.runInContext('(async()=>{'+app.slice(start,end)+'})()',ctx);
  let pending=run();
  assert.deepEqual(events,[['save','task-a',true,'task-b','maya']]);
  assert.equal(frames.length,0);
  resolve();
  await pending;
  assert.equal(events[1],'render');
  assert.deepEqual(events[2].slice(0,3),['dialog','task-a','nextUpForm']);
  assert.equal(events[2].at(-1).readOnly,true);
  assert.equal(events[3],'Task swapped into Next up. Responsibility accepted.');
  frames.shift()();
  assert.equal(events.at(-1),'focus-state');

  events.length=0;
  pending=run();
  reject(new Error('Fictional failed save'));
  await assert.rejects(pending,/Fictional failed save/);
  assert.deepEqual(events,[['save','task-a',true,'task-b','maya']]);
  assert.equal(frames.length,0);

  events.length=0;
  pending=run();
  currentForm={...form};
  resolve();
  await pending;
  assert.deepEqual(events,[['save','task-a',true,'task-b','maya']]);
  assert.equal(frames.length,0);
});

test('accepting an assignment keeps it visible among equally urgent suggestions without committing it',()=>{
  const realNow=Date.now();
  let clock=realNow-4*86400000;
  const store=GatherStore.createStore({storage:null,now:()=>clock});
  const peers=Array.from({length:4},(_,index)=>store.addTask({title:`Fictional assignment ${index+1}`,owner:'maya'}));
  const urgent=store.addTask({title:'Fictional high priority assignment',owner:'maya'});
  store.setTaskPriority(urgent.id,{priority:'high'});
  const blocked=store.addTask({title:'Fictional blocked assignment',owner:'maya',status:'blocked'});
  const awaiting=store.addTask({title:'Fictional reported assignment',owner:'maya',requiresVerification:true});
  store.reportCompletion(awaiting.id,'Fictional result ready to review.','maya');
  const other=store.addTask({title:'Fictional different owner',owner:'dev'});
  const waiting=store.addTask({title:'Fictional pending linked work',owner:'maya',dependencies:[{taskId:other.id,kind:'dependency',reason:'Wait for the other task result.'}]});
  const help=store.addTask({title:'Fictional assignment needs help',owner:'maya'});
  store.requestRecovery(help.id,{kind:'help',note:'Fictional help request.'},'maya');
  const excluded=[blocked,awaiting,other,waiting,help];
  for(const task of excluded)store.setTaskPriority(task.id,{priority:'high'});
  const visible=new Set([...peers,urgent,...excluded].map(task=>task.id));
  const view=()=>{const s=store.getState();return {...s,tasks:s.tasks.filter(task=>visible.has(task.id))};};
  const initial=suggestions(panel(view()));
  const picked=peers.find(task=>task.id===initial[1]?.id);
  assert.equal(initial[0]?.id,urgent.id);
  assert.ok(picked,'choose an ordinary task already visible in the suggestions');
  clock=realNow;
  store.acceptTasks([{id:picked.id,revision:picked.revision}],'maya');
  const before=store.exportState(),current=view();
  for(const overview of [false,true]){
    const html=panel(current,'maya',overview),rows=suggestions(html);
    assert.equal(rows.length,3);
    assert.deepEqual(rows.slice(0,2).map(row=>row.id),[urgent.id,picked.id]);
    assert.match(rows[0].markup,/Review assignment/);
    assert.match(rows[1].markup,/Accepted · Not committed/);
    assert.ok(peers.some(task=>task.id===rows[2].id&&task.id!==picked.id));
    assert.match(rows[2].markup,/Review assignment/);
    for(const task of excluded)assert.ok(!rows.some(row=>row.id===task.id));
    assert.match(html,/0\/3/);
    assert.doesNotMatch(html,/<form|data-action="(?:claim|accept-task|toggle-task)"/);
  }
  const accepted=current.tasks.find(task=>task.id===picked.id);
  assert.ok(accepted.acceptedAt);
  assert.equal(accepted.nextUpAt,'');
  assert.equal(accepted.status,'todo');
  assert.equal(store.exportState(),before);
  const organizerRank=GatherPriorities.rank(current.tasks,new Date(),true,current.event.timeZone).map(task=>task.id);
  assert.ok(peers.filter(task=>task.id!==picked.id).every(task=>organizerRank.indexOf(task.id)<organizerRank.indexOf(picked.id)),
    'the organizer still sees pending acceptance as an attention signal');
});

test('empty guidance distinguishes no assignments from blocked, dependent, and verification-only work',()=>{
  for(const tasks of [[],[task('done',{status:'done'}),task('other',{owner:'jules'})]]){
    const html=panel(state(tasks));assert.match(html,/No open tasks assigned to you/);assert.doesNotMatch(html,/Choose up to|Suggested next/);
  }
  for(const item of [task('blocked',{status:'blocked'}),task('dependent',{dependencies:[{taskId:'missing'}]}),
    task('help',{recoveryRequests:[{kind:'help',status:'pending'}]})]){
    const html=panel(state([item]));assert.match(html,/Nothing ready to start/);assert.doesNotMatch(html,/Choose up to|Suggested next/);
  }
  const reporting=panel(state([task('reported',{status:'progress',requiresVerification:true,reportedAt:'2026-10-01T12:00:00Z'})]));
  assert.match(reporting,/Awaiting organizer verification/);
  assert.doesNotMatch(reporting,/Nothing ready to start|No open tasks assigned|Choose up to|Suggested next/);
});

const completionLinks=markup=>[...markup.matchAll(/<button\b[^>]*data-action="review-personal-completion"[^>]*>/g)].map(([button])=>{
  assert.match(button,/data-next-up-origin="completion-review"/);
  const field=key=>button.match(new RegExp(`data-${key}="([^"]+)"`))?.[1];
  return {id:field('id'),kind:field('review-kind'),at:field('reported-at')};
});

test('personal panels track the saved report through verification, return, revision and reopening without changing commitments',()=>{
  let clock=Date.parse('2026-11-20T16:00:00Z');
  const store=GatherStore.createStore({storage:null,now:()=>clock});
  const {id}=store.addTask({title:'Inspect <fictional entrance> & signs',owner:'maya',requiresVerification:true});
  const other=store.addTask({title:'Other owner progress',owner:'dev',requiresVerification:true});
  store.reportCompletion(other.id,'PRIVATE-OTHER-REPORT','dev');
  const status=GatherRecoveryUI.personalCompletionReviewKind;
  const get=()=>store.getState().tasks.find(task=>task.id===id);
  const names={pending:'Awaiting organizer verification',verified:'Recently verified',returned:'Completion changes requested'};
  function check(stage,reportedAt){
    const before=store.exportState(),current=store.getState();
    current.tasks=current.tasks.filter(task=>task.id===id||task.id===other.id);
    const personal=['pending','verified'].includes(stage);
    assert.equal(status(get(),'maya'),personal?stage:'');
    assert.equal(status(get(),'dev'),'');assert.equal(status(get(),'jack'),'');
    for(const overview of [false,true]){
      const html=panel(current,'maya',overview);
      for(const [kind,heading] of Object.entries(names))assert.equal(html.includes(heading),kind===stage,`${stage}; ${heading}; ${overview}`);
      assert.deepEqual(completionLinks(html),personal?[{id,kind:stage,at:reportedAt}]:[]);
      if(personal){
        assert.match(html,/Inspect &lt;fictional entrance&gt; &amp; signs/);
        assert.equal((html.match(new RegExp(`data-id="${id}"`,'g'))||[]).length,1);
        if(stage==='pending')assert.doesNotMatch(html,/Nothing ready to start|No open tasks assigned to you/);
      }
      assert.doesNotMatch(html,/PRIVATE-|nasa\.gov|<fictional entrance>|Other owner progress|data-action="verify-task"|<form/);
      for(const actor of ['dev','jack','jules'])assert.ok(!completionLinks(panel(current,actor,overview)).some(link=>link.id===id));
    }
    assert.equal(store.exportState(),before,'rendering either personal panel performs no store mutation');
  }
  store.setNextUp(id,{enabled:true},'maya');check('committed');
  clock+=60_000;
  store.reportCompletion(id,{note:'PRIVATE-ORIGINAL-NOTE',links:['https://www.nasa.gov/'],fileIds:['PRIVATE-FILE']},'maya');
  const originalAt=get().reportedAt;
  assert.equal(get().nextUpAt,'');assert.equal(get().status,'progress');
  check('pending',originalAt);
  clock+=60_000;
  store.returnCompletion(id,'PRIVATE-RETURN-REASON','jack');check('returned');
  assert.equal(get().reportedAt,'');
  clock+=60_000;
  store.reportCompletion(id,'PRIVATE-REVISED-NOTE','maya');
  const revised=get().reportedAt;
  assert.notEqual(originalAt,revised);
  check('pending',revised);
  clock+=60_000;
  store.verifyTask(id,'jack');check('verified',revised);
  assert.equal(get().status,'done');assert.equal(get().nextUpAt,'');
  store.setCompletionEvidence(id,{note:'PRIVATE-AMENDMENT'},'maya');check('verified',revised);
  assert.match(panel({...store.getState(),tasks:[get()]}),/Task verified · Evidence update not yet reviewed/);
  store.reviewCompletionEvidence(id,get().revision,'jack');check('verified',revised);
  assert.doesNotMatch(panel({...store.getState(),tasks:[get()]}),/Evidence update not yet reviewed/);
  clock+=60_000;
  store.updateTask(id,{status:'progress'},'jack');check('reopened');
  assert.equal(get().verifiedAt,'');assert.equal(get().reportedAt,'');
});

function completionReviewNavigation({view='tasks',kind='pending'}={}){
  const reportedAt='2026-11-20T16:00:00.000Z',id='fictional-report';
  const item=task(id,{status:kind==='pending'?'progress':'done',requiresVerification:true,reportedAt,verifiedAt:kind==='pending'?'':'2026-11-20T17:00:00.000Z'});
  const ui={actor:'maya',view,tab:'mine'},window={GatherMode:{projectId:'fictional-project'}},document={hidden:false,activeElement:null};
  const root={},backdrop={hidden:true},dialog={},heading={},events=[],frames=[];
  const controls=[];
  const panel={dataset:{nextUpPanel:view==='overview'?'overview':'mine',nextUpActor:'maya'},contains:el=>controls.includes(el),closest:()=>null,parentElement:root};
  const marker=(patch={})=>({isConnected:true,hidden:false,inert:false,dataset:{action:'review-personal-completion',nextUpOrigin:'completion-review',id,reviewKind:kind,reportedAt,...patch},
    closest(selector){if(selector==='[data-next-up-panel]')return panel;return this.hidden||this.inert?this:null;},
    getClientRects(){return [{}];},matches:()=>false,focus(){events.push(['focus card',this.dataset.reportedAt,this.dataset.reviewKind]);},
  });
  const opener=marker();controls.push(opener);
  const fallback={getClientRects:()=>[{}],closest:()=>null,focus:()=>events.push(['focus panel heading'])};
  const flags={pending:false,stale:false};
  let title={};
  const context=vm.createContext({ui,window,document,GatherRecoveryUI,store:{getState:()=>state([item]),getSnapshotRevision:()=>5},
    $$:(selector,parent)=>selector==='[data-next-up-panel]'&&parent===root?[panel]:parent===panel?controls:[],
    $:(selector)=>({ '#viewRoot':root,'#dialogBackdrop':backdrop,'#dialog':dialog,'#dialogTitle':title,'.completion-evidence h3':heading,
      '#personalCompletionPending':fallback,'#personalCompletionVerified':fallback,'[data-next-up-heading]':fallback })[selector]??null,
    hiddenByClosedDisclosure:el=>!!el.closedDisclosure,workspaceUpdatesPending:()=>flags.pending,scheduleRevisionIsStale:()=>flags.stale,
    render:()=>events.push(['render']),toast:message=>events.push(['toast',message]),requestAnimationFrame:fn=>frames.push(fn),
    taskDialog(...args){events.push(['dialog',...args]);ui.detailId=args[0];ui.dialogKind='task';backdrop.hidden=false;document.activeElement=title;},
    focusTaskDialogControl(el,container){assert.equal(el,heading);assert.equal(container,dialog);document.activeElement=heading;events.push(['focus completion']);},
  });
  const app=readFileSync('legacy/app.js','utf8');
  const slice=(start,end)=>{const from=app.indexOf(start),to=app.indexOf(end,from+start.length);assert.ok(from>=0&&to>from);return app.slice(from,to);};
  vm.runInContext(slice('  function sameNextUpPanel(','  function sameWrapReview(')+slice('  function openPersonalCompletionReview(','  function focusTaskDialogControl('),context);
  return {id,opener,item,ui,window,document,backdrop,panel,flags,events,controls,marker,
    start(control=opener){return context.openPersonalCompletionReview(id,control);},
    restore(){return context.restoreNextUpFocus(opener,root);},
    replaceTitle(){title={};document.activeElement=title;},flush(){for(const frame of frames.splice(0))frame();},
  };
}

test('an exact pending or verified card opens existing completion details read-only and preserves its opener',()=>{
  for(const [view,kind] of [['tasks','pending'],['overview','verified']]){
    const f=completionReviewNavigation({view,kind});
    assert.equal(f.start(),true);
    assert.equal(f.events[0][1],f.id);assert.equal(f.events[0].at(-1).readOnly,true);
    assert.equal(f.ui.lastFocus,f.opener);
    assert.equal(f.events.length,1,'heading jump waits until the task dialog is mounted');
    f.flush();assert.deepEqual(f.events.at(-1),['focus completion']);
  }
});

test('wrong or retired completion controls cannot open the report; delayed focus is scoped to the same report and editor',()=>{
  for(const [label,alter] of [
    ['away from Mine',f=>{f.ui.tab='all';}],['different panel actor',f=>{f.panel.dataset.nextUpActor='dev';}],
    ['foreign card',f=>f.marker()],['pending snapshot',f=>{f.flags.pending=true;}],
    ['already reviewed',f=>{f.item.status='done';f.item.verifiedAt='2026-11-20T17:00:00.000Z';}],
    ['new report',f=>{f.item.reportedAt='2026-11-20T18:00:00.000Z';}],['wrong task owner',f=>{f.item.owner='dev';}],
    ['archived',f=>{f.item.archivedAt='2026-11-21';}],['hidden card',f=>{f.opener.hidden=true;}],
    ['inert card',f=>{f.opener.inert=true;}],['disconnected card',f=>{f.opener.isConnected=false;}],
  ]){
    const f=completionReviewNavigation();
    assert.equal(f.start(alter(f)||f.opener),false,label);f.flush();
    assert.ok(!f.events.some(([event])=>event==='dialog'||event==='focus completion'),label);
  }
  for(const [label,alter] of [
    ['another report',f=>{f.item.reportedAt='2026-11-20T18:00:00.000Z';}],['another owner',f=>{f.item.owner='dev';}],
    ['new project',f=>{f.window.GatherMode.projectId='other-project';}],['another actor',f=>{f.ui.actor='dev';}],
    ['different view',f=>{f.ui.view='timeline';}],['lost access',f=>{f.window.GatherAccessLost=true;}],
    ['moved focus',f=>{f.document.activeElement={};}],['closed dialog',f=>{f.backdrop.hidden=true;}],
    ['updated snapshot',f=>{f.flags.pending=true;}],['new dialog title',f=>f.replaceTitle()],
  ]){
    const f=completionReviewNavigation();assert.equal(f.start(),true,label);
    alter(f);f.flush();assert.ok(!f.events.some(([event])=>event==='focus completion'),label);
  }
});

test('return focus follows the same submission from pending to verified, but does not jump to a replacement report',()=>{
  for(const sameReport of [true,false]){
    const f=completionReviewNavigation();f.opener.isConnected=false;
    f.controls.splice(0,1,f.marker({reviewKind:'verified',...(sameReport?{}:{reportedAt:'2026-11-20T18:00:00.000Z'})}));
    assert.equal(f.restore(),true);
    assert.deepEqual(f.events,sameReport?[['focus card',f.item.reportedAt,'verified']]:[['focus panel heading']]);
  }
});

test('Recently verified shows the three newest current confirmations only, excluding other and archived records',t=>{
  let clock=Date.parse('2026-11-20T16:00:00Z');
  const store=GatherStore.createStore({storage:null,now:()=>clock});
  const started=Array.from({length:6},(_,index)=>{
    const {id}=store.addTask({title:`Fictional review ${index}`,owner:index===5?'dev':'maya',requiresVerification:true});
    clock+=60_000;
    store.reportCompletion(id,'PRIVATE-REVIEW-NOTE',index===5?'dev':'maya');return id;
  });
  for(const index of [1,4,2,0,3,5]){clock+=60_000;store.verifyTask(started[index],'jack');}
  const snapshot=store.getState();snapshot.tasks=snapshot.tasks.filter(task=>started.includes(task.id));
  snapshot.tasks.find(task=>task.id===started[3]).archivedAt='2026-11-21';
  // Stale/legacy fields must not pretend to represent a current owner report.
  snapshot.tasks.push(task('legacy-without-report',{status:'done',requiresVerification:true,verifiedAt:new Date(clock+60000).toISOString()}),
    task('legacy-without-verification',{status:'done',requiresVerification:true}),
    task('manual-done',{status:'done'}),
    task('done-without-required-review',{status:'done',reportedAt:'2026-11-20T16:00:00.000Z'}));
  const before=structuredClone(snapshot),byId=id=>snapshot.tasks.find(task=>task.id===id);
  const expected=[0,2,4].map(i=>({id:started[i],kind:'verified',at:byId(started[i]).reportedAt}));
  for(const overview of [false,true]){
    const html=panel(snapshot,'maya',overview);
    assert.match(html,/Recently verified/);
    assert.match(html,/0\/3/);
    assert.deepEqual(completionLinks(html),expected);
    assert.doesNotMatch(html,/PRIVATE-|legacy-without|manual-done|done-without-required-review|Fictional review [135]/);
  }
  const oldFlag=globalThis.GatherAccessLost,hadFlag=Object.hasOwn(globalThis,'GatherAccessLost');
  t.after(()=>{if(hadFlag)globalThis.GatherAccessLost=oldFlag;else delete globalThis.GatherAccessLost;});
  globalThis.GatherAccessLost=true;
  assert.equal(GatherRecoveryUI.personalCompletionReviewKind(byId(started[0]),'maya'),'');
  assert.deepEqual(completionLinks(panel(snapshot,'maya')),[]);
  assert.deepEqual(snapshot,before);
});

test('pending help and date requests stay visible without taking commitment slots or duplicating tasks',()=>{
  const store=GatherStore.createStore({storage:null});
  const [help,date,other]=['Fictional help task','Fictional date task','Fictional other owner'].map((title,i)=>store.addTask({title,owner:i===2?'dev':'maya'}));
  store.setNextUp(help.id,{enabled:true},'maya');
  store.setNextUp(date.id,{enabled:true},'maya');
  store.requestRecovery(help.id,{kind:'help',note:'Fictional help note'},'maya');
  store.requestRecovery(date.id,{kind:'date',note:'Fictional date note',proposedDate:'2099-11-04'},'maya');
  store.requestRecovery(other.id,{kind:'help',note:'Fictional other note'},'dev');
  const view=()=>{const s=store.getState();return {...s,tasks:s.tasks.filter(task=>[help.id,date.id,other.id].includes(task.id))};};
  const before=store.exportState();
  for(const overview of [false,true]){
    const html=panel(view(),'maya',overview);
    assert.match(html,/1\/3/);
    assert.match(html,/Waiting for the organizer[\s\S]*Fictional help task[\s\S]*Help request awaiting review/);
    assert.match(html,/Fictional date task[\s\S]*Date proposal awaiting review/);
    for(const {id} of [help,date])assert.equal(html.split('data-open-recovery data-id="'+id+'"').length,2);
    assert.doesNotMatch(html,/Fictional .* note|Fictional other owner/);
  }
  assert.equal(store.exportState(),before);
  store.setNextUp(date.id,{enabled:false},'maya');
  const uncommitted=panel(view());
  assert.match(uncommitted,/0\/3/);
  assert.match(uncommitted,/Waiting for the organizer[\s\S]*Fictional date task/);
  assert.equal(uncommitted.split('data-open-recovery data-id="'+date.id+'"').length,2);
  assert.doesNotMatch(uncommitted,/Suggested next tasks/);
});

test('recent task handoff replies sit outside assignments and commitments in Next up and Overview',()=>{
  let clock=Date.parse('2026-11-20T16:00:00Z');
  const store=GatherStore.createStore({storage:null,now:()=>clock});
  const request=(owner,title,index,handoff=true)=>{
    clock+=60_000;
    const {id}=store.addTask({title,owner,dueDate:'2026-11-21'});
    store.setNextUp(id,{enabled:true},owner);
    const kind=index%2?'date':'help';
    store.requestRecovery(id,{kind,note:'Fictional unseen request '+index,...(kind==='date'?{proposedDate:'2026-11-28'}:{})},owner);
    const requestId=store.getState().tasks.find(row=>row.id===id).recoveryRequests.at(-1).id;
    if(handoff)store.resolveRecovery(id,{action:'reassign',requestId,note:`Private decision ${index} <tag>`,owner:'jules',reviewAfter:'2026-11-29'},'jack');
    return {id,requestId};
  };
  const own=Array.from({length:5},(_,index)=>request('maya',`Fictional handoff ${index+1}${index===4?' <latest>':''}`,index));
  const {id:unrelated}=request('dev','Another requester’s handoff',5);
  const waiting=request('maya','Fictional still waiting',6,false);
  const wanted=new Set([...own.map(item=>item.id),unrelated,waiting.id]);
  const snapshot=store.getState();snapshot.tasks=snapshot.tasks.filter(row=>wanted.has(row.id));
  const before=store.exportState(),expected=[...own].reverse();
  const links=markup=>[...markup.matchAll(/<button\b[^>]*data-action="review-request-handoff-reply"[^>]*>/g)].map(([button])=>{
    assert.match(button,/data-next-up-origin="handoff-reply"/);
    return Object.fromEntries(['id','request-id'].map(key=>[key==='id'?key:'requestId',button.match(new RegExp(`data-${key}="([^"]+)"`))?.[1]]));
  });
  for(const overview of [false,true]){
    const html=panel(snapshot,'maya',overview);
    const older=html.match(/<details\b([^>]*\bdata-next-up-older-handoffs\b[^>]*)>([\s\S]*?)<\/details>/);
    assert.ok(older);
    assert.doesNotMatch(older[1],/\bopen\b/,'older handoffs are a collapsed native disclosure');
    assert.match(html,/Tasks handed off/);
    assert.match(html,/Fictional handoff 5 &lt;latest&gt;/);
    assert.deepEqual(links(html.replace(older[0],'')),expected.slice(0,3));
    assert.deepEqual(links(older[2]),expected.slice(3));
    assert.match(html,/Waiting for the organizer[\s\S]*Fictional still waiting/);
    assert.match(html,/0\/3/);
    assert.doesNotMatch(html,/Private decision|unseen request|<latest>|Another requester|data-action="(?:claim|accept-task|toggle-task)"|<form/);
    for(const {id} of own){
      assert.equal((html.match(new RegExp(`data-id="${id}"`,'g'))||[]).length,1,'there is a reply only, not a duplicate task row');
      const row=snapshot.tasks.find(item=>item.id===id);
      assert.equal(row.owner,'jules');
      assert.equal(row.nextUpAt,'');
      assert.equal(row.acceptedAt,'');
    }
    assert.deepEqual(links(panel(snapshot,'jules',overview)),[],'the assigned teammate does not receive someone else’s replies');
    assert.deepEqual(links(panel(snapshot,'jack',overview)),[],'organizer status does not make this personal queue communal');
  }
  assert.equal(store.exportState(),before,'opening the panels never makes additional decisions or changes work');
});

test('suggested task text is escaped, actor-scoped, and committing continues through the existing owner action',()=>{
  const s=state([task('id"<>',{title:'<img src=x onerror=alert(1)>'})]);
  const html=panel(s);assert.match(html,/data-id="id&quot;&lt;&gt;"/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
  assert.doesNotMatch(panel(s,'jules'),/id&quot;/);
  const store=GatherStore.createStore({storage:null});const created=store.addTask({title:'Ready to start',owner:'maya'}),raw=store.exportState();
  panel(store.getState());assert.equal(store.exportState(),raw);
  store.setNextUp(created.id,{enabled:true},'maya');const committed=store.getState().tasks.find(t=>t.id===created.id);
  assert.ok(committed.nextUpAt);assert.ok(committed.acceptedAt);assert.equal(committed.status,'todo');
  assert.match(panel(store.getState()),/1\/3/);
});

test('reassignment advice excludes inactive teammates without erasing their historical workload',()=>{
  const current=task('help',{recoveryRequests:[{kind:'help',status:'pending'}]}),historic=task('former-work',{owner:'former',status:'done'});
  const busy=task('dev-work',{owner:'dev',nextUpAt:'2026-10-01T12:00:00Z'});
  const s={...state([current,historic,busy]),members:[{id:'maya',name:'Maya'},{id:'former',name:'Former teammate',active:false},{id:'dev',name:'Dev Kim',active:true}]};
  const before=structuredClone(s);assert.match(GatherPriorities.suggestion(current,s).text,/Consider Dev/);assert.deepEqual(s,before);
  s.members.find(m=>m.id==='dev').active=false;
  assert.doesNotMatch(GatherPriorities.suggestion(current,s).text,/Consider (?:Former|Dev|Maya)/);
  s.members.push({id:'legacy',name:'Legacy active member'});
  assert.match(GatherPriorities.suggestion(current,s).text,/Consider Legacy/);
});

test('Overview next steps are personal, read-only and link to My tasks without accepting work',()=>{
  const s=state([task('mine',{title:'Review the planning brief'}),task('other',{owner:'jules'}),task('waiting',{dependencies:[{taskId:'missing'}]})]);
  const before=structuredClone(s),recovery=GatherRecoveryUI.create({store:{getState:()=>s},ui:{actor:'maya'},h,options:()=>'',dayLabel:h,member:id=>({name:id})});
  const html=recovery.nextUpPanel(s,{overview:true});
  assert.match(html,/aria-label="Your next steps"/);assert.match(html,/Your next steps/);
  assert.match(html,/0\/3 committed/);assert.match(html,/Review a task to accept responsibility/);
  assert.match(html,/data-action="task-filter" data-filter="mine"[^>]*>View my tasks/);
  assert.match(html,/data-id="mine"/);assert.doesNotMatch(html,/data-id="other"|data-id="waiting"|<form|data-action="accept-task"/);
  assert.deepEqual(s,before);
  assert.doesNotMatch(recovery.nextUpPanel(s),/Your next steps|View my tasks|committed/);
});

test('both personal panels show saved activity facts without losing deadlines, review states or task scope',()=>{
  const committed='2026-11-01T20:00:00Z';
  const s=state([
    task('scheduled',{nextUpAt:committed,schedule:{start:'2099-11-20T16:30',end:'2099-11-20T17:15',location:'<Loading & hall>'}}),
    task('untimed',{nextUpAt:committed,eventActivity:true,dueDate:'2099-11-19'}),
    task('ordinary',{nextUpAt:committed,dueDate:'2099-11-17'}),
    task('waiting',{eventActivity:true,dueDate:'2099-11-18',recoveryRequests:[{kind:'date',status:'pending',createdBy:'maya',proposedDate:'2099-12-01',note:'Private request text'}]}),
    task('returned',{requiresVerification:true,completionReview:{note:'Private returned evidence'},schedule:{start:'2099-11-21T10:00',end:'',location:''}}),
    task('nonowned',{owner:'dev',nextUpAt:committed,schedule:{start:'2099-11-20T16:30',end:'',location:'Other owner location'}}),
  ]);
  const before=structuredClone(s);
  for(const overview of [false,true]){
    const html=panel(s,'maya',overview);
    const scheduled=activityRow(html,'scheduled');
    assert.equal(activityCount(scheduled),1);
    assert.match(scheduled,/Nov(?:ember)?\s+20,?\s+2099/);
    assert.match(scheduled,/(?:4:30|16:30).*?(?:5:15|17:15)/s);
    assert.match(scheduled,/America\/Los_Angeles/);
    assert.match(scheduled,/&lt;Loading &amp; hall&gt;/);
    assert.doesNotMatch(scheduled,/<Loading|No due date|Prep due|No end time set/);

    const untimed=activityRow(html,'untimed');
    assert.equal(activityCount(untimed),1);
    assert.match(untimed,/Start time not set/);
    assert.match(text(untimed),/Prep due\s+2099-11-19/);
    const ordinary=activityRow(html,'ordinary');
    assert.equal(activityCount(ordinary),0);
    assert.match(ordinary,/2099-11-17/);
    assert.doesNotMatch(ordinary,/Prep due/);

    const waiting=activityRow(html,'waiting');
    assert.equal(activityCount(waiting),1);
    assert.match(waiting,/data-open-recovery/);
    assert.match(waiting,/Date proposal awaiting review/);
    assert.match(waiting,/Start time not set/);
    assert.match(text(waiting),/Prep due\s+2099-11-18/);

    const returned=activityRow(html,'returned');
    assert.equal(activityCount(returned),1);
    assert.match(returned,/data-action="review-returned-completion"/);
    assert.match(returned,/Review and revise/);
    assert.match(returned,/Location not set/);
    assert.match(returned,/No end time set/);
    assert.doesNotMatch(html,/Other owner location|data-id="nonowned"|Private request text|Private returned evidence|2099-12-01|<form|data-action="(?:claim|accept-task|toggle-task)"/);
  }
  assert.deepEqual(s,before);
});

test('a suggested scheduled activity retains its review label and exposes a saved-time warning',()=>{
  // 01:30 occurs twice on this date in the event zone; existing saved rows
  // can contain it even though new schedule writes reject repeated times.
  const s=state([task('suggested',{acceptedAt:'2026-10-01T12:00:00Z',dueDate:'2026-10-31',
    schedule:{start:'2026-11-01T01:30',end:'2026-11-01T02:30',location:'Main gate'}})]);
  for(const overview of [false,true]){
    const [{markup}]=suggestions(panel(s,'maya',overview));
    assert.equal(activityCount(markup),1);
    assert.match(markup,/Accepted · Not committed/);
    assert.match(text(markup),/Prep due\s+2026-10-31/);
    assert.match(markup,/Start time 2026-11-01 01:30 occurs twice in America\/Los_Angeles/);
    assert.match(markup,/Saved activity time:.*Confirm the time with the organizer before relying on it/s);
    assert.match(markup,/Main gate/);
    assert.doesNotMatch(markup,/<form|data-action="(?:claim|accept-task|toggle-task)"/);
  }
});
