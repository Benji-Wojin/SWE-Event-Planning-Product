import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';

const create = () => GatherStore.createStore({ storage: null });
const getTask = store => store.getState().tasks.find(t => t.id === 'dietary');
const metadata = task => Object.fromEntries(['title','owner','dueDate','category','requiresVerification'].map(key => [key,task[key]]));

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
  vm.runInContext(source.match(/  const isOrganizer = .*;/)[0]+source.slice(source.indexOf('  function taskDialog('),source.indexOf('  function newTaskDialog(')),context);
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
