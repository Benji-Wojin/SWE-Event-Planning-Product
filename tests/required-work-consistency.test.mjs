import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';
import '../legacy/planning-ui.js';

const now='2026-10-03T16:30:00Z';
const get=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const create=()=>GatherStore.createStore({storage:null});
const reload=(snapshot)=>{
  let raw=JSON.stringify(snapshot);
  return GatherStore.createStore({storage:{getItem:key=>key===GatherStore.STORAGE_KEY?raw:null,setItem:(_key,value)=>{raw=value;}}});
};
const task=(id,extra={})=>({id,title:id,owner:'maya',status:'todo',dueDate:'',dependencies:[],...extra});
const link=(id,kind='dependency')=>({taskId:id,kind,reason:'Fictional relationship'});
const h=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function linkedStore(availability,kind='dependency'){
  const source=create();
  const prerequisite=source.addTask({title:'Fictional prerequisite',owner:'dev',requiresVerification:true});
  source.reportCompletion(prerequisite.id,'Fictional prerequisite result.','dev');
  source.verifyTask(prerequisite.id);
  const add=(label,fields={})=>{
    const row=source.addTask({title:'Fictional '+label,owner:'maya',...fields});
    source.addDependency(row.id,{taskId:prerequisite.id,kind,reason:'Fictional reason'});
    return row.id;
  };
  const manual=add('manual completion'),report=add('owner report'),pending=add('pending verification',{requiresVerification:true}),
    commitment=add('Next up'),resume=add('resume',{status:'blocked'}),historical=add('already completed');
  // Ensure there is a live satisfied Required link even in the Related-only cases,
  // because a manually blocked task with no Required links is not resumable.
  if(kind==='related'){
    const ready=source.addTask({title:'Fictional available result',owner:'dev'});
    source.reportCompletion(ready.id,'An available result.','dev');
    source.addDependency(resume,{taskId:ready.id,reason:'Available required work'});
  }
  source.reportCompletion(pending,'A pending fictional report.','maya');
  source.reportCompletion(historical,'A completed fictional result.','maya');
  const snapshot=JSON.parse(source.exportState());
  if(availability==='archived')snapshot.tasks.find(task=>task.id===prerequisite.id).archivedAt=now;
  if(availability==='missing')snapshot.tasks=snapshot.tasks.filter(task=>task.id!==prerequisite.id);
  const store=reload(snapshot);
  assert.equal(get(store,prerequisite.id)?.archivedAt,availability==='archived'?now:undefined);
  assert.ok(get(store,manual),'a real saved workspace was loaded');
  assert.ok(get(store,pending).reportedAt,'the pending report was saved while Required work was available');
  return {store,prerequisite,manual,report,pending,commitment,resume,historical};
}

test('missing or archived verified Required work blocks each task action without mutating completion history',()=>{
  for(const unavailable of ['archived','missing']){
    const {store,prerequisite,manual,report,pending,commitment,resume,historical}=linkedStore(unavailable);
    const old=store.exportState(),done=get(store,historical),pendingBefore=get(store,pending);
    let notifications=0;store.subscribe(()=>notifications++);
    for(const [action,error] of [
      [()=>store.updateTask(manual,{status:'done'},'jack'),/required work/i],
      [()=>store.reportCompletion(report,'The dependent is finished.','maya'),/required work/i],
      [()=>store.verifyTask(pending,'jack',pendingBefore.revision),/required work/i],
      [()=>store.setNextUp(commitment,{enabled:true},'maya'),/blocker|required work/i],
      [()=>store.resumeTask(resume,'maya'),/unavailable|still open|required work/i],
    ]){
      assert.throws(action,error,unavailable);
      assert.equal(store.exportState(),old,unavailable);
    }
    assert.equal(notifications,0);
    assert.equal(get(store,historical).status,'done');
    assert.deepEqual(get(store,historical).completionResult,done.completionResult);
    assert.equal(store.taskCompletionStates().get(historical),true);
    if(unavailable==='archived')assert.equal(store.taskCompletionStates().get(prerequisite.id),true,'historical verification remains true for the archived task itself');
  }
});

test('Related links never gate actions and a current verified Required link remains valid',()=>{
  for(const [availability,kind] of [['archived','related'],['missing','related'],['available','dependency']]){
    const {store,manual,report,pending,commitment,resume}=linkedStore(availability,kind);
    assert.equal(store.updateTask(manual,{status:'done'},'jack').status,'done');
    assert.equal(store.reportCompletion(report,'Fictional dependent result.','maya').status,'done');
    assert.equal(store.verifyTask(pending,'jack',get(store,pending).revision).status,'done');
    assert.ok(store.setNextUp(commitment,{enabled:true},'maya').nextUpAt);
    assert.equal(store.resumeTask(resume,'maya').status,'progress');
  }
});

test('new links to unavailable tasks fail atomically; obsolete links can be explicitly removed',()=>{
  for(const unavailable of ['archived','missing']){
    const {store,prerequisite,report}=linkedStore(unavailable);
    const host=store.addTask({title:'Fictional host',owner:'maya',status:'blocked',note:'Waiting for the safety contact to confirm.'});
    const active=store.addTask({title:'Fictional active work',owner:'dev'});
    const before=store.exportState(),historical=get(store,prerequisite.id);
    let updates=0;store.subscribe(()=>updates++);
    for(const kind of ['dependency','related'])for(const attempt of [
      ()=>store.addTask({title:'Cannot link',dependencies:[link(active.id),link(prerequisite.id,kind)]}),
      ()=>store.addDependency(host.id,link(prerequisite.id,kind),'maya'),
      ()=>store.setDependencyKind(report,link(prerequisite.id,kind),'maya'),
    ]){
      assert.throws(attempt,unavailable==='archived'?/Archived tasks cannot be linked/:/task could not be found/i);
      assert.equal(store.exportState(),before,`${unavailable}/${kind} must not create a task or consume the blocked placeholder`);
    }
    assert.equal(updates,0);
    const unlinked=store.removeDependency(report,prerequisite.id,'maya');
    assert.ok(!unlinked.dependencies.some(row=>row.taskId===prerequisite.id));
    assert.equal(unlinked.comments.at(-1).kind,'dependency-removed');
    assert.equal(updates,1);assert.deepEqual(get(store,prerequisite.id),historical);
    assert.equal(store.reportCompletion(report,'Fictional result after link review.','maya').status,'done');
  }
});

test('unavailable work never redelivers a new result, and prior linked history is retained',()=>{
  const {store,prerequisite,report}=linkedStore('archived');
  const snapshot=JSON.parse(store.exportState()),dependent=snapshot.tasks.find(task=>task.id===report);
  const previous=dependent.comments.filter(comment=>comment.kind==='dependency-result');
  assert.equal(previous.length,1,'the result was originally delivered while the task was available');
  dependent.dependencies.find(link=>link.taskId===prerequisite.id).delivered='';
  const loaded=reload(snapshot);
  loaded.addComment(report,'Fictional context after the archive.','maya');
  const after=get(loaded,report);
  assert.deepEqual(after.comments.filter(comment=>comment.kind==='dependency-result'),previous);
  assert.equal(after.comments.at(-1).text,'Fictional context after the archive.');
  assert.equal(get(loaded,prerequisite.id).status,'done');
});

function projections(){
  const archived=task('archived-prerequisite',{status:'done',requiresVerification:true,verifiedAt:now,archivedAt:now,owner:'dev',
    completionResult:{text:'ARCHIVED_FIXTURE_RESULT'}});
  const current=task('current-prerequisite',{status:'done',requiresVerification:true,verifiedAt:now,owner:'dev'});
  const unavailable=task('archived-parent',{status:'blocked',dependencies:[link(archived.id)]});
  const missing=task('missing-parent',{status:'blocked',dependencies:[link('missing-prerequisite')]});
  const ready=task('ready-parent',{status:'blocked',dependencies:[link(current.id),link(archived.id,'related')]});
  const related=task('related-parent',{dependencies:[link(archived.id,'related'),link('missing-prerequisite','related')]});
  const historical=task('historical-parent',{status:'done',dependencies:[link(archived.id)]});
  const notReady=task('not-ready-next-up',{dependencies:[link(archived.id)],nextUpAt:now});
  const tasks=[archived,current,unavailable,missing,ready,related,historical,notReady];
  return {archived,unavailable,missing,ready,related,historical,notReady,tasks,
    state:{tasks,event:{name:'Fictional event',date:'2026-10-03',timeZone:'UTC'},members:[{id:'maya',name:'Maya',active:true}]}};
}

test('priorities, Link map and Before the event agree that unavailable Required work is not ready',()=>{
  const {unavailable,missing,ready,related,historical,notReady,archived,tasks,state}=projections();
  const before=structuredClone(state),P=GatherPriorities,graph=GatherPlanningUI;
  for(const [parent,id] of [[unavailable,archived.id],[missing,'missing-prerequisite']]){
    assert.deepEqual(P.unresolved(parent,tasks).map(item=>item.taskId),[id]);
    assert.ok(!P.analyze(parent,tasks,new Date(now),'UTC').factors.some(factor=>factor.key==='ready'));
    assert.match(P.decision(parent,tasks,new Date(now),'UTC').label,/Review unavailable required work/);
    assert.ok(P.rank(tasks,new Date(now),false,'UTC').some(task=>task.id===parent.id));
    const readiness=graph.readiness(parent,tasks);
    assert.equal(readiness.tone,'waiting');assert.match(readiness.label,/unavailable/i);
    assert.match(graph.graphMarkup(tasks,[parent],parent.id),new RegExp(`data-id="${parent.id}"[^>]*aria-label="[^"]*unavailable`,'i'));
  }
  assert.equal(P.actionable(notReady,tasks),false);
  assert.ok(!P.nextUp(tasks,'maya',new Date(now),'UTC').some(task=>task.id===notReady.id));
  assert.equal(P.actionable(related,tasks),true);
  assert.equal(graph.readiness(related,tasks).label,'No prerequisite blockers');
  assert.equal(graph.readiness(ready,tasks).label,'Ready to resume');
  assert.equal(graph.readiness(historical,tasks).label,'Complete');
  assert.equal(graph.readiness(archived,tasks).label,'Complete','do not rewrite verified historical completion');
  const archivedCard=graph.graphMarkup(tasks,[archived],archived.id).match(new RegExp(`<button[^>]*data-id="${archived.id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
  assert.match(archivedCard,/Complete/);assert.doesNotMatch(archivedCard,/Unblocks/);
  const groups=Object.fromEntries(GatherScheduleUI.reviewItems(state,now,{mine:true,actor:'maya'}).map(group=>[group.key,group.tasks.map(task=>task.id)]));
  assert.deepEqual(groups.prerequisites,[unavailable.id,missing.id,notReady.id]);
  assert.deepEqual(groups['linked-results'],[ready.id]);
  assert.deepEqual(state,before);
});

test('task relationships call unavailable Required work out without showing a ready-to-resume action',()=>{
  const {unavailable,missing,ready,state}=projections(),source=readFileSync('legacy/app.js','utf8');
  const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const context=vm.createContext({store:{getState:()=>state},ui:{actor:'maya'},window:{},h,GatherPlanningUI,GatherPriorities,GatherScheduleUI,
    isOrganizer:()=>false,icon:()=>'',member:id=>({name:id}),statuses:{todo:'To do',blocked:'Blocked',done:'Done'},options:()=>'',
    completionLinkedImpact:()=>({markup:'',shownIds:new Set()}),linkedTaskForm:()=>'',completionText:()=>'',
  });
  vm.runInContext(part('  function dependencyInfo(', '  function linkedTaskForm(')+part('  function dependencyMarkup(', '  function handoffMarkup('),context);
  for(const parent of [unavailable,missing]){
    const info=context.dependencyInfo(parent,state);
    assert.equal(info.open.length,1);assert.equal(info.ready,false);
    const markup=context.dependencyMarkup(parent);
    assert.match(markup,/Required work[^<]*unavailable|Unavailable required work/i);
    assert.match(markup,/Remove unavailable link/);
    assert.doesNotMatch(markup,/data-action="resume-task"|status-done">Complete|ARCHIVED_FIXTURE_RESULT/);
  }
  assert.match(context.dependencyMarkup(ready),/data-action="resume-task"/);
  const legacy=task('legacy-done',{status:'done',requiresVerification:true,owner:'dev'});
  const waiting=task('waiting-parent',{status:'blocked',dependencies:[link(legacy.id)]});
  state.tasks.push(legacy,waiting);
  const markup=context.dependencyMarkup(waiting);
  assert.match(markup,/status-blocked">Awaiting verification<\/span>/);
  assert.doesNotMatch(markup,/>Done<\/span>|data-action="resume-task"/);
});
