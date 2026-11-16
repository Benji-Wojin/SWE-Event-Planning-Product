import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';
import '../legacy/schedule-ui.js';

const source=readFileSync('legacy/app.js','utf8');
const start=source.indexOf('  function taskOwnerPresentation(');
const helper=source.slice(start,source.indexOf('  function taskDialog(',start));
const optionsStart=source.indexOf('  const options =');
const ownerChoices=source.slice(optionsStart,source.indexOf('  const statusOptions =',optionsStart));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function present(task,{organizer=true,lost=false,mode,members=[{id:'dev',name:'Dev Kim',active:false}]}={}){
  const state={members,tasks:[task]},before=structuredClone(state);
  const context=vm.createContext({window:{GatherAccessLost:lost,GatherMode:mode},h});
  vm.runInContext(ownerChoices+'\n'+helper+'globalThis.present=taskOwnerPresentation;',context);
  const result=context.present(task,state,organizer);
  assert.deepEqual(state,before);return result;
}
const task=extra=>({id:'activity',owner:'dev',status:'todo',...extra});

const sharedRoster=[
  {id:'jack',name:'Fictional organizer',role:'Organizer'},
  {id:'invited',name:'Fictional <teammate>',role:'Teammate',active:true},
  {id:'legacy',name:'Lena Demo',role:'Teammate · example',active:true},
  {id:'former',name:'Fictional former member',role:'Former teammate',active:false},
];
function renderedOwnerChoices(value,{mode,all=false}={}){
  const state={members:structuredClone(sharedRoster)},before=structuredClone(state);
  const context=vm.createContext({window:{GatherMode:mode},store:{getState:()=>state},h});
  vm.runInContext(ownerChoices+'\nglobalThis.ownerChoices=ownerOptions;',context);
  const markup=context.ownerChoices(value,all);
  assert.deepEqual(state,before,'rendering does not change the roster');
  return Array.from(markup.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g),([,attrs,label])=>({
    value:attrs.match(/\bvalue="([^"]*)"/)?.[1],label,selected:/\bselected\b/.test(attrs),
  }));
}

test('real shared task owner choices exclude legacy sample and revoked actors without hiding historical ownership filters',()=>{
  const mode={projectId:'fictional-project',demo:false};
  const choices=renderedOwnerChoices('',{mode});
  assert.deepEqual(choices.map(choice=>choice.value),['','jack','invited']);
  assert.deepEqual(choices.filter(choice=>choice.selected).map(choice=>choice.value),['']);
  assert.equal(choices.find(choice=>choice.value==='invited').label,'Fictional &lt;teammate&gt;');
  const filtered=renderedOwnerChoices('legacy',{mode,all:true});
  assert.deepEqual(filtered.map(choice=>choice.value),['','unassigned','jack','invited','legacy','former']);
  assert.deepEqual(filtered.filter(choice=>choice.selected).map(choice=>choice.value),['legacy']);
});

test('editing a saved owner keeps that unavailable choice selected without offering unrelated unavailable actors',()=>{
  const mode={projectId:'fictional-project',demo:false};
  for(const [saved,other] of [['legacy','former'],['former','legacy']]){
    const choices=renderedOwnerChoices(saved,{mode});
    assert.deepEqual(choices.filter(choice=>choice.selected).map(choice=>choice.value),[saved],
      'the browser must not silently use Unassigned when saving unrelated details');
    assert.match(choices.find(choice=>choice.value===saved).label,/unavailable|example|former teammate/i);
    assert.ok(choices.some(choice=>choice.value==='invited'&&!choice.selected),'an active teammate remains available');
    assert.ok(!choices.some(choice=>choice.value===other),'the exception is only for the saved assignment');
  }
});

test('task ownership guidance identifies legacy assignments as unavailable only in real projects',()=>{
  const mode={projectId:'fictional-project',demo:false};
  const owned=task({owner:'legacy',note:'Keep the existing report context.'});
  const outcome=present(owned,{members:sharedRoster,mode});
  assert.match(outcome.name,/Lena Demo/);
  assert.match(outcome.notice,/Review task ownership/);
  assert.match(outcome.notice,/data-action="review-task-owner" data-id="activity"/);
  assert.doesNotMatch(outcome.notice,/<form|data-action="(?:claim|assign|accept-task)"/);
  const saved=present({...owned,status:'done',requiresVerification:true,verifiedAt:'2099-11-20T18:00Z'},{members:sharedRoster,mode});
  assert.equal(saved.name,outcome.name,'the completed record still shows its recorded owner');
  assert.equal(saved.notice,'','recorded completion does not prompt reassignment');
  for(const simulation of [undefined,{projectId:'fictional-demo',demo:true}]){
    const preview=present(owned,{members:sharedRoster,mode:simulation});
    assert.equal(preview.name,'Lena Demo');
    assert.equal(preview.notice,'');
    assert.deepEqual(renderedOwnerChoices('',{mode:simulation}).map(choice=>choice.value),['','jack','invited','legacy']);
  }
});

test('new activity and recovery reassignment menus use the shared project roster policy',()=>{
  const owned=task({owner:'jack',recoveryRequests:[{
    id:'request',kind:'help',status:'pending',createdBy:'jack',note:'Check who can take this on.',
  }]});
  const sampleTask=task({id:'sample-task',owner:'legacy'});
  const state={event:{timeZone:''},members:structuredClone(sharedRoster),tasks:[owned,sampleTask]};
  const before=structuredClone(state);
  const formsStart=source.indexOf('  const recovery = GatherRecoveryUI.create(');
  const forms=source.slice(formsStart,source.indexOf('  const projectInfo=',formsStart));
  const selections=markup=>Array.from(
    markup.match(/<select name="owner"[^>]*>(.*?)<\/select>/s)[1].matchAll(/<option value="([^"]*)"/g),
    option=>option[1],
  );
  for(const [mode,examples] of [
    [{projectId:'fictional-project',demo:false},[]],
    [{projectId:'fictional-demo',demo:true},['legacy']],
    [undefined,['legacy']],
  ]){
    const context=vm.createContext({window:{GatherMode:mode},store:{getState:()=>state},ui:{actor:'jack'},h,
      dayLabel:h,member:id=>state.members.find(person=>person.id===id),statusBadge:()=>'',
      GatherRecoveryUI:globalThis.GatherRecoveryUI,GatherScheduleUI:globalThis.GatherScheduleUI});
    vm.runInContext(ownerChoices+'\n'+forms+'\nglobalThis.forms={recovery,schedule};',context);
    assert.deepEqual(selections(context.forms.schedule.newActivity(state)),['','jack','invited',...examples]);
    assert.deepEqual(selections(context.forms.recovery.recoveryMarkup(owned,true)),['','invited',...examples],
      'the recovery form also excludes the task’s current owner');
    assert.deepEqual(context.forms.schedule.reviewAssignmentTasks(state,{},'owner-unavailable').map(row=>row.id),
      examples.length ? [] : ['sample-task'], 'event review routes a historical sample assignment to reassignment in a real project');
    assert.deepEqual(context.forms.schedule.reviewAcceptanceTasks(state,{actor:'legacy'}).map(row=>row.id),
      examples.length ? ['sample-task'] : [], 'event review only waits for acceptance from someone who can accept');
  }
  assert.deepEqual(state,before,'both menus only render; they do not write');
});

test('unavailable task owners are explicit and organizers get a read-only route to the existing editor',()=>{
  const result=present(task());
  assert.equal(result.name,'Dev Kim · Inactive teammate');
  assert.match(result.notice,/aria-label="Task ownership"/);assert.match(result.notice,/Review task ownership/);
  assert.match(result.notice,/assignment alone does not record acceptance/);
  assert.match(result.notice,/Changing the owner resets acceptance and Next up commitments/);
  assert.match(result.notice,/data-action="review-task-owner" data-id="activity"/);
  assert.doesNotMatch(result.notice,/<form|data-action="(?:claim|assign|accept-task|verify-task)"/);
  assert.match(source,/const organizer=isOrganizer\(\), own=task.owner===ui.actor,ownerInfo=taskOwnerPresentation\(task,taskState,organizer\)/);
  assert.match(source,/<dd>\$\{h\(ownerInfo.name\)\}<\/dd>/);assert.match(source,/\$\{ownerInfo.notice\}/);
});

test('teammates and access-lost views explain the path without organizer controls',()=>{
  for(const options of [{organizer:false},{lost:true}]){
    const result=present(task(),options);
    assert.match(result.notice,/Ask the organizer to review the owner/);
    assert.match(result.notice,/add context in the conversation/);assert.doesNotMatch(result.notice,/<button|data-action|Edit task details/);
  }
});

test('active, unassigned and resolved historical tasks do not ask for unnecessary owner changes',()=>{
  assert.equal(present(task(),{members:[{id:'dev',name:'Dev Kim'}]}).notice,'');
  assert.equal(present(task({owner:''})).name,'Unassigned');assert.equal(present(task({owner:''})).notice,'');
  for(const extra of [{status:'done'},{status:'done',requiresVerification:true,verifiedAt:'2026-11-20T18:00Z'}]){
    const result=present(task(extra));assert.equal(result.name,'Dev Kim · Inactive teammate');assert.equal(result.notice,'');
  }
  assert.match(present(task({status:'done',requiresVerification:true})).notice,/Review task ownership/);
});

test('missing owners never masquerade as Unassigned or expose IDs; pending report loss is disclosed accurately',()=>{
  const missing=present(task({owner:'PRIVATE-MISSING-ID',id:'id"<>'}));
  assert.equal(missing.name,'Assigned owner unavailable');assert.doesNotMatch(missing.notice,/PRIVATE-MISSING-ID/);
  assert.match(missing.notice,/data-id="id&quot;&lt;&gt;"/);
  assert.doesNotMatch(missing.notice,/clears this pending completion report/);
  assert.match(present(task({status:'progress',requiresVerification:true,reportedAt:'fixture'})).notice,/clears this pending completion report; review it first/);
  assert.doesNotMatch(present(task({status:'done',requiresVerification:true,reportedAt:'fixture'})).notice,/clears this pending completion report/);
  const unsafe=present(task(),{members:[{id:'dev',name:'<img src=x>',active:false}]});
  assert.equal(h(unsafe.name),'&lt;img src=x&gt; · Inactive teammate');assert.doesNotMatch(unsafe.notice,/<img|<script/);
});

test('Review owner opens and focuses only the current organizer task form, preserving drafts without writes',()=>{
  const begin=source.indexOf('  function focusTaskOwnerEditor(');
  const handler=source.slice(begin,source.indexOf('  function openAttentionOwnerReview(',begin));
  assert.match(source,/if\(action==='review-task-owner'\)focusTaskOwnerEditor\(id\)/);
  for(const mode of ['allowed','member','lost','other-dialog','other-task','stale-form','missing-form','missing-details','closed']){
    let focused=0;const details={open:false},field={value:'unsaved-owner',focus(){focused++;}};
    const form={dataset:{id:mode==='stale-form'?'other':'activity'},closest:()=>mode==='missing-details'?null:details};
    const context=vm.createContext({action:'review-task-owner',id:'activity',window:{GatherAccessLost:mode==='lost'},isOrganizer:()=>mode!=='member',
      ui:{dialogKind:mode==='other-dialog'?'other':'task',detailId:mode==='other-task'?'other':'activity'},
      focusTaskDialogControl:target=>target.focus(),
      $:(selector,root)=>selector==='#dialogBackdrop'?{hidden:mode==='closed'}:selector==='#taskDetailForm'?(mode==='missing-form'?null:form):root===form?field:null});
    vm.runInContext(handler+"\nfocusTaskOwnerEditor('activity');",context);
    assert.equal(details.open,mode==='allowed');assert.equal(focused,mode==='allowed'?1:0);assert.equal(field.value,'unsaved-owner');
  }
  assert.doesNotMatch(handler,/store\.|fetch|render\(|taskDialog\(|closeDialog\(|reset\(/);
});

test('Review overlap schedule opens only the current organizer edit form without saving or resetting it',()=>{
  const begin=source.indexOf('  function focusTaskScheduleEditor(');
  const handler=source.slice(begin,source.indexOf('  function setPlanReceiptReturn(',begin));
  assert.match(source,/if\(action==='review-overlap-schedule'\)focusTaskScheduleEditor\(id\)/);
  for(const mode of ['allowed','member','lost','other-dialog','other-task','stale-form','missing-form','missing-details','closed','settings']){
    const details={open:false},start={value:'2026-11-20T14:15'},focus=[];
    const form={dataset:{id:mode==='stale-form'?'other':'activity'},closest:()=>mode==='missing-details'?null:details};
    const dialog={},settings={};
    const context=vm.createContext({action:'review-overlap-schedule',id:'activity',window:{GatherAccessLost:mode==='lost'},isOrganizer:()=>mode!=='member',
      ui:{dialogKind:mode==='other-dialog'?'other':'task',detailId:mode==='other-task'?'other':'activity'},
      focusTaskDialogControl:(target,root)=>focus.push([target,root]),
      $:(selector,root)=>selector==='#dialog'?dialog:selector==='#dialogBackdrop'?{hidden:mode==='closed'}:
        selector==='details.task-schedule'&&mode!=='missing-details'?details:selector==='#scheduleForm'&&root===details&&!['missing-form','settings'].includes(mode)?form:
        root===form?start:root===details&&selector==='[data-action="event-context"]'?settings:null});
    vm.runInContext(handler+`\nfocusTaskScheduleEditor('activity',${mode==='settings'});`,context);
    assert.equal(details.open,['allowed','settings'].includes(mode));assert.deepEqual(focus,mode==='allowed'?[[start,dialog]]:mode==='settings'?[[settings,dialog]]:[]);
    assert.equal(start.value,'2026-11-20T14:15');
  }
  assert.doesNotMatch(handler,/store\.|fetch|render\(|taskDialog\(|closeDialog\(|reset\(/);
});
