import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
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
test('close-out attention follows a real returned, resubmitted, amended and reviewed result without sharing the report',()=>{
  const store=GatherStore.createStore({storage:null});
  const {id}=store.addTask({title:'Return venue keys',owner:'maya',requiresVerification:true});
  const markup=()=>GatherWrapUp.markup(store.getState(),{h,organizer:true,scope:{mine:false,actor:'jack'}});
  const group=()=>GatherWrapUp.groups(store.getState()).find(item=>item.tasks.some(task=>task.id===id)).key;
  store.reportCompletion(id,'PRIVATE initial result.','maya');
  assert.equal(group(),'verification');assert.doesNotMatch(markup(),/data-wrap-attention="(?:returned|amendment)"/);
  store.returnCompletion(id,'PRIVATE reason for returning.','jack');
  assert.equal(group(),'open');assert.match(markup(),/data-wrap-attention="returned"/);assert.doesNotMatch(markup(),/PRIVATE/);
  store.reportCompletion(id,'PRIVATE revised result.','maya');
  assert.equal(group(),'verification');assert.doesNotMatch(markup(),/data-wrap-attention="(?:returned|amendment)"/);
  const verified=store.verifyTask(id,'jack');
  const amended=store.setCompletionEvidence(id,{note:'PRIVATE amended evidence.'},'maya');
  assert.equal(group(),'completed');assert.match(markup(),/data-wrap-attention="amendment"/);assert.doesNotMatch(markup(),/PRIVATE/);
  const reviewed=store.reviewCompletionEvidence(id,amended.revision,'jack');
  assert.equal(reviewed.verifiedAt,verified.verifiedAt);
  assert.equal(group(),'completed');assert.doesNotMatch(markup(),/data-wrap-attention="(?:returned|amendment)"/);
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
test('saving a Wrap up lesson returns to its exact record and later repaint retains that focus',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const before=source.indexOf('  function finishWrapUpLesson('),after=source.indexOf('  function thoughtDialog()',before);
  const restore=source.indexOf('  function restoreViewFocus('),next=source.indexOf('  function saveLock(',restore);
  const calls=[],heading={id:'wrapUpLessons'},root={closest:()=>null};
  const card=id=>({dataset:{wrapLesson:id},textContent:'Same lesson title',closest:()=>null});
  heading.closest=()=>null;
  let cards=[card('other'),card('saved')];
  const doc={body:{}};doc.activeElement=doc.body;
  const ui={view:'memory'},window={};
  const ctx=vm.createContext({ui,window,document:doc,$:key=>key==='#viewRoot'?root:heading,$$:()=>cards,
    closeDialog:()=>calls.push('close'),render:()=>calls.push('render'),isScheduleControl:()=>false,
    focusScheduleTarget:target=>{calls.push(target);return true;}});
  vm.runInContext(source.slice(before,after)+source.slice(restore,next),ctx);
  assert.equal(ctx.finishWrapUpLesson('saved'),true);
  assert.deepEqual(calls.splice(0),['close','render',cards[1]]);
  const old=cards[1];old.isConnected=false;cards=[card('other'),card('saved')];
  assert.equal(ctx.restoreViewFocus(old,root),true);assert.deepEqual(calls.splice(0),[cards[1]]);
  cards=[card('other')];
  assert.equal(ctx.restoreViewFocus(old,root),true);assert.deepEqual(calls.splice(0),[heading]);
  ui.view='overview';
  assert.equal(ctx.finishWrapUpLesson('saved'),false);assert.deepEqual(calls,['close','render']);
  assert.match(source,/if\(!finishWrapUpLesson\(lesson\?\.id\)&&!window\.GatherAccessLost\)thoughtDialog\(\)/);
});
test('the reuse picker projects only titles and display groups, and copies chosen text in source order',()=>{
  const s=state([
    row('internal-one',{title:'2. Confirm\nmain entrance',note:'PRIVATE_NOTE',dueDate:'2030-01-01',schedule:{location:'PRIVATE_LOCATION'}}),
    row('internal-two',{title:'</textarea><script>example</script>',status:'done',completionEvidence:{note:'PRIVATE_RESULT'}}),
    row('internal-three',{title:'Other task',owner:'jack'}),
    row('long',{title:'x'.repeat(200),status:'todo'}),
  ]);
  const before=structuredClone(s),rows=GatherWrapUp.reusableTitles(s,{mine:true,actor:'maya'});
  assert.deepEqual(rows.map(x=>x.title),['2. Confirm main entrance','x'.repeat(200),'</textarea><script>example</script>']);
  assert.deepEqual(Object.keys(rows[0]).sort(),['group','title']);
  const html=GatherWrapUp.reusablePicker(rows,{mine:true});
  assert.match(html,/My tasks/);assert.match(html,/maxlength="180"/);
  assert.doesNotMatch(html,/PRIVATE_|2030-|internal-|Other task|<script>|\bchecked\b/);
  assert.match(html,/&lt;script&gt;example/);
  const choices=[{index:2,title:'[x] Pack supplies'},{index:0,title:rows[0].title}];
  assert.equal(GatherWrapUp.reusableChecklist(rows,choices),'- [ ] 2. Confirm main entrance\n- [ ] [x] Pack supplies');
  for(const bad of [[],[{index:1,title:rows[1].title}],[{index:5,title:'Outside scope'}],[choices[0],choices[0]],
    Array.from({length:25},(_,i)=>({index:i,title:'Task '+i}))])
    assert.equal(GatherWrapUp.reusableChecklist(rows,bad),'');
  assert.deepEqual(s,before);
});

test('reusable checklist keeps selection through search, guards copying, and falls back to selection',async()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const code=source.slice(source.indexOf('  function updateReuseChecklistWarning('),source.indexOf('  function updateGuestAgendaWarning('));
  const controls=[{checked:false,value:'0'},{checked:false,value:'1'}],edits=[{},{}],rows=[{},{}];
  const titles=[{value:'Signage'},{value:'Room layout'}];
  const status={},search={value:''},warning={},none={},button={setAttribute(k,v){this[k]=v;}};
  const actions=[],preview={value:'',isConnected:true,focus(){actions.push('focus');},select(){actions.push('select');}};
  const sync={hidden:true};
  let revision=1,organizer=false,copied=true,duringCopy,opened,newer=false,knownFloor=0;
  const context=vm.createContext({GatherWrapUp,h,ui:{view:'memory',wrapMine:true,actor:'maya'},
    window:{navigator:{onLine:true}},isOrganizer:()=>organizer,
    scheduleRevisionIsStale:value=>value<=knownFloor,recoveryConflictPending:()=>false,
    store:{getState:()=>state([row('a',{title:'Signage'}),row('b',{title:'Room layout'})]),getSnapshotRevision:()=>revision,confirmSnapshotRevision:async expected=>!newer&&expected===revision},
    $:id=>({'#reuseChecklistWarning':warning,'#reuseChecklistPreview':preview,'#reuseChecklistSearch':search,
      '#reuseChecklistCount':status,'#reuseChecklistNoMatches':none,'#workspaceSyncNotice':sync,
      '[data-action="copy-reuse-checklist"]':button})[id],
    $$:id=>({'[data-reuse-choice]':controls,'[data-reuse-edit]':edits,'[data-reuse-row]':rows,'[data-reuse-title]':titles})[id],
    openDialog(_title,html,_footer,_wide,kind){context.ui.dialogKind=kind;opened=html;},
    toast:message=>actions.push(message),copyText:async text=>{actions.push(text);duringCopy?.();return copied;},
  });
  vm.runInContext(code,context);
  context.reuseChecklistDialog();assert.equal(opened,undefined);
  organizer=true;context.reuseChecklistDialog();assert.match(opened,/Choose reusable tasks/);
  assert.equal(button['aria-disabled'],'true');assert.equal(preview.value,'');
  controls[0].checked=true;context.syncReuseChecklist();
  assert.equal(edits[0].hidden,false);assert.equal(edits[1].hidden,true);
  knownFloor=1;await context.copyReuseChecklist();
  assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);assert.deepEqual(actions,[]);
  knownFloor=0;context.syncReuseChecklist();
  search.value='layout';context.filterReuseChecklist();
  assert.equal(rows[0].hidden,true);assert.equal(rows[1].hidden,false);
  controls[1].checked=true;context.syncReuseChecklist();
  assert.equal(preview.value,'- [ ] Signage\n- [ ] Room layout');
  titles[1].value='';context.syncReuseChecklist();
  assert.equal(preview.value,'');assert.match(status.textContent,/1 to 180/);
  titles[1].value='Check room layout';context.syncReuseChecklist();
  await context.copyReuseChecklist();
  assert.deepEqual(actions.splice(0),['- [ ] Signage\n- [ ] Check room layout','Checklist copied. Paste it in the next event’s private plan.']);
  copied=false;
  await context.copyReuseChecklist();assert.deepEqual(actions.splice(0),[preview.value,'focus','select','Copy the selected preview manually. Nothing was sent.']);
  context.window.navigator.onLine=false;await context.copyReuseChecklist();
  assert.equal(preview.value,'');assert.match(warning.textContent,/Reconnect/);assert.deepEqual(actions,[]);
  context.window.navigator.onLine=true;context.syncReuseChecklist();
  duringCopy=()=>{revision=2;};copied=true;
  await context.copyReuseChecklist();assert.match(actions.pop(),/changed while copying/);
  assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);
  actions.length=0;await context.copyReuseChecklist();assert.deepEqual(actions,[]);
  duringCopy=undefined;context.reuseChecklistDialog();context.syncReuseChecklist();
  newer=true;await context.copyReuseChecklist();
  assert.deepEqual(actions,[]);assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);
  context.window.GatherAccessLost=true;context.updateReuseChecklistWarning();assert.match(warning.textContent,/access changed/);
});
