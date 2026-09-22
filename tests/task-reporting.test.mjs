import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';

const create = () => GatherStore.createStore({ storage: null });
const getTask = store => store.getState().tasks.find(t => t.id === 'dietary');
const metadata = task => Object.fromEntries(['title','owner','dueDate','category','requiresVerification'].map(key => [key,task[key]]));

test('reassignment clears old email acceptance and follow-up timing without erasing history',()=>{
  const store=create(),parent=store.addTask({title:'Check the coach schedule',owner:'jules',status:'progress'});
  const email=store.addMessage({sender:'Jules Miller',subject:'Coach schedule',taskId:parent.id,body:'I accept this task.'});
  store.applyMessage(email.id);store.recordFollowup(parent.id,'2030-01-01');
  const current=()=>store.getState().tasks.find(t=>t.id===parent.id);
  assert.equal(current().acceptedSourceId,email.id);
  store.updateTask(parent.id,{owner:'maya'});
  for(const key of ['acceptedAt','acceptedBy','acceptedSourceId','acceptedRecordedBy','followupAfter'])assert.equal(current()[key],'',key);
  store.acceptTask(parent.id,'maya');assert.equal(current().acceptedBy,'maya');assert.equal(current().acceptedSourceId,'');
  assert.equal(store.getState().messages.find(m=>m.id===email.id).appliedTaskId,parent.id);
  assert.ok(store.getState().activity.some(a=>a.taskId===parent.id&&a.type==='followup-recorded'));
  const data=JSON.parse(store.exportState()),stale=data.tasks.find(t=>t.id===parent.id);stale.acceptedAt='';stale.acceptedSourceId=email.id;stale.acceptedRecordedBy='jack';
  let raw=JSON.stringify(data);const recovered=GatherStore.createStore({storage:{getItem:()=>raw,setItem:(_key,value)=>raw=value}});
  recovered.acceptTask(parent.id,'maya');assert.equal(recovered.getState().tasks.find(t=>t.id===parent.id).acceptedSourceId,'');
});

test('reached follow-up dates appear in attention while future dates remain quiet',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const context=vm.createContext({dateKey:()=> '2026-09-22',dependencyInfo:()=>({ready:false})});
  vm.runInContext(source.slice(source.indexOf('  const reason ='),source.indexOf('  const attention ='))+'globalThis.reason=reason;',context);
  const task={owner:'maya',status:'progress',acceptedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),dueDate:'2026-10-06'};
  assert.equal(context.reason({...task,followupAfter:'2026-09-22'}).key,'followup');
  assert.equal(context.reason({...task,followupAfter:'2026-09-21'}).key,'followup');
  assert.equal(context.reason({...task,followupAfter:'2026-09-23'}),null);
  assert.equal(context.reason({...task,status:'done',followupAfter:'2026-09-21'}),null);
});

test('discard checks detect changed values but ignore untouched, hidden and read-only fields',()=>{
  const source=readFileSync('legacy/app.js','utf8');let prompts=0;
  const context=vm.createContext({$$:(_selector,root)=>root.fields,window:{confirm:()=>{prompts++;return false;}}});
  vm.runInContext(source.slice(source.indexOf('  function hasUnsavedFields('),source.indexOf('  const unsavedDialog=')),context);
  const root={fields:[
    {tagName:'INPUT',type:'text',name:'title',value:'Same',defaultValue:'Same'},
    {tagName:'TEXTAREA',name:'note',value:'Same note',defaultValue:'Same note'},
    {tagName:'SELECT',name:'owner',value:'maya',options:[{value:'jack'},{value:'maya',defaultSelected:true}]},
    {tagName:'INPUT',type:'checkbox',checked:false,defaultChecked:false},
    {tagName:'INPUT',type:'hidden',value:'2',defaultValue:'1'},
    {tagName:'TEXTAREA',readOnly:true,value:'Private preview',defaultValue:''},
  ]};
  assert.equal(context.confirmDiscard(root),true);assert.equal(prompts,0);
  root.fields[0].value='Edited';assert.equal(context.hasUnsavedFields(root),true);assert.equal(context.hasUnsavedFields(root,['title']),false);assert.equal(context.confirmDiscard(root),false);assert.equal(prompts,1);
  root.fields[0].value='Same';root.fields[2].value='jack';assert.equal(context.hasUnsavedFields(root),true);
  root.fields[2].value='maya';root.fields[3].checked=true;assert.equal(context.hasUnsavedFields(root),true);
});

test('editing a follow-up preserves the exact text and clears the previous sent marker',()=>{
  const store=create();
  store.saveDraft('bus','Original message','jack');
  store.recordFollowup('bus','2030-01-01','jack');
  const sent=()=>store.getState().drafts.find(d=>d.taskId==='bus');
  assert.ok(sent().manuallySentAt);
  store.saveDraft('bus','Original message','jack');
  assert.ok(sent().manuallySentAt);
  store.saveDraft('bus','Edited message','jack');
  assert.equal(sent().text,'Edited message');
  assert.ok(!sent().manuallySentAt);
  const before=store.exportState();
  assert.throws(()=>store.saveDraft('bus','x'.repeat(5001),'jack'),/5,000/);
  assert.equal(store.exportState(),before);
  store.recordFollowup('bus','2030-01-02','jack');
  assert.ok(sent().manuallySentAt);
  assert.equal(sent().text,'Edited message');
});

test('teammates report their own work but cannot edit task details or complete through a generic patch', () => {
  const store = create(), before = store.exportState(), task = getTask(store);
  for (const patch of [{title:task.title}, {dueDate:task.dueDate}, {owner:'maya'}, {category:task.category}, {requiresVerification:false}, {status:'done'}, {status:'blocked',note:'  '}]) {
    assert.throws(() => store.updateTask('dietary',patch,'maya'));
    assert.equal(store.exportState(),before);
  }
  assert.throws(() => store.updateTask('bus',{status:'blocked',note:'Need help'},'maya'),/assigned owner/);
  store.updateTask('dietary',{title:'Confirm meals',dueDate:'2027-01-02'},'jack');
  assert.equal(getTask(store).title,'Confirm meals');
});

test('completion records the owner and preserves task details with and without verification', () => {
  for (const verification of [true,false]) {
    const store = create();
    store.updateTask('dietary',{requiresVerification:verification},'jack');
    const before = metadata(getTask(store));
    assert.throws(() => store.reportCompletion('dietary','  ','maya'),/completion note/);
    store.reportCompletion('dietary','All dietary needs confirmed.','maya');
    const task = getTask(store);
    assert.deepEqual(metadata(task),before);
    assert.equal(task.status,verification?'progress':'done');
    assert.equal(task.reportedBy,'Maya Singh');
    assert.ok(task.reportedAt);
    assert.equal(task.verifiedAt,'');
  }
});

test('a blocker or fresh progress replaces a pending report; comments preserve attribution', () => {
  for (const status of ['blocked','progress']) {
    const store = create();
    store.updateTask('dietary',{requiresVerification:true},'jack');
    const before = metadata(getTask(store));
    store.reportCompletion('dietary','Meals confirmed.','maya');
    store.updateTask('dietary',{status,note:'One guest changed their requirements.'},'maya');
    assert.deepEqual(metadata(getTask(store)),before);
    assert.equal(getTask(store).status,status);
    assert.equal(getTask(store).reportedAt,'');
    assert.equal(getTask(store).reportedBy,'');
    assert.throws(() => store.verifyTask('dietary','jack'),/no completion report/);
    store.addComment('dietary','Can Jack check with the caterer?','maya');
    assert.equal(getTask(store).comments.at(-1).actor,'maya');
  }
});

function taskDialogHtml(actor,id='dietary',identity) {
  const source=readFileSync('legacy/app.js','utf8');
  let html='';
  const context=vm.createContext({
    store:create(),ui:{actor},window:identity?{GatherIdentity:identity}:{},
    openDialog:(_title,body)=>{html=body;},toast:()=>{},
    h:value=>String(value??'').replaceAll('<','&lt;'),
    statusBadge:status=>status,sourceButton:()=>'',dayLabel:value=>value,
    timeLabel:value=>value,relative:value=>value,completionText:()=>'',
    commitment:()=>'',member:id=>({name:id}),avatar:()=>'',ownerOptions:()=>'',statusOptions:()=>'',options:()=>'',
  });
  context.statuses={todo:'To do',progress:'In progress',blocked:'Blocked',done:'Done'};
  vm.runInContext(source.match(/  const isOrganizer = .*;/)[0]+source.slice(source.indexOf('  function dependencyInfo('),source.indexOf('  function newTaskDialog(')),context);
  context.taskDialog(id);
  return html;
}

test('saving organizer details does not withdraw the organizer’s own pending completion', () => {
  const store=create();
  store.updateTask('dietary',{owner:'jack',requiresVerification:true},'jack');
  store.reportCompletion('dietary','All confirmed.','jack');
  const task=getTask(store);
  store.updateTask('dietary',{...metadata(task),status:task.status,note:task.note},'jack');
  assert.equal(getTask(store).reportedAt,task.reportedAt);
  assert.equal(getTask(store).revision,task.revision);
});

test('changing a pending completion note clears the old report but metadata-only edits preserve it',()=>{
  const store=create();store.updateTask('dietary',{requiresVerification:true});
  store.reportCompletion('dietary','All 24 meal requirements recorded.','maya');
  const report=getTask(store);
  store.updateTask('dietary',{...metadata(report),status:report.status,note:report.note,dueDate:'2027-01-03'});
  assert.equal(getTask(store).reportedAt,report.reportedAt);
  const latest=getTask(store);
  store.updateTask('dietary',{...metadata(latest),status:latest.status,note:'Need to collect five new guest responses.'});
  assert.equal(getTask(store).reportedAt,'');
  assert.equal(getTask(store).reportedBy,'');
  assert.throws(()=>store.verifyTask('dietary'),/no completion report/);
});

test('completed tasks must be reopened before introducing verification',()=>{
  const store=create(),before=store.exportState();
  assert.throws(()=>store.updateTask('venue',{requiresVerification:true}),/Reopen this task/);
  assert.equal(store.exportState(),before);
  const venue=store.getState().tasks.find(t=>t.id==='venue');
  store.updateTask('venue',{...metadata(venue),status:'done',note:venue.note});
  store.updateTask('venue',{status:'todo'});
  assert.equal(store.updateTask('venue',{requiresVerification:true}).requiresVerification,true);
});

test('task dialog leads with context and reporting, with editor hidden from teammates', () => {
  const maya=taskDialogHtml('maya');
  assert.match(maya,/Assigned to/);
  assert.match(maya,/Report complete/);
  assert.match(maya,/Report blocked/);
  assert.match(maya,/id="commentForm"/);
  assert.match(maya,/name="note"[^>]*><\/textarea>/);
  assert.doesNotMatch(maya,/name="(?:title|dueDate|owner|category|status)"|taskDetailForm|Edit task details/);
  const other=taskDialogHtml('maya','bus');
  assert.doesNotMatch(other,/id="responseForm"/);
  assert.match(other,/id="commentForm"/);
  const jack=taskDialogHtml('jack');
  assert.match(jack,/<details class="task-organizer section-gap"><summary>Edit task details/);
  assert.ok(jack.indexOf('id="commentForm"') < jack.indexOf('id="taskDetailForm"'));
  assert.doesNotMatch(taskDialogHtml('jack','dietary',{role:'member'}),/taskDetailForm/);
  assert.match(taskDialogHtml('maya','wayfinding'), /data-action="claim"[^>]*>Claim task/);
  assert.doesNotMatch(maya, /data-action="claim"/);
});

test('claiming assigns and accepts once without altering task details or stealing assigned work', () => {
  const store=create(), before=store.getState().tasks.find(t=>t.id==='wayfinding');
  const claimed=store.claimTask('wayfinding','maya');
  assert.equal(claimed.owner,'maya');
  assert.equal(claimed.acceptedBy,'maya');
  assert.ok(claimed.acceptedAt);
  assert.equal(claimed.revision,before.revision+1);
  for(const key of ['title','dueDate','category','status','note'])assert.equal(claimed[key],before[key]);
  const saved=store.exportState();
  for(const actor of ['maya','dev'])assert.throws(()=>store.claimTask('wayfinding',actor),/already has an owner/);
  assert.equal(store.exportState(),saved);
  assert.equal(store.getState().activity.filter(a=>a.type==='claimed'&&a.taskId==='wayfinding').length,1);
  const done=store.addTask({title:'Finished unassigned task',status:'done'});
  assert.throws(()=>store.claimTask(done.id,'maya'),/Completed tasks/);
});

test('task refresh preserves only dirty sibling fields, excluding the submitted form',()=>{
  const forms=[
    {id:'commentForm',inputs:[{name:'text',tagName:'TEXTAREA',value:'Posted comment',defaultValue:''}]},
    {id:'responseForm',inputs:[{name:'note',tagName:'TEXTAREA',value:'Unsent update',defaultValue:''}]},
    {id:'taskDetailForm',inputs:[
      {name:'title',tagName:'INPUT',value:'Same title',defaultValue:'Same title'},
      {name:'note',tagName:'TEXTAREA',value:'Original note',defaultValue:'Original note'},
      {name:'owner',tagName:'SELECT',value:'dev',options:[{value:'',defaultSelected:false},{value:'maya',defaultSelected:true},{value:'dev',defaultSelected:false}]},
      {name:'additional',type:'checkbox',value:'on',checked:true,defaultChecked:false},
    ]},
  ];
  const source=readFileSync('legacy/app.js','utf8');
  const context=vm.createContext({ui:{dialogKind:'task'},$$:(_selector,root)=>root?root.inputs:forms});
  vm.runInContext(source.slice(source.indexOf('  function taskDrafts('),source.indexOf('  function taskDialog(')),context);
  const drafts=JSON.parse(JSON.stringify(context.taskDrafts('commentForm')));
  assert.deepEqual(drafts.map(field=>[field.form,field.name,field.value]),[
    ['responseForm','note','Unsent update'],['taskDetailForm','owner','dev'],['taskDetailForm','additional','on'],
  ]);
  assert.equal(drafts[2].checked,true);
  context.ui.dialogKind='private';assert.equal(context.taskDrafts().length,0);
});
