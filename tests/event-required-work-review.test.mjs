import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const source=readFileSync('legacy/app.js','utf8');
const fragment=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const now='2026-10-03T16:30:00Z';
const action='review-event-required-work';
const h=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const schedule=GatherScheduleUI.create({h});
const task=(id,fields={})=>({id,title:id,owner:'maya',status:'todo',dependencies:[],...fields});
const required=(taskId,kind='dependency')=>({taskId,kind,reason:'Fictional relationship'});
const tasks=()=>[
  task('maya-blocked',{title:'Fictional <handover>',status:'blocked',dependencies:[required('required')]}),
  task('maya-missing',{title:'Fictional <handover>',dependencies:[required('gone')]}),
  task('maya-results',{status:'blocked',dependencies:[required('finished')]}),
  task('maya-related',{dependencies:[required('gone','related')]}),
  task('maya-archived',{archivedAt:now,dependencies:[required('gone')]}),
  task('dev-blocked',{owner:'dev',dependencies:[required('gone')]}),
  task('required',{owner:'dev',status:'done',requiresVerification:true,note:'PRIVATE_PREREQUISITE_NOTE'}),
  task('finished',{owner:'dev',status:'done',requiresVerification:true,verifiedAt:now}),
];
const plan=()=>({event:{name:'Fictional event',date:'2026-10-03',timeZone:'UTC'},members:[{id:'maya',name:'Maya',active:true},{id:'dev',name:'Dev',active:true}],tasks:tasks()});
const group=(html,key)=>html.match(new RegExp(`<details[^>]*data-event-review-group="${key}"[^>]*>([\\s\\S]*?)<\\/details>`))?.[1];
const ids=(html)=>[...html.matchAll(/<button\b[^>]*>/g)].filter(([tag])=>tag.includes(`data-action="${action}"`)).map(([tag])=>tag.match(/data-id="([^"]*)"/)[1]);

test('Before the event offers the required-work route only in the matching group and current task scope',()=>{
  const state=plan(),before=structuredClone(state),scope={mine:true,actor:'maya'};
  for(const organizer of [true,false]){
    const html=schedule.preparationReview(state,now,scope,organizer),section=group(html,'prerequisites');
    assert.deepEqual(ids(section),['maya-blocked','maya-missing']);
    assert.deepEqual(ids(group(html,'linked-results')),['maya-results']);
    assert.deepEqual(ids(html),['maya-results',...ids(section)],'other appearances of the same task are ordinary opens');
    assert.match(section,/Fictional &lt;handover&gt;/);
    assert.match(section,/aria-label="Review required work for Fictional &lt;handover&gt;"/);
    assert.match(group(html,'blocked'),/data-action="task" data-id="maya-blocked"/);
    assert.doesNotMatch(html,/PRIVATE_PREREQUISITE_NOTE/);
  }
  assert.deepEqual(ids(group(schedule.preparationReview(state,now,{mine:false,actor:'maya'},true),'prerequisites')),['maya-blocked','maya-missing','dev-blocked']);
  assert.deepEqual(state,before);
});

function fixture(){
  const state=plan(),backdrop={hidden:false},sync={hidden:true},dialog={},frames=[],calls=[];
  const ui={view:'timeline',actor:'maya',timelineMode:'schedule',scheduleMine:true,scheduleDate:'2026-10-03'};
  const window={GatherMode:{projectId:'fictional-project',demo:false},GatherAccessLost:false};
  const document={hidden:false,activeElement:{}};
  const controls={revision:42,knownStale:false};
  let title,sections=[],relationship;
  const focusable=(label,fields={})=>({label,isConnected:true,dataset:{},closest:()=>null,
    focus(){document.activeElement=this;calls.push(['focus',label]);},scrollIntoView:()=>{},getClientRects:()=>[{}],...fields});
  const refresh=focusable('refresh',{dataset:{action:'refresh-event-review'}}),reload=focusable('reload');
  const findSection=key=>sections.find(item=>item.dataset.eventReviewGroup===key);
  const readFocus=(target)=>{target?.focus();return !!target;};
  const ctx=vm.createContext({ui,window,document,Date,h,schedule,GatherScheduleUI,
    store:{getState:()=>state,getSnapshotRevision:()=>controls.revision,refresh:async()=>({verified:true})},
    $:(selector,root)=>{
      if(selector==='#dialog')return dialog;
      if(selector==='#dialogTitle')return title;
      if(selector==='#dialogBackdrop')return backdrop;
      if(selector==='#workspaceSyncNotice')return sync;
      if(selector==='[data-action="refresh-event-review"]')return refresh;
      if(selector==='#dialogStaleNotice [data-action="reload-workspace"]')return reload;
      if(selector.includes('task-dependencies')&&selector.includes('h3'))return relationship;
      if(selector==='summary')return root?.summary;
      return null;
    },
    $$:(selector,root)=>selector==='[data-event-review-group]'?sections:root?.rows||[],
    scheduleWorkspaceKey:()=>JSON.stringify([window.GatherMode.projectId,window.GatherMode.demo,state.demoGeneration,ui.actor]),
    scheduleRevisionIsStale:()=>controls.knownStale,isOrganizer:()=>false,hiddenByClosedDisclosure:node=>!!node?.section&&!node.section.open,
    focusTaskDialogControl:readFocus,focusScheduleTarget:readFocus,focusable:root=>root?.open?root.rows:[],
    requestAnimationFrame:fn=>frames.push(fn),toast:message=>calls.push(['toast',message]),
    showPendingUpdate:(_text,key)=>{calls.push(['refresh-required',key]);sync.hidden=false;},
    openDialog(label,markup,_footer,_wide,kind,focusHeading){
      ui.dialogKind=kind;ui.eventTaskReview=null;title=focusable(label);
      assert.equal(focusHeading,true);
      const openedTitle=title;frames.push(()=>{if(title===openedTitle&&ui.dialogKind===kind)title.focus();});
      sections=[...markup.matchAll(/<details\b([^>]*)\bdata-event-review-group="([^"]+)"([^>]*)><summary>([^<]*)<\/summary>([\s\S]*?)<\/details>/g)]
        .map(([,left,key,right,summary,body])=>{
          const section={dataset:{eventReviewGroup:key},open:/\bopen\b/.test(left+right),summary:focusable(summary),
            querySelector(selector){return selector==='summary'?this.summary:null;},
            querySelectorAll(){return this.rows;},contains(node){return this.rows.includes(node);}};
          section.rows=[...body.matchAll(/<button\b[^>]*data-action="([^"]+)"[^>]*data-id="([^"]+)"[^>]*>/g)].map(([,action,id])=>focusable(id,{
            dataset:{action,id},section,closest:selector=>selector==='[data-event-review-group]'?section:null,
          }));
          return section;
        });
      dialog.contains=node=>sections.some(section=>section===node||section.contains(node));
    },
    taskDialog(...args){
      calls.push(['task',...args.map(arg=>arg&&typeof arg==='object'?{...arg}:arg)]);
      if(args[7]?.eventRequiredWork)ui.eventTaskReview=args[7].eventRequiredWork;
      ui.dialogKind='task';ui.detailId=args[0];title=focusable('task title');relationship=focusable('Task relationships');
      const openedTitle=title;frames.push(()=>{if(title===openedTitle)title.focus();});
    },
  });
  const run=(script,globals={})=>vm.runInContext(script,Object.assign(ctx,globals));
  run(fragment('  function eventReviewScope(', '  function showPendingUpdate('));
  const flush=()=>{for(const frame of frames.splice(0))frame();};
  run('beforeEventReview()');flush();calls.length=0;
  return {ctx,run,state,ui,window,document,controls,calls,frames,flush,findSection,backdrop,sync,refresh,reload,
    get title(){return title;},replaceTitle(){title=focusable('replacement title');},get relationship(){return relationship;}};
}

const open=(f,id='maya-blocked',groupKey='prerequisites',button)=>{
  const opener=button??f.findSection(groupKey)?.rows.find(node=>node.dataset.id===id);
  return f.run('openEventRequiredWork(id,opener)',{id,opener});
};

test('required work opens the exact task read-only and restores the same row or original group summary',()=>{
  for(const [id,key] of [['maya-blocked','prerequisites'],['maya-results','linked-results']]){
    const f=fixture(),before=structuredClone(f.state);
    assert.equal(open(f,id,key),true);
    const [verb,taskId,,discard,focus,,,,options]=f.calls[0];
    assert.deepEqual([verb,taskId,discard,focus,options.readOnly],['task',id,false,true,true]);
    assert.equal(options.eventRequiredWork.snapshot,f.ui.eventReviewSnapshot);
    assert.equal(options.eventRequiredWork.group,key);
    f.flush();assert.equal(f.document.activeElement,f.relationship);
    assert.deepEqual(f.state,before);
    assert.equal(f.run('returnToEventTaskReview()'),true);f.flush();
    assert.equal(f.findSection(key).open,true);
    assert.equal(f.document.activeElement,f.findSection(key).rows.find(row=>row.dataset.id===id));
    assert.equal(open(f,id,key),true);f.flush();
    f.state.tasks.find(task=>task.id===id).status='done';
    assert.equal(f.run('returnToEventTaskReview()'),true);f.flush();
    assert.equal(f.findSection(key).open,true);
    assert.equal(f.document.activeElement,f.findSection(key).summary);
    assert.doesNotMatch(f.findSection(key).summary.label,/undefined/);
  }
});

test('special event review ignores forged, detached, hidden and out-of-scope controls',()=>{
  for(const [reason,alter] of [
    ['actor',f=>{f.ui.actor='dev';}],['project',f=>{f.window.GatherMode.projectId='other';}],
    ['role-independent access',f=>{f.window.GatherAccessLost=true;}],['scope',f=>{f.ui.scheduleMine=false;}],
    ['date',f=>{f.ui.scheduleDate='2026-10-04';}],['view',f=>{f.ui.view='tasks';}],
    ['dialog',f=>{f.ui.dialogKind='task';}],['hidden backdrop',f=>{f.backdrop.hidden=true;}],
    ['save',f=>{f.ui.pendingSave=true;}],['hidden document',f=>{f.document.hidden=true;}],
    ['refresh running',f=>{f.ui.syncing=true;}],
    ['disclosure',f=>{f.findSection('prerequisites').open=false;}],
    ['detached',f=>{f.findSection('prerequisites').rows[0].isConnected=false;}],
  ]){
    const f=fixture();alter(f);assert.equal(open(f),false,reason);assert.deepEqual(f.calls,[],reason);
  }
  const f=fixture(),exact=f.findSection('prerequisites').rows[0];
  assert.equal(open(f,'maya-missing','prerequisites',exact),false);
  assert.equal(open(f,'maya-blocked','prerequisites',{...exact}),false);
  assert.equal(open(f,'maya-blocked','blocked'),false);
  assert.deepEqual(f.calls,[]);
});

test('newer or changed event snapshots route to Refresh, not a stale task or unrelated heading',()=>{
  for(const change of [f=>{f.controls.revision++;},f=>{f.controls.knownStale=true;},f=>{f.sync.hidden=false;},f=>{f.state.event.timeZone='America/Los_Angeles';}]){
    const f=fixture();change(f);assert.equal(open(f),false);
    assert.ok(!f.calls.some(call=>call[0]==='task'));
    assert.ok(f.calls.some(call=>call[0]==='refresh-required'&&call[1]==='prerequisites'));
    assert.equal(f.document.activeElement,f.refresh);
    assert.equal(f.refresh.dataset.id,'prerequisites');
  }
  const gone=fixture();gone.state.tasks[0].status='done';
  assert.equal(open(gone),false);
  gone.flush();
  assert.equal(gone.document.activeElement,gone.findSection('prerequisites').summary);
  assert.ok(!gone.calls.some(call=>call[0]==='task'));
  assert.match(gone.calls.find(call=>call[0]==='toast')[1],/no longer in that review group/);
});

test('late changes stop relationship or return-row focus from moving into stale content',()=>{
  for(const change of [f=>{f.controls.revision++;},f=>{f.state.tasks[0].status='done';},f=>{f.replaceTitle();},
    f=>{f.document.hidden=true;},f=>{f.document.activeElement={label:'different focused control'};},
    f=>{f.ui.scheduleMine=false;},f=>{f.ui.eventTaskReview={...f.ui.eventTaskReview};}]){
    const f=fixture();assert.equal(open(f),true);
    f.frames.shift()();change(f);f.flush();
    assert.notEqual(f.document.activeElement,f.relationship);
  }
  const stale=fixture();assert.equal(open(stale),true);stale.flush();stale.sync.hidden=false;
  assert.equal(stale.run('returnToEventTaskReview()'),true);stale.flush();
  assert.equal(stale.document.activeElement,stale.refresh);
  const switched=fixture();assert.equal(open(switched),true);switched.flush();switched.ui.scheduleMine=false;
  assert.equal(switched.run('returnToEventTaskReview()'),false);
  for(const hosted of [true,false]){
    const drift=fixture();if(!hosted)delete drift.ctx.store.refresh;
    assert.equal(open(drift),true);drift.flush();
    assert.equal(drift.run('returnToEventTaskReview()'),true);
    drift.controls.revision++;
    drift.flush();
    assert.deepEqual(drift.calls.find(([event])=>event==='refresh-required'),['refresh-required','prerequisites']);
    assert.equal(drift.document.activeElement,hosted?drift.refresh:drift.reload);
  }
});
