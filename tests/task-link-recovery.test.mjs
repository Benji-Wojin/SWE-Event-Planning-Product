import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';

const source=readFileSync('legacy/app.js','utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const notice=part('  function taskLinkNotice()', '  function tasksView(s)');
const bootstrap=part('  ui.scheduleDate=navigation.initialScheduleDate();', "  if((!window.GatherMode||window.GatherMode.demo)&&ui.view");
const handoffLink=part('  function openTaskHandoffLink(', '  function openScheduleReconfirmation(');
const receiptReturn=part('  function setPlanReceiptReturn(', '  function openTaskHandoffLink(');
const ownerChoices=part('  const options =', '  const statusOptions =');
function land(id,tasks,{welcome=false,review='',organizer=false,mode,accessLost=false,openReview=false,activity='',date='',rows=[],fromPlanReceipt=false}={}){
  const events=[];
  const ui={tab:'mine',actor:'fictional-actor'},title={},frames=[],document={activeElement:title};
  let updatesPending=false;
  const elements={
    '#taskLinkUnavailableTitle':{focus(){events.push('notice focus');},scrollIntoView(){events.push('notice visible');}},
    '#taskLinkNotice':{remove(){events.push('dismissed');}},
    '#taskSearch':{focus(){events.push('search focus');}},
    '#viewRoot':{querySelector(){return {
      scrollIntoView(options){assert.equal(options.block,'center');assert.equal(options.inline,'nearest');assert.equal(options.behavior,'instant');events.push('opener visible');},
      focus(options){assert.equal(options.preventScroll,true);events.push('opener focus');},
    };}},
    '#workspaceHandoffTitle':{focus(){events.push('welcome focus');}},
    '#dialogTitle':title,
    '#schedulePanelHeading':{label:'schedule heading'},
  };
  const context=vm.createContext({
    ui,document,store:{getState:()=>({tasks,members:[{id:'active',active:true},{id:'former',active:false},{id:'example',role:'Member · example'}]})},taskLinkUnavailable:false,joinWelcome:false,
    GatherScheduleUI,
    navigation:{initialScheduleDate:()=>date,takeInitialActivityLink:()=>activity,takeInitialTaskLink:()=>({id,review,...(fromPlanReceipt?{fromPlanReceipt:true}:{})}),takeJoinWelcome:()=>welcome,initial:()=>'overview'},
    window:{GatherMode:mode,GatherAccessLost:accessLost,dispatchEvent(){events.push('ready');}},Event,isLiveTeammate:()=>true,isOrganizer:()=>organizer,
    syncTeammateWelcome(){},
    navigate(view,options){ui.view=view;if(options?.scheduleDay)ui.scheduleDate=options.scheduleDay;events.push(view);},loadInitialGuide(){},$:selector=>elements[selector],
    $$:selector=>selector==='.schedule-row'?rows:[],focusScheduleTarget(target){events.push(['focus',target?.label]);return !!target;},
    toast:message=>events.push(['toast',message]),
    taskDialog(...args){if(args[7])args[7]={...args[7]};if(ui.planReceiptReturn)events.push(['capture plan receipt return',ui.planReceiptReturn.id]);events.push(args);},
    requestAnimationFrame(fn){frames.push(fn);},focusTaskOwnerEditor(id){events.push(['owner focus',id]);},
    schedule:{firstTimeTask:(state,id)=>state.tasks.find(task=>task.id===id&&task.eventActivity&&!task.schedule&&!(task.status==='done'&&(!task.requiresVerification||task.verifiedAt)))},
    workspaceUpdatesPending:()=>updatesPending,focusTaskScheduleEditor(id,setup){events.push(['schedule focus',id,setup]);},
    openOrganizerReview(...args){
      if(ui.planReceiptReturn)events.push(['capture plan receipt return',ui.planReceiptReturn.id]);
      events.push(['review',...args]);return openReview;
    },
  });
  vm.runInContext(ownerChoices+'\n'+notice+'\n'+receiptReturn+'\n'+handoffLink+'\n'+part('  function focusTimelineRow(', '  function timelineView(')+'\n'+bootstrap,context);
  return {ui,events,context,document,elements,frames,pending(){updatesPending=true;},markup:()=>vm.runInContext('taskLinkNotice()',context)};
}

test('activity bootstrap uses the current overnight start day and focuses only the exact dated Timeline row',()=>{
  const id='fictional-activity',day='2099-12-04',date='2099-11-01';
  const task={id,title:'Same name',status:'done',schedule:{start:day+'T23:45',end:'2099-12-05T01:00'}};
  const row=(label,id,scheduleDay)=>({label,dataset:{id,scheduleDay},closest:()=>null,getClientRects:()=>[{}]});
  const rows=[row('same-title decoy','different',day),row('same activity carryover',id,'2099-12-05'),row('exact activity',id,day)];
  const view=land('',[task],{activity:id,date,mode:{projectId:'fictional-project'},welcome:true,rows});
  assert.equal(view.ui.scheduleDate,day);
  assert.equal(view.ui.tab,'mine','the normal Shared tasks view is not selected');
  assert.deepEqual(view.events,['timeline','ready',['focus','exact activity']]);
  const missingRow=land('',[task],{activity:id,date,mode:{projectId:'fictional-project'},rows:rows.slice(0,2)});
  assert.deepEqual(missingRow.events,['timeline','ready',['focus','schedule heading'],['toast','This activity is no longer visible on this date.']]);
});

test('missing, unscheduled, archived or invalid activities leave the viewer on Timeline without a task dialog',()=>{
  const id='fictional-unavailable',date='2099-11-01';
  for(const tasks of [[],[{id,schedule:null}],[{id,archivedAt:'former',schedule:{start:'2099-12-05T13:00'}}],
    [{id,schedule:{start:'2099-02-29T13:00'}}]]){
    const view=land('',tasks,{activity:id,date,mode:{projectId:'fictional-project'}});
    assert.equal(view.ui.scheduleDate,date);
    assert.deepEqual(view.events,['timeline','ready',['focus','schedule heading'],['toast','This activity is no longer available on the schedule.']]);
  }
  for(const override of [{mode:{demo:true}},{mode:undefined},{accessLost:true}]){
    const view=land('',[{id,schedule:{start:'2099-12-05T13:00'}}],{activity:id,mode:{projectId:'fictional-project'},...override});
    assert.deepEqual(view.events,['overview','ready']);
  }
});

test('an unavailable task link lands on All tasks with a persistent, focused explanation and a search action',()=>{
  const id='fictional-removed-task',view=land(id,[{id:'current-task'}],{welcome:true});
  assert.equal(view.ui.tab,'all');
  assert.deepEqual(view.events,['tasks','ready','notice focus','notice visible']);
  const markup=view.markup();
  assert.match(markup,/id="taskLinkNotice" aria-labelledby="taskLinkUnavailableTitle"/);
  assert.match(markup,/id="taskLinkUnavailableTitle" tabindex="-1" aria-describedby="taskLinkUnavailableHelp">This task is no longer available/);
  assert.match(markup,/id="taskLinkUnavailableHelp">The link doesn’t match a task in this project/);
  assert.match(markup,/data-action="continue-task-search">Go to task search/);
  assert.doesNotMatch(markup,/fictional-removed-task|current-task|deleted|permission/);
  assert.equal(view.markup(),markup,'a passive rerender must not erase the notice');
  vm.runInContext('continueFromTaskLinkNotice()',view.context);
  assert.equal(view.markup(),'');
  assert.deepEqual(view.events.slice(-2),['dismissed','search focus']);
  assert.match(source,/if\(view!=='tasks'\)taskLinkUnavailable=false/);
});

test('start time shortcuts keep the exact live task and fall back when the activity or view changed',()=>{
  const id='activity',options={review:'schedule',organizer:true,mode:{demo:false,projectId:'fixture'}};
  const task={id,eventActivity:true,status:'todo'};
  const opened=[id,'',false,true,'',undefined,'',{readOnly:true}];
  const live=land(id,[task],options);
  assert.deepEqual(live.events.at(-1),opened);
  live.frames[0]();assert.deepEqual(live.events.at(-1),['schedule focus',id,true]);
  for(const extra of [{schedule:{start:'2027-01-01T10:00'}},{eventActivity:false},{status:'done'},{archivedAt:'archived'}]){
    const stale=land(id,[{...task,...extra}],options);
    assert.deepEqual(stale.events.at(-1),opened);assert.equal(stale.frames.length,0);
  }
  for(const opts of [{organizer:false},{mode:{demo:true}},{mode:undefined}]){
    const ordinary=land(id,[task],{...options,...opts});
    assert.deepEqual(ordinary.events.at(-1),opened);assert.equal(ordinary.frames.length,0);
  }
  for(const late of ['updates','slot','focus','project']){
    const copy={...task},view=land(id,[copy],{...options,mode:{...options.mode}});
    if(late==='updates')view.pending();
    if(late==='slot')copy.schedule={start:'2027-01-01T10:00'};
    if(late==='focus')view.document.activeElement={};
    if(late==='project')view.context.window.GatherMode.projectId='other';
    view.frames[0]();assert.deepEqual(view.events.at(-1),opened,late);
  }
  assert.deepEqual(land(id,[],options).events,['tasks','ready','notice focus','notice visible']);
});

test('owner receipt hints focus only a still-actionable task in the same live organizer dialog',()=>{
  const id='exact-task',options={review:'owner',organizer:true,mode:{demo:false,projectId:'fixture'}};
  const opened=[id,'',false,true,'',undefined,'',{readOnly:true}];
  for(const owner of ['', 'former', 'missing', 'example']){
    const view=land(id,[{id,status:'todo',owner}],options);
    assert.deepEqual(view.events.at(-1),opened);
    assert.equal(view.frames.length,1);
    view.frames[0]();assert.deepEqual(view.events.at(-1),['owner focus',id]);
  }
  for(const extra of [{owner:'active'},{status:'done'},{reportedAt:'reported'},{verifiedAt:'verified'},{archivedAt:'archived'}]){
    const view=land(id,[{id,status:'todo',...extra}],options);
    assert.deepEqual(view.events.at(-1),opened);
    assert.equal(view.frames.length,0);
  }
  for(const override of [{organizer:false},{mode:{demo:true}},{mode:undefined}]){
    const view=land(id,[{id,status:'todo'}],{...options,...override});
    assert.deepEqual(view.events.at(-1),opened);assert.equal(view.frames.length,0);
  }
  for(const late of ['focus','dialog','actor','owner','project','access']){
    const task={id,status:'todo'},view=land(id,[task],{...options,mode:{...options.mode}});
    if(late==='focus')view.document.activeElement={};
    if(late==='dialog')view.elements['#dialogTitle']={};
    if(late==='actor')view.ui.actor='other';
    if(late==='owner')task.owner='active';
    if(late==='project')view.context.window.GatherMode.projectId='other';
    if(late==='access')view.context.window.GatherAccessLost=true;
    view.frames[0]();assert.deepEqual(view.events.at(-1),opened,late);
  }
  assert.deepEqual(land(id,[],options).events,['tasks','ready','notice focus','notice visible']);
});

test('the planner return is captured only for the exact available live organizer editor destination',()=>{
  const id='fictional-task',mode={demo:false,projectId:'fictional-project'};
  const task={id,status:'todo',eventActivity:true};
  for(const review of ['owner','schedule']){
    const options={review,organizer:true,mode,fromPlanReceipt:true};
    const exact=land(id,[{id:'same-title-decoy'},task],options);
    const dialogIndex=exact.events.findIndex(event=>Array.isArray(event)&&event[0]===id);
    assert.ok(dialogIndex>0);
    assert.deepEqual(exact.events[dialogIndex-1],['capture plan receipt return',id],
      'the first task dialog render has the exact scoped Back context');
    for(const override of [{fromPlanReceipt:false},{organizer:false},{accessLost:true},{mode:{...mode,demo:true}},{mode:undefined}]){
      assert.equal(land(id,[task],{...options,...override}).events.some(event=>event[0]==='capture plan receipt return'),false);
    }
    assert.deepEqual(land(id,[{id:'decoy'}],options).events,['tasks','ready','notice focus','notice visible']);
    assert.equal(land(id,[{...task,archivedAt:'archived'}],options).ui.planReceiptReturn,undefined);
  }
});

test('return to the plan receipt is scoped to the live task control and respects draft and save guards',()=>{
  const id='fictional-task';
  function fixture(guidedWorkspace=true){
    const ui={view:'tasks',detailId:id,actor:'fictional-actor',dialogKind:'task'},mode={projectId:'fixture &=1',demo:false};
    const opener={isConnected:true,dataset:{action:'return-to-plan-receipt'},closest:()=>null},dialog={},backdrop={hidden:false},emailForm={};
    const flags={organizer:true,close:true,email:true,disclosure:false},location={href:'/project'},calls=[];
    const context=vm.createContext({ui,guidedWorkspace,URLSearchParams,document:{hidden:false},
      window:{GatherMode:mode,top:{location}},isOrganizer:()=>flags.organizer,
      store:{getState:()=>({tasks:[{id,status:'todo'}]})},
      $:(selector,root)=>({ '#dialog':dialog,'#dialogBackdrop':backdrop,'#emailReviewForm':emailForm,
        '#planReceiptBack':root===dialog?opener:undefined })[selector],
      hiddenByClosedDisclosure:()=>flags.disclosure,
      confirmCloseDialog(){calls.push('confirm dialog');return flags.close;},
      confirmDiscard(form){assert.equal(form,emailForm);calls.push('confirm mail draft');return flags.email;},
      closeDialog(){calls.push('close');ui.planReceiptReturn=null;},
    });
    const back=vm.runInContext(receiptReturn+`\nsetPlanReceiptReturn('${id}');returnToPlanReceipt;`,context);
    return {ui,mode,opener,backdrop,flags,calls,location,context,back:control=>back(control??opener)};
  }
  for(const block of [
    f=>{f.ui.pendingSave=true;},f=>{f.context.document.hidden=true;},f=>{f.ui.dialogKind='other';},
    f=>{f.ui.detailId='another-task';},f=>{f.ui.view='timeline';},f=>{f.ui.actor='another-actor';},
    f=>{f.mode.projectId='another-project';},f=>{f.mode.demo=true;},f=>{f.flags.organizer=false;},
    f=>{f.context.window.GatherAccessLost=true;},f=>{f.backdrop.hidden=true;},f=>{f.opener.isConnected=false;},
    f=>{f.opener.closest=()=>({});},f=>{f.flags.disclosure=true;},f=>{f.opener.dataset.action='different';},
  ]){
    const f=fixture();block(f);
    assert.equal(f.back(),false);assert.deepEqual(f.calls,[]);assert.equal(f.location.href,'/project');
  }
  const decoy=fixture();assert.equal(decoy.back({...decoy.opener}),false);assert.deepEqual(decoy.calls,[]);
  const cancelled=fixture();cancelled.flags.close=false;
  assert.equal(cancelled.back(),false);assert.deepEqual(cancelled.calls,['confirm dialog']);
  assert.equal(cancelled.location.href,'/project');assert.equal(cancelled.ui.planReceiptReturn.id,id);
  const email=fixture();email.flags.email=false;
  assert.equal(email.back(),false);assert.deepEqual(email.calls,['confirm dialog','confirm mail draft']);
  assert.equal(email.location.href,'/project');assert.equal(email.ui.planReceiptReturn.id,id);
  for(const guided of [true,false]){
    const success=fixture(guided);assert.equal(success.back(),true);
    assert.deepEqual(success.calls,['confirm dialog','confirm mail draft','close']);
    assert.equal(success.location.href,`/plan?project=fixture+%26%3D1${guided?'&guide=1':''}&receiptTask=${id}`);
    assert.equal(success.ui.planReceiptReturn,null);
  }
});

test('current links open the matching task with heading focus, ordinary navigation never shows the notice',()=>{
  const id='current-task',current=land(id,[{id}]);
  assert.equal(current.ui.tab,'all');
  assert.deepEqual(current.events,['tasks','ready','opener visible','opener focus',[id,'',false,true]]);
  assert.equal(current.markup(),'');
  const ordinary=land('',[],{welcome:true});
  assert.deepEqual(ordinary.events,['overview','welcome focus','ready']);
  assert.equal(ordinary.markup(),'');
});

test('authorized hosted receipt hints try the current organizer review, with quiet fallback for stale hints',()=>{
  const id='current-task',tasks=[{id}],mode={demo:false};
  for(const review of ['completion','amendment']){
    const current=land(id,tasks,{review,organizer:true,mode,openReview:true});
    assert.deepEqual(current.events,['tasks','ready','opener visible','opener focus',['review',id,review,'',true]]);
    assert.equal(current.markup(),'');
    const stale=land(id,tasks,{review,organizer:true,mode,openReview:false});
    assert.deepEqual(stale.events,['tasks','ready','opener visible','opener focus',['review',id,review,'',true],[id,'',false,true]]);
    assert.equal(stale.markup(),'');
  }
  for(const options of [{mode,organizer:false},{mode:{demo:true},organizer:true},{organizer:true}]){
    const ordinary=land(id,tasks,{review:'completion',openReview:true,...options});
    assert.deepEqual(ordinary.events,['tasks','ready','opener visible','opener focus',[id,'',false,true]]);
  }
  assert.deepEqual(land(id,tasks,{review:'completion',organizer:true,mode,accessLost:true}).events,['tasks','ready']);
  assert.deepEqual(land(id,[],{review:'completion',organizer:true,mode}).events,['tasks','ready','notice focus','notice visible']);
});

test('completion and amendment receipt links scope Back before the first review and preserve it on quiet fallback',()=>{
  const id='exact-task',mode={demo:false,projectId:'fictional-project'},active={id},decoy={id:'different-task'};
  for(const review of ['completion','amendment']){
    const options={review,organizer:true,mode,fromPlanReceipt:true};
    const reviewAttempt=['review',id,review,'',true];
    for(const openReview of [true,false]){
      const landing=land(id,[decoy,active],{...options,openReview});
      assert.deepEqual({...landing.ui.planReceiptReturn},{id,intent:review,project:mode.projectId,actor:'fictional-actor',view:'tasks'});
      const index=landing.events.findIndex(event=>Array.isArray(event)&&event[0]==='review');
      assert.deepEqual(landing.events.slice(index-1,index+1),[['capture plan receipt return',id],reviewAttempt]);
      if(!openReview)assert.deepEqual(landing.events.at(-1),[id,'',false,true]);
    }
    for(const [tasks,override] of [
      [[active],{fromPlanReceipt:false}],[[active],{organizer:false}],[[active],{accessLost:true}],
      [[active],{mode:{...mode,demo:true}}],[[active],{mode:undefined}],[[active],{mode:{demo:false}}],
      [[decoy],{}],[[{...active,archivedAt:'archived'}],{}],
    ]){
      const landing=land(id,tasks,{...options,openReview:true,...override});
      assert.equal(landing.ui.planReceiptReturn,undefined);
      assert.ok(!landing.events.some(event=>event[0]==='capture plan receipt return'));
    }
  }
});
