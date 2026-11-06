import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui = GatherScheduleUI.create({h, options:()=>'', person:id=>h(id||'Unassigned'), statusBadge:status=>'<span>'+h(status)+'</span>'});
const now = Date.parse('2100-03-15T01:00:00Z');
function fixture() {
  const store = GatherStore.createStore({storage:null});
  store.completeSetup({name:'Fictional school event',date:'2100-03-14',timeZone:'America/Los_Angeles'});
  const item = store.addTask({title:'Fictional hall check',owner:'maya',requiresVerification:true});
  store.setTaskSchedule(item.id,{start:'2100-03-14T18:00',end:'2100-03-14T18:30',location:'Hall'});
  store.reportCompletion(item.id,{note:'PRIVATE original report.',links:['https://www.nasa.gov/']},'maya');
  store.verifyTask(item.id);
  return {store,id:item.id};
}

test('amended evidence remains visible from before-event review through schedule and run sheet without changing verification',()=>{
  const {store,id}=fixture();
  const group = state => GatherScheduleUI.reviewItems(state,now).find(g=>g.key==='evidence-amendments');
  assert.deepEqual(group(store.getState())?.tasks,[]);
  const original = store.getState().tasks.find(t=>t.id===id);
  store.setCompletionEvidence(id,{note:'PRIVATE amended report.',fileIds:['private_file']},'maya');
  const state=store.getState(),before=structuredClone(state),task=state.tasks.find(t=>t.id===id);
  assert.equal(task.verifiedAt,original.verifiedAt);
  assert.equal(task.status,'done');
  assert.deepEqual(group(state).tasks.map(t=>t.id),[id]);
  for(const html of [ui.preparationReview(state,now),ui.view(state,true,now),ui.clock(state,now).markup,ui.runSheet(state,now)]) {
    assert.match(html,/Evidence amended after verification/);
    assert.match(html,/Fictional hall check/);
    assert.doesNotMatch(html,/PRIVATE|private_file|nasa\.gov/);
  }
  const sheet=ui.runSheet(state,now);
  assert.match(sheet,/>Done<span>Evidence amended after verification<\/span>/);
  assert.match(sheet,/Task verification is unchanged/);
  assert.deepEqual(state,before);
});

test('amendment attention is scoped, independent of activity time and absent for reviewed or unverified evidence',()=>{
  const {store,id}=fixture();store.setCompletionEvidence(id,{note:'PRIVATE amended report.'},'maya');
  const state=store.getState(),task=state.tasks.find(t=>t.id===id);
  const amended = (s,scope={}) => GatherScheduleUI.reviewItems(s,now,scope).find(g=>g.key==='evidence-amendments').tasks;
  assert.deepEqual(amended(state,{mine:true,actor:'dev'}),[]);
  assert.deepEqual(amended(state,{mine:true}),[]);
  assert.deepEqual(amended(state,{mine:true,actor:'maya'}).map(t=>t.id),[id]);
  assert.doesNotMatch(ui.runSheet(state,now,{mine:true,actor:'dev'}),/Evidence amended|PRIVATE/);
  task.schedule=null;
  assert.deepEqual(amended(state).map(t=>t.id),[id]);
  assert.doesNotMatch(ui.runSheet(state,now),/Evidence amended after verification/);
  for(const patch of [{completionEvidence:null},{verifiedAt:''},{completionEvidenceReviewAt:task.verifiedAt}]) {
    const copy=structuredClone(state);Object.assign(copy.tasks.find(t=>t.id===id),patch);
    assert.deepEqual(amended(copy),[]);
  }
  task.completionEvidenceReviewAt='2099-01-01T00:00:00.000Z';
  assert.equal(amended(state).length,1,'a mismatched old review is not the current verification');
});
