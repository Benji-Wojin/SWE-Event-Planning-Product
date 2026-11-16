import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/planning-ui.js';
import '../legacy/recovery-ui.js';
import '../legacy/completion-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const day = '2026-11-20';
const reviewAfter = '2026-11-21';
const replyText = 'FICTIONAL REQUEST REPLY';
const get = (store, id) => store.getState().tasks.find(task => task.id === id);
const ask = (store, id, actor = 'maya') => store.requestRecovery(id, { kind: 'help', note: 'Fictional request' }, actor);
const decide = (store, id, data = {}) => store.resolveRecovery(id, {
  action: 'checkin', requestId: GatherPriorities.pendingRequest(get(store, id)).id, note: replyText, reviewAfter, ...data,
}, 'jack');

function fixture() {
  let now = Date.parse(day + 'T18:00:00Z');
  const store = GatherStore.createStore({ storage: null, now: () => now });
  const ui = { view: 'tasks', taskView: 'list', tab: 'mine', actor: 'maya' };
  const member = id => store.getState().members.find(item => item.id === id);
  const recovery = GatherRecoveryUI.create({ store, ui, h, options: () => '', dayLabel: h, member });
  const context = vm.createContext({
    ui, store, recovery, window: globalThis, h, member, GatherPriorities, GatherPlanningUI, guideTaskId: '',
    isOrganizer: () => ui.actor === 'jack', icon: name => `<i>${h(name)}</i>`, person: id => h(member(id)?.name),
    statusBadge: status => `<span class="status-badge">${h(status)}</span>`, due: task => h(task.dueDate),
    completionText: () => 'Completed', timeLabel: h, relative: h,
    dependencyInfo: task => ({ open: GatherPriorities.unresolved(task, store.getState().tasks) }),
  });
  vm.runInContext(source.slice(source.indexOf('  const noteUpdate = '), source.indexOf('  const toast = ')) +
    source.slice(source.indexOf('  const completionNeedsReview = '), source.indexOf('  const empty = ')) +
    '\nglobalThis.row = taskRow;', context);
  return { store, ui, render: id => context.row(get(store, id)), advance: () => { now += 60_000; } };
}

const details = row => row.match(/<td\b[^>]*class="task-cell-details"[^>]*>\s*(<button\b[\s\S]*?<\/button>)\s*<\/td>/)?.[1] || '';
const identity = button => Object.fromEntries(['action', 'id', 'task-focus'].map(key => [key, button.match(new RegExp('data-' + key + '="([^"]+)"'))?.[1]]));
const hasReply = /\bdata-open-recovery-reply\b|Review organizer response/;

test('shared task Status and completion details distinguish pending review from verified or returned work',()=>{
  const {store,render,advance}=fixture(),{id}=store.addTask({title:'Fictional welcome task',owner:'maya',requiresVerification:true});
  const status=()=>render(id).match(/<td\b[^>]*class="task-cell-status"[^>]*>[\s\S]*?<\/td>/)?.[0]||'';
  const section=()=>GatherCompletionUI.section(get(store,id),false,false);
  store.reportCompletion(id,'Fictional initial results.','maya');
  assert.match(status(),/Awaiting organizer verification/);
  assert.doesNotMatch(status(),/>progress<\/span>/);
  assert.match(section(),/Awaiting organizer verification\.<\/strong> The report is saved, but the task is not verified yet/);
  assert.doesNotMatch(section(),/Completion verified by the organizer|data-action="verify-task"|id="returnCompletionForm"/);
  advance();store.returnCompletion(id,'Add a confirmation.','jack');
  assert.match(status(),/>progress<\/span>/);
  assert.doesNotMatch(status(),/Awaiting organizer verification/);
  assert.match(section(),/Changes requested/);
  assert.doesNotMatch(section(),/Awaiting organizer verification\.|Completion verified by the organizer/);
  advance();store.reportCompletion(id,'Fictional added confirmation.','maya');
  advance();store.verifyTask(id,'jack');
  const before=store.exportState();
  assert.match(status(),/>done<\/span>/);
  assert.doesNotMatch(status(),/Awaiting organizer verification/);
  assert.match(section(),/Completion verified by the organizer\./);
  assert.doesNotMatch(section(),/Awaiting organizer verification|data-action="verify-task"/);
  assert.equal(store.exportState(),before);
});

test('My tasks keeps a review link for a blocked request after its reply is no longer the latest comment', () => {
  const { store, render, advance } = fixture();
  const prerequisite = store.addTask({ title: 'Fictional prerequisite', owner: 'dev' });
  const task = store.addTask({
    title: 'Check <fictional pickup> & "signage"', owner: 'maya', status: 'blocked', dueDate: day,
    dependencies: [{ taskId: prerequisite.id, kind: 'dependency', reason: 'Pickup requires the route check.' }],
  });
  const ordinary = details(render(task.id));
  const expectedIdentity = { action: 'task', id: task.id, 'task-focus': 'details' };
  assert.deepEqual(identity(ordinary), expectedIdentity);
  assert.doesNotMatch(ordinary, hasReply);
  ask(store, task.id);
  assert.doesNotMatch(details(render(task.id)), hasReply);
  decide(store, task.id);
  advance();
  store.addComment(task.id, 'A teammate adds a later route note.', 'dev');
  const before = store.exportState(), row = render(task.id), action = details(row);
  assert.match(row, /A teammate adds a later route note/);
  assert.doesNotMatch(row, /FICTIONAL REQUEST REPLY|<fictional pickup>|data-action="resume-task"/);
  assert.match(action, /data-open-recovery-reply/);
  assert.match(action, />Review organizer response<\/button>/);
  assert.match(action, /aria-label="Review organizer response[^\"]*Check &lt;fictional pickup&gt; &amp; &quot;signage&quot;"/);
  assert.deepEqual(identity(action), expectedIdentity, 'passive render can restore the same task Details control');
  assert.match(row, /class="status-badge">blocked<\/span>/);
  assert.deepEqual(GatherPriorities.unresolved(get(store, task.id), store.getState().tasks).map(link => link.taskId), [prerequisite.id]);
  assert.equal(store.exportState(), before);
});

test('reply affordance is requester-owned and My tasks only, with current state and access checks', t => {
  const { store, render, ui } = fixture();
  const { id } = store.addTask({ title: 'Fictional plan', owner: 'maya', dueDate: day });
  const action = () => details(render(id));
  ask(store, id);
  decide(store, id);
  assert.match(action(), /data-open-recovery-reply/);
  for (const tab of ['all', 'attention', 'done']) {
    ui.tab = tab;
    assert.doesNotMatch(action(), hasReply, tab);
  }
  ui.tab = 'mine';
  const original = globalThis.GatherAccessLost, hadFlag = Object.hasOwn(globalThis, 'GatherAccessLost');
  t.after(() => { if (hadFlag) globalThis.GatherAccessLost = original; else delete globalThis.GatherAccessLost; });
  globalThis.GatherAccessLost = true;
  assert.doesNotMatch(action(), hasReply);
  globalThis.GatherAccessLost = false;

  ask(store, id);
  assert.doesNotMatch(action(), hasReply, 'a newer pending request replaces the old reply');
  store.updateTask(id, { dueDate: reviewAfter }, 'jack');
  assert.doesNotMatch(action(), hasReply, 'a superseded request must not uncover the old reply');

  ask(store, id);
  decide(store, id, { action: 'reassign', owner: 'jules' });
  for (const actor of ['maya', 'jules', 'jack']) {
    ui.actor = actor;
    assert.doesNotMatch(action(), hasReply, actor);
  }

  ui.actor = 'jules';
  ask(store, id, 'jules');
  decide(store, id);
  store.reportCompletion(id, 'Fictional work done.', 'jules');
  assert.equal(get(store, id).status, 'done');
  assert.match(action(), /data-open-recovery-reply/, 'completed My tasks can still show the last explicit reply');
});

test('the saved reassignment reply follows the original requester, not the task or a newer author',t=>{
  const {store,ui,render,advance}=fixture();
  const {personalHandoffReply}=GatherRecoveryUI;
  const {id}=store.addTask({title:'Fictional hall coverage',owner:'maya',dueDate:day});
  store.setNextUp(id,{enabled:true},'maya');
  ask(store,id);
  const requestId=GatherPriorities.pendingRequest(get(store,id)).id;
  assert.ok(!personalHandoffReply(get(store,id),'maya'),'a pending request is not a handoff');
  decide(store,id,{action:'reassign',owner:'jules'});
  const reassigned=get(store,id);
  assert.equal(personalHandoffReply(reassigned,'maya')?.id,requestId);
  assert.equal(reassigned.owner,'jules');
  assert.equal(reassigned.nextUpAt,'');
  assert.equal(reassigned.acceptedAt,'');
  assert.doesNotMatch(details(render(id)),hasReply,'the normal My tasks owner link is not reused');
  for(const actor of ['jules','jack','dev','',undefined])assert.ok(!personalHandoffReply(reassigned,actor),String(actor));

  advance();
  store.requestRecovery(id,{kind:'date',note:'Fictional request from new owner',proposedDate:'2026-11-26'},'jules');
  const anotherRequestId=GatherPriorities.pendingRequest(get(store,id)).id;
  assert.equal(personalHandoffReply(get(store,id),'maya')?.id,requestId,'a newer pending request from a different author cannot hide this reply');
  advance();
  decide(store,id,{action:'reassign',owner:'dev',note:'Fictional decision for new owner'});
  assert.equal(personalHandoffReply(get(store,id),'maya')?.id,requestId);
  assert.equal(personalHandoffReply(get(store,id),'jules')?.id,anotherRequestId);
  assert.ok(!personalHandoffReply(get(store,id),'dev'));

  const originalFlag=globalThis.GatherAccessLost,hadFlag=Object.hasOwn(globalThis,'GatherAccessLost');
  t.after(()=>{if(hadFlag)globalThis.GatherAccessLost=originalFlag;else delete globalThis.GatherAccessLost;});
  globalThis.GatherAccessLost=true;
  assert.ok(!personalHandoffReply(get(store,id),'maya'));
  globalThis.GatherAccessLost=false;
  assert.ok(!personalHandoffReply({...get(store,id),archivedAt:day},'maya'));

  advance();
  store.updateTask(id,{owner:'maya'},'jack');
  assert.ok(!personalHandoffReply(get(store,id),'maya'),'returning the assignment hides historical handoff');
  ask(store,id);
  const newerRequestId=GatherPriorities.pendingRequest(get(store,id)).id;
  assert.notEqual(newerRequestId,requestId);
  decide(store,id);
  advance();
  store.updateTask(id,{owner:'dev'},'jack');
  const before=store.exportState();
  assert.ok(!personalHandoffReply(get(store,id),'maya'),'a newer decision for that requester masks the first handoff even after ownership changes again');
  ui.actor='maya';
  assert.doesNotMatch(details(render(id)),hasReply);
  assert.equal(store.exportState(),before);
});

test('a superseded or malformed request never creates or resurrects a personal handoff reply',()=>{
  const {store,advance}=fixture();
  const {personalHandoffReply}=GatherRecoveryUI;
  const {id}=store.addTask({title:'Fictional appointment',owner:'maya'});
  ask(store,id);
  const staleId=GatherPriorities.pendingRequest(get(store,id)).id;
  advance();
  store.requestRecovery(id,{kind:'date',note:'Replacement proposal',proposedDate:'2026-11-22'},'maya');
  const before=store.exportState();
  assert.throws(()=>decide(store,id,{requestId:staleId,action:'reassign',owner:'jules'}),/already handled|replaced/);
  assert.equal(store.exportState(),before);
  assert.ok(!personalHandoffReply(get(store,id),'maya'));
  // An ordinary assignment edit supersedes the request without making a decision.
  store.updateTask(id,{owner:'jules'},'jack');
  const assigned=get(store,id);
  assert.ok(!personalHandoffReply(assigned,'maya'));
  const valid={...assigned.recoveryRequests.at(-1),status:'resolved',decision:'reassign',decisionNote:'Fictional decision',resolvedAt:day+'T19:00:00Z',resolvedBy:'jack'};
  const candidate=patch=>({...assigned,recoveryRequests:[{...valid,...patch}]});
  for(const patch of [{id:''},{id:null},{id:123},{status:'pending'},{status:'superseded'},{kind:'other'},{decision:'checkin'},{createdBy:'dev'}]){
    assert.ok(!personalHandoffReply(candidate(patch),'maya'),JSON.stringify(patch));
  }
  const candidates={...assigned,recoveryRequests:[valid,{...valid,id:staleId,status:'pending'}]};
  assert.ok(!personalHandoffReply(candidates,'maya'),'a newer own pending request also masks the old reply if the task is no longer assigned');
});

function handoffDialogFixture(kind='help',view='tasks'){
  const {store}=fixture(),{id}=store.addTask({title:'Fictional <handoff> & coverage',owner:'maya'});
  const note='Saved reply <tag> & "details".';
  store.requestRecovery(id,{kind,note:'Fictional original request',...(kind==='date'?{proposedDate:'2026-11-22'}:{})},'maya');
  const requestId=GatherPriorities.pendingRequest(get(store,id)).id;
  decide(store,id,{action:'reassign',owner:'jules',note});
  const ui={view,tab:'mine',actor:'maya'},window={},document={hidden:false},backdrop={hidden:true};
  const root={},calls=[],buttons=[];
  const node=(name,dataset={},parent)=>({name,dataset,isConnected:true,parentElement:parent,hidden:false,inert:false,
    closest(selector){
      if(selector==='[data-next-up-panel]')return this.panel??null;
      return this.hidden||this.inert?this:null;
    },matches(){return !!this.disabled;},getClientRects(){return this.hidden||this.inert||this.older&&!this.older.open?[]:[{}];},
    focus(options){assert.equal(options.preventScroll,true);calls.push(['focus',this.name]);},
  });
  const panel=node('panel',{nextUpPanel:view==='overview'?'overview':'mine',nextUpActor:'maya'},root);
  panel.contains=button=>buttons.includes(button);
  const older={open:false,contains:button=>button.older===older};
  const heading=node('Handoffs heading'),panelHeading=node('Next up heading');
  function button(name='receipt',patch={}){
    const result=node(name,{action:'review-request-handoff-reply',nextUpOrigin:'handoff-reply',id,requestId,...patch},panel);
    result.panel=panel;buttons.push(result);return result;
  }
  const opener=button(),flags={pending:false,stale:false,missingHeading:false};
  const state=store.getState();
  const context=vm.createContext({
    ui,window,document,h,GatherRecoveryUI,
    store:{getState:()=>state,getSnapshotRevision:()=>12},
    $$:(selector,parent)=>selector==='[data-next-up-panel]'&&parent===root?[panel]:parent===panel?buttons:[],
    $:(selector,parent)=>({ '#viewRoot':root,'#dialogBackdrop':backdrop,'[data-next-up-older-handoffs]':parent===panel?older:null,
      '#requestHandoffRepliesHeading':flags.missingHeading?null:heading,'[data-next-up-heading]':panelHeading })[selector]??null,
    workspaceUpdatesPending:()=>flags.pending,scheduleRevisionIsStale:()=>flags.stale,
    hiddenByClosedDisclosure:node=>!!node.closedDisclosure||!!node.older&&!node.older.open,
    openDialog(...args){calls.push(['dialog',...args]);backdrop.hidden=false;},
    render:()=>calls.push(['render']),toast:message=>calls.push(['toast',message]),
  });
  const block=(from,to)=>{const start=source.indexOf(from),end=source.indexOf(to,start+from.length);assert.ok(start>=0&&end>start);return source.slice(start,end);};
  vm.runInContext(block('  function sameNextUpPanel(','  function sameWrapReview(')+
    block('  function openRequestHandoffReply(','  function focusTaskDialogControl('),context);
  return {id,requestId,opener,panel,ui,window,document,backdrop,flags,calls,older,buttons,button,state,store,
    open(control=opener){return context.openRequestHandoffReply(id,control);},
    restore(){return context.restoreNextUpFocus(opener,root);},
  };
}

test('authorized card opens only its exact saved handoff note in a read-only dialog',()=>{
  for(const [kind,view] of [['help','tasks'],['date','overview']]){
    const f=handoffDialogFixture(kind,view),before=f.store.exportState();
    assert.equal(f.open(),true);
    const [[event,title,body,footer,wide,dialogKind,focusHeading]]=f.calls;
    assert.equal(event,'dialog');assert.equal(title,'Organizer reply');assert.equal(dialogKind,'request-handoff-reply');
    assert.equal(wide,false);assert.equal(focusHeading,true);
    assert.equal(f.ui.lastFocus,f.opener);
    assert.match(body,new RegExp(kind==='date'?'Date proposal':'Help request'));
    assert.match(body,/no longer assigned to you/);
    assert.match(body,/Saved reply<\/h3>[\s\S]*Saved reply &lt;tag&gt; &amp; &quot;details&quot;/);
    assert.doesNotMatch(body,/Fictional original request|<tag>|<form|textarea|input/);
    assert.match(footer,/data-action="close-dialog">Back to replies/);
    assert.match(footer,new RegExp(`data-action="task" data-id="${f.id}">Open task`));
    assert.equal(f.store.exportState(),before,'the reply dialog performs no writes');
  }
});

test('wrong scope, replaced request, and stale workspace cannot open a handoff reply',()=>{
  for(const [label,alter] of [
    ['wrong view',f=>{f.ui.view='timeline';}],['different tab',f=>{f.ui.tab='all';}],
    ['different actor',f=>{f.ui.actor='jules';}],['different panel',f=>{f.panel.dataset.nextUpPanel='overview';}],
    ['foreign control',f=>({...f.opener})],['wrong origin',f=>{f.opener.dataset.nextUpOrigin='task';}],
    ['hidden',f=>{f.opener.hidden=true;}],['inert',f=>{f.opener.inert=true;}],
    ['closed older section',f=>{f.opener.closedDisclosure=true;}],['detached',f=>{f.opener.isConnected=false;}],
    ['other dialog open',f=>{f.backdrop.hidden=false;}],['saving',f=>{f.ui.pendingSave=true;}],
    ['hidden document',f=>{f.document.hidden=true;}],['lost access',f=>{f.window.GatherAccessLost=true;}],
    ['updates queued',f=>{f.flags.pending=true;}],['stale workspace revision',f=>{f.flags.stale=true;}],
    ['replaced reply',f=>{const task=f.state.tasks.find(row=>row.id===f.id);task.recoveryRequests.push({...task.recoveryRequests.at(-1),id:'new-reply'});}],
    ['again assigned',f=>{f.state.tasks.find(row=>row.id===f.id).owner='maya';}],
    ['archived',f=>{f.state.tasks.find(row=>row.id===f.id).archivedAt=day;}],
  ]){
    const f=handoffDialogFixture(),before=f.store.exportState();
    const candidate=alter(f)||f.opener;
    assert.equal(f.open(candidate),false,label);
    assert.ok(!f.calls.some(([event])=>event==='dialog'),label);
    assert.equal(f.ui.lastFocus,undefined,label);
    if(label.includes('queued')||label.includes('stale'))assert.match(f.calls.find(([event])=>event==='toast')?.[1],/Check for project updates/);
    if(label==='replaced reply')assert.match(f.calls.find(([event])=>event==='toast')?.[1],/no longer in your handoff list/);
    assert.equal(f.store.exportState(),before,label);
  }
});

test('return focus reopens only the exact older reply, never a newer reply to the same task',()=>{
  for(const findExact of [true,false]){
    const f=handoffDialogFixture();
    f.buttons.length=0;f.opener.isConnected=false;
    f.button('different reply',{requestId:'different-id'});
    if(findExact)f.button('exact older reply').older=f.older;
    assert.equal(f.restore(),true);
    assert.equal(f.older.open,findExact);
    assert.deepEqual(f.calls,[['focus',findExact?'exact older reply':'Handoffs heading']]);
    f.calls.length=0;
    f.panel.dataset.nextUpActor='jules';
    // Old and remounted controls use different panels in a real redraw.
    f.opener.panel={dataset:{nextUpPanel:'mine',nextUpActor:'maya'}};
    assert.equal(f.restore(),false);
    assert.deepEqual(f.calls,[]);
  }
});
