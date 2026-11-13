import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const notice=part('  function taskLinkNotice()', '  function tasksView(s)');
const bootstrap=part('  const {id:initialTask,review:initialTaskReview}=navigation.takeInitialTaskLink();', "  if((!window.GatherMode||window.GatherMode.demo)&&ui.view");
function land(id,tasks,{welcome=false,review='',organizer=false,mode,accessLost=false,openReview=false}={}){
  const events=[];
  const ui={tab:'mine'};
  const elements={
    '#taskLinkUnavailableTitle':{focus(){events.push('notice focus');},scrollIntoView(){events.push('notice visible');}},
    '#taskLinkNotice':{remove(){events.push('dismissed');}},
    '#taskSearch':{focus(){events.push('search focus');}},
    '#viewRoot':{querySelector(){return {
      scrollIntoView(options){assert.equal(options.block,'center');assert.equal(options.inline,'nearest');assert.equal(options.behavior,'instant');events.push('opener visible');},
      focus(options){assert.equal(options.preventScroll,true);events.push('opener focus');},
    };}},
    '#workspaceHandoffTitle':{focus(){events.push('welcome focus');}},
  };
  const context=vm.createContext({
    ui,store:{getState:()=>({tasks})},taskLinkUnavailable:false,joinWelcome:false,
    navigation:{takeInitialTaskLink:()=>({id,review}),takeJoinWelcome:()=>welcome,initial:()=>'overview'},
    window:{GatherMode:mode,GatherAccessLost:accessLost,dispatchEvent(){events.push('ready');}},Event,isLiveTeammate:()=>true,isOrganizer:()=>organizer,
    navigate(view){ui.view=view;events.push(view);},syncGuide(){},$:selector=>elements[selector],
    taskDialog(...args){events.push(args);},
    openOrganizerReview(...args){events.push(['review',...args]);return openReview;},
  });
  vm.runInContext(notice+'\n'+bootstrap,context);
  return {ui,events,context,markup:()=>vm.runInContext('taskLinkNotice()',context)};
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
