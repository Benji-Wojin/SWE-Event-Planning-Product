import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const notice=part('  function taskLinkNotice()', '  function tasksView(s)');
const bootstrap=part('  const {id:initialTask,review:initialTaskReview}=navigation.takeInitialTaskLink();', "  if((!window.GatherMode||window.GatherMode.demo)&&ui.view");
const handoffLink=part('  function openTaskHandoffLink(', '  function openScheduleReconfirmation(');
function land(id,tasks,{welcome=false,review='',organizer=false,mode,accessLost=false,openReview=false}={}){
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
  };
  const context=vm.createContext({
    ui,document,store:{getState:()=>({tasks,members:[{id:'active',active:true},{id:'former',active:false},{id:'example',role:'Member · example'}]})},taskLinkUnavailable:false,joinWelcome:false,
    navigation:{takeInitialTaskLink:()=>({id,review}),takeJoinWelcome:()=>welcome,initial:()=>'overview'},
    window:{GatherMode:mode,GatherAccessLost:accessLost,dispatchEvent(){events.push('ready');}},Event,isLiveTeammate:()=>true,isOrganizer:()=>organizer,
    navigate(view){ui.view=view;events.push(view);},syncGuide(){},$:selector=>elements[selector],
    taskDialog(...args){if(args[7])args[7]={...args[7]};events.push(args);},
    requestAnimationFrame(fn){frames.push(fn);},focusTaskOwnerEditor(id){events.push(['owner focus',id]);},
    schedule:{firstTimeTask:(state,id)=>state.tasks.find(task=>task.id===id&&task.eventActivity&&!task.schedule&&!(task.status==='done'&&(!task.requiresVerification||task.verifiedAt)))},
    workspaceUpdatesPending:()=>updatesPending,focusTaskScheduleEditor(id,setup){events.push(['schedule focus',id,setup]);},
    openOrganizerReview(...args){events.push(['review',...args]);return openReview;},
  });
  vm.runInContext(notice+'\n'+handoffLink+'\n'+bootstrap,context);
  return {ui,events,context,document,elements,frames,pending(){updatesPending=true;},markup:()=>vm.runInContext('taskLinkNotice()',context)};
}

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
