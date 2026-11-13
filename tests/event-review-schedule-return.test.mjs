import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const source=readFileSync('legacy/app.js','utf8');
const id='fictional-activity',actor='jack',date='2026-11-13';
const zone='America/Los_Angeles';
const fixed={id,title:'Fictional <activity>',owner:actor,revision:4,status:'progress',
  acceptedAt:'2026-11-10T19:00:00Z',eventActivity:true,
  schedule:{start:date+'T14:00',end:'',location:''}};
const data={start:date+'T14:00',end:date+'T14:45',location:'North hall',taskId:'different-activity'};
const expected={start:data.start,end:data.end,location:data.location};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const schedule=GatherScheduleUI.create({h,options:()=>'',statusBadge:h});

function fragment(from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'missing source block: '+from);
  return source.slice(start,end);
}

function fixture({group='activity-details',mine=true}={}){
  const ui={actor,view:'timeline',timelineMode:'schedule',scheduleDate:date,scheduleMine:mine,dialogKind:'before-event-review'};
  const window={GatherMode:{projectId:'fictional-project'}},document={hidden:false};
  const calls=[],writes=[],frames=[];
  const state={event:{name:'Fictional school event',timeZone:zone},demoGeneration:1,
    members:[{id:actor,name:'Jack Fictional'},{id:'maya',name:'Maya Fictional'}],
    tasks:[structuredClone(fixed),{...structuredClone(fixed),id:'different-activity',owner:'maya',title:'Fictional other activity'}]};
  if(group==='activity-time')state.tasks[0].schedule=null;
  const groupElement={dataset:{eventReviewGroup:group},isConnected:true,open:true};
  const panel={contains:el=>el===groupElement||el===opener};
  const opener={isConnected:true,dataset:{action:'schedule-review-activity',id,eventReviewGroup:group,reviewGroup:group},
    closest:selector=>selector.includes('event-review-group')?groupElement:selector.includes('before-event-review')?panel:dialog};
  groupElement.contains=el=>el===opener;
  groupElement.querySelector=selector=>selector.includes('schedule-review-activity')?opener:null;
  const dialog={contains:el=>el===opener||el===groupElement||el===form||el===heading,querySelector:()=>null};
  const backdrop={hidden:false},status={textContent:''};
  let organizer=true,stale=false,workspaceRevision=21,form=null,heading={},floor=0;
  const store={
    getState:()=>state,getSnapshotRevision:()=>workspaceRevision,
    setTaskSchedule(...args){
      return new Promise((resolve,reject)=>writes.push({args,reject,finish(savedPatch={}){
        const saved={...state.tasks[0],revision:5,schedule:expected,acceptedAt:'',...savedPatch};
        state.tasks[0]=saved;workspaceRevision++;
        resolve(saved);
      }}));
    },
  };
  const context=vm.createContext({
    ui,window,document,store,h,schedule,GatherScheduleUI,
    isOrganizer:()=>organizer,
    workspaceUpdatesPending:()=>stale,
    recoveryConflictPending:revision=>Number.isSafeInteger(revision)&&revision<floor,
    scheduleRevisionIsStale:revision=>Number.isSafeInteger(revision)&&revision<floor,
    showPendingUpdate(revision,group){stale=true;calls.push(['stale',revision,group]);},
    showRecoveryWriteConflict(revision){floor=revision+1;stale=true;calls.push(['conflict',revision]);},
    hasUnsavedFields:element=>!!element?.dirty,
    confirmDiscard:()=>true,
    eventReviewScope:()=>({actor:ui.actor,mine:ui.timelineMode!=='deadlines'&&ui.scheduleMine}),
    $:selector=>({
      '#dialog':dialog,'#dialogTitle':heading,'#dialogBackdrop':backdrop,'#reviewScheduleForm':form,
      '.before-event-review':panel,'#eventReviewRefreshStatus':status,
      '[data-action="schedule-review-activity"]':opener,'[data-event-review-group]':groupElement,
    })[selector]??null,
    $$:selector=>selector.includes('event-review-group')?[groupElement]:
      selector.includes('schedule-review-activity')?[opener]:[],
    openDialog(title,body,footer,wide,kind){
      calls.push(['open',title,body,footer,wide,kind]);
      ui.dialogKind=kind;
      heading={};
      const tag=body.match(/<form id="reviewScheduleForm"[^>]*>/)?.[0];
      if(tag){
        const dataset=Object.fromEntries(Array.from(tag.matchAll(/data-([a-z-]+)="([^"]*)"/g),([,key,value])=>
          [key.replace(/-([a-z])/g,(_,char)=>char.toUpperCase()),value]));
        form={id:'reviewScheduleForm',isConnected:true,dataset,fields:{...data},closest:()=>dialog};
      }
    },
    beforeEventReview(group){
      calls.push(['review',group]);
      ui.dialogKind='before-event-review';
      ui.eventScheduleEditor=null;
      if(form)form.isConnected=false;
      form=null;
    },
    render:()=>calls.push(['render']),
    toast:message=>calls.push(['toast',message]),
    formError:(_form,error)=>calls.push(['error',error.message]),
    requestAnimationFrame:cb=>frames.push(cb),
  });
  ui.eventReviewSnapshot={scope:context.eventReviewScope(),key:JSON.stringify([window.GatherMode.projectId,
    window.GatherMode.demo,state.demoGeneration,ui.actor]),mode:ui.timelineMode,date:ui.scheduleDate,workspaceRevision,zone};
  vm.runInContext(fragment('  function scheduleWorkspaceKey(','  function inOrganizerTimeline(')+
    fragment('  function eventScheduleContextMatches(','  function returnToEventTaskReview('),context);
  return {ui,window,document,backdrop,state,calls,writes,opener,groupElement,
    get form(){return form;},get task(){return state.tasks[0];},
    set organizer(value){organizer=value;},set stale(value){stale=value;},set floor(value){floor=value;},
    set revision(value){workspaceRevision=value;},
    open(target=id,button=opener){return context.openEventReviewSchedule(target,button);},
    back(){return context.returnFromEventReviewSchedule();},
    save(draft=form){return context.saveEventReviewSchedule(draft,draft.fields);},
    replace(){form={...form,dataset:{...form.dataset},fields:{...form.fields}};heading={};},
    flush(){for(const frame of frames.splice(0))frame();},
  };
}

const reviews=f=>f.calls.filter(([kind])=>kind==='review');
const opened=f=>f.calls.filter(([kind])=>kind==='open');
const redraws=f=>f.calls.filter(([kind])=>kind==='render'||kind==='review');
const outcome=f=>f.calls.filter(([kind])=>kind==='toast').map(([,text])=>text).join(' ');

test('opening a scoped activity editor and going Back returns to the exact source review group without writes',()=>{
  for(const group of ['activity-time','activity-details']){
    const f=fixture({group});
    f.open();
    assert.equal(opened(f).length,1);
    const [,title,body,footer,,kind]=opened(f)[0];
    assert.match(title,/schedule/i);
    assert.match(body,/Fictional &lt;activity&gt;/);
    assert.match(body,/id="reviewScheduleForm"[^>]*data-id="fictional-activity"[^>]*data-revision="4"/);
    assert.match(footer,/Back to event review/);
    assert.equal(kind,'schedule-from-review');
    assert.doesNotMatch(body,/different-activity|name="taskId"/);
    f.back();
    assert.deepEqual(reviews(f),[['review',group]]);
    assert.equal(f.writes.length,0);
  }
});

test('stale, foreign, wrong-role, or replaced group controls cannot open a schedule editor',()=>{
  for(const reason of ['stale','floor','revision','role','access','wrong id','wrong group','detached','foreign owner','resolved']){
    const f=fixture();
    let requested=id;
    if(reason==='stale')f.stale=true;
    if(reason==='floor')f.floor=22;
    if(reason==='revision')f.revision=22;
    if(reason==='role')f.organizer=false;
    if(reason==='access')f.window.GatherAccessLost=true;
    if(reason==='wrong id')requested='different-activity';
    if(reason==='wrong group')f.groupElement.dataset.eventReviewGroup='activity-time';
    if(reason==='detached')f.opener.isConnected=false;
    if(reason==='foreign owner'){
      requested='different-activity';
      f.opener.dataset.id=requested;
    }
    if(reason==='resolved')f.task.schedule={...expected};
    f.open(requested);
    assert.equal(opened(f).length,0,reason);
    assert.equal(f.writes.length,0);
    if(['stale','floor','revision'].includes(reason)){
      assert.deepEqual(f.calls[0],['stale',undefined,'activity-details']);
      assert.match(outcome(f),/Refresh the event review/);
    }
  }
});

test('a save waits for the exact activity write and returns to the same source group on confirmation',async()=>{
  const f=fixture();
  f.open();
  const pending=f.save();
  assert.equal(f.writes.length,1);
  const [write]=f.writes;
  assert.deepEqual(JSON.parse(JSON.stringify(write.args.slice(0,3))),[id,expected,actor]);
  assert.deepEqual(redraws(f),[],'do not repaint while the write is pending');
  write.finish();
  await pending;
  assert.deepEqual(redraws(f),[['render'],['review','activity-details']]);
  assert.match(outcome(f),/Schedule saved/i);
  assert.match(outcome(f),/owner.*accept again/i);
});

test('a changed project, task revision, time zone, filter or form never writes the older draft',async()=>{
  for(const reason of ['workspace revision','task revision','time zone','known stale','project','demo reset','actor',
    'access','role','mode','scope','date','replacement']){
    const f=fixture();
    f.open();
    const form=f.form;
    if(reason==='workspace revision')f.revision=22;
    if(reason==='task revision')f.task.revision=5;
    if(reason==='time zone')f.state.event.timeZone='America/New_York';
    if(reason==='known stale')f.stale=true;
    if(reason==='project')f.window.GatherMode.projectId='different-project';
    if(reason==='demo reset')f.state.demoGeneration=2;
    if(reason==='actor')f.ui.actor='maya';
    if(reason==='access')f.window.GatherAccessLost=true;
    if(reason==='role')f.organizer=false;
    if(reason==='mode')f.ui.timelineMode='deadlines';
    if(reason==='scope')f.ui.scheduleMine=false;
    if(reason==='date')f.ui.scheduleDate='2026-11-14';
    if(reason==='replacement')f.replace();
    await f.save(form).catch(()=>{});
    assert.equal(f.writes.length,0,reason);
    assert.deepEqual(form.fields,data,reason);
    assert.doesNotMatch(outcome(f),/Schedule saved/i);
  }
});

test('a failed, unconfirmed, or superseded save cannot announce success or replace the current review',async()=>{
  for(const reason of ['error','conflict','demo conflict','demo commit conflict','unconfirmed','form','project','access','filter','closed']){
    const f=fixture(),original=structuredClone(data);
    f.open();
    const form=f.form,pending=f.save(),[write]=f.writes;
    if(reason==='error')write.reject(new Error('Fictional save error'));
    else if(reason==='conflict')write.reject(Object.assign(new Error('The plan changed in another tab.'),{status:409}));
    else if(reason==='demo conflict')write.reject(Object.assign(new Error('Someone updated this demo.'),{status:409}));
    else if(reason==='demo commit conflict')write.reject(Object.assign(new Error('Another profile saved first.'),{status:409}));
    else{
      if(reason==='form')f.replace();
      if(reason==='project')f.window.GatherMode.projectId='different-project';
      if(reason==='access')f.window.GatherAccessLost=true;
      if(reason==='filter')f.ui.scheduleMine=false;
      if(reason==='closed')f.backdrop.hidden=true;
      write.finish(reason==='unconfirmed'?{schedule:{...expected,location:'Unexpected location'}}:{});
    }
    await pending.catch(()=>{});
    assert.deepEqual(redraws(f),[],reason);
    assert.doesNotMatch(outcome(f),/Schedule saved/i);
    assert.deepEqual(form.fields,original,reason);
    if(reason.endsWith('conflict'))assert.ok(f.calls.some(event=>event[0]==='conflict'&&event[1]===21));
  }
});

test('an ambiguous save cannot be repeated from the old editor, but Back still returns to the source group',async()=>{
  const f=fixture({group:'activity-time'});
  f.open();
  const pending=f.save(),[write]=f.writes;
  write.reject(Object.assign(new Error('Fictional lost response'),{status:503}));
  await assert.rejects(pending,/confirm/i);
  assert.deepEqual(f.form.fields,data);
  assert.equal(f.ui.eventScheduleEditor.unconfirmed,true);
  await assert.rejects(f.save(),/previous save|confirm/i);
  assert.equal(f.writes.length,1);
  assert.equal(f.back(),true);
  assert.deepEqual(reviews(f),[['review','activity-time']]);
});
