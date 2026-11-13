import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';
import '../legacy/inbox.js';

const directNote='The welcome desk is ready.';
const emailNote='Organizer-reviewed result: the accessible entrance is staffed.';
const oldLink='https://example.com/previous-entrance';
const oldFile='previous_entrance';
const sender='Maya Singh <fictional sender>';
const savedTask=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const reload=raw=>GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});

function fixture({requiresVerification=true,previous=true}={}){
  const store=GatherStore.createStore({storage:null});
  const {id}=store.addTask({title:'Fictional welcome desk',owner:'maya',requiresVerification});
  if(previous)store.reportCompletion(id,{note:directNote,links:[oldLink],fileIds:[oldFile]},'maya');
  const addEmail=(options={})=>store.addMessage({taskId:id,subject:'Fictional welcome desk report',
    sender,body:'The welcome desk is complete. See https://example.com/email-link for context.',...options});
  const apply=(message,fields={})=>store.applyMessage(message.id,{mode:'update',taskId:id,
    expectedRevision:savedTask(store,id).revision,status:'done',note:emailNote,...fields});
  return {store,id,addEmail,apply,get task(){return savedTask(store,id);}};
}

test('explicit email completion archives old structured evidence exactly once even if only the source changes',()=>{
  for(const note of [directNote,emailNote]){
    const f=fixture(),original=f.task,email=f.addEmail();
    assert.equal(email.suggested.signal,'completion-report');
    assert.equal(f.task.completionReportSourceId,'','reading a suggested email does not apply it');
    f.apply(email,{note});
    const task=f.task;
    assert.equal(task.status,'progress');
    assert.ok(task.reportedAt);
    assert.equal(task.reportedBy,sender);
    assert.equal(task.verifiedAt,'');
    assert.equal(task.completionReportSourceId,email.id);
    assert.equal(task.completionEvidenceReviewAt,'');
    assert.deepEqual(task.completionEvidenceHistory,[original.completionEvidence]);
    assert.equal(task.completionEvidence.note,note,'use the exact reviewed note, not the raw email body');
    assert.equal(task.completionEvidence.actor,'jack');
    assert.deepEqual(task.completionEvidence.links,[]);
    assert.deepEqual(task.completionEvidence.fileIds,[]);
    assert.ok(task.revision>original.revision);
    const before=f.store.exportState();
    f.apply(email,{note:'Retry must not replace a reviewed message'});
    assert.equal(f.store.exportState(),before,'reapplying the same message must not duplicate evidence history');
    assert.deepEqual(savedTask(reload(before),f.id),task);
  }
});

test('verification and later non-superseding metadata retain the exact email provenance, not the latest inbox link',()=>{
  const f=fixture({previous:false});
  const source=f.addEmail({receivedAt:'2026-10-22T12:00:00Z'});
  f.apply(source);
  const pending=f.task;
  f.store.updateTask(f.id,{title:'Fictional welcome desk and route',dueDate:'2026-11-18'});
  const metadata=f.addEmail({subject:'Fictional scheduling reference',body:'Here are the venue details.',
    receivedAt:'2026-10-23T12:00:00Z'});
  f.apply(metadata,{status:'progress',note:pending.note});
  assert.equal(f.task.sourceMessageId,metadata.id);
  assert.equal(f.task.completionReportSourceId,source.id);
  assert.equal(f.task.reportedAt,pending.reportedAt);
  assert.deepEqual(f.task.completionEvidence,pending.completionEvidence);
  const verified=f.store.verifyTask(f.id,'jack',f.task.revision);
  assert.equal(verified.completionReportSourceId,source.id);
  assert.equal(verified.sourceMessageId,metadata.id);
  assert.equal(verified.completionResult.text,emailNote);
  assert.equal(verified.completionResult.reporter,sender);
  assert.equal(verified.completionEvidenceReviewAt,verified.verifiedAt);
  f.store.updateTask(f.id,{category:'Venue'});
  assert.equal(f.task.completionReportSourceId,source.id);
  assert.deepEqual(f.task.completionResult,verified.completionResult);
});

test('the email evidence snapshot is bounded and sanitized without losing the reviewed task note or source',()=>{
  const f=fixture({previous:false}),source=f.addEmail();
  const note='Reviewed\u0001 note: '+ 'x'.repeat(3500);
  f.apply(source,{note});
  assert.equal(f.task.note,note);
  assert.equal(f.task.completionReportSourceId,source.id);
  const evidence=f.task.completionEvidence;
  assert.ok(evidence.note.length<=3000);
  assert.match(evidence.note,/^Reviewed� note:/);
  assert.match(evidence.note,/Excerpt/);
  assert.doesNotMatch(evidence.note,/\u0001/);
  assert.deepEqual(savedTask(reload(f.store.exportState()),f.id).completionEvidence,evidence);
});

test('email completion without verification is Done with its own evidence and a later verified email cannot replace saved provenance',()=>{
  const done=fixture({requiresVerification:false});
  const prior=done.task.completionEvidence,source=done.addEmail();
  done.apply(source);
  assert.equal(done.task.status,'done');
  assert.equal(done.task.verifiedAt,'');
  assert.equal(done.task.completionReportedBy,sender);
  assert.equal(done.task.completionReportSourceId,source.id);
  assert.equal(done.task.completionResult.text,emailNote);
  assert.deepEqual(done.task.completionEvidenceHistory,[prior]);
  assert.deepEqual(done.task.completionEvidence.links,[]);

  const verified=fixture();
  const first=verified.addEmail({receivedAt:'2026-10-22T12:00:00Z'});
  verified.apply(first);
  const original=verified.store.verifyTask(verified.id,'jack',verified.task.revision);
  const later=verified.addEmail({sender:'Fictional later sender',receivedAt:'2026-10-23T12:00:00Z'});
  verified.apply(later,{note:'Later email does not replace verified evidence.'});
  assert.equal(verified.task.sourceMessageId,later.id);
  for(const field of ['reportedAt','reportedBy','verifiedAt','verifiedBy','completionReportSourceId',
    'completionEvidence','completionEvidenceHistory','completionEvidenceReviewAt','completionResult'])
    assert.deepEqual(verified.task[field],original[field],field);
});

test('a direct report, return, explicit withdrawal, and reopen remove superseded email provenance',()=>{
  for(const action of ['direct','return','withdrawal','reopen','reassign']){
    const f=fixture({requiresVerification:action!=='reopen',previous:false});
    const source=f.addEmail();
    f.apply(source);
    const previous=f.task.completionEvidence;
    assert.equal(f.task.completionReportSourceId,source.id);
    if(action==='direct')f.store.reportCompletion(f.id,{note:emailNote,links:['https://example.com/new-direct']},'maya');
    if(action==='return')f.store.returnCompletion(f.id,'Confirm the staff assignment.','jack',f.task.revision);
    if(action==='withdrawal')f.store.updateTask(f.id,{status:'progress',note:f.task.note},'maya');
    if(action==='reopen')f.store.updateTask(f.id,{status:'progress'});
    if(action==='reassign')f.store.updateTask(f.id,{owner:'dev',confirmPendingReportReassignment:true});
    assert.equal(f.task.completionReportSourceId,'',action);
    assert.ok(f.task.completionEvidenceHistory.some(item=>JSON.stringify(item)===JSON.stringify(previous)),action);
    if(action==='direct'){
      assert.equal(f.task.completionEvidence.actor,'maya');
      assert.deepEqual(f.task.completionEvidence.links,['https://example.com/new-direct']);
    }else{
      assert.equal(f.task.reportedAt,'',action);
      assert.equal(f.task.completionEvidence,null,action);
    }
  }
});

test('completion details link the exact report and keep older links and files out of the current submission',()=>{
  const f=fixture(),source=f.addEmail();
  f.apply(source);
  const html=GatherCompletionUI.section(f.task,true,true,{completionSource:{id:source.id,sender}});
  const [current,history]=html.split('<details class="completion-history">');
  const sourceButton=current.match(/<button[^>]*data-action="source"[^>]*>[\s\S]*?<\/button>/)?.[0]||'';
  assert.ok(sourceButton.includes('data-id="'+source.id+'"'));
  assert.match(current,/Maya Singh &lt;fictional sender&gt;/);
  assert.doesNotMatch(current,/<fictional sender>/);
  assert.match(current,/Organizer-reviewed result: the accessible entrance is staffed\./);
  assert.ok(!current.includes(oldLink)&&!current.includes(oldFile));
  assert.ok(history.includes(oldLink)&&history.includes(oldFile));
  assert.doesNotMatch(GatherCompletionUI.section(f.task,true,true),/data-action="source"/,
    'do not invent an email link when the caller cannot resolve the saved source');
  assert.doesNotMatch(GatherCompletionUI.section(f.task,true,true,{completionSource:{id:'different-email',sender}}),
    /data-action="source"/,'never render the latest email as the completion source unless its ID matches');
});

test('the real inbox preview warns about replacing the submission even when no task fields change',()=>{
  const f=fixture(),message=f.addEmail(),state=f.store.getState();
  const values={...message.suggested,note:f.task.note};
  assert.equal(GatherInbox.changes(message,state,values).changed.length,0,'fixture changes completion provenance only');
  const inbox=readFileSync('legacy/inbox-view.js','utf8');
  const start=inbox.indexOf('  const changeNames='),end=inbox.indexOf('  function updateChangePreview(',start);
  assert.ok(start>=0&&end>start);
  const context=vm.createContext({GatherInbox,h:String,statuses:{},dayLabel:String,timeLabel:String,member:id=>({name:id})});
  vm.runInContext(inbox.slice(start,end),context);
  const preview=context.changePreview(message,state,values);
  assert.match(preview,/becomes the current completion report/);
  assert.match(preview,/previous submission, including its links and files, moves to Earlier submissions/);
  assert.match(preview,/No attachments are imported from this email/);
  assert.match(preview,/remain in progress until the organizer verifies/);
  assert.doesNotMatch(preview,/will attach this email as a source; no field values change/);
  const ordinary=context.changePreview(message,state,{...values,status:'progress'});
  assert.doesNotMatch(ordinary,/current completion report|moves to Earlier submissions/);
  f.apply(message,{note:f.task.note});
  const saved=f.store.getState();
  const receipt=context.emailReader(saved.messages.find(item=>item.id===message.id),saved);
  assert.match(receipt,/current completion report in the task/);
  assert.doesNotMatch(receipt,/Email attached\. No task fields changed/);
});

test('the source action opens the reviewed message even when already selected behind the task dialog',()=>{
  const f=fixture(),source=f.addEmail();
  f.apply(source);
  const app=readFileSync('legacy/app.js','utf8'),lines=app.split('\n');
  const early=lines.find(line=>line.includes("action==='source'||action==='select-message'")&&line.includes('&&id===ui.messageId'));
  const route=lines.find(line=>line.includes("action==='source'||action==='select-message'")&&line.includes('ui.messageId=id;'));
  assert.ok(early&&route);
  for(const [view,hidden,messageId,expected] of [
    ['inbox',false,source.id,['close','render']],
    ['inbox',true,source.id,[]],
    ['inbox',false,'newer-email',['close','render']],
    ['tasks',false,'newer-email',['close','inbox']],
  ]){
    const ui={view,messageId},backdrop={hidden},calls=[];
    vm.runInNewContext('(()=>{'+early+'\n'+route+'})()',{
      action:'source',id:source.id,ui,$:selector=>selector==='#dialogBackdrop'?backdrop:null,
      closeDialog(){backdrop.hidden=true;calls.push('close');},
      render(){calls.push('render');},navigate(next){calls.push(next);},
    });
    assert.equal(ui.messageId,source.id);
    assert.deepEqual(calls,expected);
  }
});
