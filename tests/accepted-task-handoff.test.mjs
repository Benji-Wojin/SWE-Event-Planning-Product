import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/schedule-ui.js';

const app=readFileSync('legacy/app.js','utf8');
const part=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)));
const helpers=part('  function focusAfterAcceptance(', '  function teammateHandoff(');
const readiness=part('  function assignmentReadiness(', '  function acceptanceDialog(');
const nextUpEligibility=part('  function resumedNextUpAvailable(', '  function resumeTaskReceipt(');
const restoreView=part('  function restoreViewFocus(', '  function saveLock(');
const submitBranch=part("      if(form.id==='acceptTasksForm'){\n        if(window.GatherAccessLost", "      if(form.id==='newTaskForm')");
const h=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function fixture({ready=false,commitments=0}={}){
  const store=GatherStore.createStore({storage:null});
  const row=store.addTask({title:'Prepare <fictional> & team',owner:'maya',status:ready?'todo':'blocked',note:'Private fixture note',dueDate:'2030-11-18'});
  const other=store.addTask({title:row.title,owner:'maya'});
  const link=store.addTask({title:'Other fixture work',owner:'dev'});
  if(!ready)store.addDependency(row.id,{taskId:link.id,reason:'Required fixture work'});
  for(let index=0;index<commitments;index++){
    const commitment=store.addTask({title:'Fictional commitment '+index,owner:'maya'});
    store.setNextUp(commitment.id,{enabled:true},'maya');
  }
  const read=()=>store.getState(),before=read().tasks.find(task=>task.id===row.id);
  const state={current:read(),review:{id:'acceptTasksForm',dataset:{actor:'maya'},isConnected:true},stale:false,showDialog:false,hiddenByDisclosure:false,revision:12};
  const selection={id:row.id,revision:before.revision};
  const ui={view:'tasks',tab:'mine',actor:'maya',dialogKind:'acceptance'};
  const window={GatherMode:{projectId:'fictional-project'},GatherIdentity:{role:'member'},GatherAccessLost:false};
  const body={},document={body,activeElement:body,hidden:false},microtasks=[],frames=[],events=[];
  const open={isConnected:true,dataset:{action:'open-accepted-handoff',id:row.id},closest:()=>null};
  const next={id:'acceptanceHandoffNextUp',isConnected:true,dataset:{action:'open-accepted-next-up',id:row.id},closest:()=>null};
  const dismiss={isConnected:true,dataset:{action:'dismiss-accepted-handoff'},closest:()=>null};
  const dialog={},title={},nextForm={dataset:{id:row.id}};
  const makeControl=()=>({matches:()=>false,closest:()=>null});
  const nextState=makeControl(),swap=makeControl();
  const elements={'#viewRoot':{},'#acceptanceHandoffHeading':{},'#acceptanceHandoffOpen':open,'#acceptanceHandoffDismiss':dismiss,
    '#acceptanceHandoffNextUp':next,'#dialog':dialog,'#dialogTitle':title,'#nextUpForm':nextForm,'#nextUpTaskState':nextState,
    'select[name="replaceTaskId"]':commitments>=3?swap:null,
    '#acceptanceHandoff':{remove:()=>events.push('remove')},'#dialogBackdrop':{get hidden(){return !state.showDialog;}}};
  const ctx=vm.createContext({ui,window,document,h,GatherPriorities,GatherScheduleUI,
    $:(selector,root)=>{
      if(selector==='#acceptTasksForm')return state.review;
      if(['#dialogTitle','#nextUpForm'].includes(selector))assert.equal(root,dialog);
      if(['#nextUpTaskState','select[name="replaceTaskId"]'].includes(selector))assert.equal(root,nextForm);
      return elements[selector];
    },
    store:{getState:()=>state.current,getSnapshotRevision:()=>state.revision,setNextUp(){assert.fail('Opening the shortcut must not commit work');}},
    hiddenByClosedDisclosure:()=>state.hiddenByDisclosure,workspaceUpdatesPending:()=>state.stale,scheduleRevisionIsStale:()=>false,
    queueMicrotask:fn=>microtasks.push(fn),focusScheduleTarget:el=>{assert.equal(el,elements['#acceptanceHandoffHeading']);events.push('focus receipt');return true;},
    requestAnimationFrame:fn=>frames.push(fn),
    focusTaskDialogControl(el,root){assert.equal(root,dialog);events.push(el===swap?'focus swap':'focus Next up status');document.activeElement=el;},
    skipToContent:()=>events.push('focus page'),toast:message=>events.push(['toast',message]),
    taskDialog(...args){events.push(['task',...args]);ui.dialogKind='task';ui.detailId=args[0];if(args[3])frames.push(()=>{document.activeElement=title;state.showDialog=true;});},
    closeDialog(){events.push('close');ui.dialogKind='';},render(){events.push('render');if(state.restoreFocus)document.activeElement=state.restoreFocus;},beforeEventReview(){events.push('event');},
  });
  vm.runInContext(helpers+readiness+nextUpEligibility,ctx);
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
  return {row,other,before,read,selection,ui,window,document,state,events,open,next,dismiss,microtasks,frames,elements,nextForm,swap,nextState,capture,accept,remember,markup,act,submit,run};
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

test('accepted task shortcut opens the exact Next up controls for an open slot or a full list, without committing',()=>{
  for(const [commitments,label,focus] of [
    [0,'Go to Next up controls','focus Next up status'],[3,'Review Next up swap','focus swap'],
  ]){
    const f=fixture({ready:true,commitments}),receipt=f.capture();
    assert.equal(f.remember(receipt,f.accept()),true);
    const before=f.read();
    assert.match(f.markup(),new RegExp(`data-action="open-accepted-next-up" data-id="${f.row.id}">${label}<`));
    assert.equal(f.act({...f.next},f.row.id),false,'an unrelated identical button is not the current receipt control');
    assert.equal(f.act(f.next,f.other.id),false,'a duplicate title does not authorize a different task');
    assert.deepEqual(f.events,[]);
    assert.equal(f.act(f.next,f.row.id),true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.events)),[['task',f.row.id,'',false,true,'',null,'',{readOnly:true}]]);
    assert.equal(f.ui.lastFocus,f.next);
    f.frames.forEach(fn=>fn());
    assert.equal(f.events.at(-1),focus);
    assert.deepEqual(f.read(),before,'only an explicit form submission may add or swap commitments');
  }
});

test('acceptance is not treated as Next up eligibility when work is blocked, unavailable, revised, or already committed',()=>{
  for(const [label,change] of [
    ['blocked',(task)=>{task.status='blocked';}],
    ['returned',(task)=>{task.completionReview={note:'Changes requested'};}],
    ['help requested',(task)=>{task.recoveryRequests=[{kind:'help',status:'pending'}];}],
    ['committed',(task)=>{task.nextUpAt='2026-11-13T15:00:00Z';}],
    ['missing requirement',(task)=>{task.dependencies=[{taskId:'missing',kind:'dependency'}];}],
    ['archived Done requirement',(task,state)=>{
      task.dependencies=[{taskId:'archived',kind:'dependency'}];
      state.tasks.push({id:'archived',status:'done',requiresVerification:true,verifiedAt:'2026-11-13',archivedAt:'2026-11-13'});
    }],
    ['new schedule needs acceptance',(task)=>{task.acceptedAt='';task.scheduleReconfirmation={owner:'maya'};}],
  ]){
    const f=fixture({ready:true}),receipt=f.capture();
    assert.equal(f.remember(receipt,f.accept()),true);
    change(f.state.current.tasks.find(task=>task.id===f.row.id),f.state.current);
    assert.doesNotMatch(f.markup(),/acceptanceHandoffNextUp/,label);
    assert.equal(f.act(f.next,f.row.id),false,label);
    assert.deepEqual(f.events,[],label);
  }
  const related=fixture({ready:true}),receipt=related.capture();assert.equal(related.remember(receipt,related.accept()),true);
  related.state.current.tasks.find(task=>task.id===related.row.id).dependencies=[{taskId:'missing',kind:'related'}];
  assert.match(related.markup(),/Go to Next up controls/);
});

test('queued Next up focus fails closed on replacement, staleness, or moved focus',()=>{
  for(const [label,change] of [
    ['revision',f=>{f.state.revision++;}],['stale',f=>{f.state.stale=true;}],
    ['title',f=>{f.elements['#dialogTitle']={};}],['focus',f=>{f.document.activeElement={};}],
    ['scope',f=>{f.ui.tab='all';}],['actor',f=>{f.ui.actor='dev';}],['project',f=>{f.window.GatherMode.projectId='other';}],
    ['receipt',f=>{f.ui.acceptanceHandoff={...f.ui.acceptanceHandoff};}],
    ['disabled',f=>{f.nextState.matches=()=>true;}],['hidden',f=>{f.nextState.closest=()=>({});}],
    ['form task',f=>{f.nextForm.dataset.id=f.other.id;}],
    ['eligibility',f=>{f.state.current.tasks.find(task=>task.id===f.row.id).status='blocked';}],
    ['hidden document',f=>{f.document.hidden=true;}],['save in flight',f=>{f.ui.pendingSave=true;}],
    ['access lost',f=>{f.window.GatherAccessLost=true;}],
  ]){
    const f=fixture({ready:true}),receipt=f.capture();assert.equal(f.remember(receipt,f.accept()),true);
    assert.equal(f.act(f.next,f.row.id),true);assert.equal(f.frames.length,2);
    f.frames[0]();change(f);f.frames[1]();
    assert.deepEqual(f.events.map(event=>event[0]),['task'],label);
  }
});

test('returning from the accepted task restores the exact Next up shortcut or its receipt task button',()=>{
  const f=fixture({ready:true}),receipt=f.capture();assert.equal(f.remember(receipt,f.accept()),true);
  assert.equal(f.act(f.next,f.row.id),true);
  f.next.isConnected=false;f.document.activeElement=f.document.body;
  const calls=[];
  let shortcutExists=true;
  f.run(restoreView,{
    isScheduleControl:()=>false,
    restoreFocus(previous,root){assert.equal(previous,f.next);assert.equal(root,f.elements['#viewRoot']);calls.push('shortcut');return shortcutExists;},
    focusScheduleTarget(target){assert.equal(target,f.open);calls.push('accepted task button');return true;},
  });
  const restore=()=>f.run('restoreViewFocus(origin, root)',{origin:f.ui.lastFocus,root:f.elements['#viewRoot']});
  assert.equal(restore(),true);assert.deepEqual(calls.splice(0),['shortcut']);
  shortcutExists=false;
  f.state.current.tasks.find(task=>task.id===f.row.id).nextUpAt='2026-11-13T15:00:00Z';
  assert.doesNotMatch(f.markup(),/acceptanceHandoffNextUp/);
  assert.equal(restore(),true);assert.deepEqual(calls.splice(0),['shortcut','accepted task button']);
  f.document.activeElement={};
  assert.equal(restore(),false);assert.deepEqual(calls,[]);
  f.document.activeElement=f.document.body;
  f.state.current.tasks.find(task=>task.id===f.row.id).owner='dev';
  assert.equal(restore(),false);assert.deepEqual(calls,['shortcut'],'never fall back to an unrelated task receipt');
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
