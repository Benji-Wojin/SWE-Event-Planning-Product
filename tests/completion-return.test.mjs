import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/completion-ui.js';
import '../legacy/recovery-ui.js';
const create=()=>GatherStore.createStore({storage:null});
const current=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const pending=()=>{
  const store=create(),task=store.addTask({title:'Fictional school welcome review',scope:'An approved route and named greeter.',owner:'maya',requiresVerification:true,dueDate:'2027-02-01'});
  store.acceptTask(task.id,'maya');store.reportCompletion(task.id,{note:'Route checked; greeter not yet named.',links:['https://www.nasa.gov/'],fileIds:['shared_checklist']},'maya');
  return {store,task:current(store,task.id)};
};
test('organizer returns a pending completion with a reason, retaining original evidence and owner progress attribution',()=>{
  const {store,task}=pending();let saves=0;store.subscribe(()=>saves++);
  const returned=store.returnCompletion(task.id,'Name the greeter and confirm the accessible entrance.');assert.equal(saves,1);
  assert.equal(returned.status,'progress');assert.equal(returned.reportedAt,'');assert.equal(returned.reportedBy,'');assert.equal(returned.verifiedAt,'');assert.equal(returned.completionEvidence,null);assert.equal(returned.completionResult,null);
  for(const key of ['owner','scope','title','note','dueDate','schedule','dependencies','acceptedAt','acceptedBy','updatedAt','updatedBy','ownerRespondedAt'])assert.deepEqual(returned[key],task[key],key);
  assert.deepEqual(returned.completionEvidenceHistory.at(0),task.completionEvidence);assert.equal(returned.completionReview.actor,'jack');assert.equal(returned.completionReview.reportedAt,task.reportedAt);assert.equal(returned.completionReview.reportedBy,task.reportedBy);assert.match(returned.comments.at(-1).text,/Earlier report by Maya Singh/);assert.ok(returned.comments.at(-1).text.includes(task.note));
  const raw=store.exportState(),loaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});assert.deepEqual(current(loaded,task.id).completionReview,returned.completionReview);
  const html=GatherCompletionUI.section(returned,true);assert.match(html,/Changes requested/);assert.match(html,/Name the greeter/);assert.match(html,/No current completion report/);assert.doesNotMatch(html,/id="completionEvidenceForm"/);
});
test('owner progress preserves the changes request; a fresh report supersedes it and only explicit verification completes the task',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Record the missing greeter.');
  store.updateTask(task.id,{status:'progress',note:'Confirming the greeter now.'},'maya');assert.ok(current(store,task.id).completionReview);assert.equal(current(store,task.id).scope,task.scope);
  store.reportCompletion(task.id,'Greeter named and accessible route confirmed.','maya');const resubmitted=current(store,task.id);assert.equal(resubmitted.completionReview,null);assert.ok(resubmitted.reportedAt);assert.equal(resubmitted.status,'progress');assert.equal(resubmitted.completionEvidenceHistory.length,1);assert.ok(resubmitted.comments.some(comment=>comment.kind==='completion-returned'));
  store.verifyTask(task.id);const verified=current(store,task.id);assert.equal(verified.status,'done');assert.equal(verified.reportedBy,'Maya Singh');assert.equal(verified.verifiedBy,'jack');assert.equal(verified.completionReview,null);assert.equal(verified.scope,task.scope);
  const before=store.exportState();assert.throws(()=>store.returnCompletion(task.id,'Too late'),/pending/);assert.equal(store.exportState(),before);
});
test('a returned report offers a fresh preparation entry only to the eligible owner',()=>{
  const {store,task}=pending();
  const returned=store.returnCompletion(task.id,'Name the greeter before submitting again.');
  const before=store.exportState(),section=GatherCompletionUI.section;
  const prepare=/Prepare revised report/;
  const html=section(returned,true,false,{canPrepareRevision:true,completionBlocked:false});
  const request=html.match(/<section[^>]*aria-label="Completion changes requested"[\s\S]*?<\/section>/)?.[0]||'';
  assert.match(request,/Name the greeter before submitting again/);
  assert.match(request,/<button[^>]*type="button"[^>]*>Prepare revised report<\/button>/);
  assert.match(request,/data-action="prepare-revised-completion"/);
  assert.ok(request.includes('data-id="'+task.id+'"'));
  assert.match(html,/Earlier submissions · 1/);
  assert.doesNotMatch(html,/id="completionEvidenceForm"/);
  for(const [canEdit,organizer] of [[false,false],[true,true]]){
    const view=section(returned,canEdit,organizer,{canPrepareRevision:false,completionBlocked:false});
    assert.match(view,/Changes requested/);assert.doesNotMatch(view,prepare);
  }
  assert.doesNotMatch(section(returned,true,false),prepare,'no permission context defaults to no action');
  assert.equal(store.exportState(),before,'viewing the request does not submit or edit the task');

  const recovery=GatherRecoveryUI.create({store,ui:{actor:'maya'},h:String,
    options:rows=>rows.map(([value,label])=>`<option value="${value}">${label}</option>`).join(''),
    dayLabel:String,member:id=>({name:id})});
  const form=recovery.responseMarkup(returned,false,false);
  assert.match(form,/<h3>Revised completion report<\/h3>/);
  assert.doesNotMatch(form,/data-action="prepare-completion"/,'returned work has one preparation entry point');
  assert.match(form,/<textarea name="note"[^>]*><\/textarea>/);
  assert.match(form,/<textarea name="completionLinks"[^>]*><\/textarea>/);
  assert.match(form,/<select name="completionFileIds"[^>]*><\/select>/);
  assert.doesNotMatch(form,/Route checked|www\.nasa\.gov|shared_checklist/);

  const submit={},label={},evidence={hidden:true,querySelectorAll:()=>[]};
  let focused=0;
  const draftForm={dataset:{revisingCompletion:'true'},elements:{
    response:{value:'progress',options:[{value:'progress'},{value:'completed'}]},proposedDate:{},
    note:{value:'A new draft the owner typed',focus:()=>focused++},
  },querySelector:selector=>({'[data-proposed-date]':{},'[data-completion-only]':evidence,
    '[data-response-note-label]':label,'button[type="submit"]':submit})[selector]};
  assert.equal(recovery.prepareCompletion(draftForm),true);
  assert.equal(draftForm.elements.note.value,'A new draft the owner typed');
  assert.equal(evidence.hidden,false);assert.equal(focused,1);
  assert.equal(submit.textContent,'Submit revised completion');
  assert.equal(store.exportState(),before,'preparing the form does not submit the revised completion');

  store.reportCompletion(task.id,'The fictional greeter and route are confirmed.','maya');
  const submitted=current(store,task.id);
  const staleReview={...submitted,completionReview:returned.completionReview};
  assert.doesNotMatch(section(staleReview,true,false,{canPrepareRevision:true,completionBlocked:false}),prepare);
  store.verifyTask(task.id);
  const verified={...current(store,task.id),completionReview:returned.completionReview};
  assert.doesNotMatch(section(verified,true,true,{canPrepareRevision:true,completionBlocked:false}),prepare);
});
test('open required work keeps a returned report visible but blocks preparation',()=>{
  const {store,task}=pending();
  const returned=store.returnCompletion(task.id,'Check the accessible route again.');
  const linked=store.addTask({title:'Fictional accessibility check',owner:'jack',requiresVerification:true});
  store.addDependency(task.id,{taskId:linked.id,kind:'dependency',reason:'Confirm the route before reporting completion.'});
  const blocked=current(store,task.id),before=store.exportState();
  assert.deepEqual(blocked.completionReview,returned.completionReview);
  const section=GatherCompletionUI.section(blocked,true,false,{canPrepareRevision:true,completionBlocked:true});
  assert.match(section,/Check the accessible route again/);
  assert.match(section,/Finish required work before preparing a revised report\./);
  assert.doesNotMatch(section,/Prepare revised report/);
  assert.equal(store.exportState(),before);
  store.reportCompletion(linked.id,'Fictional accessibility check ready.','jack');
  store.verifyTask(linked.id);
  assert.match(GatherCompletionUI.section(current(store,task.id),true,false,{canPrepareRevision:true,completionBlocked:false}),/Prepare revised report/);
  assert.equal(current(store,task.id).reportedAt,'','finishing the prerequisite does not submit a revised report');
});
test('returned-work actions open the matching feedback and recheck ownership and blockers before preparing',()=>{
  const {store,task}=pending();
  store.returnCompletion(task.id,'Confirm the fictional greeter.');
  const source=readFileSync('legacy/app.js','utf8');
  const dialog={}, calls=[], ui={actor:'maya'};
  const form={dataset:{id:task.id}};
  const context=vm.createContext({
    window:{},ui,store,GatherPriorities,
    render(){calls.push('refresh');},toast(){},
    taskDialog(id){ui.dialogKind='task';ui.detailId=id;calls.push('open:'+id);},
    requestAnimationFrame(fn){fn();},
    $(selector,root){
      if(selector==='#dialog')return dialog;
      assert.equal(root,dialog);
      if(selector==='#responseForm')return form;
      assert.equal(selector,'[aria-label="Completion changes requested"] h4');
      return {focus(){calls.push('feedback focused');}};
    },
    dependencyInfo:()=>({open:[]}),
    recovery:{prepareCompletion(value){assert.equal(value,form);calls.push('prepare');}},
    id:task.id,
  });
  vm.runInContext(source.slice(source.indexOf('  function openReturnedCompletion('),source.indexOf('  function eventReviewScope(')),context);
  const saved=store.exportState();
  vm.runInContext('openReturnedCompletion(id);prepareRevisedCompletion(id);',context);
  assert.deepEqual(calls,['open:'+task.id,'feedback focused','prepare']);
  assert.equal(store.exportState(),saved);
  context.dependencyInfo=()=>({open:[{}]});
  vm.runInContext('prepareRevisedCompletion(id)',context);
  ui.actor='dev';
  vm.runInContext('openReturnedCompletion(id);prepareRevisedCompletion(id);',context);
  assert.deepEqual(calls,['open:'+task.id,'feedback focused','prepare','refresh']);
  assert.equal(store.exportState(),saved);
});
test('returning completion rejects unauthorized, invalid, repeated and nonpending decisions without changes',()=>{
  const {store,task}=pending(),before=store.exportState();
  for(const actor of ['maya','dev']){assert.throws(()=>store.returnCompletion(task.id,'Change this.',actor),/organizer/);assert.equal(store.exportState(),before);}
  for(const reason of ['', ' ',null,{},'x'.repeat(3001),'bad\u0000reason']){assert.throws(()=>store.returnCompletion(task.id,reason));assert.equal(store.exportState(),before);}
  store.returnCompletion(task.id,'Record the agreed result.');const stable=store.exportState();assert.throws(()=>store.returnCompletion(task.id,'Repeated'),/pending/);assert.equal(store.exportState(),stable);
  assert.throws(()=>store.returnCompletion('dietary','No pending report.'),/pending/);assert.equal(store.exportState(),stable);
  const ordinary=store.addTask({title:'No verification required',owner:'maya'});store.reportCompletion(ordinary.id,'Done.','maya');const completed=store.exportState();assert.throws(()=>store.returnCompletion(ordinary.id,'Reopen separately.'),/pending/);assert.equal(store.exportState(),completed);
});
test('legacy reports without evidence retain a bounded excerpt plus full report text, and changing outcome supersedes the active request',()=>{
  const {store,task}=pending(),raw=JSON.parse(store.exportState()),legacy=raw.tasks.find(t=>t.id===task.id);delete legacy.completionEvidence;legacy.note='x'.repeat(4000);
  let saved=JSON.stringify(raw);const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}});
  const returned=loaded.returnCompletion(task.id,'Check the missing details.');assert.equal(returned.completionEvidenceHistory.length,1);assert.ok(returned.completionEvidenceHistory[0].note.length<=3000);assert.match(returned.completionEvidenceHistory[0].note,/Earlier report excerpt/);assert.ok(returned.comments.at(-1).text.includes('x'.repeat(4000)));
  assert.equal(GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}}).getState().persistence,'saved');
  loaded.setTaskOutcome(task.id,'A new agreed result.');assert.equal(current(loaded,task.id).completionReview,null);assert.ok(current(loaded,task.id).comments.some(comment=>comment.kind==='completion-returned'));
});
test('changes-request UI is escaped and source exposes one explicit reasoned organizer action',()=>{
  const html=GatherCompletionUI.section({status:'progress',completionReview:{note:'<script>untrusted</script>',at:new Date().toISOString()},completionEvidenceHistory:[]},false);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Nothing was verified/);
  const source=readFileSync('legacy/app.js','utf8');assert.match(source,/What needs changing\?/);assert.match(source,/Return completion for changes/);assert.match(source,/await sendBack\(id,note,actor,revision\)/);assert.match(source,/No email is sent/);
  for(const path of ['legacy/hosted-store.js','scripts/prepare.mjs'])assert.match(readFileSync(path,'utf8'),/'returnCompletion'/);
});
test('malformed persisted review decisions fail closed without replacing saved workspace bytes',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Check the missing result.');const original=JSON.parse(store.exportState()),review=current(store,task.id).completionReview;
  for(const value of [{},[],{...review,note:''},{...review,note:'x'.repeat(3001)},{...review,actor:'not-a-member'},{...review,at:'not a date'},{...review,reportedAt:'invalid'},{...review,execute:true}]){
    const raw=structuredClone(original);raw.tasks.find(t=>t.id===task.id).completionReview=value;const saved=JSON.stringify(raw);let writes=0;
    const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem(){writes++;}}});assert.equal(loaded.getState().persistence,'unavailable');assert.equal(writes,0);
  }
});
test('a new owner-email completion report supersedes the active request and later progress cannot revive it',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Name the greeter.');
  const email=store.addMessage({taskId:task.id,sender:'Maya Singh',subject:'Welcome route complete',body:'The welcome route and named greeter are complete.'});
  store.applyMessage(email.id);const resubmitted=current(store,task.id);assert.ok(resubmitted.reportedAt);assert.equal(resubmitted.status,'progress');assert.equal(resubmitted.completionReview,null);assert.ok(resubmitted.comments.some(comment=>comment.kind==='completion-returned'));
  store.updateTask(task.id,{status:'progress',note:'Checking one further detail.'},'maya');assert.equal(current(store,task.id).reportedAt,'');assert.equal(current(store,task.id).completionReview,null);assert.doesNotMatch(GatherCompletionUI.section(current(store,task.id),true),/Changes requested/);
});
test('manually completing after an explicit verification-policy change supersedes the request, including after reopening',()=>{
  const {store,task}=pending();store.returnCompletion(task.id,'Review the remaining work.');store.updateTask(task.id,{requiresVerification:false});store.updateTask(task.id,{status:'done'});assert.equal(current(store,task.id).completionReview,null);store.updateTask(task.id,{status:'progress'});assert.equal(current(store,task.id).completionReview,null);
});
test('historical control characters do not prevent return; only the synthetic evidence excerpt is cleaned',()=>{
  const {store,task}=pending(),raw=JSON.parse(store.exportState()),legacy=raw.tasks.find(t=>t.id===task.id);delete legacy.completionEvidence;legacy.note='Earlier\u0001report\u007ftext';
  let saved=JSON.stringify(raw);const loaded=GatherStore.createStore({storage:{getItem:()=>saved,setItem:(_key,value)=>saved=value}});assert.equal(loaded.getState().persistence,'saved');
  const returned=loaded.returnCompletion(task.id,'Record the missing details.');assert.equal(returned.note,legacy.note);assert.ok(returned.comments.at(-1).text.includes(legacy.note));assert.doesNotMatch(returned.completionEvidenceHistory[0].note,/[\u0001\u007f]/);assert.equal(GatherStore.createStore({storage:{getItem:()=>saved,setItem(){}}}).getState().persistence,'saved');
});
