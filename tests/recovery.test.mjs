import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/store.js';
import '../legacy/priorities.js';
const now=new Date('2026-09-24T12:00:00Z');
const create=()=>GatherStore.createStore({storage:null,now:now.getTime()});
const get=(store,id)=>store.getState().tasks.find(task=>task.id===id);
const decision={action:'checkin',note:'Keep the agreed plan.',reviewAfter:'2026-09-30'};

test('Next up is owner-controlled, three-slot limited, atomic and distinct from assignments',()=>{
  const store=create(),tasks=Array.from({length:4},(_,i)=>store.addTask({title:'Work '+i,owner:'maya',status:'todo'}));
  for(const task of tasks.slice(0,3))store.setNextUp(task.id,{enabled:true},'maya');
  const before=store.exportState();
  assert.throws(()=>store.setNextUp(tasks[3].id,{enabled:true},'maya'),/three/);
  assert.throws(()=>store.setNextUp(tasks[3].id,{enabled:true,replaceTaskId:'bad'},'maya'));
  assert.throws(()=>store.setNextUp(tasks[3].id,{enabled:true},'jack'),/owner/);
  assert.equal(store.exportState(),before);
  store.setNextUp(tasks[3].id,{enabled:true,replaceTaskId:tasks[0].id},'maya');
  assert.equal(GatherPriorities.nextUp(store.getState().tasks,'maya').length,3);
  assert.equal(get(store,tasks[0].id).owner,'maya');
  assert.equal(get(store,tasks[0].id).nextUpAt,'');
  assert.ok(get(store,tasks[3].id).acceptedAt);
  store.requestRecovery(tasks[3].id,{kind:'help',note:'Need another owner.'},'maya');
  assert.equal(get(store,tasks[3].id).nextUpAt,'');
});

test('date proposals preserve the plan, reject stale approvals and protect fixed deadlines',()=>{
  const store=create();store.updateTask('dietary',{dueDate:'2026-09-25'});store.setTaskPriority('dietary',{priority:'auto',hardDeadline:true});
  store.requestRecovery('dietary',{kind:'date',note:'Waiting for responses.',proposedDate:'2026-09-28'},'maya');
  const task=get(store,'dietary'),requestId=task.recoveryRequests.at(-1).id,before=store.exportState();
  assert.equal(task.dueDate,'2026-09-25');
  assert.throws(()=>store.resolveRecovery('dietary',{...decision,action:'date',dueDate:'2026-09-28',requestId}),/external deadline/);
  assert.throws(()=>store.resolveRecovery('dietary',{...decision,requestId},'maya'),/organizer/);
  assert.equal(store.exportState(),before);
  store.resolveRecovery('dietary',{...decision,action:'date',dueDate:'2026-09-28',requestId,confirmHardDeadline:true});
  const updated=get(store,'dietary');
  assert.equal(updated.dueDate,'2026-09-28');assert.equal(updated.updatedAt,task.updatedAt);
  assert.equal(updated.recoveryRequests.at(-1).status,'resolved');assert.equal(updated.deadlineHistory.at(-1).from,'2026-09-25');
  assert.equal(updated.followupAfter,decision.reviewAfter);assert.ok(updated.comments.at(-1).text.includes('2026-09-28'));
  assert.throws(()=>store.resolveRecovery('dietary',{...decision,requestId}),/already handled/);
});

test('accepted completion email supersedes help requests and blocks reassignment decisions until verified',()=>{
  const store=create();store.updateTask('dietary',{requiresVerification:true});
  store.requestRecovery('dietary',{kind:'help',note:'Need another owner.'},'maya');
  const message=store.addMessage({sender:'Maya Singh',subject:'Dietary restrictions complete',taskId:'dietary',body:'All dietary restrictions collected. This task is complete.'});
  store.applyMessage(message.id,{status:'done'});
  const task=get(store,'dietary');
  assert.ok(task.reportedAt);assert.equal(GatherPriorities.pendingRequest(task),undefined);
  assert.throws(()=>store.resolveRecovery('dietary',{...decision,action:'reassign',owner:'jules'}),/verification/);
  assert.ok(GatherPriorities.rank(store.getState().tasks,now).some(t=>t.id==='dietary'));
});

test('new follow-up replaces old check-in; owner response acknowledges the reminder',()=>{
  const store=create(),task=store.addTask({title:'Check program',owner:'maya',dueDate:'2026-10-20',status:'progress'});
  store.acceptTask(task.id,'maya');store.resolveRecovery(task.id,{...decision,reviewAfter:'2026-09-25'});
  store.recordFollowup(task.id,'2026-09-30');
  assert.equal(get(store,task.id).planReviewAfter,'2026-09-30');
  assert.equal(GatherPriorities.decision(get(store,task.id),[],new Date('2026-09-27T12:00:00Z')),null);
  store.addComment(task.id,'Everything is on track.','maya');
  const info=GatherPriorities.analyze(get(store,task.id),[],new Date('2026-10-01T12:00:00Z'));
  assert.ok(!info?.factors.some(f=>f.key==='followup'));
});

test('hard deadlines and critical prerequisites outrank old optional tasks; verification is never hidden',()=>{
  const base={owner:'maya',status:'progress',acceptedAt:now.toISOString(),updatedAt:now.toISOString(),dependencies:[],priority:'auto'};
  const old={...base,id:'old',dueDate:'2026-08-01',priority:'low'};
  const child={...base,id:'child',dueDate:'2026-10-01'};
  const parent={...base,id:'parent',status:'blocked',dueDate:'2026-09-25',hardDeadline:true,dependencies:[{taskId:'child'}]};
  assert.deepEqual(GatherPriorities.rank([old,parent,child],now).map(t=>t.id),['child','old']);
  parent.reportedAt=now.toISOString();parent.requiresVerification=true;
  assert.ok(GatherPriorities.rank([old,parent,child],now).some(t=>t.id==='parent'));
});

test('a new acceptance or commitment acknowledges a check-in despite an older owner note',()=>{
  const task={id:'accepted',owner:'maya',status:'progress',dueDate:'2026-10-20',updatedAt:'2026-09-20T12:00:00Z',ownerRespondedAt:'2026-09-21T12:00:00Z',followupSentAt:'2026-09-24T12:00:00Z',followupAfter:'2026-09-25',planReviewAfter:'2026-09-25',acceptedAt:'2026-09-25T12:00:00Z'};
  assert.equal(GatherPriorities.decision(task,[task],new Date('2026-09-26T12:00:00Z')),null);
  assert.equal(GatherPriorities.analyze(task,[task],new Date('2026-09-26T12:00:00Z')),null);
  task.acceptedAt='2026-09-20T12:00:00Z';task.nextUpAt='2026-09-25T12:00:00Z';
  assert.equal(GatherPriorities.analyze(task,[task],new Date('2026-09-26T12:00:00Z')),null);
});
