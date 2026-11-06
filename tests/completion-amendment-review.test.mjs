import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';
import '../legacy/schedule-ui.js';
import '../legacy/wrap-up.js';
const current=(store,id)=>store.getState().tasks.find(task=>task.id===id);
function fixture(){
  const store=GatherStore.createStore({storage:null,now:Date.parse('2027-02-01T12:00Z')});
  const task=store.addTask({title:'Fictional hall handoff',owner:'maya',requiresVerification:true,scope:'Record the agreed hall handoff.'});
  store.reportCompletion(task.id,'Original fictional report.','maya');store.verifyTask(task.id);
  store.setCompletionEvidence(task.id,{note:'Amended fictional detail.'},'maya');
  return {store,id:task.id};
}
test('explicit organizer acknowledgment clears amendment attention, preserves completion and records who reviewed which revision',()=>{
  const {store,id}=fixture(),before=current(store,id);let saves=0;store.subscribe(()=>saves++);
  const reviewed=store.reviewCompletionEvidence(id,before.revision,'jack');
  assert.equal(saves,1);assert.equal(reviewed.completionEvidenceReviewAt,before.verifiedAt);
  assert.equal(reviewed.revision,before.revision+1);
  for(const field of ['status','verifiedAt','verifiedBy','reportedAt','reportedBy','completedAt','completedBy','note','scope','owner','updatedAt','updatedBy','noteUpdatedAt','noteUpdatedBy','completionResult','completionEvidence','completionEvidenceHistory','dependencies'])assert.deepEqual(reviewed[field],before[field],field);
  assert.equal(reviewed.comments.at(-1).actor,'jack');assert.equal(reviewed.comments.at(-1).kind,'completion-evidence-reviewed');
  assert.match(reviewed.comments.at(-1).text,new RegExp('task revision '+before.revision));
  assert.equal(store.getState().activity[0].type,'completion-evidence-reviewed');
  assert.doesNotMatch(GatherCompletionUI.section(reviewed,true,true),/amended after task verification|I reviewed this amendment/);
  assert.doesNotMatch(GatherWrapUp.markup(store.getState()),/Evidence amended after verification/);
  assert.equal(GatherScheduleUI.reviewItems(store.getState()).find(group=>group.key==='evidence-amendments').tasks.length,0);
  const raw=store.exportState(),loaded=GatherStore.createStore({storage:{getItem:()=>raw,setItem(){}}});
  assert.equal(current(loaded,id).completionEvidenceReviewAt,before.verifiedAt);
  store.setCompletionEvidence(id,{note:'A second amendment in the same millisecond.'},'maya');
  assert.equal(current(store,id).completionEvidence.at,before.completionEvidence.at);
  assert.equal(current(store,id).completionEvidenceReviewAt,'');
  assert.match(GatherWrapUp.markup(store.getState()),/Evidence amended after verification/);
});
test('members, invalid or stale task revisions and unverified reports cannot acknowledge an amendment',()=>{
  const {store,id}=fixture(),task=current(store,id),before=store.exportState();
  for(const actor of ['maya','dev','missing']){assert.throws(()=>store.reviewCompletionEvidence(id,task.revision,actor));assert.equal(store.exportState(),before);}
  for(const revision of [null,undefined,0,-1,1.5,String(task.revision),task.revision-1,task.revision+1]){assert.throws(()=>store.reviewCompletionEvidence(id,revision,'jack'));assert.equal(store.exportState(),before);}
  store.setCompletionEvidence(id,{note:'Newer unseen amendment.'},'maya');const newer=store.exportState();
  assert.throws(()=>store.reviewCompletionEvidence(id,task.revision,'jack'),/changed/);assert.equal(store.exportState(),newer);
  const pending=store.addTask({title:'Unverified task',owner:'maya',requiresVerification:true});store.reportCompletion(pending.id,'Reported.','maya');
  const stable=store.exportState();assert.throws(()=>store.reviewCompletionEvidence(pending.id,current(store,pending.id).revision,'jack'),/verified/);assert.equal(store.exportState(),stable);
});
test('only the organizer gets an explicit revision-bound review control, separate from editing evidence',()=>{
  const {store,id}=fixture(),task=current(store,id);
  const html=GatherCompletionUI.section(task,true,true);
  assert.match(html,/I reviewed this amendment/);assert.match(html,new RegExp('data-revision="'+task.revision+'"'));
  assert.match(html,/does not reverify the task/);
  for(const args of [[true,false],[false,false],[true]])assert.doesNotMatch(GatherCompletionUI.section(task,...args),/I reviewed this amendment/);
  const app=readFileSync('legacy/app.js','utf8'),prepare=readFileSync('scripts/prepare.mjs','utf8');
  assert.match(app,/section\(task,own\|\|organizer,organizer\)/);
  assert.match(app,/store\.reviewCompletionEvidence\(id,Number\(el.dataset.revision\),ui.actor\)/);
  assert.match(prepare,/'reviewCompletionEvidence'/);
  assert.match(readFileSync('legacy/hosted-store.js','utf8'),/reviewCompletionEvidence: 2/);
});
test('successful acknowledgment discards confirmed drafts, but a rejected save never rebuilds or clears them',async()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function taskDialog('),end=source.indexOf('    const expanded=',start);
  let captures=0;const context=vm.createContext({store:{getState:()=>({tasks:[{id:'fictional'}]})},ui:{dialogKind:'task',detailId:'fictional'},taskDrafts(){captures++;return ['unsaved-evidence','unsaved-comment'];},toast(){}});
  vm.runInContext(source.slice(start,end)+'return drafts;}',context);
  assert.deepEqual([...context.taskDialog('fictional','',true)],[]);assert.equal(captures,0);
  assert.deepEqual([...context.taskDialog('fictional')],['unsaved-evidence','unsaved-comment']);assert.equal(captures,1);
  const line=source.split('\n').find(line=>line.includes("if(action==='review-completion-evidence')"));
  const handler=line.replace('store.reviewCompletionEvidence(','await store.reviewCompletionEvidence(');
  let rebuilt=0,rendered=0,notified=0,fail=false;
  const run=()=>vm.runInNewContext('(async()=>{'+handler+'})()',{
    action:'review-completion-evidence',id:'fictional',el:{dataset:{revision:'6'}},ui:{actor:'jack'},window:{},isOrganizer:()=>true,
    store:{async reviewCompletionEvidence(id,revision,actor){assert.equal(id,'fictional');assert.equal(revision,6);assert.equal(actor,'jack');if(fail)throw Error('Stale task');}},
    render(){rendered++;},taskDialog(id,excluded,discard){assert.equal(discard,true);rebuilt++;},toast(){notified++;}
  });
  await run();assert.equal(rebuilt,1);assert.equal(rendered,1);assert.equal(notified,1);
  fail=true;await assert.rejects(run(),/Stale task/);assert.equal(rebuilt,1);assert.equal(rendered,1);assert.equal(notified,1);
});
