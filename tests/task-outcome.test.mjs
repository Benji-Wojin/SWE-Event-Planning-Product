import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
const fresh=()=>GatherStore.createStore({storage:null});
const task=(store,id)=>store.getState().tasks.find(task=>task.id===id);

test('a separate initial required outcome survives progress, completion reporting, verification and reload',()=>{
  const store=fresh(),created=store.addTask({title:'Confirm fictional school welcome route',owner:'maya',scope:'  Organizer reviews a marked welcome route and a named greeter.  ',note:'Initial context',requiresVerification:true});
  assert.equal(created.scope,'Organizer reviews a marked welcome route and a named greeter.');
  store.updateTask(created.id,{status:'progress',note:'Drafting the route.'},'maya');assert.equal(task(store,created.id).scope,created.scope);
  store.reportCompletion(created.id,'Route reviewed and greeter confirmed.','maya');assert.equal(task(store,created.id).scope,created.scope);
  let before=store.exportState();assert.throws(()=>store.setTaskOutcome(created.id,'Different work'),/completion|reopen/);assert.equal(store.exportState(),before);
  store.verifyTask(created.id);assert.equal(task(store,created.id).scope,created.scope);before=store.exportState();assert.throws(()=>store.setTaskOutcome(created.id,''),/completion|reopen/);assert.equal(store.exportState(),before);
  const loaded=GatherStore.createStore({storage:{getItem:()=>before,setItem(){}}});assert.equal(task(loaded,created.id).scope,created.scope);
});

test('organizer outcome changes preserve progress and attribution, reset acceptance/commitment and record both outcomes in one save',()=>{
  const store=fresh(),created=store.addTask({title:'Fictional corporate briefing',owner:'maya',status:'progress',scope:'Draft a briefing.',note:'Working on the approved outline.',dueDate:'2027-01-08'});
  store.updateEvent({timeZone:'America/Los_Angeles'});
  store.setTaskSchedule(created.id,{start:'2027-01-08T17:00',end:'2027-01-08T17:30',location:'Fictional room'});
  store.acceptTask(created.id,'maya');store.setNextUp(created.id,{enabled:true},'maya');
  const before=task(store,created.id),count=store.getState().tasks.length;assert.ok(before.acceptedAt);assert.ok(before.nextUpAt);let saves=0;store.subscribe(()=>saves++);
  store.setTaskOutcome(created.id,'Approved briefing with named handoff owners.');
  const after=task(store,created.id);assert.equal(saves,1);assert.equal(after.scope,'Approved briefing with named handoff owners.');assert.equal(after.revision,before.revision+1);
  for(const key of ['acceptedAt','acceptedBy','acceptedSourceId','acceptedRecordedBy','nextUpAt','nextUpBy'])assert.equal(after[key],'',key);
  for(const key of ['owner','title','status','note','dueDate','schedule','dependencies','handoffs','requiresVerification','updatedAt','updatedBy','ownerRespondedAt','followupAfter','followupSentAt','planReviewAfter','recoveryRequests'])assert.deepEqual(after[key],before[key],key);
  assert.equal(store.getState().tasks.length,count);assert.equal(after.comments.length,before.comments.length+1);assert.equal(after.comments.at(-1).actor,'jack');assert.match(after.comments.at(-1).text,/Previous outcome: Draft a briefing/);assert.match(after.comments.at(-1).text,/New outcome: Approved briefing/);
  store.acceptTask(created.id,'maya');assert.ok(task(store,created.id).acceptedAt);assert.equal(task(store,created.id).status,'progress');
});

test('outcome validation and permissions fail before mutation; same text is a no-op and clearing is explicit',()=>{
  const store=fresh();store.updateEvent({membersCanCreateTasks:true});
  const created=store.addTask({title:'Fictional party table',owner:'maya',scope:'Guests can find their table.'},'maya');assert.equal(created.scope,'Guests can find their table.');
  store.acceptTask(created.id,'maya');let saves=0;store.subscribe(()=>saves++);
  const before=store.exportState();store.setTaskOutcome(created.id,' Guests can find their table. ');assert.equal(store.exportState(),before);assert.equal(saves,0);
  assert.throws(()=>store.setTaskOutcome(created.id,'Other outcome','maya'),/organizer/);assert.equal(store.exportState(),before);
  for(const value of [null,{},[],1,'x'.repeat(3001),'bad\u0000text']){
    assert.throws(()=>store.setTaskOutcome(created.id,value));assert.equal(store.exportState(),before);
    assert.throws(()=>store.addTask({title:'Invalid initial outcome',scope:value},'maya'));assert.equal(store.exportState(),before);
  }
  store.setTaskOutcome(created.id,'');assert.equal(task(store,created.id).scope,'');assert.equal(task(store,created.id).acceptedAt,'');assert.match(task(store,created.id).comments.at(-1).text,/New outcome: Not recorded/);
  const latest=store.exportState();assert.throws(()=>store.addTask({title:'Forged owner',scope:'A result.',owner:'jack'},'maya'));assert.equal(store.exportState(),latest);
});

test('outcome UI escapes shared text, explains reconfirmation and keeps historical/member views read-only',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function taskOutcomeMarkup('),helper=source.slice(start,source.indexOf('  function taskOwnerPresentation(',start));
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const render=(task,organizer=true,lost=false)=>{const context=vm.createContext({window:{GatherAccessLost:lost},h});vm.runInContext(helper+'globalThis.render=taskOutcomeMarkup;',context);return context.render(task,organizer);};
  const open={id:'task"<>',status:'progress',scope:'<script>not code</script>'};
  const html=render(open);assert.match(html,/aria-label="Task outcome"/);assert.match(html,/Done when/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-id="task&quot;&lt;&gt;"/);assert.match(html,/clears acceptance and Next up/);assert.match(html,/Status, latest update, dates, schedule and links stay unchanged/);
  for(const [value,organizer,lost] of [[{...open,status:'done'},true,false],[{...open,reportedAt:'fixture'},true,false],[open,false,false],[open,true,true]])assert.doesNotMatch(render(value,organizer,lost),/<form|Save outcome/);
  assert.match(source,/Done when \(optional\)/);assert.match(source,/Shared with the team and kept separately from progress updates/);
  assert.match(source,/store\.setTaskOutcome\(form.dataset.id,data.scope,ui.actor\)/);
  for(const path of ['legacy/hosted-store.js','scripts/prepare.mjs'])assert.match(readFileSync(path,'utf8'),/'setTaskOutcome'/);
});
test('Reduce scope uses the same outcome history and reconfirmation without replacing the owner progress note',()=>{
  const store=fresh(),created=store.addTask({title:'Fictional anniversary welcome',owner:'maya',scope:'Original wider result.',note:'Working on the welcome.'});
  store.acceptTask(created.id,'maya');store.setNextUp(created.id,{enabled:true},'maya');const before=task(store,created.id);let saves=0;store.subscribe(()=>saves++);
  store.resolveRecovery(created.id,{action:'scope',scope:'Smaller agreed result.',note:'Use a smaller welcome area.',reviewAfter:'2027-01-09'});
  const after=task(store,created.id);assert.equal(after.scope,'Smaller agreed result.');assert.equal(after.acceptedAt,'');assert.equal(after.nextUpAt,'');assert.equal(after.status,before.status);assert.equal(after.note,before.note);assert.equal(after.updatedBy,before.updatedBy);assert.equal(after.updatedAt,before.updatedAt);assert.equal(saves,1);assert.ok(after.comments.some(comment=>comment.text.includes('Previous outcome: Original wider result.')));
});
