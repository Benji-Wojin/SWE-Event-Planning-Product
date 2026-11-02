import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const create=()=>GatherStore.createStore({storage:null});
const input=extra=>({title:'Prepare welcome signs',note:'Use the agreed accessible route.',owner:'',kind:'related',reason:'Supports guest arrival in parallel.',...extra});
const record=(store,id)=>store.getState().tasks.find(task=>task.id===id);

test('ordinary planning creates a linked, independently owned Todo task in one save without cloning context',()=>{
  const store=create();store.completeSetup({timeZone:'America/Los_Angeles'});
  const parent=store.addTask({title:'Run the school welcome',owner:'jack',status:'progress',dueDate:'2026-11-18',note:'PRIVATE-PARENT-NOTE',scope:'PARENT-OUTCOME'});
  store.setTaskSchedule(parent.id,{start:'2026-11-20T17:00',end:'2026-11-20T17:30',location:'School hall'});
  const before=record(store,parent.id);let saves=0;store.subscribe(()=>saves++);
  const child=store.addLinkedTask(parent.id,input({owner:'maya'}));
  assert.equal(saves,1);assert.equal(child.status,'todo');assert.equal(child.owner,'maya');assert.equal(child.acceptedAt,'');
  assert.equal(child.dueDate,'');assert.equal(child.schedule,null);assert.equal(child.requiresVerification,false);
  assert.equal(child.scope,'','omitting an outcome never copies the parent outcome');
  assert.equal(child.note,'Use the agreed accessible route.');assert.doesNotMatch(JSON.stringify(child),/PRIVATE-PARENT-NOTE/);
  const after=record(store,parent.id);assert.equal(after.status,before.status);assert.deepEqual(after.schedule,before.schedule);assert.equal(after.dueDate,before.dueDate);
  assert.equal(after.scope,before.scope);assert.equal(after.note,before.note);
  assert.equal(after.dependencies[0].taskId,child.id);assert.equal(after.dependencies[0].kind,'related');assert.equal(after.dependencies[0].reason,input().reason);
  store.reportCompletion(parent.id,'Welcome delivered.','jack');assert.equal(record(store,parent.id).status,'done','related work is not a completion gate');
});

test('linked tasks persist a separate explicit outcome through progress, completion and reload',()=>{
  let raw='';const storage={getItem:()=>raw||null,setItem:(_key,value)=>raw=value};
  const store=GatherStore.createStore({storage}),parent=store.addTask({title:'School welcome',owner:'jack',scope:'All guests welcomed.'});
  const child=store.addLinkedTask(parent.id,input({owner:'jack',scope:'  Signs installed on the approved accessible route.  '}));
  assert.equal(child.scope,'Signs installed on the approved accessible route.');
  assert.equal(child.note,input().note);assert.equal(child.status,'todo');assert.equal(child.acceptedAt,'');assert.equal(child.reportedAt,'');
  store.updateTask(child.id,{status:'progress',note:'Signs printed; installation next.'},'jack');
  assert.equal(record(store,child.id).scope,child.scope);
  store.reportCompletion(child.id,'Signs installed and checked.','jack');
  const reloaded=GatherStore.createStore({storage});
  assert.equal(record(reloaded,child.id).scope,child.scope);
  assert.equal(record(reloaded,child.id).completionResult.text,'Signs installed and checked.');
  assert.equal(record(reloaded,parent.id).scope,'All guests welcomed.');assert.equal(record(reloaded,parent.id).status,'todo');
});

test('required linked tasks gate completion and retain explicit result reporting',()=>{
  const store=create(),parent=store.addTask({title:'Deliver corporate briefing',owner:'jack',status:'progress'});
  const child=store.addLinkedTask(parent.id,input({kind:'dependency',owner:'jack',reason:'The approved briefing notes are required first.'}));
  assert.equal(record(store,parent.id).status,'progress');
  assert.throws(()=>store.reportCompletion(parent.id,'Not finished yet.','jack'),/required|linked|complete|prerequisite/i);
  store.reportCompletion(child.id,'Briefing notes approved.','jack');
  store.reportCompletion(parent.id,'Briefing delivered.','jack');assert.equal(record(store,parent.id).status,'done');
});

test('teammate creation remains organizer-controlled, scoped to own parent and self/unassigned owner',()=>{
  const store=create(),parent=store.addTask({title:'Team preparation',owner:'maya',scope:'Parent result stays organizer-controlled.'});
  const before=store.exportState();assert.throws(()=>store.addLinkedTask(parent.id,input(),'maya'),/organizer/);assert.equal(store.exportState(),before);
  store.updateEvent({membersCanCreateTasks:true});
  assert.throws(()=>store.addLinkedTask(parent.id,input(),'dev'),/owner or the organizer/);
  assert.throws(()=>store.addLinkedTask(parent.id,input({owner:'dev'}),'maya'),/organizer/);
  const child=store.addLinkedTask(parent.id,input({owner:'maya',scope:'Signs checked before arrival.'}),'maya');assert.equal(child.owner,'maya');assert.equal(child.acceptedAt,'');assert.equal(child.scope,'Signs checked before arrival.');
  const unassigned=store.addLinkedTask(parent.id,input({title:'Set up the welcome table',scope:'Table ready for check-in.'}),'maya');assert.equal(unassigned.owner,'');assert.equal(unassigned.scope,'Table ready for check-in.');
  assert.equal(record(store,parent.id).scope,parent.scope);
  const saved=store.exportState();assert.throws(()=>store.updateTask(parent.id,{scope:'Forged parent result'},'maya'));assert.equal(store.exportState(),saved);
});

test('invalid linked outcomes fail atomically, while empty and maximum-length outcomes are supported',()=>{
  const store=create(),parent=store.addTask({title:'Corporate guest welcome',owner:'jack'});let saves=0;store.subscribe(()=>saves++);
  for(const scope of [null,1,{},[],true,'x'.repeat(3001),'unsafe\u0000result','unsafe\u007fresult']){
    const before=store.exportState();assert.throws(()=>store.addLinkedTask(parent.id,input({scope})),/required outcome/);
    assert.equal(store.exportState(),before);assert.equal(saves,0);
  }
  for(const [index,scope] of ['', '   ', 'x'.repeat(3000), '看板已安装。\nAccessible route checked.'].entries()){
    const child=store.addLinkedTask(parent.id,input({title:'Linked result '+index,scope}));
    assert.equal(child.scope,scope.trim());assert.equal(saves,index+1);
  }
});

test('invalid or duplicate linked tasks fail before any state change and completed parents stay closed',()=>{
  const store=create(),parent=store.addTask({title:'School dance delivery',owner:'jack'});
  for(const patch of [{title:''},{title:'x'.repeat(181)},{note:'x'.repeat(3001)},{reason:''},{reason:'x'.repeat(2001)},{owner:'missing'},{kind:'unsafe'},{status:'done'},{dueDate:'2026-11-01'},{schedule:{}},{owner:12}]){
    const before=store.exportState();assert.throws(()=>store.addLinkedTask(parent.id,input(patch)));assert.equal(store.exportState(),before);
  }
  const child=store.addLinkedTask(parent.id,input());const before=store.exportState();
  assert.throws(()=>store.addLinkedTask(parent.id,input({title:'  PREPARE   WELCOME SIGNS  '})),/already linked/);assert.equal(store.exportState(),before);
  store.reportCompletion(parent.id,'Completed.');const done=store.exportState();assert.throws(()=>store.addLinkedTask(parent.id,input({title:'Later'})),/Reopen/);assert.equal(store.exportState(),done);
  assert.equal(record(store,child.id).status,'todo');
});

test('Unicode task names remain distinct and links survive reload',()=>{
  let raw='';const store=GatherStore.createStore({storage:{getItem:()=>raw||null,setItem:(_key,value)=>raw=value}}),parent=store.addTask({title:'庆祝活动',owner:'jack'});
  const a=store.addLinkedTask(parent.id,input({title:'准备邀请函'})),b=store.addLinkedTask(parent.id,input({title:'准备欢迎标志'}));assert.notEqual(a.id,b.id);
  const reloaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem:()=>{}}});
  assert.deepEqual(record(reloaded,parent.id).dependencies.map(link=>link.taskId),[a.id,b.id]);
  assert.equal(record(reloaded,a.id).schedule,null);
});

const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function linkedTaskForm('),formSource=source.slice(start,source.indexOf('  function dependencyMarkup(',start));
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function markup({organizer=true,enabled=false,owner='maya',status='todo',lost=false}={}){
  const ctx=vm.createContext({window:{GatherAccessLost:lost},ui:{actor:'maya'},h,member:()=>({name:'Maya'}),ownerOptions:()=>'<option>active owners</option>',options:(rows,selected)=>rows.map(([value,label])=>`<option value="${h(value)}"${value===selected?' selected':''}>${h(label)}</option>`).join('')});
  vm.runInContext(formSource+'globalThis.form=linkedTaskForm;',ctx);return ctx.form({id:'id"<>',owner,status},{event:{membersCanCreateTasks:enabled}},organizer);
}
test('linked creation form is role-gated, defaults to related and discloses its exact scope',()=>{
  const html=markup();assert.match(html,/Create a linked task/);assert.match(html,/<details class="dependency-add linked-task-create">/,'retain this form expansion independently from other relationship sections');assert.match(html,/value="related" selected/);assert.match(html,/data-id="id&quot;&lt;&gt;"/);
  assert.match(html,/notes and outcome are not copied/);assert.match(html,/without dates, activity times or recorded acceptance/);assert.match(html,/No message is sent/);
  assert.match(html,/Done when \(optional\)/);assert.match(html,/<textarea name="scope" rows="2" maxlength="3000"[^>]*><\/textarea>/);
  assert.doesNotMatch(html,/<textarea name="scope"[^>]*required/);assert.match(html,/Shared with the team; keep private codes in Private details/);
  assert.doesNotMatch(html,/type="date"|name="status"|name="start"/);
  for(const opts of [{organizer:false},{organizer:false,enabled:true,owner:'jack'},{lost:true},{status:'done'}])assert.equal(markup(opts),'');
  const member=markup({organizer:false,enabled:true});assert.match(member,/Me · Maya/);assert.doesNotMatch(member,/active owners/);
});
test('hosted client, build preparation and API expose one guarded atomic linked-task action',()=>{
  for(const file of ['legacy/hosted-store.js','scripts/prepare.mjs','lib/workspace.ts'])assert.match(readFileSync(file,'utf8'),/addLinkedTask/);
  const handler=source.split('\n').find(line=>line.includes("if(form.id==='linkedTaskForm')"));assert.match(handler,/store.addLinkedTask/);
  assert.match(handler,/scope:data.scope/);
  assert.doesNotMatch(handler,/store\.addTask|store\.addDependency/,'never chain two network mutations');
});
