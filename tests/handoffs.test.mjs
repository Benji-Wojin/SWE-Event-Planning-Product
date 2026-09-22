import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/store.js';
const setup=()=>{const store=GatherStore.createStore({storage:null});const parent=store.addTask({title:'Prepare welcome desk',owner:'dev',status:'progress'});return {store,id:parent.id};};
const task=(store,id)=>store.getState().tasks.find(t=>t.id===id);
const pending=(store,id)=>task(store,id).handoffs.filter(item=>item.status==='pending');
const report=(store,id,note,status='progress')=>store.updateTask(id,{status,note},'dev');

test('progress and comments suggest concrete requests and owners without creating or assigning tasks',()=>{
 for(const [text,title,owner] of [
  ['I need Jules to print the name badges.','Print the name badges','jules'],
  ['Maya needs to review the slides before I can continue.','Review the slides','maya'],
  ['Jules, please print name badges.','Print name badges','jules'],
  ['Could Dev review the seating plan?','Review the seating plan','dev'],
  ['Maya told me Jack needs to approve the budget.','Approve the budget','jack'],
  ['I need someone else to order name badges.','Order name badges',''],
 ])for(const source of ['note','comment']){
  const {store,id}=setup(),count=store.getState().tasks.length;
  if(source==='note')report(store,id,text);else store.addComment(id,text,'maya');
  const suggestions=pending(store,id);assert.equal(suggestions.length,1,text);assert.equal(suggestions[0].title,title);assert.equal(suggestions[0].owner,owner);
  assert.equal(store.getState().tasks.length,count);assert.equal(task(store,id).dependencies.length,0);assert.equal(task(store,id).status,'progress');
 }
});

test('negative, completed, conditional and self requests do not suggest work; independent requests stay separate',()=>{
 for(const note of ['We no longer need Jules to print the badges.','Jules does not need to print the badges.','Maya has already reviewed the slides.','If Maya has time, she could review the slides.','I need to print the badges myself.']){
  const {store,id}=setup();report(store,id,note);assert.equal(pending(store,id).length,0,note);
 }
 const {store,id}=setup();report(store,id,'We do not need dietary restrictions. Jules needs to print the badges, and Maya needs to approve the guest list.');
 assert.deepEqual(pending(store,id).map(s=>s.owner),['jules','maya']);
 report(store,id,'I need Jules to print the name badges and welcome sheets.');assert.equal(pending(store,id)[0].title,'Print the name badges and welcome sheets');
});

test('rephrased requests deduplicate across updates, comments, reload and dismissal; cancelled requests retire only suggestions',()=>{
 const {store,id}=setup();report(store,id,'I need Jules to print the name badges.');const first=pending(store,id)[0];
 store.addComment(id,'Also still need Jules to print name badges.','dev');assert.equal(pending(store,id).length,1);assert.equal(pending(store,id)[0].id,first.id);
 let raw=store.exportState();const loaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v}});
 loaded.resolveHandoff(id,first.id,{action:'dismiss'},'dev');report(loaded,id,'Also need Jules to print the name badges.');assert.equal(pending(loaded,id).length,0);
 store.addComment(id,'We no longer need Jules to print name badges.','dev');assert.equal(pending(store,id).length,0);assert.equal(task(store,id).dependencies.length,0);
});

test('create requires ownership confirmation, is idempotent and preserves progress; results return to the source',()=>{
 const {store,id}=setup();report(store,id,'I need Jules to print the name badges.');const suggestion=pending(store,id)[0],before=store.exportState();
 assert.throws(()=>store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'},'dev'),/organizer/);assert.equal(store.exportState(),before);
 assert.throws(()=>store.resolveHandoff(id,suggestion.id,{action:'dismiss'},'maya'),/owner/);
 const created=store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'},'jack');assert.equal(created.owner,'jules');assert.equal(created.acceptedAt,'');
 const count=store.getState().tasks.length;assert.equal(store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'},'jack').id,created.id);assert.equal(store.getState().tasks.length,count);
 assert.equal(task(store,id).status,'progress');store.acceptTask(created.id,'jules');store.reportCompletion(created.id,'Badges are printed and at the welcome desk.','jules');
 assert.ok(task(store,id).comments.some(c=>c.kind==='dependency-result'&&c.text.includes('Badges are printed')));assert.equal(task(store,id).status,'progress');
});

test('matching existing work is suggested; linking never overwrites its owner and duplicate creation is rejected',()=>{
 const {store,id}=setup(),existing=store.addTask({title:'Print name badges',owner:'maya'});report(store,id,'I need Jules to print the name badges.');const suggestion=pending(store,id)[0];
 assert.equal(suggestion.taskId,existing.id);const before=store.exportState();
 assert.throws(()=>store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:''},'dev'),/already exists/);assert.equal(store.exportState(),before);
 assert.throws(()=>store.resolveHandoff(id,suggestion.id,{action:'link',taskId:existing.id,owner:'jules'},'jack'),/Unexpected/);
 store.resolveHandoff(id,suggestion.id,{action:'link',taskId:existing.id},'dev');assert.equal(task(store,existing.id).owner,'maya');assert.equal(task(store,id).status,'progress');
});

test('explicit associations are related links, not blockers; required links still enforce cycles and readiness',()=>{
 const {store,id}=setup(),other=store.addTask({title:'Review speaker slides',owner:'maya'});
 report(store,id,'This is associated with Review speaker slides.');let suggestion=pending(store,id)[0];assert.equal(suggestion.kind,'related');
 store.resolveHandoff(id,suggestion.id,{action:'link',taskId:other.id},'dev');assert.equal(task(store,id).dependencies[0].kind,'related');
 const required=store.addTask({title:'Check desk safety',status:'done',note:'Safe.'});
 report(store,id,'Waiting for a safety check.','blocked');assert.equal(task(store,id).dependencies.filter(link=>link.kind!=='related').length,1);store.addDependency(id,{taskId:required.id},'dev');store.resumeTask(id,'dev');assert.equal(task(store,id).status,'progress');
 report(store,id,'This depends on Review speaker slides.');suggestion=pending(store,id)[0];store.resolveHandoff(id,suggestion.id,{action:'link',taskId:other.id},'dev');assert.equal(task(store,id).dependencies.find(l=>l.taskId===other.id).kind,'dependency');
 store.updateTask(other.id,{status:'progress',note:'I need someone to prepare another desk.'},'maya');const reverse=pending(store,other.id)[0];
 assert.throws(()=>store.resolveHandoff(other.id,reverse.id,{action:'link',taskId:id},'maya'),/depend on each other/);
});

test('blocked requests avoid generic duplicates and reuse an unused placeholder on confirmation',()=>{
 const {store,id}=setup();report(store,id,'Waiting for an answer.','blocked');const placeholder=task(store,id).dependencies[0].taskId,count=store.getState().tasks.length;
 report(store,id,'I need Jules to print the name badges.','blocked');assert.equal(store.getState().tasks.length,count);const suggestion=pending(store,id)[0];
 const created=store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:''},'dev');assert.equal(created.id,placeholder);assert.equal(created.title,'Print the name badges');assert.equal(task(store,id).dependencies.length,1);
 const next=setup();report(next.store,next.id,'Waiting for venue keys.','blocked');report(next.store,next.id,'Also waiting for an insurance certificate.','blocked');const total=next.store.getState().tasks.length;
 report(next.store,next.id,'Also still waiting for the insurance certificate.','blocked');assert.equal(next.store.getState().tasks.length,total);
});

test('negated blocker topics are excluded while genuinely missing dietary data still links',()=>{
 for(const note of ['We do not need dietary restrictions. I need Jules to print the name badges.','Dietary restrictions are no longer needed. Waiting for venue keys.','Dietary restrictions are not required. Waiting for keys.']){
  const {store,id}=setup();report(store,id,note,'blocked');assert.ok(!task(store,id).dependencies.some(link=>link.taskId==='dietary'),note);if(pending(store,id).length)assert.equal(task(store,id).dependencies.length,0);
 }
 for(const note of ['We do not have dietary restrictions yet.','Dietary restrictions have not been received yet.']){
  const {store,id}=setup();report(store,id,note,'blocked');assert.ok(task(store,id).dependencies.some(link=>link.taskId==='dietary'),note);
 }
});

test('named budget requests do not create a second automatic task, while a separate blocker is retained',()=>{
 const {store,id}=setup();const before=store.getState().tasks.length;report(store,id,'Jack needs to approve the budget.','blocked');assert.equal(store.getState().tasks.length,before);assert.equal(pending(store,id).length,1);
 const suggestion=pending(store,id)[0];store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:'jack'},'jack');assert.equal(task(store,id).dependencies.length,1);
 const next=setup();report(next.store,next.id,'Waiting for venue keys. Jules needs to print the badges.','blocked');const keys=task(next.store,next.id).dependencies[0].taskId;
 const printing=pending(next.store,next.id)[0];const child=next.store.resolveHandoff(next.id,printing.id,{action:'create',title:printing.title,owner:''},'dev');assert.notEqual(child.id,keys);assert.equal(task(next.store,next.id).dependencies.length,2);
 for(const note of ['Waiting for budget approval. Jack needs to approve the budget.','Waiting for dietary restrictions. Maya needs to collect dietary restrictions.']){
  const fresh=setup();report(fresh.store,fresh.id,note,'blocked');assert.equal(task(fresh.store,fresh.id).dependencies.length,1);assert.equal(pending(fresh.store,fresh.id).length,0);
 }
 const dietary=setup();report(dietary.store,dietary.id,'Maya needs to collect dietary restrictions.');assert.equal(pending(dietary.store,dietary.id)[0].taskId,'dietary');
});

test('completed work can be requested again and cancelling a named request retires its pending suggestion',()=>{
 const {store,id}=setup();store.addComment(id,'Jules needs to print name badges.','dev');let suggestion=pending(store,id)[0];
 const child=store.resolveHandoff(id,suggestion.id,{action:'create',title:suggestion.title,owner:'jules'},'jack');store.reportCompletion(child.id,'Printed.','jules');
 report(store,id,'We need Jules to print name badges again.');suggestion=pending(store,id)[0];assert.ok(suggestion);assert.equal(suggestion.taskId,'');
 report(store,id,'Also still need Jules to print name badges again.');assert.equal(pending(store,id).length,1);assert.equal(pending(store,id)[0].id,suggestion.id);
 store.addComment(id,'Jules does not need to print name badges.','dev');assert.equal(pending(store,id).length,0);assert.ok(task(store,child.id));assert.equal(task(store,id).dependencies.length,1);
});
