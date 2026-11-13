import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';

const app=readFileSync('legacy/app.js','utf8');
const part=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const helpers=part('  function focusAfterAcceptance(', '  function teammateHandoff(');
const readiness=part('  function assignmentReadiness(', '  function acceptanceDialog(');
const submitBranch=part("      if(form.id==='acceptTasksForm'){\n        if(window.GatherAccessLost", "      if(form.id==='newTaskForm')");
const h=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function fixture(){
  const store=GatherStore.createStore({storage:null});
  const row=store.addTask({title:'Prepare <fictional> & team',owner:'maya',status:'blocked',note:'Private fixture note',dueDate:'2030-11-18'});
  const other=store.addTask({title:row.title,owner:'maya'});
  const link=store.addTask({title:'Other fixture work',owner:'dev'});
  store.addDependency(row.id,{taskId:link.id,reason:'Required fixture work'});
  const read=()=>store.getState(),before=read().tasks.find(task=>task.id===row.id);
  const state={current:read(),review:{id:'acceptTasksForm',dataset:{actor:'maya'},isConnected:true},stale:false,showDialog:false,hiddenByDisclosure:false};
  const selection={id:row.id,revision:before.revision};
  const ui={view:'tasks',tab:'mine',actor:'maya',dialogKind:'acceptance'};
  const window={GatherMode:{projectId:'fictional-project'},GatherIdentity:{role:'member'},GatherAccessLost:false};
  const body={},document={body,activeElement:body,hidden:false},microtasks=[],events=[];
  const open={isConnected:true,dataset:{action:'open-accepted-handoff',id:row.id},closest:()=>null};
  const dismiss={isConnected:true,dataset:{action:'dismiss-accepted-handoff'},closest:()=>null};
  const elements={'#viewRoot':{},'#acceptanceHandoffHeading':{},'#acceptanceHandoffOpen':open,'#acceptanceHandoffDismiss':dismiss,
    '#acceptanceHandoff':{remove:()=>events.push('remove')},'#dialogBackdrop':{get hidden(){return !state.showDialog;}}};
  const ctx=vm.createContext({ui,window,document,h,GatherPriorities,
    $:selector=>selector==='#acceptTasksForm'?state.review:elements[selector],
    store:{getState:()=>state.current,getSnapshotRevision:()=>12},
    hiddenByClosedDisclosure:()=>state.hiddenByDisclosure,workspaceUpdatesPending:()=>state.stale,scheduleRevisionIsStale:()=>false,
    queueMicrotask:fn=>microtasks.push(fn),focusScheduleTarget:el=>{assert.equal(el,elements['#acceptanceHandoffHeading']);events.push('focus receipt');return true;},
    skipToContent:()=>events.push('focus page'),toast:message=>events.push(['toast',message]),
    taskDialog(...args){events.push(['task',...args]);ui.dialogKind='task';ui.detailId=args[0];},
    closeDialog(){events.push('close');ui.dialogKind='';},render(){events.push('render');if(state.restoreFocus)document.activeElement=state.restoreFocus;},beforeEventReview(){events.push('event');},
  });
  vm.runInContext(helpers+readiness,ctx);
  const run=(source,values={})=>vm.runInContext(source,Object.assign(ctx,values));
  const capture=()=>run('captureAcceptanceHandoff([selection],state.review)',{selection,state});
  const accept=(selections=[selection])=>{const result=store.acceptTasks(selections,'maya');state.current=read();return result;};
  const remember=(receipt,result)=>run('rememberAcceptanceHandoff(receipt,result)',{receipt,result});
  const markup=()=>run('acceptanceHandoffMarkup(state.current)',{state});
  const act=(opener,id)=>run('actOnAcceptanceHandoff(opener,id)',{opener,id});
  const submit=(selections,save)=>{
    ctx.store.acceptTasks=(selected,actor)=>{assert.equal(actor,'maya');events.push('save');return save(selected);};
    return run(`(async()=>{${submitBranch.replace('store.acceptTasks(', 'await store.acceptTasks(')}})()`,{form:state.review,data:{selections}});
  };
  return {row,other,before,read,selection,ui,window,document,state,events,open,dismiss,microtasks,capture,accept,remember,markup,act,submit,run};
}

test('a single confirmed My tasks acceptance renders the exact persisted assignment and its current readiness',()=>{
  const f=fixture(),receipt=f.capture();
  assert.equal(receipt.id,f.row.id);
  const result=f.accept();
  assert.equal(f.remember(receipt,result),true);
  assert.match(f.markup(),/Responsibility accepted/);
  assert.match(f.markup(),/Prepare &lt;fictional&gt; &amp; team/);
  assert.match(f.markup(),new RegExp(`data-action="open-accepted-handoff" data-id="${f.row.id}"`));
  assert.doesNotMatch(f.markup(),new RegExp(f.other.id+'|Private fixture note|Other fixture work'));
  assert.match(f.markup(),/Waiting on 1 required task before completion/);
  const after=f.read().tasks.find(task=>task.id===f.row.id);
  for(const key of ['status','dueDate','note','dependencies','nextUpAt','reportedAt'])assert.deepEqual(after[key],f.before[key],key);
  assert.equal(f.capture(),null,'an already accepted task cannot seed a new receipt');
});

test('receipt rejects older, foreign, unconfirmed and replaced acceptance data',()=>{
  for(const change of [
    (_f,result)=>{result[0].id='different-task';},(_f,result)=>{result[0].revision--;},
    (_f,result)=>{result[0].owner='dev';},(_f,result)=>{result[0].acceptedBy='dev';},
    (_f,result)=>{result[0].acceptedAt='';},(f,result)=>{result.push({id:f.other.id});},
    (f)=>{f.state.current.tasks.find(task=>task.id===f.row.id).acceptedAt='different-acceptance';},
    (f)=>{f.state.current.tasks.find(task=>task.id===f.row.id).revision++;},
    (f)=>{f.state.current.tasks.find(task=>task.id===f.row.id).archivedAt='archived';},
    (f)=>{f.state.current.tasks.find(task=>task.id===f.row.id).reportedAt='reported';},
    (f)=>{f.ui.actor='dev';},(f)=>{f.ui.tab='all';},(f)=>{f.ui.view='timeline';},
    (f)=>{f.window.GatherMode.projectId='different';},(f)=>{f.window.GatherAccessLost=true;},
  ]){
    const f=fixture(),receipt=f.capture(),result=f.accept();change(f,result);
    assert.equal(f.remember(receipt,result),false);assert.equal(f.markup(),'');
  }
  for(const change of [f=>{f.state.review.dataset.returnTo='event-review';},f=>{f.window.GatherIdentity.role='admin';},
    f=>{f.window.GatherMode.demo=true;},f=>{f.selection.revision--;},f=>{f.selection.id='old';}]){
    const f=fixture();change(f);assert.equal(f.capture(),null);
  }
});

test('receipt opens only its exact live control read-only and focuses safely',()=>{
  const f=fixture(),receipt=f.capture();assert.equal(f.remember(receipt,f.accept()),true);
  for(const change of [
    [f.ui,'pendingSave',true],[f.document,'hidden',true],[f.state,'showDialog',true],[f.state,'hiddenByDisclosure',true],
    [f.open,'isConnected',false],[f.open,'closest',()=>({})],[f.open.dataset,'action','other'],[f.open.dataset,'id',f.other.id],
  ]){
    const [object,key,value]=change,prior=object[key];object[key]=value;
    assert.equal(f.act(f.open,f.row.id),false);object[key]=prior;
  }
  assert.equal(f.act({...f.open},f.row.id),false);
  assert.equal(f.act(f.open,f.other.id),false);
  f.state.stale=true;assert.equal(f.act(f.open,f.row.id),false);assert.match(f.events.pop()[1],/Refresh the project/);
  assert.deepEqual(f.events,[]);
  f.state.stale=false;assert.equal(f.act(f.open,f.row.id),true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.events)),[['task',f.row.id,'',false,true,'',null,'',{readOnly:true}]]);
  assert.equal(f.ui.lastFocus,f.open);
  f.document.activeElement={};f.run('focusAfterAcceptance()');f.microtasks.shift()();assert.equal(f.events.length,1);
  f.document.activeElement=f.document.body;f.run('focusAfterAcceptance()');f.microtasks.shift()();assert.equal(f.events.at(-1),'focus receipt');
  assert.equal(f.act(f.dismiss),true);assert.deepEqual(f.events.slice(-2),['remove','focus page']);assert.equal(f.markup(),'');
});

test('hosted-style submission waits for its one shared save before showing a receipt; other scopes keep their prior return',async()=>{
  for(const scenario of ['single','opener remains','focus moved','multi','event','superseded','failed']){
    const f=fixture();
    if(scenario==='event')f.state.review.dataset.returnTo='event-review';
    if(scenario==='opener remains'||scenario==='focus moved')f.state.restoreFocus={id:'Review task acceptance'};
    const selections=scenario==='multi'?[f.selection,{id:f.other.id,revision:f.other.revision}]:[f.selection];
    let finish,fail;
    const submitted=f.submit(selections,input=>new Promise((resolve,reject)=>{
      finish=()=>resolve(f.accept(input));fail=reject;
    }));
    assert.deepEqual(f.events,['save']);assert.equal(f.markup(),'');
    if(scenario==='failed'){
      fail(new Error('fictional rejection'));await assert.rejects(submitted,/fictional rejection/);
      assert.deepEqual(f.events,['save']);assert.equal(f.markup(),'');continue;
    }
    if(scenario==='superseded')f.state.review={id:'acceptTasksForm',dataset:{actor:'maya'},isConnected:true};
    finish();await submitted;
    const receipt=['single','opener remains','focus moved'].includes(scenario);
    if(receipt)assert.match(f.markup(),/Responsibility accepted/);else assert.equal(f.markup(),'',scenario);
    if(scenario==='event')assert.deepEqual(f.events.slice(1,3),['render','event']);
    if(receipt||scenario==='multi'){
      assert.deepEqual(f.events.slice(1,3),['close','render']);
      if(scenario==='focus moved')f.document.activeElement={id:'Different control'};
      f.microtasks.shift()();
      const focusEvents=f.events.filter(event=>typeof event==='string'&&event.startsWith('focus '));
      assert.deepEqual(focusEvents,scenario==='focus moved'?[]:[receipt?'focus receipt':'focus page']);
    }
  }
});
