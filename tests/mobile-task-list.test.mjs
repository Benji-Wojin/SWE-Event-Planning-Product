import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const markup=app.slice(app.indexOf('  const completionNeedsReview'),app.indexOf('  const empty ='));
const person=app.slice(app.indexOf('  const person ='),app.indexOf('  const statusBadge'));
const label=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function fixture({organizer=true,blocked=false,task={}}={}){
  const current={id:'task-123',title:'Prepare <welcome>',category:'Venue',owner:'person-1',status:'todo',...task};
  const calls=[];
  const ctx=vm.createContext({
    guideTaskId:'task-123',ui:{tab:'all',actor:'jack'},current,h:label,
    isOrganizer:()=>organizer,dependencyInfo:()=>({open:blocked?[{}]:[]}),
    latestUpdateRecord:()=>({text:'A long & useful update for the team.'}),
    updateAttribution:()=> 'Recorded by the fictional organizer',
    due:()=> 'Nov 18',timeLabel:()=> 'Nov 20',completionText:()=> 'Marked done',commitment:()=> 'Awaiting acceptance',
    statusBadge:status=>status,icon:name=>'<svg aria-hidden="true" data-icon="'+name+'"></svg>',
    member:()=>({name:'Fictional Alexandra Robertson-Wells'}),
    avatar:()=>'<span class="avatar">FA</span>',
    store:{getState:()=>({tasks:[current]}),updateTask:(_id,patch)=>calls.push(patch.status)},
    taskDialog:id=>calls.push('open:'+id),render:()=>calls.push('render'),toast:()=>{},window:{},
    action:'toggle-task',id:current.id,
  });
  vm.runInContext(person+markup,ctx);
  return {html:vm.runInContext('taskRow(current)',ctx),click(){
    const handler=app.split('\n').find(line=>line.includes("if(action==='toggle-task')"));
    vm.runInContext('(function(){'+handler+'})()',ctx);return calls;
  }};
}

test('task cards keep one semantic row with the same owner, due date, status, note and task actions',()=>{
  const {html}=fixture();
  assert.match(html,/<tr role="row" class="guide-first-task-row"/);
  for(const field of ['completion','name','owner','status','due','update','details']){
    assert.match(html,new RegExp('role="cell" class="task-cell-'+field+'" headers="tasks-'+field+'"'));
    assert.match(app,new RegExp('id="tasks-'+field+'" role="columnheader" scope="col"'));
  }
  assert.match(app,/<table class="task-table" role="table" aria-label="Task list"/);
  assert.match(app,/class="toolbar task-filter-toolbar"/);
  const css=readFileSync('legacy/lovable-ui.css','utf8');
  assert.match(css,/\.task-filter-toolbar > \.inline \{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.task-filter-toolbar \.select-input \{[^}]*min-width: 0; min-height: 44px/);
  assert.match(html,/Prepare &lt;welcome&gt;/);
  assert.match(html,/aria-label="Owner: Fictional Alexandra Robertson-Wells · Open task: Prepare &lt;welcome&gt;"/);
  assert.match(html,/class="task-owner-full">Fictional Alexandra Robertson-Wells/);
  assert.match(html,/class="task-card-label" aria-hidden="true">Due/);
  assert.match(html,/A long &amp; useful update for the team/);
  assert.match(html,/aria-label="Open task: Prepare &lt;welcome&gt;"[^>]*>[\s\S]*?class="task-card-open" aria-hidden="true">Open task/);
  assert.equal((html.match(/data-action="toggle-task"/g)||[]).length,1);
  assert.doesNotMatch(html,/<welcome>/);
});

test('read-only and review-required rows show inspection, not a misleading empty checkbox',()=>{
  for(const [options,verb] of [[{organizer:false},'View'],[{blocked:true},'Review'],[{task:{requiresVerification:true}},'Review']]){
    const row=fixture(options);
    assert.match(row.html,/class="icon-button task-inspect-button" data-action="task"/);
    assert.doesNotMatch(row.html,/data-action="toggle-task"/);
    assert.match(row.html,new RegExp('aria-label="'+verb+' Prepare &lt;welcome&gt;"'));
    assert.deepEqual(row.click(),['open:task-123']);
  }
  const ordinary=fixture();
  assert.match(ordinary.html,/class="check-button"/);
  assert.deepEqual(ordinary.click(),['done','render']);
  const finished=fixture({blocked:true,task:{status:'done',requiresVerification:true}});
  assert.match(finished.html,/class="check-button checked"/);
  assert.deepEqual(finished.click(),['todo','render']);
});
