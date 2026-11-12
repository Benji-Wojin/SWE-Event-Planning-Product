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
    document:{activeElement:{}},guidedWorkspace:true,
    window:{GatherMode:{projectId:'p_fictional',projectUrl:()=>'/project?project=p_fictional'}},h:String,
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
  guide.context.guideProgress.events.push({checkpoint:'add_task_clicked'});guide.paint();
  assert.equal(guide.changes(),1);assert.equal(guide.focuses(),1);
  guide.context.guideProgress.events.push({checkpoint:'task_created'});guide.paint();
  assert.match(guide.html(),/Step 3 of 5/);assert.match(guide.html(),/No amounts are required/);
  assert.equal(guide.changes(),2);assert.equal(guide.focuses(),2);
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

test('guided task form keeps the same save path with only the required title input',()=>{
  const start=source.indexOf('  function newTaskDialog('), end=source.indexOf('  function followupDialog',start);
  let body;
  const context=vm.createContext({canCreateTasks:()=>true,guidedWorkspace:true,openDialog:(_title,markup)=>{body=markup;}});
  vm.runInContext(source.slice(start,end)+'newTaskDialog(true);',context);
  assert.match(body,/id="newTaskForm"/);assert.match(body,/name="title" required/);assert.match(body,/Save first task/);
  assert.doesNotMatch(body,/<select|name="dueDate"|<textarea/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.workspace-guide\{[^}]*padding:clamp\(18px/);
  assert.match(css,/\.workspace-guide-actions \.btn,\.workspace-guide-pause\{min-height:44px/);
});
