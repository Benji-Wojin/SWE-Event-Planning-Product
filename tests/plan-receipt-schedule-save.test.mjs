import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

let source;
before(()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  source=readFileSync('public/gather-assets/app.js','utf8');
});
const actor='fictional-organizer', id='fictional-activity', zone='America/Los_Angeles', day='2026-12-05';
const input={start:day+'T14:00',end:day+'T14:45',location:'  North hall  ',taskId:'unrelated-fixture-task'};
const slot={start:input.start,end:input.end,location:input.location.trim()};
const scheduled={start:day+'T13:00',end:day+'T13:45',location:'Existing room'};
const h=value=>String(value??'');
const schedule=GatherScheduleUI.create({h,options:()=>'',statusBadge:h});
const serialized=value=>JSON.parse(JSON.stringify(value));

function fragment(from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,`Missing source block: ${from}`);
  return source.slice(start,end);
}

function fixture({view='tasks',intent='schedule',formId='scheduleForm',initialSlot=null,fromTimeline=false}={}){
  let organizer=true,revision=20,dirty=[],completionDrafts=[],backHidden=false,latestPending=false;
  const calls=[],writes=[],frames=[];
  const state={event:{timeZone:zone},members:[{id:actor,name:'Fictional organizer'}],
    tasks:[{id,owner:actor,title:'Fictional activity',revision:4,status:'todo',eventActivity:true,schedule:initialSlot},
      {id:'unrelated-fixture-task',title:'Another activity',revision:1,status:'todo',eventActivity:true,schedule:null}]};
  const ui={actor,view,dialogKind:'task',detailId:id,pendingSave:false,timelineMode:'schedule',scheduleDate:'2026-12-04',scheduleMine:false};
  if(fromTimeline)ui.lastFocus={dataset:{id},timelineControl:true};
  const window={GatherMode:{projectId:'fictional-project',demo:false},top:{location:{href:'unchanged'}}};
  const document={hidden:false,activeElement:null,body:{id:'body'},listeners:{},addEventListener(type,listener){this.listeners[type]=listener;}};
  const backdrop={hidden:false};
  const dialog={scrollTop:45,contains:node=>[title,back,form].includes(node)};
  let title={id:'dialogTitle',isConnected:true},back=makeBack(),form=makeForm(formId);
  function makeForm(fid='scheduleForm'){
    return {id:fid,isConnected:true,dataset:{id,revision:'4'},values:{...input},closest:()=>dialog,
      contains:node=>node===submitter,querySelector:()=>null,classList:{contains:()=>false}};
  }
  function makeBack(){return {id:'planReceiptBack',isConnected:true,dataset:{action:'return-to-plan-receipt'},
    closest:()=>backHidden?{}:null,matches:()=>false,getClientRects:()=>backHidden?[]:[{}],
    focus(options){calls.push(['focus-back',ui.pendingSave,options?.preventScroll]);document.activeElement=this;}};}
  const submitter={id:'save-schedule',value:'save',isConnected:true};
  document.activeElement=submitter;
  const store={getState:()=>structuredClone(state),getSnapshotRevision:()=>revision,refresh:()=>{},
    setTaskSchedule(...args){return new Promise((resolve,reject)=>writes.push({args,reject,
      finish({patch={},responsePatch={},taskRevision=5,workspaceAdvance=1,deltaSlot}={}){
        const [taskId,requested]=args;
        const index=state.tasks.findIndex(task=>task.id===taskId);
        const task={...state.tasks[index],revision:taskRevision,schedule:deltaSlot===undefined?
          requested&&{...requested,location:requested.location.trim()}:deltaSlot,...patch};
        state.tasks[index]=task;
        revision+=workspaceAdvance;
        resolve({...task,...responsePatch});
      },
    }));},
  };
  const context=vm.createContext({
    window,document,ui,store,schedule,h,GatherScheduleUI,URLSearchParams,
    FormData:class extends Map {constructor(current){super(Object.entries(current.values??{}));}},
    $:(selector,root)=>({'#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,'#scheduleForm':form,
      '#schedulePickerForm':form,'#planReceiptBack':back})[selector]??null,
    $$:()=>[],isOrganizer:()=>organizer,guidedWorkspace:true,hiddenByClosedDisclosure:()=>false,
    workspaceUpdatesPending:()=>latestPending,scheduleRevisionIsStale:()=>latestPending,
    scheduleWorkspaceKey:()=>JSON.stringify([window.GatherMode.projectId,ui.actor]),
    isScheduleControl:node=>!!node?.timelineControl,
    inOrganizerTimeline:()=>ui.view==='timeline'&&organizer&&ui.timelineMode!=='deadlines',
    timelineScheduleScope:()=>({date:ui.scheduleDate,mine:ui.scheduleMine,actor:ui.actor}),
    requestAnimationFrame:fn=>frames.push(fn),queueMicrotask:fn=>frames.push(fn),
    saveLock(){ui.pendingSave=true;calls.push(['lock']);const writer=form;writer.dataset.saving='true';let released=false;
      return ()=>{if(!released){calls.push(['release']);released=true;ui.pendingSave=false;delete writer.dataset.saving;}};},
    taskDrafts:exclude=>{calls.push(['read-drafts',exclude]);return dirty;},
    taskCompletionDraftContext:()=>completionDrafts,
    render(){calls.push(['render']);},
    taskDialog(...args){
      calls.push(['modal',...args]);
      form.isConnected=false;title.isConnected=false;back.isConnected=false;form=makeForm();
      title={id:'dialogTitle',isConnected:true};back=makeBack();document.activeElement=title;
      if(args[7]?.scheduleReceiptReturn)context.focusPlanReceiptAfterSchedule(args[7].scheduleReceiptReturn);
    },
    focusTaskDialogControl(target,root){assert.equal(root,dialog);target.focus({preventScroll:true});},
    focusScheduleTarget(target){target?.focus({preventScroll:true});return !!target;},
    confirmCloseDialog:()=>true,confirmDiscard:()=>true,closeDialog(){calls.push(['close']);backdrop.hidden=true;},
    toast:text=>calls.push(['toast',text]),formError:(_form,error)=>calls.push(['error',error.message]),
    showRecoveryWriteConflict:()=>calls.push(['conflict']),showPendingUpdate:()=>calls.push(['stale']),
  });
  vm.runInContext(fragment('  function setPlanReceiptReturn(', '  function jumpFromNextUpToTimeline(')+
    fragment('  function eventScheduleSlotKey(', '  function eventScheduleEditorNotice(')+
    fragment("  document.addEventListener('submit',async event=>{", "  document.addEventListener('change',async event=>{"),context);
  if(intent)context.setPlanReceiptReturn(id,intent);
  return {window,document,ui,backdrop,dialog,state,frames,calls,writes,submitter,
    get form(){return form;},get back(){return back;},get title(){return title;},get revision(){return revision;},
    set organizer(value){organizer=value;},set dirty(value){dirty=value;},set completionDrafts(value){completionDrafts=value;},
    set backHidden(value){backHidden=value;},set latestPending(value){latestPending=value;},
    replaceForm(){form.isConnected=false;form=makeForm();},replaceBack(){back.isConnected=false;back=makeBack();},
    submit(value='save',current=form){submitter.value=value;return document.listeners.submit({target:current,submitter,preventDefault(){}});},
    returnToReceipt(opener=back){return context.returnToPlanReceipt(opener);},
    flush(){for(const frame of frames.splice(0))frame();},
  };
}

const outcomes=f=>f.calls.filter(([type])=>['modal','render','toast','focus-back','error','close'].includes(type));
const messages=(f,type)=>f.calls.filter(call=>call[0]===type).map(call=>call[1]);

test('a receipt start-time save waits for the hosted commit and then focuses the exact Back action after unlock',async()=>{
  assert.match(source,/if\(fromPlanReceipt\)setPlanReceiptReturn\(initialTask,initialTaskReview\)/);
  assert.match(source,/if\(!scheduleReceiptReturn\)requestAnimationFrame\(\(\)=>\{restoreFocus\(previousFocus,/);
  assert.match(source,/if\(scheduleReceiptReturn\)focusPlanReceiptAfterSchedule\(scheduleReceiptReturn\)/);
  const f=fixture(),previous=f.form,oldBack=f.back;
  assert.equal(f.ui.planReceiptReturn.intent,'schedule');
  const pending=f.submit();
  assert.equal(f.ui.pendingSave,true);
  assert.equal(f.writes.length,1);
  assert.deepEqual(serialized(f.writes[0].args),[id,{...slot,location:input.location},actor]);
  assert.deepEqual(outcomes(f),[],'no read receipt, redraw, focus or success notice before acknowledgment');
  assert.equal(f.returnToReceipt(),false,'the old return control cannot interrupt the save');
  assert.equal(f.frames.length,0);
  await f.submit();
  assert.equal(f.writes.length,1,'second submit while locked cannot write again');

  f.writes[0].finish();
  await pending;
  assert.equal(f.ui.pendingSave,false);
  assert.equal(previous.isConnected,false);
  assert.notEqual(f.back,oldBack);
  assert.equal(f.document.activeElement,f.title,'wait for the post-redraw focus frame');
  assert.equal(f.frames.length,1);
  assert.equal(messages(f,'modal').length,1);
  const modal=f.calls.find(([type])=>type==='modal');
  assert.equal(modal[1],id);
  assert.equal(modal[2],'scheduleForm');
  assert.equal(modal[3],false,'the modal does not discard drafts');
  assert.equal(modal[4],true,'the new task title is the initial focus');
  assert.equal(modal.at(-1).scheduleReceiptReturn,f.ui.planReceiptReturn);
  assert.deepEqual(messages(f,'toast'),['Schedule saved.']);
  f.flush();
  assert.equal(f.document.activeElement,f.back);
  assert.equal(f.dialog.scrollTop,0);
  assert.deepEqual(f.calls.find(([type])=>type==='focus-back'),['focus-back',false,true]);
  assert.equal(f.returnToReceipt(oldBack),false,'old disconnected controls cannot navigate');
  assert.equal(f.returnToReceipt(),true);
  assert.equal(f.window.top.location.href,`/plan?project=fictional-project&guide=1&receiptTask=${id}`);
  assert.equal(f.writes.length,1);
});

test('ambiguous save acknowledgments preserve the form and never announce or focus a receipt',async()=>{
  for(const [reason,finish] of [
    ['task revision did not advance',{taskRevision:4}],
    ['workspace revision did not advance',{workspaceAdvance:0}],
    ['wrong returned task',{responsePatch:{id:'unrelated-fixture-task'}}],
    ['wrong saved revision',{responsePatch:{revision:6}}],
    ['wrong saved slot',{responsePatch:{schedule:scheduled}}],
    ['wrong current slot',{deltaSlot:scheduled,responsePatch:{schedule:slot}}],
    ['archived task',{patch:{archivedAt:'2026-12-03T12:00:00Z'}}],
    ['different event time zone',{}],
  ]){
    const f=fixture(),original=f.form;
    const pending=f.submit();
    if(reason==='different event time zone')f.state.event.timeZone='America/New_York';
    f.writes[0].finish(finish);
    await pending;
    assert.equal(f.form,original,reason);
    assert.deepEqual(f.form.values,input,reason);
    assert.match(messages(f,'error').join(' '),/couldn.t confirm this start time/i,reason);
    assert.equal(messages(f,'toast').some(text=>/Schedule saved/.test(text)),false,reason);
    assert.equal(messages(f,'render').length,0,reason);
    assert.equal(f.frames.length,0,reason);
    assert.equal(f.ui.pendingSave,false,reason);
  }
});

test('a known stale receipt editor is blocked before any hosted write',async()=>{
  const f=fixture();f.latestPending=true;
  await f.submit();
  assert.equal(f.writes.length,0);
  assert.equal(messages(f,'stale').length,1);
  assert.match(messages(f,'error').join(' '),/check the latest plan before saving/i);
  assert.equal(f.frames.length,0);
  assert.equal(f.ui.pendingSave,false);
});

test('late schedule results do not redraw a replaced modal or a changed project, account, or view',async()=>{
  for(const change of ['form','closed','task','project','actor','view','role','access']){
    const f=fixture(),pending=f.submit();
    if(change==='form')f.replaceForm();
    if(change==='closed')f.backdrop.hidden=true;
    if(change==='task')f.ui.detailId='unrelated-fixture-task';
    if(change==='project')f.window.GatherMode.projectId='other-project';
    if(change==='actor')f.ui.actor='other-organizer';
    if(change==='view')f.ui.view='timeline';
    if(change==='role')f.organizer=false;
    if(change==='access')f.window.GatherAccessLost=true;
    f.writes[0].finish();
    await pending;
    assert.deepEqual(outcomes(f),[],change);
    assert.equal(f.frames.length,0,change);
    assert.equal(f.ui.pendingSave,false,change);
  }
});

test('other drafts, broader editor actions, and a deliberately moved focus keep the ordinary schedule redraw',async()=>{
  for(const variant of ['other draft','completion draft','moved focus','hidden tab','owner receipt','no receipt','already timed','remove','picker','ordinary Timeline']){
    const f=fixture({intent:variant==='owner receipt'?'owner':['no receipt','ordinary Timeline'].includes(variant)?'':'schedule',
      view:variant==='ordinary Timeline'?'timeline':'tasks',fromTimeline:variant==='ordinary Timeline',
      initialSlot:['already timed','remove'].includes(variant)?scheduled:null,
      formId:variant==='picker'?'schedulePickerForm':'scheduleForm'});
    if(variant==='other draft')f.dirty=[{form:'commentForm',name:'text',value:'Fixture unfinished note'}];
    if(variant==='completion draft')f.completionDrafts=[{id:'responseForm'}];
    const pending=f.submit(variant==='remove'?'remove':'save');
    if(variant==='moved focus')f.document.activeElement={id:'different-modal-control'};
    if(variant==='hidden tab')f.document.hidden=true;
    f.writes[0].finish();
    await pending;
    assert.deepEqual(f.calls.find(([type])=>type==='modal'),['modal',id,variant==='picker'?'schedulePickerForm':'scheduleForm'],variant);
    assert.deepEqual(messages(f,'error'),[],variant);
    assert.match(messages(f,'toast').join(' '),variant==='remove'?/Removed from schedule/:/Schedule saved/,variant);
    assert.equal(f.frames.length,0,variant);
    if(variant==='ordinary Timeline')assert.equal(f.ui.firstScheduleReceipt?.id,id,'normal Timeline receipt remains intact');
  }
});

test('focus queued after an exact save will not override newer focus or a replacement Back control',async()=>{
  for(const change of ['focus','back','closed','hidden','pending','project']){
    const f=fixture(),pending=f.submit();
    f.writes[0].finish();await pending;
    assert.equal(f.frames.length,1,change);
    if(change==='focus')f.document.activeElement={id:'chosen-field'};
    if(change==='back')f.replaceBack();
    if(change==='closed')f.backdrop.hidden=true;
    if(change==='hidden')f.document.hidden=true;
    if(change==='pending')f.ui.pendingSave=true;
    if(change==='project')f.window.GatherMode.projectId='other-project';
    const active=f.document.activeElement;
    f.flush();
    assert.equal(f.document.activeElement,active,change);
    assert.deepEqual(messages(f,'focus-back'),[],change);
    assert.equal(f.dialog.scrollTop,45,change);
  }
});
