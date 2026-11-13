import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const day='2026-11-21',draftDate='2026-11-24',laterDraft='2026-11-25';

function fragment(from,to){
  const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'missing source block: '+from);
  return app.slice(start,end);
}

function fixture(){
  const ui={actor:'maya',view:'timeline',timelineMode:'schedule',scheduleMine:true,scheduleDate:day,
    dialogKind:'',toolUpdatePending:true,recoveryConflictRevision:21};
  const window={GatherMode:{projectId:'fictional-project'}},document={hidden:false};
  const requests=[],calls=[],frames=[];
  let revision=21,known=22,state={demoGeneration:1,event:{name:'Fictional event',timeZone:'UTC'},tasks:[{id:'fictional-activity'}]};
  const backdrop={hidden:true},sync={hidden:false},root={};
  function node(id){
    const attrs=new Map();
    return {id,isConnected:true,hidden:false,disabled:false,dataset:{},textContent:'',
      setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),
      removeAttribute:key=>attrs.delete(key),focus(){document.activeElement=this;calls.push(['focus',id]);},
      getClientRects:()=>[{top:0,bottom:10}],closest:()=>null,matches:()=>false,
      scrollIntoView(){},
    };
  }
  let button=node('timelineScheduleRefresh'),status=node('timelineScheduleRefreshStatus'),
    field={...node('scheduleDate'),value:draftDate,defaultValue:day,validity:{badInput:false}},heading=node('schedulePanelHeading');
  const elsewhere=node('unrelated'),otherRow=node('otherRow');
  const body=node('body'),panel=node('schedulePanel');
  document.body=body;
  document.activeElement=button;
  const controls=()=>[button,status,field,heading,otherRow];
  panel.contains=element=>controls().includes(element);
  root.contains=element=>panel.contains(element)||element===panel;
  function replace({restoring=false}={}){
    const before=[button,status,field,heading];
    if(before.includes(document.activeElement))document.activeElement=body;
    for(const control of before)control.isConnected=false;
    button=node('timelineScheduleRefresh');
    status=node('timelineScheduleRefreshStatus');
    field={...node('scheduleDate'),value:ui.scheduleDate,defaultValue:ui.scheduleDate,validity:{badInput:false}};
    heading=node('schedulePanelHeading');
    if(!restoring)status.textContent='Replacement status untouched';
  }
  function select(selector){
    return ({
      '#timelineScheduleRefresh':button,'#timelineScheduleRefreshStatus':status,'#scheduleDate':field,
      '#schedulePanelHeading':heading,'#viewRoot':root,'.schedule-panel':panel,
      '#dialogBackdrop':backdrop,'#workspaceSyncNotice':sync,
    })[selector]??null;
  }
  const store={
    getState:()=>state,getSnapshotRevision:()=>revision,
    setTaskSchedule(){assert.fail('Schedule refresh must be read-only');},
    refresh(canApply,options){
      return new Promise((resolve,reject)=>requests.push({
        canApply:(next,candidate=state)=>canApply(next,candidate),options,reject,
        finish({next=22,candidate=structuredClone(state),result={verified:true,changed:next!==revision}}={}){
          if(!result.verified||result.pending){resolve(result);return;}
          const accepted=canApply(next,candidate);
          if(accepted){revision=next;state=candidate;}
          resolve(accepted?result:next>revision?{pending:true,newerRevision:next}:{changed:false});
        },
      }));
    },
  };
  const context=vm.createContext({
    ui,window,document,store,$:select,$$:()=>[],
    isOrganizer:()=>false,
    workspaceUpdatesPending:()=>!sync.hidden||revision<=ui.recoveryConflictRevision,
    recoveryConflictPending:value=>(value??revision)<=ui.recoveryConflictRevision,
    scheduleRevisionIsStale:value=>(value??revision)<known,
    rememberNewerSchedule(_snapshot,next){if(Number.isSafeInteger(next))known=Math.max(known,next);},
    showPendingUpdate(next){
      if(Number.isSafeInteger(next))known=Math.max(known,next);
      sync.hidden=false;
      calls.push(['pending',next]);
    },
    refreshSuggestionSurfaces:()=>calls.push(['suggestions']),
    focusable:controls,
    focusScheduleTarget(target){target?.focus();return !!target;},
    restoreFocus(previous){if(previous?.id)select('#'+previous.id)?.focus();},
    render(){
      const saved=context.captureScheduleDateDraft();
      const previousFocus=root.contains(document.activeElement)?document.activeElement:null;
      replace({restoring:true});
      context.restoreScheduleDateDraft(saved);
      if(previousFocus&&!previousFocus.isConnected&&document.activeElement===body)context.restoreFocus(previousFocus);
      calls.push(['render',revision]);
    },
    toast:message=>calls.push(['toast',message]),
    requestAnimationFrame:fn=>frames.push(fn),
  });
  vm.runInContext(fragment('  function timelineScheduleScope(','  function inOrganizerTimeline(')+
    fragment('  function captureScheduleDateDraft(','  function render() {')+
    fragment('  async function refreshTimelineSchedule(','  function openRunSheet('),context);
  return {ui,window,document,backdrop,sync,requests,calls,root,elsewhere,otherRow,replace,
    get state(){return state;},get revision(){return revision;},get known(){return known;},set known(value){known=value;},
    get button(){return button;},get status(){return status;},get field(){return field;},get heading(){return heading;},
    refresh(control=button){return context.refreshTimelineSchedule(control);},
    flush(){while(frames.length)frames.shift()();},
  };
}

const renders=f=>f.calls.filter(([kind])=>kind==='render');

test('when an update removes a focused Timeline action, focus falls back to the schedule heading',()=>{
  const body={},heading={},root={},document={body,activeElement:body};
  const ui={view:'timeline',timelineMode:'schedule'};
  const context=vm.createContext({document,window:{},ui,isScheduleControl:()=>false,restoreFocus:()=>false,
    $:(selector,scope)=>selector==='#schedulePanelHeading'&&scope===root?heading:null,
    focusScheduleTarget(target){document.activeElement=target;return true;}});
  vm.runInContext(fragment('  function restoreViewFocus(','  function saveLock('),context);
  for(const action of ['run-sheet','draft-guest-agenda','schedule-set-start','open-first-schedule-receipt']){
    document.activeElement=body;
    assert.equal(context.restoreViewFocus({isConnected:false,dataset:{action}},root),true,action);
    assert.equal(document.activeElement,heading,action);
  }
  document.activeElement=body;ui.timelineMode='deadlines';
  assert.equal(context.restoreViewFocus({isConnected:false,dataset:{action:'run-sheet'}},root),false);
  assert.equal(document.activeElement,body);
});

test('a verified refresh preserves the committed Timeline filter, the latest typed date and focus',async()=>{
  const f=fixture(),oldButton=f.button,pending=f.refresh();
  assert.equal(f.requests.length,1);
  const [read]=f.requests;
  assert.equal(read.options.requireFresh,true);
  assert.equal(read.canApply(21),false,'known newer workspace or conflict floor rejects old snapshots');
  assert.equal(read.canApply(22),true);
  assert.equal(oldButton.getAttribute('aria-disabled'),'true');
  await f.refresh();
  assert.equal(f.requests.length,1,'duplicate click must not race the first read');
  f.field.value=laterDraft;
  const candidate={...f.state,tasks:[{id:'fictional-new-schedule'}]};
  read.finish({candidate});
  await pending;
  f.flush();
  assert.equal(f.revision,22);
  assert.equal(f.ui.scheduleDate,day);
  assert.equal(f.ui.scheduleMine,true);
  assert.equal(f.field.defaultValue,day);
  assert.equal(f.field.value,laterDraft);
  assert.deepEqual(f.state.tasks,candidate.tasks);
  assert.deepEqual(renders(f),[['render',22]]);
  assert.equal(f.sync.hidden,true);
  assert.equal(f.ui.toolUpdatePending,false);
  assert.equal(f.ui.syncing,false);
  assert.equal(f.status.textContent,'Schedule updated.');
  assert.equal(f.document.activeElement,f.button,'refresh should restore the current check button');
  assert.notEqual(f.document.activeElement,oldButton);
});

test('an unverified result, network failure, or known-newer pending result does not publish or clear stale data',async()=>{
  for(const outcome of ['unverified','failure','pending']){
    const f=fixture(),pending=f.refresh(),[read]=f.requests;
    if(outcome==='failure')read.reject(new Error('Fictional network error'));
    else read.finish({result:outcome==='unverified'?{changed:false}:{pending:true,newerRevision:25}});
    await pending;
    assert.equal(f.revision,21,outcome);
    assert.equal(f.sync.hidden,false,outcome);
    assert.equal(f.ui.toolUpdatePending,true,outcome);
    assert.equal(f.ui.syncing,false,outcome);
    assert.equal(f.field.value,draftDate,outcome);
    assert.equal(f.button.getAttribute('aria-disabled')==='true',false,outcome);
    assert.deepEqual(renders(f),[],outcome);
    assert.match(f.status.textContent,/couldn.t|could not|try again|newer/i,outcome);
    if(outcome==='pending')assert.equal(f.known,25);
  }
});

test('a pending refresh refuses navigation, project/scope replacement and hidden, saving or invalid input states',async()=>{
  for(const change of ['view','mode','actor','project','generation','demo','filter','date','button','modal','save',
    'hidden','access','invalid date','dirty proposal','saving proposal']){
    const f=fixture(),pending=f.refresh(),[read]=f.requests;
    if(change==='view')f.ui.view='tasks';
    if(change==='mode')f.ui.timelineMode='deadlines';
    if(change==='actor')f.ui.actor='dev';
    if(change==='project')f.window.GatherMode.projectId='different-project';
    if(change==='generation')f.state.demoGeneration=2;
    if(change==='demo')f.window.GatherMode.demo=true;
    if(change==='filter')f.ui.scheduleMine=false;
    if(change==='date')f.ui.scheduleDate=laterDraft;
    if(change==='button')f.replace();
    if(change==='modal')f.backdrop.hidden=false;
    if(change==='save')f.ui.pendingSave=true;
    if(change==='hidden')f.document.hidden=true;
    if(change==='access')f.window.GatherAccessLost=true;
    if(change==='invalid date')f.field.validity.badInput=true;
    if(change==='dirty proposal')f.ui.reviewDirty=true;
    if(change==='saving proposal')f.ui.savingProposal=true;
    assert.equal(read.canApply(22),false,change);
    read.finish();
    await pending;
    f.flush();
    assert.deepEqual(renders(f),[],change);
    assert.equal(f.revision,21,change);
    assert.equal(f.ui.syncing,false,change);
    if(change==='button')assert.equal(f.status.textContent,'Replacement status untouched');
  }
});

test('a verified same-revision read clears an inconclusive stale indicator without redrawing',async()=>{
  const f=fixture();
  f.known=21;
  f.ui.recoveryConflictRevision=20;
  f.ui.toolUpdatePending=false;
  const pending=f.refresh();
  f.requests[0].finish({next:21});
  await pending;
  f.flush();
  assert.deepEqual(renders(f),[]);
  assert.equal(f.field.value,draftDate);
  assert.equal(f.sync.hidden,true);
  assert.equal(f.ui.toolUpdatePending,false);
  assert.match(f.status.textContent,/schedule is up to date/i);
});

test('late completion does not steal focus from another control the user chose during the read',async()=>{
  const f=fixture(),pending=f.refresh();
  f.elsewhere.focus();
  f.requests[0].finish();
  await pending;
  f.flush();
  assert.equal(f.document.activeElement,f.elsewhere);
  assert.deepEqual(renders(f),[['render',22]]);
});

test('manual refresh does not start while the current native date input has a partial invalid edit',async()=>{
  const f=fixture();
  f.field.validity.badInput=true;
  f.document.activeElement=f.field;
  await f.refresh();
  assert.deepEqual(f.requests,[]);
  assert.deepEqual(renders(f),[]);
  assert.equal(f.field.value,draftDate);
  assert.equal(f.document.activeElement,f.field);
  assert.match(f.status.textContent,/finish typing or clear the date/i);
});
