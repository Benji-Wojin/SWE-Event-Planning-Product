import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/wrap-up.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const row=(id,extra={})=>({id,title:id,owner:'maya',status:'todo',...extra});
const state=tasks=>({event:{name:'School dance',date:'2026-11-06'},members:[{id:'jack',name:'Jack'},{id:'maya',name:'Maya'},{id:'old',name:'Former teammate',active:false}],tasks});
const ids=groups=>Object.fromEntries(groups.map(group=>[group.key,group.tasks.map(task=>task.id)]));

test('wrap-up partitions all saved tasks once, distinguishing pending verification from recorded completion',()=>{
  const s=state([row('todo'),row('blocked',{status:'blocked'}),row('progress',{status:'progress'}),
    row('reported',{status:'progress',requiresVerification:true,reportedAt:'2026-11-06T20:00Z'}),
    row('legacy-done',{status:'done',requiresVerification:true}),row('verified',{status:'done',requiresVerification:true,verifiedAt:'2026-11-06T20:30Z',verifiedBy:'jack'}),row('done',{status:'done'})]);
  const before=structuredClone(s),groups=GatherWrapUp.groups(s);
  assert.deepEqual(ids(groups),{open:['todo','blocked','progress'],verification:['reported','legacy-done'],completed:['verified','done']});
  assert.equal(new Set(groups.flatMap(g=>g.tasks.map(t=>t.id))).size,7);assert.deepEqual(s,before);
});
test('My tasks never includes other owners or unassigned work; empty personal scope is not an event all-clear',()=>{
  const s=state([row('mine'),row('other',{owner:'jack'}),row('unassigned',{owner:''}),row('done',{owner:'maya',status:'done'})]);
  assert.deepEqual(ids(GatherWrapUp.groups(s,{mine:true,actor:'maya'})),{open:['mine'],verification:[],completed:['done']});
  for(const actor of ['',undefined,'absent'])assert.equal(GatherWrapUp.groups(s,{mine:true,actor}).flatMap(g=>g.tasks).length,0);
  const html=GatherWrapUp.markup(s,{h,scope:{mine:true,actor:'absent'}});
  assert.match(html,/No tasks assigned to you/);assert.match(html,/does not mean the whole event is finished/);assert.doesNotMatch(html,/>other<|>mine</);
});
test('rendered review lists all completions, projects safe facts, escapes data, and uses existing task actions only',()=>{
  const s=state(Array.from({length:8},(_,i)=>row('done-'+i,{status:'done',completedBy:'maya',completedAt:'2026-11-06T20:00Z'})));
  s.tasks.push(row('id"<>',{title:'<img src=x>',owner:'missing',note:'PRIVATE_NOTE',comments:[{text:'PRIVATE_COMMENT'}],completionEvidence:[{url:'PRIVATE_EVIDENCE'}]}));
  s.messages=[{subject:'PRIVATE_MAIL'}];s.guests=[{name:'PRIVATE_GUEST'}];s.privateRecords=[{reference:'PRIVATE_BOOKING'}];
  const before=structuredClone(s),html=GatherWrapUp.markup(s,{h});
  for(let i=0;i<8;i++)assert.ok(html.includes('data-id="done-'+i+'"'));
  assert.match(html,/data-id="id&quot;&lt;&gt;"/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/Unavailable owner/);
  assert.doesNotMatch(html,/<img|PRIVATE_|data-action="(?:verify-task|toggle-task|claim|copy)|<form|100%|All clear/);
  assert.deepEqual(s,before);assert.match(html,/Recorded completions/);assert.match(html,/not an event-success score/);
});
test('membership and completion attribution remain truthful when owners leave or verification is pending',()=>{
  const s=state([row('old',{owner:'old'}),row('missing',{owner:'gone'}),row('unassigned',{owner:''}),
    row('done',{status:'done',completedBy:'gone'}),row('verified',{status:'done',requiresVerification:true,verifiedBy:'jack',verifiedAt:'2026-11-06T20:00Z'}),
    row('pending',{status:'done',requiresVerification:true,verifiedBy:'jack'})]);
  const html=GatherWrapUp.markup(s,{h});
  assert.match(html,/Former teammate · inactive/);assert.match(html,/Unavailable owner/);assert.match(html,/Unassigned/);
  assert.match(html,/Verified by Jack/);assert.match(html,/Completion recorded by an unavailable member/);
  assert.equal((html.match(/Verified by Jack/g)||[]).length,1,'pending legacy record is not claimed verified');
});
test('amended completion evidence is called out without silently reopening a completed task or exposing evidence',()=>{
  const store=GatherStore.createStore({storage:null});
  const item=store.addTask({title:'Return the hall keys',owner:'maya',requiresVerification:true});
  store.reportCompletion(item.id,'Keys returned.','maya');store.verifyTask(item.id,'jack');
  assert.doesNotMatch(GatherWrapUp.markup(store.getState(),{h}),/Evidence amended after verification/);
  store.setCompletionEvidence(item.id,{note:'PRIVATE new handover details'},'maya');
  const before=store.exportState(),html=GatherWrapUp.markup(store.getState(),{h});
  assert.match(html,/Evidence amended after verification — open to review/);assert.doesNotMatch(html,/PRIVATE/);
  assert.ok(GatherWrapUp.groups(store.getState()).find(g=>g.key==='completed').tasks.some(task=>task.id===item.id));assert.equal(store.exportState(),before);
});
test('real task reporting and organizer verification update wrap-up without inferring status from dates',()=>{
  const store=GatherStore.createStore({storage:null});store.completeSetup({name:'Corporate summit',date:'2020-01-01'});
  const item=store.addTask({title:'Return borrowed equipment',owner:'maya',requiresVerification:true});
  const group=()=>GatherWrapUp.groups(store.getState()).find(g=>g.tasks.some(t=>t.id===item.id)).key;
  assert.equal(group(),'open');const before=store.exportState();GatherWrapUp.markup(store.getState(),{h});assert.equal(store.exportState(),before);
  store.acceptTask(item.id,'maya');store.reportCompletion(item.id,'All borrowed equipment returned.','maya');assert.equal(group(),'verification');
  assert.throws(()=>store.verifyTask(item.id,'maya'));assert.equal(group(),'verification');
  store.verifyTask(item.id,'jack');assert.equal(group(),'completed');
  const saved=store.exportState(),reloaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}});
  assert.ok(GatherWrapUp.groups(reloaded.getState()).find(g=>g.key==='completed').tasks.some(t=>t.id===item.id));
});
test('empty plans stay explicit, and no event rating is selected on the lesson form',()=>{
  const html=GatherWrapUp.markup(state([]),{h});assert.match(html,/No tasks in this plan/);assert.match(html,/does not certify/);
  const source=readFileSync('legacy/app.js','utf8'),form=source.slice(source.indexOf('  function feedbackDialog()'),source.indexOf('  function thoughtDialog()'));
  assert.match(form,/repeat or do differently/);assert.match(form,/Not rated/);assert.doesNotMatch(form,/\],'4'\)/);
  assert.match(source,/memory:'Wrap up'/);assert.match(readFileSync('legacy/index.html','utf8'),/data-view="memory"[^\n]*Wrap up/);
});
test('hosted and local entry points load the versioned wrap-up renderer and preserve the memory deep link',()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const html=readFileSync('public/workspace.html','utf8');assert.match(html,/\/gather-assets\/versioned\/[a-f0-9]{20}-wrap-up\.js/);
  const app=readFileSync('public/gather-assets/app.js','utf8');assert.match(app,/GatherWrapUp\.markup\(/);assert.match(app,/action==='wrap-up-scope'/);
  assert.match(readFileSync('legacy/navigation.js','utf8'),/'memory'/);
});
