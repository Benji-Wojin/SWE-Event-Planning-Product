import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';

const app=readFileSync('legacy/app.js','utf8');
const reason='Please confirm the greeter is at the accessible entrance.';
const reviewMethods={verify:'verifyTask',return:'returnCompletion',amendment:'reviewCompletionEvidence'};

function sourceBlock(from,to){
  const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'missing source block: '+from);
  return app.slice(start,end);
}

function fixture(kind,{hosted=true,blocked=false,related=false,impact=false}={}){
  const core=GatherStore.createStore({storage:null});
  const {id}=core.addTask({title:'Fictional welcome desk',owner:'maya',requiresVerification:true});
  core.reportCompletion(id,'The welcome desk is set up.','maya');
  if(kind==='amendment'){
    core.verifyTask(id,'jack');
    core.setCompletionEvidence(id,{note:'Added the new accessible entrance details.'},'maya');
  }
  if(blocked||related){
    const linked=core.addTask({title:'Fictional accessibility check',owner:'jack'});
    core.addDependency(id,{taskId:linked.id,kind:related?'related':'dependency',reason:'Coordinate the entrance plan.'});
  }
  const getTask=()=>core.getState().tasks.find(task=>task.id===id);
  if(impact){
    const dependent=core.addTask({title:'Fictional attendee support',owner:'maya',status:'blocked'});
    core.addDependency(dependent.id,{taskId:id,kind:'dependency',reason:'Wait for the organizer’s welcome desk verification.'});
  }
  const ui={actor:'jack',view:'tasks',dialogKind:'task',detailId:id};
  const window=hosted?{GatherMode:{projectId:'fictional-project'}}:{GatherMode:{demo:true}};
  const dialog={isConnected:true,dataset:{}},backdrop={hidden:false};
  let title={},revision=hosted?11:undefined,stale=false,known=0,organizer=true,controls={};
  let noteValue=reason,dirtyForm='';
  const writes=[],calls=[],frames=[];
  const impactHeading={};
  const refresh={focus:()=>calls.push(['focus'])};
  const formSubmit={setAttribute(){},removeAttribute(){}};
  function makeControl(type){
    const attr=new Map();
    return {id:type==='return'?'returnCompletionForm':'',isConnected:true,disabled:false,
      dataset:{id,revision:String(getTask().revision),
        ...(type==='return'?{}:{action:type==='verify'?'verify-task':'review-completion-evidence'}),
        ...(hosted?{workspaceRevision:'11'}:{})},
      elements:{note:{get value(){return noteValue;}}},
      closest:()=>dialog,querySelector:()=>formSubmit,
      matches:selector=>selector.includes(type==='return'?'returnCompletionForm':type==='verify'?'verify-task':'review-completion-evidence'),
      getAttribute:key=>attr.get(key),setAttribute:(key,value)=>attr.set(key,value),removeAttribute:key=>attr.delete(key),
    };
  }
  const remount=()=>{
    controls=kind==='amendment'?{amendment:makeControl('amendment')}:
      {verify:makeControl('verify'),return:makeControl('return')};
    title={};
  };
  remount();
  function select(selector){
    if(selector==='#dialog')return dialog;
    if(selector==='#dialogTitle')return title;
    if(selector==='#dialogBackdrop')return backdrop;
    if(selector==='#completionLinkedImpactHeading')return impact&&getTask().status==='done'&&getTask().verifiedAt?impactHeading:null;
    if(selector==='#activityReviewRefresh')return refresh;
    if(['#completionEvidenceForm','#responseForm','#returnCompletionForm'].includes(selector)&&selector===dirtyForm)return {dirty:true};
    if(selector.includes('returnCompletionForm')&&selector.includes('button'))return formSubmit;
    return Object.values(controls).find(control=>control.isConnected&&control.matches(selector))||null;
  }
  const document={hidden:false,activeElement:null};
  const store={getState:()=>core.getState(),getSnapshotRevision:()=>revision};
  for(const method of Object.values(reviewMethods)){
    store[method]=(...args)=>new Promise((resolve,reject)=>writes.push({method,args,reject,finish(replaceResult=value=>value){
      try{
        const result=core[method](...args);
        if(revision!==undefined)revision++;
        resolve(replaceResult(result));
      }catch(error){reject(error);}
    }}));
  }
  const context=vm.createContext({
    ui,window,document,store,isOrganizer:()=>organizer,
    hasUnsavedFields:form=>!!form?.dirty,
    $:select,$$:selector=>Object.values(controls).filter(control=>control.isConnected&&control.matches(selector)),
    workspaceUpdatesPending:()=>stale,
    scheduleRevisionIsStale:value=>Number.isSafeInteger(value)&&value<known,
    recoveryConflictPending:value=>Number.isSafeInteger(value)&&value<known,
    showPendingUpdate(){stale=true;calls.push(['warning']);},
    showRecoveryWriteConflict(value){known=value+1;stale=true;calls.push(['conflict',value]);},
    requestAnimationFrame:fn=>frames.push(fn),
    focusTaskDialogControl(target){if(target===impactHeading)calls.push(['focus linked impact']);else{assert.equal(target,title);calls.push(['focus heading']);}},
    saveLock(root){
      assert.equal(root,dialog);
      assert.equal(ui.pendingSave,undefined);
      ui.pendingSave=true;
      return ()=>{delete ui.pendingSave;calls.push(['unlock']);};
    },
    render:()=>calls.push(['render']),
    taskDialog(...args){calls.push(['dialog',...args]);title={};document.activeElement=title;},
    toast:message=>calls.push(['toast',message]),
    formError:(_form,error)=>calls.push(['formError',error.message]),
  });
  window.GatherCompletionUI={celebrate:task=>calls.push(['celebrate',task?.id])};
  dialog.contains=control=>Object.values(controls).includes(control);
  dialog.querySelector=select;
  dialog.querySelectorAll=context.$$;
  vm.runInContext(
    sourceBlock('  function dependencyInfo(','  function linkedTaskForm(')+
    sourceBlock('  function acceptanceReviewPending(','  function paintAcceptanceRefresh(')+
    sourceBlock('  function completionReviewControls(','  function canRefreshActivityReview('),context,
  );
  return {id,ui,window,document,backdrop,core,calls,writes,getTask,
    get control(){return controls[kind];}, get controls(){return controls;},
    set revision(value){revision=value;},set stale(value){stale=value;},set known(value){known=value;},
    set organizer(value){organizer=value;},set note(value){noteValue=value;},get note(){return noteValue;},
    set dirtyForm(value){dirtyForm=value;},
    save(opener=controls[kind],note=noteValue){return context.saveReviewedCompletion(opener,note);},
    replaceControls(){remount();},
    flush(){for(const frame of frames.splice(0))frame();},
  };
}

test('decisions do not remove a sibling form with unsent text or evidence',async()=>{
  for(const [kind,form] of [['verify','#returnCompletionForm'],['verify','#responseForm'],['return','#completionEvidenceForm']]){
    const f=fixture(kind);
    f.dirtyForm=form;
    await f.save();
    assert.equal(f.writes.length,0);
    assert.match(f.calls.find(([event])=>event==='toast'||event==='formError')[1],/copy or clear|save or clear/i);
  }
});

test('only a current acknowledged verification moves focus from the dialog title to the linked impact',async()=>{
  for(const outcome of ['exact','mismatched receipt','new task revision','new workspace','known newer workspace','hidden','moved focus','replaced dialog']){
    const f=fixture('verify',{impact:true}),pending=f.save();
    assert.equal(f.writes.length,1,outcome);
    assert.deepEqual(f.calls,[],outcome);
    f.writes[0].finish(value=>outcome==='mismatched receipt'?{...value,id:'different-task'}:value);
    await pending;
    if(outcome==='new task revision')f.core.updateTask(f.id,{title:'Fictional revised welcome desk'},'jack');
    if(outcome==='new workspace')f.stale=true;
    if(outcome==='known newer workspace')f.known=13;
    if(outcome==='hidden')f.document.hidden=true;
    if(outcome==='moved focus')f.document.activeElement={};
    if(outcome==='replaced dialog')f.replaceControls();
    f.flush();
    assert.equal(f.calls.filter(([event])=>event==='focus linked impact').length,outcome==='exact'?1:0,outcome);
    assert.equal(f.writes.length,1,'linked impact does not trigger a downstream write');
    assert.equal(f.core.getState().tasks.find(task=>task.title==='Fictional attendee support').status,'blocked');
  }
  const f=fixture('amendment',{impact:true}),pending=f.save();
  f.writes[0].finish();await pending;f.flush();
  assert.ok(f.calls.some(([event])=>event==='focus heading'));
  assert.ok(!f.calls.some(([event])=>event==='focus linked impact'),'acknowledging an amendment is not a new verification');
});

const rendered=f=>f.calls.filter(([kind])=>['render','dialog','celebrate'].includes(kind));

test('the three current organizer decisions make only their existing write and redraw after it succeeds',async()=>{
  for(const kind of Object.keys(reviewMethods)){
    const f=fixture(kind),original=f.getTask(),before=f.core.exportState();
    const pending=f.save();
    assert.equal(f.writes.length,1,kind);
    const [write]=f.writes;
    assert.equal(write.method,reviewMethods[kind],kind);
    assert.deepEqual(write.args,kind==='verify'?[f.id,'jack',original.revision]:
      kind==='return'?[f.id,reason,'jack',original.revision]:[f.id,original.revision,'jack']);
    assert.equal(f.core.exportState(),before,'no state changes while awaiting the write');
    assert.deepEqual(rendered(f),[]);
    await f.save();
    assert.equal(f.writes.length,1,'duplicate clicks do not duplicate the write');
    write.finish();
    await pending;
    f.flush();
    assert.equal(f.ui.pendingSave,undefined);
    assert.equal(f.calls.filter(([event])=>event==='render').length,1);
    const dialogs=f.calls.filter(([event])=>event==='dialog');
    assert.equal(dialogs.length,1);
    assert.equal(dialogs[0][1],f.id);
    assert.equal(dialogs[0][2],kind==='return'?'returnCompletionForm':'');
    assert.equal(dialogs[0][3],false,'other task drafts survive the same-task redraw');
    assert.equal(dialogs[0].at(-1).readOnly,true,'redraw must not perform a resource lookup');
    assert.deepEqual(f.calls.filter(([event])=>event==='focus heading'),[['focus heading']]);
    const saved=f.getTask();
    if(kind==='verify'){
      assert.equal(saved.status,'done');
      assert.ok(saved.verifiedAt);
      assert.deepEqual(f.calls.filter(([event])=>event==='celebrate'),[['celebrate',f.id]]);
    }else if(kind==='return'){
      assert.notEqual(saved.status,'done');
      assert.equal(saved.reportedAt,'');
      assert.equal(saved.completionReview.note,reason);
      assert.deepEqual(saved.completionEvidenceHistory[0],original.completionEvidence);
    }else{
      assert.equal(saved.completionEvidenceReviewAt,original.verifiedAt);
      assert.equal(saved.verifiedAt,original.verifiedAt,'acknowledging an amendment does not reverify the task');
      assert.deepEqual(saved.completionResult,original.completionResult);
    }
  }
});

test('changed task, workspace, identity, role, or current control cannot write any decision',async()=>{
  for(const kind of Object.keys(reviewMethods)){
    for(const reason of ['detached','replacement','wrong task','closed','not organizer','lost access','workspace',
      'invalid task revision','missing hosted revision','sticky','pending sync','newer floor','new evidence','already decided']){
      const f=fixture(kind),old=f.control,task=f.getTask();
      switch(reason){
        case 'detached': old.isConnected=false; break;
        case 'replacement': f.replaceControls(); break;
        case 'wrong task': f.ui.detailId='different-task'; break;
        case 'closed': f.backdrop.hidden=true; break;
        case 'not organizer': f.organizer=false; break;
        case 'lost access': f.window.GatherAccessLost=true; break;
        case 'workspace': f.revision=12; break;
        case 'invalid task revision': old.dataset.revision='not-a-revision'; break;
        case 'missing hosted revision': delete old.dataset.workspaceRevision; break;
        case 'sticky': old.dataset.reviewNeedsRefresh='true'; break;
        case 'pending sync': f.stale=true; break;
        case 'newer floor': f.known=12; break;
        case 'new evidence': f.core.setCompletionEvidence(f.id,{note:'New submission evidence.'},'maya'); break;
        case 'already decided':
          if(kind==='amendment')f.core.reviewCompletionEvidence(f.id,task.revision,'jack');
          else f.core.verifyTask(f.id,'jack');
          old.dataset.revision=String(f.getTask().revision);
          break;
      }
      const before=f.core.exportState();
      await f.save(old);
      assert.equal(f.writes.length,0,kind+': '+reason);
      assert.equal(f.core.exportState(),before);
      assert.deepEqual(rendered(f),[]);
    }
  }
});

test('only verification is blocked by unfinished Required work; Related work and local revision reviews still work',async()=>{
  const blocked=fixture('verify',{blocked:true});
  await blocked.save();
  assert.equal(blocked.writes.length,0);
  assert.ok(blocked.getTask().reportedAt);
  for(const [kind,options] of [['return',{blocked:true}],['verify',{related:true,hosted:false}]]){
    const f=fixture(kind,options),pending=f.save();
    assert.equal(f.writes.length,1,kind);
    f.writes[0].finish();
    await pending;
    assert.equal(f.getTask().status==='done',kind==='verify');
  }
});

test('replacing links under the same completion note changes the real task revision and invalidates both old decisions',()=>{
  for(const kind of ['verify','return']){
    const core=GatherStore.createStore({storage:null});
    const {id}=core.addTask({title:'Fictional accessibility check',owner:'maya',requiresVerification:true});
    const note='The accessible entrance is ready.';
    core.reportCompletion(id,{note,links:['https://example.com/entrance-first']},'maya');
    const original=core.getState().tasks.find(task=>task.id===id);
    core.reportCompletion(id,{note,links:['https://example.com/entrance-replacement']},'maya');
    const latest=core.getState().tasks.find(task=>task.id===id);
    assert.equal(latest.completionEvidence.note,note);
    assert.deepEqual(latest.completionEvidence.links,['https://example.com/entrance-replacement']);
    assert.ok(latest.revision>original.revision,'changed evidence requires a new review even with an identical note');
    const decision=revision=>kind==='verify'?core.verifyTask(id,'jack',revision):core.returnCompletion(id,reason,'jack',revision);
    const snapshot=core.exportState();
    assert.throws(()=>decision(original.revision),/changed|refresh|reopen/i);
    assert.equal(core.exportState(),snapshot,'a stale decision cannot change attribution, history, or the pending report');
    const decided=decision(latest.revision);
    assert.equal(decided.status==='done',kind==='verify');
    if(kind==='return')assert.deepEqual(decided.completionEvidenceHistory[0].links,['https://example.com/entrance-replacement']);
  }
});

test('a 409 retains the return draft, records the attempted workspace revision, and never retries an old control',async()=>{
  const f=fixture('return'),pending=f.save(),before=f.core.exportState();
  f.revision=12;
  f.writes[0].reject(Object.assign(new Error('Fictional conflict'),{status:409}));
  await pending;
  assert.deepEqual(f.calls.filter(([event])=>event==='conflict'),[['conflict',11]]);
  assert.equal(f.note,reason);
  assert.equal(f.core.exportState(),before);
  assert.deepEqual(rendered(f),[]);
  assert.equal(f.controls.return.dataset.reviewNeedsRefresh,'true');
  assert.equal(f.controls.verify.dataset.reviewNeedsRefresh,'true');
  assert.equal(f.controls.verify.getAttribute('aria-disabled'),'true');
  await f.save();
  assert.equal(f.writes.length,1);
});

test('a pending completion conflict never contaminates another project’s review',async()=>{
  const f=fixture('verify'),pending=f.save();
  f.window.GatherMode.projectId='different-project';
  f.writes[0].reject(Object.assign(new Error('Fictional conflict'),{status:409}));
  await pending;
  assert.deepEqual(f.calls,[['unlock']]);
  assert.equal(f.control.dataset.reviewNeedsRefresh,undefined);
});

test('failed writes or superseded reviews cannot redraw, celebrate, or announce success',async()=>{
  for(const condition of ['offline','closed','other task','other actor','other project','other view','lost access','replacement']){
    const f=fixture('verify'),pending=f.save();
    switch(condition){
      case 'closed': f.backdrop.hidden=true; break;
      case 'other task': f.ui.detailId='different-task'; break;
      case 'other actor': f.ui.actor='maya'; break;
      case 'other project': f.window.GatherMode.projectId='different-project'; break;
      case 'other view': f.ui.view='timeline'; break;
      case 'lost access': f.window.GatherAccessLost=true; break;
      case 'replacement': f.replaceControls(); break;
    }
    if(condition==='offline')f.writes[0].reject(new Error('Fictional offline failure'));
    else f.writes[0].finish();
    await pending;
    assert.deepEqual(rendered(f),[],condition);
    assert.equal(f.ui.pendingSave,undefined);
    assert.ok(f.calls.filter(([event])=>event==='toast').every(([,message])=>/offline|try again/i.test(message)));
  }
});
