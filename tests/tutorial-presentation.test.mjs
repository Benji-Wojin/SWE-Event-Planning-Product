import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const renderer=source.slice(source.indexOf('  const guideSteps'),source.indexOf('  function syncGuide'));
const taskRenderer=source.slice(source.indexOf('  function guideTaskPanel'),source.indexOf('  function assignmentCandidates'));
function fixture(checkpoints,{bound=true,focused=false,error=false,view='overview',organizer=true,guided=true,tasks=[]}={}){
  let changes=0,focuses=0,markup='';
  const host={hidden:true,dataset:{},contains:()=>focused,set innerHTML(value){changes++;markup=value;}};
  const state={tasks},ui={view},role={organizer};
  const context=vm.createContext({
    $:selector=>selector==='#workspaceGuide'?host:{focus(){focuses++;}},
    document:{activeElement:{}},guidedWorkspace:guided,guideTaskId:'',ui,isOrganizer:()=>role.organizer,store:{getState:()=>state},
    window:{GatherMode:{projectId:'p_fictional',projectUrl:path=>path+'?project=p_fictional'}},
    h:value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'<svg aria-hidden="true"></svg>',statusBadge:value=>value,
    guideProgress:{projectId:bound?'p_fictional':'p_other',events:checkpoints.map(checkpoint=>({checkpoint}))},guideError:error,
  });
  vm.runInContext(renderer+taskRenderer,context);
  return {host,ui,state,role,paint:()=>vm.runInContext('paintGuide()',context),html:()=>markup,
    task:(away=false)=>vm.runInContext(`guideTaskPanel(store.getState(),${away})`,context),changes:()=>changes,focuses:()=>focuses,context};
}

test('workspace guide makes saved progress visible and preserves focus on telemetry-only changes',()=>{
  const guide=fixture(['started','project_created'],{focused:true});guide.paint();
  assert.equal(guide.host.hidden,false);
  assert.match(guide.html(),/Step 2 of 5/);
  assert.match(guide.html(),/Add your first task/);
  assert.match(guide.html(),/data-action="guide-add-task"/);
  assert.match(guide.html(),/data-guide-state="done"[\s\S]*Project/);
  assert.match(guide.html(),/data-guide-state="current" aria-current="step"[\s\S]*Task/);
  assert.match(guide.html(),/Finish later/);
  assert.doesNotMatch(guide.html(),/workspaceGuidePlanTitle/);
  guide.context.guideProgress.events.push({checkpoint:'add_task_clicked'});guide.paint();
  assert.equal(guide.changes(),1);assert.equal(guide.focuses(),1);
  guide.context.guideProgress.events.push({checkpoint:'task_created'});guide.paint();
  assert.match(guide.html(),/Step 3 of 5/);assert.match(guide.html(),/No amounts are required/);
  assert.match(guide.html(),/Open Budget[\s\S]*<section[^>]+aria-labelledby="workspaceGuidePlanTitle"/);
  assert.match(guide.html(),/Optional walkthrough[\s\S]*Draft a plan with AI/);
  assert.match(guide.html(),/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
  assert.match(guide.html(),/won’t send anything to AI or change your project/);
  assert.match(guide.html(),/You can skip this and come back from <strong>Overview → Build a plan/);
  assert.equal(guide.changes(),2);assert.equal(guide.focuses(),2);
  guide.context.guideProgress.events.push({checkpoint:'budget_viewed'});guide.paint();
  assert.match(guide.html(),/Step 4 of 5/);
  assert.match(guide.html(),/Open Event info[\s\S]*<section[^>]+aria-labelledby="workspaceGuidePlanTitle"/);
  assert.match(guide.html(),/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
  guide.context.guideProgress.events.push({checkpoint:'event_details_viewed'});guide.paint();
  assert.match(guide.html(),/Step 5 of 5[\s\S]*Invite a teammate/);
  assert.match(guide.html(),/Open invitation form[\s\S]*<section[^>]+aria-labelledby="workspaceGuidePlanTitle"/);
  assert.match(guide.html(),/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
});

test('a committed task does not offer to create a duplicate while progress reloads',()=>{
  const guide=fixture(['started','project_created','add_task_clicked']);guide.paint();
  guide.context.guideTaskId='task_saved';guide.paint();
  assert.match(guide.html(),/Your first task is saved/);
  assert.match(guide.html(),/Loading the next guide step/);
  assert.doesNotMatch(guide.html(),/guide-add-task|workspaceGuidePlanTitle/);
  guide.context.guideProgress.events.push({checkpoint:'task_created'});guide.paint();
  assert.match(guide.html(),/Open Budget/);
});

test('the saved first task shows the optional planner inline before progress settles and does not duplicate it after',()=>{
  const first={id:'task_saved',title:'<Confirm venue>',status:'todo'};
  const guide=fixture(['started','project_created','add_task_clicked'],{view:'tasks',tasks:[first]});
  guide.paint();
  assert.doesNotMatch(guide.task(),/guideTaskPlanTitle/);
  guide.context.guideTaskId=first.id;
  guide.paint();
  assert.match(guide.html(),/Your first task is saved/);
  assert.doesNotMatch(guide.html(),/guide-add-task|workspaceGuidePlanTitle/);
  const inline=guide.task();
  assert.match(inline,/id="guideTaskSaved"[^>]*>&lt;Confirm venue&gt;/);
  assert.match(inline,/Open task details[\s\S]*aria-labelledby="guideTaskPlanTitle"[\s\S]*id="guideTaskPlanTitle"[\s\S]*guide-task-practice/);
  assert.match(inline,/<ol class="workspace-guide-plan-steps" aria-label="How AI plan drafting works">[\s\S]*Write a short brief[\s\S]*Generate a private draft[\s\S]*Groq[\s\S]*starter checklist without AI[\s\S]*Choose what to add[\s\S]*Shared tasks[\s\S]*Timeline[\s\S]*<\/ol>/);
  assert.match(inline,/<a id="guideTaskPlanTitleLink"/);
  assert.match(inline,/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
  assert.match(inline,/private draft[\s\S]*Opening the planner won’t send anything to AI or change your project/);
  assert.doesNotMatch(guide.task(true),/guideTaskPlanTitle/);

  guide.context.guideProgress.events.push({checkpoint:'task_created'});
  guide.paint();
  assert.match(guide.html(),/Step 3 of 5[\s\S]*Open Budget/);
  assert.doesNotMatch(guide.html(),/workspaceGuidePlanTitle/);
  assert.match(guide.task(),/guideTaskPlanTitle/);
  const beforeNavigation=guide.changes();
  guide.ui.view='budget';guide.paint();
  assert.match(guide.html(),/Step 3 of 5[\s\S]*aria-labelledby="workspaceGuidePlanTitle"/);
  assert.match(guide.html(),/data-action="guide-task-reveal">Review your first task/);
  assert.equal(guide.changes(),beforeNavigation+1,'a view change can repaint the placement without a new checkpoint');
  assert.doesNotMatch(guide.task(true),/guideTaskPlanTitle/);
  guide.ui.view='tasks';guide.paint();
  assert.doesNotMatch(guide.html(),/workspaceGuidePlanTitle/);
  assert.doesNotMatch(guide.html(),/data-action="guide-task-reveal"/);
  assert.match(guide.task(),/guideTaskPlanTitle/);
});

test('missing saved-task context falls back to the top guide; unrelated accounts and projects never get an inline planner',()=>{
  const first={id:'task_saved',title:'Confirm venue',status:'todo'}, checkpoints=['started','project_created','task_created'];
  const fallback=fixture(checkpoints,{view:'tasks',tasks:[first]});fallback.paint();
  assert.match(fallback.html(),/workspaceGuidePlanTitle/);
  assert.doesNotMatch(fallback.task(),/guideTaskPlanTitle/);
  fallback.context.guideTaskId=first.id;
  fallback.paint();
  assert.doesNotMatch(fallback.html(),/workspaceGuidePlanTitle/);
  fallback.state.tasks=[];fallback.paint();
  assert.match(fallback.html(),/workspaceGuidePlanTitle/);
  assert.doesNotMatch(fallback.task(),/guideTaskPlanTitle/);

  for(const options of [{bound:false},{organizer:false},{guided:false}]){
    const excluded=fixture(checkpoints,{view:'tasks',tasks:[first],...options});
    excluded.context.guideTaskId=first.id;
    excluded.paint();
    assert.equal(excluded.host.hidden,true);
    assert.doesNotMatch(excluded.task(),/guideTaskPlanTitle/);
  }
  const unavailable=fixture(checkpoints,{view:'overview',tasks:[first]});
  unavailable.context.guideTaskId=first.id;
  unavailable.paint();
  assert.match(unavailable.html(),/workspaceGuidePlanTitle/);
  unavailable.context.window.GatherAccessLost=true;
  unavailable.paint();
  assert.equal(unavailable.host.hidden,true);
  unavailable.ui.view='tasks';
  assert.doesNotMatch(unavailable.task(),/guideTaskPlanTitle/);
});

test('a known exact saved task retains the optional planner after guide completion',()=>{
  const first={id:'task_saved',title:'Confirm venue',status:'todo'};
  const steps=['started','project_created','task_created','budget_viewed','event_details_viewed','invite_created'];
  const guide=fixture(steps,{view:'tasks',tasks:[first]});
  guide.paint();
  assert.match(guide.html(),/Getting started · Complete/);
  assert.doesNotMatch(guide.html(),/workspaceGuidePlanTitle/);
  assert.doesNotMatch(guide.task(),/guideTaskPlanTitle/);
  guide.context.guideTaskId=first.id;
  assert.match(guide.task(),/guideTaskPlanTitle/);
  guide.role.organizer=false;
  guide.paint();
  assert.equal(guide.host.hidden,true);
  assert.doesNotMatch(guide.task(),/guideTaskPlanTitle/);
});

test('the finished solo state never represents an invitation as sent, and unrelated projects show no guide',()=>{
  const steps=['started','project_created','task_created','budget_viewed','event_details_viewed'];
  const last=fixture(steps);last.paint();
  assert.match(last.html(),/Finish without inviting/);
  const finished=fixture([...steps,'invite_skipped']);finished.paint();
  assert.match(finished.html(),/data-guide-state="skipped"[\s\S]*Invite/);
  assert.match(finished.html(),/invite a teammate later/);
  assert.match(finished.html(),/Back to planning/);
  assert.doesNotMatch(finished.html(),/invitation is ready|workspaceGuidePlanTitle/);
  const unrelated=fixture(steps,{bound:false});unrelated.paint();
  assert.equal(unrelated.host.hidden,true);assert.equal(unrelated.changes(),0);
});

test('guided task form teaches where tasks go and saves the normal optional fields',()=>{
  const start=source.indexOf('  function newTaskDialog('), end=source.indexOf('  function followupDialog',start);
  let body;
  const context=vm.createContext({canCreateTasks:()=>true,guidedWorkspace:true,ownerOptions:()=>'<option>Unassigned</option>',options:()=>'<option>Guest care</option>',openDialog:(_title,markup)=>{body=markup;}});
  vm.runInContext(source.slice(start,end)+'newTaskDialog(true);',context);
  assert.match(body,/id="newTaskForm" data-guide-task="true"/);assert.match(body,/name="title" required/);assert.match(body,/Save first task/);
  assert.match(body,/Shared tasks → All tasks/);assert.match(body,/<strong>To do<\/strong>/);
  assert.match(body,/<details[^>]*><summary>Add optional details/);
  for (const name of ['owner','dueDate','category','scope','note']) assert.match(body,new RegExp('name="'+name+'"'));
  assert.equal((body.match(/\brequired\b/g)||[]).length,1);
  assert.doesNotMatch(body,/name="status"/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.workspace-guide\{[^}]*padding:clamp\(18px/);
  assert.match(css,/\.workspace-guide-actions \.btn,\.workspace-guide-pause\{min-height:44px/);
});

test('first-task walkthrough targets the returned task and offers optional real controls',()=>{
  const first={id:'first',title:'<Confirm the venue>',status:'todo'},other={id:'other',title:first.title,status:'todo'};
  const focus=[];
  const heading={focus:()=>focus.push('heading'),scrollIntoView(){}};
  const control={dataset:{id:'first'},focus:()=>focus.push('completion'),scrollIntoView(){}};
  const ui={tab:'mine',taskView:'map',owner:'someone',search:'else',view:'overview'};
  const context=vm.createContext({guideTaskId:'first',guideTaskNeedsReveal:false,ui,
    guideProgress:{projectId:'p_fictional'},window:{GatherMode:{projectId:'p_fictional',projectUrl:path=>path+'?project=p_fictional'}},
    store:{getState:()=>({tasks:[other,first]})},navigate:view=>{ui.view=view;return true;},render(){},
    $:()=>heading,$$:()=>[{dataset:{id:'other'}},control],h:value=>value.replaceAll('<','&lt;').replaceAll('>','&gt;'),
    icon:()=>'',statusBadge:value=>value,guidedWorkspace:true,isOrganizer:()=>true,
  });
  vm.runInContext(renderer+taskRenderer,context);
  const html=vm.runInContext('guideTaskPanel(store.getState())',context);
  assert.match(html,/&lt;Confirm the venue&gt;/);
  assert.match(html,/data-action="task" data-id="first"/);
  assert.match(html,/data-action="guide-task-completion"/);
  assert.match(html,/data-action="guide-task-links" data-id="first"/);
  assert.match(html,/These actions are optional/);
  assert.doesNotMatch(html,/data-id="other"/);
  vm.runInContext('revealGuideTask();revealGuideTask(true);',context);
  assert.deepEqual(focus,['heading','completion']);
  assert.equal(ui.view,'tasks');assert.equal(ui.tab,'all');assert.equal(ui.taskView,'list');assert.equal(ui.search,'');
});

test('Review your first task protects unsaved Inbox work before leaving for Shared tasks',async()=>{
  const start=source.indexOf("  document.addEventListener('click',async event=>{");
  const end=source.indexOf("      if(action==='guide-task-links')",start);
  const protectionStart=source.indexOf('  function hasUnsavedFields(');
  const protectionEnd=source.indexOf('  function confirmCloseDialog(',protectionStart);
  assert.ok(start>=0&&end>start&&protectionStart>=0&&protectionEnd>protectionStart);
  const input={type:'text',value:'Fictional edited proposal',defaultValue:'Fictional original proposal'};
  const form={};let allow=false,click;const calls=[];
  const ui={view:'inbox',pendingSave:false},button={dataset:{action:'guide-task-reveal'},closest:()=>null};
  vm.runInNewContext(source.slice(protectionStart,protectionEnd)+source.slice(start,end)+'}finally{release();}});',{
    ui,$:selector=>selector==='#emailReviewForm'?form:null,
    $$(selector,root){assert.equal(selector,'input,textarea,select');assert.equal(root,form);return [input];},
    document:{addEventListener(type,fn){assert.equal(type,'click');click=fn;}},
    window:{confirm(message){assert.match(message,/Discard your unsaved changes/);calls.push('confirm');return allow;}},
    revealGuideTask(focusCompletion){assert.equal(focusCompletion,false);calls.push('reveal');ui.view='tasks';},
  });
  const review=()=>click({target:{closest:()=>button}});
  await review();assert.deepEqual(calls,['confirm']);assert.equal(ui.view,'inbox');assert.equal(input.value,'Fictional edited proposal');
  allow=true;
  await review();assert.deepEqual(calls,['confirm','confirm','reveal']);assert.equal(ui.view,'tasks');
});
