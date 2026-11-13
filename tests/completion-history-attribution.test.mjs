import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';

const now=Date.parse('2026-11-13T16:00:00Z');
const note='The fictional entrance is staffed.';
const link='https://example.com/entrance-confirmation';
const taskAt=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const reload=raw=>GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});
const history=task=>task.completionReportEmailHistory||[];
const sourceIds=html=>Array.from(html.matchAll(/<button[^>]*data-action="source"[^>]*data-id="([^"]+)"/g),match=>match[1]);
const actorNames={jack:'Jack <Organizer>',maya:'Maya & Team'};

function fixture({verification=true}={}){
  const store=GatherStore.createStore({storage:null,now});
  const {id}=store.addTask({title:'Fictional welcome desk',owner:'maya',requiresVerification:verification});
  return {store,id,get task(){return taskAt(store,id);},
    direct(){return store.reportCompletion(id,{note,links:[link]},'maya');},
    addEmail(options={}){
      return store.addMessage({taskId:id,sender:'Maya Singh',subject:'Fictional welcome desk report',
        body:'The welcome desk is complete.',...options});
    },
    apply(message,override={}){
      return store.applyMessage(message.id,{mode:'update',taskId:id,expectedRevision:taskAt(store,id).revision,
        status:'done',note,...override});
    },
    verify(){return store.verifyTask(id,'jack',taskAt(store,id).revision);},
    return(){return store.returnCompletion(id,'Double-check the exact entrance.','jack',taskAt(store,id).revision);},
    message(messageId){return store.getState().messages.find(message=>message.id===messageId);},
  };
}

test('only explicitly applied completion emails enter task history; identical text and timestamp do not collapse them',()=>{
  const f=fixture();
  f.direct();
  const draft=f.addEmail({subject:'Fictional unapplied completion claim'});
  assert.equal(draft.suggested.signal,'completion-report');
  assert.deepEqual(history(f.task),[]);
  const first=f.addEmail({sender:'Fictional first sender'});
  f.apply(first);
  const olderEvidence=f.task.completionEvidence;
  assert.deepEqual(Object.keys(olderEvidence).sort(),['actor','at','fileIds','links','note'],
    'the provenance field must not change the evidence schema older clients validate');
  const unrelated=f.addEmail({subject:'Fictional venue information',body:'Entrance hours for reference.'});
  f.apply(unrelated,{status:'progress'});
  const second=f.addEmail({sender:'Fictional second sender'});
  f.apply(second);
  assert.deepEqual(f.task.completionEvidence,olderEvidence,'the exact source cannot be inferred from evidence content');
  assert.equal(first.receivedAt,second.receivedAt);
  assert.equal(f.task.completionReportSourceId,second.id);
  assert.deepEqual(history(f.task),[second.id,first.id]);
  assert.ok(!history(f.task).includes(draft.id)&&!history(f.task).includes(unrelated.id));
  const snapshot=f.store.exportState();
  f.apply(first);
  assert.equal(f.store.exportState(),snapshot,'reapplying the same reviewed message is a no-op');
  assert.deepEqual(history(taskAt(reload(snapshot),f.id)),[second.id,first.id]);
});

test('the ten most recent distinct reviewed sources survive direct replacement, return, reload, and verification',()=>{
  const f=fixture(),ids=[];
  for(let i=0;i<12;i++){
    const email=f.addEmail({sender:'Fictional sender '+i});
    f.apply(email);
    ids.unshift(email.id);
  }
  const expected=ids.slice(0,10);
  assert.deepEqual(history(f.task),expected);
  assert.deepEqual(history(taskAt(reload(f.store.exportState()),f.id)),expected);
  assert.equal(f.task.completionReportSourceId,expected[0]);
  f.return();
  assert.equal(f.task.completionReportSourceId,'');
  assert.deepEqual(history(f.task),expected);
  f.direct();
  assert.equal(f.task.completionReportSourceId,'');
  assert.deepEqual(history(f.task),expected);
  const newEmail=f.addEmail();
  f.apply(newEmail);
  const verified=f.verify();
  const expectedVerified=[newEmail.id,...expected.slice(0,9)];
  assert.deepEqual(history(verified),expectedVerified);
  const later=f.addEmail({sender:'Not a replacement for verified evidence'});
  f.apply(later);
  assert.equal(f.task.sourceMessageId,later.id);
  assert.equal(f.task.completionReportSourceId,newEmail.id);
  assert.deepEqual(history(f.task),expectedVerified);
});

test('older snapshots without the optional list do not invent earlier sources from matching messages or evidence',()=>{
  const f=fixture(),older=f.addEmail(),current=f.addEmail();
  f.apply(older);
  f.apply(current);
  const raw=JSON.parse(f.store.exportState());
  delete raw.tasks.find(task=>task.id===f.id).completionReportEmailHistory;
  const restored=reload(JSON.stringify(raw));
  const task=taskAt(restored,f.id);
  assert.ok(task,'a snapshot written before this field still loads');
  assert.deepEqual(history(task),[]);
  assert.equal(task.completionReportSourceId,current.id,'existing exact current source remains supported');
  assert.equal(restored.getState().messages.filter(message=>message.appliedTaskId===f.id).length,2);
  assert.ok(task.completionEvidenceHistory.length);
  const html=GatherCompletionUI.section(task,true,true,{
    completionSource:f.message(current.id),completionHistorySources:[f.message(older.id)],memberName:id=>actorNames[id],
  });
  assert.deepEqual(sourceIds(html),[current.id]);
  assert.doesNotMatch(html,/Earlier completion emails/);
});

test('malformed optional history is discarded without changing the exact current report or other workspace data',()=>{
  const f=fixture(),message=f.addEmail();
  f.apply(message);
  const original=JSON.parse(f.store.exportState());
  for(const value of ['not a list',[message.id,message.id],[{id:message.id}],[''],
    ['id\u0000embedded'],['x'.repeat(1000)],Array.from({length:11},(_,index)=>'email-fake-'+index)]){
    const raw=structuredClone(original);
    raw.tasks.find(task=>task.id===f.id).completionReportEmailHistory=value;
    const restored=reload(JSON.stringify(raw));
    const task=taskAt(restored,f.id);
    assert.ok(task,'malformed optional provenance does not make the task unavailable');
    assert.deepEqual(history(task),[]);
    assert.equal(task.completionReportSourceId,message.id);
    assert.deepEqual(task.completionEvidence,f.task.completionEvidence);
    assert.deepEqual(restored.getState().messages.find(entry=>entry.id===message.id),f.message(message.id));
  }
});

test('current and earlier evidence use their saved recorders and escape all shown names',()=>{
  const f=fixture();
  f.direct();
  const source=f.addEmail({sender:'Fictional <Earlier sender> & Co.'});
  f.apply(source);
  const state=f.task;
  const html=GatherCompletionUI.section(state,false,false,{
    completionSource:f.message(source.id),memberName:id=>actorNames[id],
  });
  const [current,earlier]=html.split('<details class="completion-history">');
  assert.match(current,/Jack &lt;Organizer&gt;/);
  assert.match(current,/Fictional &lt;Earlier sender&gt; &amp; Co\./);
  assert.doesNotMatch(current,/<Organizer>|<Earlier sender>|Maya &amp; Team/);
  assert.match(earlier,/Maya &amp; Team/);
  assert.ok(earlier.includes(link));
  assert.doesNotMatch(earlier,/Jack &lt;Organizer&gt;/);
  const unavailable=GatherCompletionUI.section(state,false,false,{memberName:()=>''});
  assert.equal((unavailable.match(/Recorder not available/gi)||[]).length,2);
  assert.doesNotMatch(unavailable,/>jack<|>maya</);
});

test('historical links use only exact scoped recorded emails and never include the current email twice',()=>{
  const f=fixture(),first=f.addEmail({sender:'Earlier <recorded> sender',subject:'First <reviewed> report'}),current=f.addEmail();
  f.apply(first);
  f.apply(current);
  const candidate=f.message(first.id),currentMessage=f.message(current.id);
  const unrelated=f.addEmail({subject:'Not a completion email',body:'These are venue logistics only.'});
  f.apply(unrelated,{status:'progress'});
  const sources=[currentMessage,candidate,candidate,f.message(unrelated.id)];
  const render=(completionHistorySources,completionSource=currentMessage)=>
    GatherCompletionUI.section(f.task,false,false,{completionSource,completionHistorySources,memberName:id=>actorNames[id]});
  const html=render(sources);
  assert.match(html,/Earlier completion emails/);
  assert.match(html,/Earlier &lt;recorded&gt; sender/);
  assert.match(html,/First &lt;reviewed&gt; report/);
  assert.doesNotMatch(html,/<recorded>|<reviewed>/);
  assert.deepEqual(sourceIds(html),[current.id,first.id]);
  assert.deepEqual(sourceIds(render([])),[current.id],'do not invent a link for an unavailable historical message');
  assert.deepEqual(sourceIds(render([{...candidate,appliedTaskId:'different-task'}])),[current.id],
    'even a matching recorded ID must resolve to the same task');
  f.direct();
  assert.equal(f.task.completionReportSourceId,'');
  assert.deepEqual(sourceIds(render([currentMessage,candidate])),[current.id,first.id]);
});
