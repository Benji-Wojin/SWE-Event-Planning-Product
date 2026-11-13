import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const renderer=source.slice(source.indexOf('  const guideSteps'),source.indexOf('  function syncGuide'));
function fixture(checkpoints,{bound=true,focused=false,error=false}={}){
  let changes=0,focuses=0,markup='';
  const host={hidden:true,dataset:{},contains:()=>focused,set innerHTML(value){changes++;markup=value;}};
  const context=vm.createContext({
    $:selector=>selector==='#workspaceGuide'?host:{focus(){focuses++;}},
    document:{activeElement:{}},guidedWorkspace:true,guideTaskId:'',
    window:{GatherMode:{projectId:'p_fictional',projectUrl:path=>path+'?project=p_fictional'}},
    h:value=>value.replaceAll('&','&amp;'),icon:()=>'<svg aria-hidden="true"></svg>',
    guideProgress:{projectId:bound?'p_fictional':'p_other',events:checkpoints.map(checkpoint=>({checkpoint}))},guideError:error,
  });
  vm.runInContext(renderer,context);
  return {host,paint:()=>vm.runInContext('paintGuide()',context),html:()=>markup,changes:()=>changes,focuses:()=>focuses,context};
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
  assert.match(guide.html(),/Optional walkthrough[\s\S]*Draft the rest of your plan with AI/);
  assert.match(guide.html(),/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
  assert.match(guide.html(),/won’t send anything to AI or change your project/);
  assert.match(guide.html(),/Find the plan builder later in <strong>Overview/);
  assert.equal(guide.changes(),2);assert.equal(guide.focuses(),2);
  guide.context.guideProgress.events.push({checkpoint:'budget_viewed'});guide.paint();
  assert.match(guide.html(),/Step 4 of 5/);
  assert.match(guide.html(),/Open Event info[\s\S]*<section[^>]+aria-labelledby="workspaceGuidePlanTitle"/);
  assert.match(guide.html(),/href="\/plan\?project=p_fictional&amp;guide=1" target="_top">Try drafting a plan with AI/);
  guide.context.guideProgress.events.push({checkpoint:'event_details_viewed'});guide.paint();
  assert.match(guide.html(),/Step 5 of 5[\s\S]*Invite a teammate/);
  assert.doesNotMatch(guide.html(),/workspaceGuidePlanTitle/);
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

test('the finished solo state never represents an invitation as sent, and unrelated projects show no guide',()=>{
  const steps=['started','project_created','task_created','budget_viewed','event_details_viewed'];
  const last=fixture(steps);last.paint();
  assert.match(last.html(),/Finish without inviting/);
  const finished=fixture([...steps,'invite_skipped']);finished.paint();
  assert.match(finished.html(),/data-guide-state="skipped"[\s\S]*Invite/);
  assert.match(finished.html(),/invite a teammate later/);
  assert.match(finished.html(),/Back to planning/);
  assert.doesNotMatch(finished.html(),/invitation is ready/);
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
  const start=source.indexOf('  function guideTaskPanel'),end=source.indexOf('  function assignmentCandidates',start);
  const first={id:'first',title:'<Confirm the venue>',status:'todo'},other={id:'other',title:first.title,status:'todo'};
  const focus=[];
  const heading={focus:()=>focus.push('heading'),scrollIntoView(){}};
  const control={dataset:{id:'first'},focus:()=>focus.push('completion'),scrollIntoView(){}};
  const ui={tab:'mine',taskView:'map',owner:'someone',search:'else',view:'overview'};
  const context=vm.createContext({guideTaskId:'first',guideTaskNeedsReveal:false,ui,window:{},
    store:{getState:()=>({tasks:[other,first]})},navigate:view=>{ui.view=view;return true;},render(){},
    $:()=>heading,$$:()=>[{dataset:{id:'other'}},control],h:value=>value.replaceAll('<','&lt;').replaceAll('>','&gt;'),
    icon:()=>'',statusBadge:value=>value,
  });
  vm.runInContext(source.slice(start,end),context);
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
