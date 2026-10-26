import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const start=source.indexOf('  function taskOwnerPresentation(');
const helper=source.slice(start,source.indexOf('  function taskDialog(',start));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function present(task,{organizer=true,lost=false,members=[{id:'dev',name:'Dev Kim',active:false}]}={}){
  const state={members,tasks:[task]},before=structuredClone(state);
  const context=vm.createContext({window:{GatherAccessLost:lost},h});
  vm.runInContext(helper+'globalThis.present=taskOwnerPresentation;',context);
  const result=context.present(task,state,organizer);
  assert.deepEqual(state,before);return result;
}
const task=extra=>({id:'activity',owner:'dev',status:'todo',...extra});

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
  const begin=source.indexOf("      if(action==='review-task-owner'");
  const handler=source.slice(begin,source.indexOf("      if(action==='quick-tour'",begin));
  for(const mode of ['allowed','member','lost','other-dialog','other-task','stale-form','missing-form','missing-details']){
    let focused=0;const details={open:false},field={value:'unsaved-owner',focus(){focused++;}};
    const form={dataset:{id:mode==='stale-form'?'other':'activity'},closest:()=>mode==='missing-details'?null:details};
    const context=vm.createContext({action:'review-task-owner',id:'activity',window:{GatherAccessLost:mode==='lost'},isOrganizer:()=>mode!=='member',
      ui:{dialogKind:mode==='other-dialog'?'other':'task',detailId:mode==='other-task'?'other':'activity'},
      $:(selector,root)=>selector==='#taskDetailForm'?(mode==='missing-form'?null:form):root===form?field:null});
    vm.runInContext(handler,context);
    assert.equal(details.open,mode==='allowed');assert.equal(focused,mode==='allowed'?1:0);assert.equal(field.value,'unsaved-owner');
  }
  assert.doesNotMatch(handler,/store\.|fetch|render\(|taskDialog\(|closeDialog\(|reset\(/);
});
