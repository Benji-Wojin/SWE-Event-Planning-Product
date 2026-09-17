import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';
import '../legacy/inbox.js';

const create=()=>GatherStore.createStore({storage:null});
const add=(store,body,extra={})=>store.addMessage({sender:'Jules Miller',subject:'Bus update',taskId:'bus',body,...extra});
const group=(store,id)=>GatherInbox.conversations(store.getState()).find(g=>g.messages.some(m=>m.id===id));

test('briefings preserve late caveats and exclude greetings and quoted history',()=>{
  const summary=GatherInbox.shortUpdate({body:'Hi Jack, The route is planned. I checked the schedule. However, the deposit is still pending.\n  > Booking confirmed.'});
  assert.match(summary,/route is planned/);
  assert.match(summary,/However, the deposit is still pending/);
  assert.doesNotMatch(summary,/Hi Jack|Booking confirmed/);
  assert.match(GatherInbox.shortUpdate({body:'We are no longer blocked. However, the deposit is still pending.'}),/deposit is still pending/);
  assert.ok(GatherInbox.shortUpdate({body:'x'.repeat(12000)}).length<100);
});

test('negation, exceptions, future claims and old quoted completions are not reported complete',()=>{
  for(const body of ["The buses aren’t confirmed.","Don't mark this complete.","It didn't get confirmed.","The booking doesn't count as confirmed.",'No one has confirmed the buses.','All tasks are done except the bus deposit.','The venue is done. The buses are not confirmed.','The buses will be confirmed tomorrow.','Please check with me.\n  > Booking confirmed.']) {
    const store=create(),m=add(store,body);
    assert.notEqual(m.suggested.signal,'completion-report',body);
    assert.notEqual(GatherInbox.briefing(group(store,m.id),store.getState()).label,'Completion reported',body);
  }
  const store=create(),m=add(store,'We are no longer blocked. Both buses are confirmed.');
  assert.equal(m.suggested.signal,'completion-report');
});

test('saved old analysis cannot apply until refreshed',()=>{
  const original=create(),m=add(original,'The buses aren’t confirmed.');
  const data=JSON.parse(original.exportState()),saved=data.messages.find(item=>item.id===m.id);
  delete saved.suggested.analysisVersion;saved.suggested.status='done';saved.suggested.signal='completion-report';
  let raw=JSON.stringify(data);
  const store=GatherStore.createStore({storage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value;}}});
  const b=GatherInbox.briefing(group(store,m.id),store.getState());
  assert.equal(b.label,'Refresh needed');
  assert.equal(b.stale,true);
  assert.throws(()=>store.applyMessage(m.id,{analysisVersion:2}),/Refresh this suggestion/);
  store.refreshProposal(m.id);
  assert.notEqual(store.getState().messages.find(item=>item.id===m.id).suggested.signal,'completion-report');
  store.applyMessage(m.id);
  assert.notEqual(store.getState().tasks.find(t=>t.id==='bus').status,'done');
});

test('completion briefings describe verification requirements and do not mutate tasks',()=>{
  const store=create();store.updateTask('bus',{requiresVerification:true});
  const m=add(store,'Both buses are confirmed.'),before=store.exportState();
  const brief=GatherInbox.briefing(group(store,m.id),store.getState());
  assert.equal(brief.message.id,m.id);
  assert.match(brief.next,/stays in progress.*verifies/);
  assert.equal(store.exportState(),before);
});

test('the selected source determines the briefing; older and stale proposals stay distinct',()=>{
  const store=create(),old=add(store,'Deposit is pending.',{receivedAt:'2025-01-01'}),fresh=add(store,'Both buses are confirmed.',{receivedAt:'2026-12-01'});
  const g=group(store,old.id),b=GatherInbox.briefing(g,store.getState(),old);
  assert.equal(b.message.id,old.id);
  assert.match(b.summary,/pending/);
  assert.equal(b.historical,true);
  assert.equal(b.label,'Older update');
  assert.match(b.next,/newer email/);
  store.updateTask('bus',{note:'Organizer has a new count.'});
  const stale=GatherInbox.briefing(group(store,fresh.id),store.getState(),fresh);
  assert.equal(stale.stale,true);
  assert.match(stale.next,/Refresh/);
});

test('briefing feed starts with summaries, keeps raw sources collapsed, and reviews one exact email',()=>{
  const store=create(),m=add(store,'<img src=x onerror=alert(1)> Deposit is pending.');
  const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context=vm.createContext({GatherInbox,store,window:{},isOrganizer:()=>true,ui:{messageId:''},h,icon:()=>'',pageHeading:(_e,t)=>t,empty:()=>'',member:id=>({name:id}),dayLabel:x=>x,timeLabel:x=>x,statuses:{blocked:'Blocked',progress:'In progress',done:'Done',todo:'To do'},options:()=>'',ownerOptions:()=>'',statusOptions:()=>''});
  vm.runInContext(readFileSync('legacy/inbox-view.js','utf8'),context);
  let html=context.inboxView(store.getState());
  assert.match(html,/Email briefing/);
  assert.match(html,/Suggested next step/);
  assert.match(html,/<details class="briefing-sources">/);
  assert.match(html,/<details class="briefing-original">/);
  assert.doesNotMatch(html,/id="emailReviewForm"|<img/);
  assert.match(html,/&lt;img/);
  context.ui.messageId=m.id;
  html=context.inboxView(store.getState());
  assert.match(html,new RegExp('id="emailReviewForm" data-id="'+m.id+'"'));
  assert.match(html,/BEFORE YOU ACCEPT/);
  assert.match(html,/After accepting/);
  assert.equal((html.match(/id="emailReviewForm"/g)||[]).length,1);
  context.window.GatherMode={demo:true};
  assert.doesNotMatch(context.inboxView(store.getState()),/href="\/(?:mail|settings)"/);
  context.isOrganizer=()=>false;
  html=context.inboxView(store.getState());
  assert.match(html,/Only the organizer can accept/);
  assert.doesNotMatch(html,/id="emailReviewForm"|data-action="sample-reply"|data-action="paste-email"/);
});
