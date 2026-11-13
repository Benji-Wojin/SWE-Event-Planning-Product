import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const app=readFileSync('legacy/app.js','utf8');
const id='fictional-activity',zone='America/Los_Angeles',day='2026-11-13';
const savedSlot={start:day+'T13:00',end:'',location:''};
const draft={start:day+'T13:15',end:day+'T14:30',location:'  Fictional north room  '};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const schedule=GatherScheduleUI.create({h,options:()=>'',statusBadge:h});

function fragment(startText,endText){
  const start=app.indexOf(startText),end=app.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,'missing source block: '+startText);
  return app.slice(start,end);
}

function fixture({workspaceStale=true,uncertain=false,group='activity-details'}={}){
  const ui={actor:'jack',view:'timeline',timelineMode:'schedule',scheduleDate:day,scheduleMine:true,
    dialogKind:'schedule-from-review',toolUpdatePending:workspaceStale};
  const window={GatherMode:{projectId:'fictional-project'}},document={hidden:false};
  let revision=21,known=workspaceStale?22:21,organizer=true;
  let state={
    event:{timeZone:zone},demoGeneration:1,members:[{id:'jack',name:'Jack Fictional'}],
    tasks:[{id,revision:4,title:'Fictional activity',owner:'jack',status:'todo',eventActivity:true,
      schedule:group==='activity-time'?null:{...savedSlot}}],
  };
  const requests=[],calls=[],frames=[];
  const backdrop={hidden:false},sync={hidden:!workspaceStale},dialog={isConnected:true};
  function node(label){
    const attributes=new Map();
    return {label,isConnected:true,dataset:{},textContent:'',hidden:false,disabled:false,
      setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),
      removeAttribute:key=>attributes.delete(key),focus:()=>calls.push(['focus',label]),
      scrollIntoView(){},closest:selector=>selector==='form'?form:dialog,
    };
  }
  let button=node('check'),status=node('status'),title=node('heading'),notice=node('notice'),submit=node('submit');
  function makeForm(){
    const elements=Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,{value,defaultValue:savedSlot[key]}]));
    elements.namedItem=name=>elements[name];
    return {...node('form'),id:'reviewScheduleForm',dataset:{id,revision:'4',workspaceRevision:'21'},
      elements,querySelector:select};
  }
  let form=makeForm();
  function select(selector){
    return ({
      '#reviewScheduleForm':form,'#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,
      '#eventScheduleCheck':button,'#eventScheduleCheckStatus':status,'#workspaceSyncNotice':sync,
      '#dialogStaleNotice':notice,'button[type="submit"]':submit,'#eventScheduleSave':submit,
    })[selector]??null;
  }
  dialog.contains=el=>[form,title,button,status,notice,submit].includes(el);
  dialog.querySelector=select;
  const scope=()=>({mine:ui.timelineMode!=='deadlines'&&ui.scheduleMine,actor:ui.actor});
  const editor={
    id,group,zone,scope:scope(),mode:ui.timelineMode,date:ui.scheduleDate,
    key:JSON.stringify([window.GatherMode.projectId,window.GatherMode.demo,state.demoGeneration,ui.actor]),
    taskRevision:4,workspaceRevision:21,generation:state.demoGeneration,
    slotKey:JSON.stringify(group==='activity-time'?null:[savedSlot.start,savedSlot.end,savedSlot.location]),
    ...(uncertain?{unconfirmed:true}:{}),
  };
  ui.eventScheduleEditor=editor;
  const store={
    getState:()=>state,getSnapshotRevision:()=>revision,
    setTaskSchedule(){assert.fail('Checking the latest schedule cannot save it');},
    refresh(canApply,options){
      return new Promise((resolve,reject)=>requests.push({
        canApply:(candidate=22,candidateState=state)=>canApply(candidate,candidateState),options,reject,
        finish({next=22,candidate=structuredClone(state),result={verified:true,changed:next!==revision}}={}){
          if(!result.verified||result.pending){resolve(result);return;}
          const accepted=canApply(next,candidate);
          if(accepted){revision=next;state=candidate;}
          resolve(accepted?result:next>revision?{pending:true,newerRevision:next}:{changed:false});
        },
      }));
    },
  };
  const context=vm.createContext({
    ui,window,document,schedule,GatherScheduleUI,store,h,
    $:select,$$:()=>[],
    isOrganizer:()=>organizer,eventReviewScope:scope,
    workspaceUpdatesPending:()=>!sync.hidden,
    recoveryConflictPending:candidate=>Number.isSafeInteger(candidate)&&candidate<=ui.recoveryConflictRevision,
    scheduleRevisionIsStale:candidate=>Number.isSafeInteger(candidate)&&candidate<known,
    rememberNewerSchedule(_snapshot,candidate){if(Number.isSafeInteger(candidate))known=Math.max(known,candidate);},
    showPendingUpdate(){sync.hidden=false;calls.push(['stale']);},
    showRecoveryWriteConflict(candidate){ui.recoveryConflictRevision=candidate;sync.hidden=false;calls.push(['conflict',candidate]);},
    render:()=>calls.push(['render']),
    beforeEventReview:()=>assert.fail('Checking does not leave the editor'),
    openDialog:()=>assert.fail('Checking does not replace the editor'),
    requestAnimationFrame:fn=>frames.push(fn),
    focusTaskDialogControl:element=>element?.focus(),
    toast:text=>calls.push(['toast',text]),
  });
  vm.runInContext(
    fragment('  function scheduleWorkspaceKey(','  function inOrganizerTimeline(')+
    fragment('  function eventScheduleContextMatches(','  function returnToEventTaskReview('),context,
  );
  return {ui,window,document,dialog,backdrop,sync,editor,requests,calls,
    get revision(){return revision;},get state(){return state;},get form(){return form;},
    get status(){return status;},get notice(){return notice;},get button(){return button;},get submit(){return submit;},
    set organizer(value){organizer=value;},set known(value){known=value;},
    check(control=button){return context.checkEventReviewSchedule(control);},
    mark(){return context.markEventScheduleCheck(editor);},
    isStale(){return context.eventScheduleReviewStale(editor);},
    values(){return Object.fromEntries(Object.keys(draft).map(key=>[key,form.elements[key].value]));},
    replace(){form=makeForm();button=node('replacement check');status=node('replacement status');title=node('replacement heading');},
    flush(){for(const fn of frames.splice(0))fn();},
  };
}

test('one verified check refreshes only the workspace stamp and leaves exact live input in place without writing',async()=>{
  const f=fixture(),form=f.form,oldButton=f.button,pending=f.check();
  assert.equal(f.requests.length,1);
  const [read]=f.requests;
  assert.equal(read.options.requireFresh,true);
  assert.equal(read.canApply(21),false,'candidate below known floor cannot publish');
  assert.equal(read.canApply(22),true);
  assert.equal(oldButton.getAttribute('aria-disabled'),'true');
  await f.check();
  assert.equal(f.requests.length,1,'duplicate click cannot start another read');
  form.elements.location.value='  Keystrokes entered during refresh  ';
  form.elements.end.value='';
  const inFlight=f.values();
  read.finish();
  await pending;
  f.flush();
  assert.equal(f.form,form);
  assert.equal(f.revision,22);
  assert.equal(f.ui.eventScheduleEditor.workspaceRevision,22);
  assert.equal(f.ui.eventScheduleEditor.taskRevision,4);
  assert.deepEqual(f.values(),inFlight);
  assert.equal(form.elements.location.defaultValue,'','draft remains visibly unsaved');
  assert.equal(f.sync.hidden,true);
  assert.equal(f.ui.toolUpdatePending,false);
  assert.equal(oldButton.getAttribute('aria-disabled'),undefined);
  assert.equal(oldButton.hidden,true);
  assert.equal(f.status.tabIndex,-1);
  assert.deepEqual(f.calls.filter(([kind])=>kind==='focus'),[['focus','status']]);
  assert.equal(f.ui.eventScheduleCheckKey,undefined);
  assert.equal(f.isStale(),false);
  assert.match(f.status.textContent,/not (?:saved|submitted)|not changed|still here/i);
});

test('candidate changes to the task revision, slot, time zone, group, or demo keep the exact old editor locked',async()=>{
  for(const reason of ['revision','slot','zone','group','deleted','owner','generation']){
    const f=fixture(),form=f.form,pending=f.check(),candidate=structuredClone(f.state);
    const [task]=candidate.tasks;
    if(reason==='revision')task.revision=5;
    if(reason==='slot')task.schedule.location='Changed <fictional> room';
    if(reason==='zone')candidate.event.timeZone='America/New_York';
    if(reason==='group')task.schedule={...savedSlot,location:'Room',end:day+'T14:00'};
    if(reason==='deleted')candidate.tasks=[];
    if(reason==='owner')task.owner='maya';
    if(reason==='generation')candidate.demoGeneration=2;
    f.requests[0].finish({candidate});
    await pending;
    assert.equal(f.form,form,reason);
    assert.equal(f.revision,21,reason);
    assert.equal(f.ui.eventScheduleEditor.workspaceRevision,21,reason);
    assert.deepEqual(f.values(),draft,reason);
    assert.equal(f.isStale(),true,reason);
    assert.match(f.status.textContent,/changed|no longer|unavailable|still here|newer/i,reason);
    if(reason==='slot')assert.match(f.status.textContent,/Current saved schedule.*Changed <fictional> room/);
  }
});

test('failed, superseded, unverified and late hidden checks preserve the draft and do not repaint',async()=>{
  for(const reason of ['failed','unverified','pending','actor','project','role','access','form','closed','hidden','scope','date','mode']){
    const f=fixture(),pending=f.check(),[read]=f.requests;
    if(reason==='failed')read.reject(new Error('Fictional failure'));
    else if(reason==='unverified')read.finish({result:{changed:false}});
    else if(reason==='pending')read.finish({result:{pending:true,newerRevision:23}});
    else{
      if(reason==='actor')f.ui.actor='maya';
      if(reason==='project')f.window.GatherMode.projectId='different-project';
      if(reason==='role')f.organizer=false;
      if(reason==='access')f.window.GatherAccessLost=true;
      if(reason==='form')f.replace();
      if(reason==='closed')f.backdrop.hidden=true;
      if(reason==='hidden')f.document.hidden=true;
      if(reason==='scope')f.ui.scheduleMine=false;
      if(reason==='date')f.ui.scheduleDate='2026-11-14';
      if(reason==='mode')f.ui.timelineMode='deadlines';
      assert.equal(read.canApply(22),false,reason);
      read.finish();
    }
    await pending;
    f.flush();
    assert.equal(f.revision,21,reason);
    assert.equal(f.ui.eventScheduleEditor.workspaceRevision,21,reason);
    assert.deepEqual(f.values(),draft,reason);
    assert.equal(f.ui.syncing,false,reason);
    if(reason==='form')assert.equal(f.status.textContent,'','late result cannot repaint a replacement status');
  }
});

test('a read may clear a sticky inconclusive check at the same revision but cannot unlock an unconfirmed save',async()=>{
  const retry=fixture({workspaceStale:false});
  retry.mark();
  assert.equal(retry.isStale(),true);
  const pending=retry.check();
  retry.requests[0].finish({next:21});
  await pending;
  assert.equal(retry.isStale(),false);
  assert.equal(retry.revision,21);
  assert.deepEqual(retry.values(),draft);

  const ambiguous=fixture({uncertain:true});
  ambiguous.mark();
  const checking=ambiguous.check();
  if(ambiguous.requests.length)ambiguous.requests[0].finish();
  await checking;
  assert.equal(ambiguous.ui.eventScheduleEditor.unconfirmed,true);
  assert.equal(ambiguous.revision,21);
  assert.equal(ambiguous.isStale(),true);
  assert.deepEqual(ambiguous.values(),draft);
});
