import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const app=readFileSync('legacy/app.js','utf8'),styles=readFileSync('legacy/styles.css','utf8');
const yesterday='2026-11-20',today='2026-11-21',tomorrow='2026-11-22',id='fictional-overnight';
const mine={mine:true,actor:'maya',date:today};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const schedule=GatherScheduleUI.create({h,options:()=>'',statusBadge:h});
const offlineWarning='Could not check for updates. This is the last loaded copy; confirm changes with your team before using it.';

function stateFixture(){
  const activity=(id,owner,start,end,location,extra={})=>({id,title:id,owner,status:'todo',eventActivity:true,
    schedule:{start,end,location},...extra});
  return {
    demoGeneration:1,
    event:{name:'Fictional overnight event',timeZone:'America/Los_Angeles'},
    members:[{id:'maya',name:'Maya Fictional'},{id:'dev',name:'Dev Fictional'}],
    tasks:[
      activity('fictional-other', 'dev',yesterday+'T22:00',today+'T01:00',''),
      activity('fictional-midnight', 'maya',yesterday+'T22:30',today+'T00:00',''),
      activity(id,'maya',yesterday+'T23:00',today+'T01:30',''),
      activity('fictional-resolved','maya',today+'T00:10','','',{status:'done'}),
      activity('fictional-complete-fields','maya',today+'T01:00',today+'T02:00','Hall'),
      activity('fictional-next','maya',today+'T04:00','','Hall'),
      activity('fictional-tomorrow','maya',tomorrow+'T04:00','','Hall'),
      {id:'fictional-undated',title:'Unscheduled activity',owner:'maya',status:'todo',eventActivity:true},
    ],
  };
}

function slice(from,to){
  const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,from);
  return app.slice(start,end);
}

test('the first missing-detail target follows date and owner scope and uses the overnight carryover date',()=>{
  const state=stateFixture(),before=structuredClone(state);
  const first=scope=>schedule.firstMissingRunSheetDetail(state,scope);
  assert.deepEqual(first(mine),{id,day:today});
  assert.deepEqual(first({...mine,date:''}),{id:'fictional-midnight',day:yesterday});
  assert.deepEqual(first({...mine,mine:false}),{id:'fictional-other',day:today});
  assert.deepEqual(first({...mine,date:tomorrow}),{id:'fictional-tomorrow',day:tomorrow});
  assert.equal(first({...mine,date:'2026-11-23'}),null);
  assert.equal(first({...mine,actor:'other-person'}),null);
  assert.equal(schedule.firstMissingRunSheetDetail({...state,tasks:state.tasks.filter(task=>
    ['fictional-undated','fictional-resolved','fictional-complete-fields'].includes(task.id))},mine),null);
  assert.deepEqual(state,before);
});

function fixture({hosted=true,date=today}={}){
  const ui={actor:'maya',view:'timeline',timelineMode:'schedule',scheduleMine:true,scheduleDate:date,dialogKind:''};
  const window={GatherMode:{projectId:'fictional-project'},print:()=>calls.push(['print'])},document={hidden:false};
  const state=stateFixture(),calls=[],requests=[],frames=[],busyRunSheetRevisions=new Set();
  let revision=hosted?21:undefined,known=0,body='',footer='';
  function control(label){
    const attrs=new Map();
    return {label,isConnected:true,hidden:false,dataset:{},textContent:'',
      setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),
      removeAttribute:key=>attrs.delete(key),toggleAttribute:(key,on)=>on?attrs.set(key,''):attrs.delete(key),
      focus:()=>calls.push(['focus',label]),closest:()=>null,
      getClientRects:()=>[{top:0,bottom:10}],
      classList:{contains:className=>className==='schedule-row'&&label.startsWith('row:')},
    };
  }
  function row(target,day){return {...control('row:'+target+':'+day),dataset:{id:target,scheduleDay:day,action:'task'}};}
  const exact=row(id,today),previous=row(id,yesterday),other=row('fictional-next',today);
  let rows=[previous,other,exact];
  const backdrop={hidden:true},sync={hidden:true},view=control('view'),panel=control('panel'),heading=control('schedule heading');
  const stale=control('stale'),print=control('print marker'),refresh=control('run sheet refresh'),
    checkStatus=control('check status'),refreshStatus=control('refresh status'),copyText={value:''};
  let button=control('handoff'),handoffStatus=control('handoff status'),title=control('dialog title');
  let rowButtons=[],copyWarnings=[],sheet;
  function connectRunSheetRows(markup){
    for(const button of rowButtons)button.isConnected=false;
    rowButtons=[];
    copyWarnings=Array.from(markup.matchAll(/data-run-sheet-update-warning hidden/g),()=>({hidden:true,textContent:''}));
    copyText.value=ui.runSheet.text;
    sheet={id:'eventRunSheet',contains:node=>rowButtons.includes(node),querySelector:selector=>select(selector),
      querySelectorAll:selector=>selector.includes('review-run-sheet-row')?rowButtons:
        selector.includes('[data-run-sheet-update-warning]')?copyWarnings:[]};
    const findButton=/<button\b[^>]*\bdata-action="review-run-sheet-row"[^>]*>/g;
    for(const [tag] of markup.matchAll(findButton)){
      const key=tag.match(/\bdata-run-sheet-row="([^"]*)"/)?.[1];
      assert.ok(key,'screen row button has a snapshot-local key');
      const node=control('run sheet row '+key);
      node.tagName='BUTTON';node.localName='button';
      node.dataset={action:'review-run-sheet-row',runSheetRow:key};
      node.closest=selector=>selector==='#eventRunSheet'?sheet:selector==='#dialog'?dialog:null;
      rowButtons.push(node);
    }
  }
  const dialog={contains:node=>node===button||node===title||node===sheet||rowButtons.includes(node),querySelector:selector=>select(selector)};
  panel.contains=node=>rows.includes(node)||node===heading;
  view.contains=node=>panel.contains(node);
  function select(selector){
    if(selector.includes('data-run-sheet-row="')){
      const key=selector.match(/data-run-sheet-row="([^"]*)"/)?.[1];
      return rowButtons.find(node=>node.dataset.runSheetRow===key)??null;
    }
    return ({
      '#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,'#viewRoot':view,
      '#workspaceSyncNotice':sync,'#eventRunSheet':sheet,'#runSheetStale':stale,
      '#runSheetPrintBlocked':print,'#runSheetRefresh':refresh,'#runSheetCheckStatus':checkStatus,
      '#runSheetCopyText':copyText,
      '#runSheetRefreshStatus':refreshStatus,'#runSheetReviewDetails':button,'#runSheetReviewDetailsStatus':handoffStatus,
      '[data-action="review-run-sheet-details"]':button,
      '.schedule-panel':panel,'#schedulePanelHeading':heading,
    })[selector]??null;
  }
  const store={getState:()=>state,getSnapshotRevision:()=>revision,
    refresh(){assert.fail('Handoff should not silently refresh or publish a different schedule');}};
  if(hosted)store.confirmSnapshotRevision=(expected,onNewer)=>new Promise((resolve,reject)=>
    requests.push({expected,reject,finish(current=true,newer){
      if(Number.isSafeInteger(newer))onNewer?.(newer);
      resolve(current);
    }}));
  const context=vm.createContext({
    ui,window,document,store,schedule,GatherScheduleUI,h,busyRunSheetRevisions,runSheetCheckOutcome:null,
    $:select,$$:selector=>selector.includes('schedule-row')?rows:sheet?.querySelectorAll(selector)??[],
    focusable:()=>rows,focusScheduleTarget:target=>{target?.focus();return !!target;},
    requestAnimationFrame:fn=>frames.push(fn),
    workspaceUpdatesPending:()=>!sync.hidden,
    scheduleRevisionIsStale:value=>Number.isSafeInteger(value)&&value<known,
    recoveryConflictPending:()=>false,
    rememberNewerSchedule(snapshot,value){
      if(Number.isSafeInteger(value)){known=Math.max(known,value);if(snapshot&&snapshot.revision<value)snapshot.stale=true;}
    },
    showPendingUpdate(value){sync.hidden=false;calls.push(['pending',value]);},
    openDialog(_title,markup,actions,_wide,kind){body=markup;footer=actions;backdrop.hidden=false;ui.dialogKind=kind;connectRunSheetRows(markup);},
    closeDialog(target){calls.push(['close',target]);backdrop.hidden=true;ui.dialogKind='';ui.runSheet=null;},
    toast:message=>calls.push(['toast',message]),
  });
  vm.runInContext(slice('  function scheduleWorkspaceKey(','  function inOrganizerTimeline(')+
    slice('  function openRunSheet(','  async function checkRunSheet('),context);
  context.openRunSheet();
  return {ui,window,document,state,sync,backdrop,exact,previous,other,heading,calls,requests,busyRunSheetRevisions,
    get body(){return body;},get footer(){return footer;},get status(){return handoffStatus;},get button(){return button;},
    copyText,checkStatus,get copyWarnings(){return copyWarnings;},
    get rowButtons(){return rowButtons;},row,
    rowButton(target,day){
      const key=[...ui.runSheet.liveTargets].find(([,item])=>item.id===target&&item.day===day)?.[0];
      return rowButtons.find(node=>node.dataset.runSheetRow===key);
    },
    set known(value){known=value;},set revision(value){revision=value;},set rows(value){rows=value;},
    handoff(opener=button){return context.reviewRunSheetMissingDetails(opener);},
    reopen(){
      backdrop.hidden=true;ui.dialogKind='';ui.runSheet=null;
      button.isConnected=false;
      button=control('replacement handoff');handoffStatus=control('replacement status');title=control('replacement title');
      context.openRunSheet();
    },
    current(){return context.currentRunSheet();},
    print(){return context.printRunSheet();},
    replaceTitle(){title=control('replacement title');},
    replaceButton(){button=control('replacement handoff');handoffStatus=control('replacement status');},
    flush(){for(const fn of frames.splice(0))fn();},
  };
}

const closes=f=>f.calls.filter(([kind])=>kind==='close');

test('the live Run sheet shortcuts are screen-only, not in standalone HTML or downloaded text',()=>{
  const f=fixture(),model=f.ui.runSheet.model,text=f.ui.runSheet.text;
  assert.match(f.body+f.footer,/Go to first activity with missing details/i);
  assert.match(f.body,/id="runSheetReviewDetails" data-action="review-run-sheet-details"/);
  assert.match(f.body,/data-action="review-run-sheet-row" data-run-sheet-row="0-\d+"/);
  const print=schedule.runSheetMarkup(model);
  assert.ok(f.body.includes(schedule.runSheetMarkup(model,f.ui.runSheet.liveTargets)));
  assert.match(print,/missing an end time or location/i);
  assert.match(text,/missing an end time or location/i);
  assert.doesNotMatch(print+text,/Go to first activity with missing details|Show in Timeline|data-action|runSheetReviewDetails/);
  assert.match(styles,/\.dialog-body>:not\(#eventRunSheet\):not\(#runSheetPrintBlocked\)\{display:none!important\}/);
});

test('a hosted handoff confirms the exact revision before focusing the date-matching Timeline row',async()=>{
  const f=fixture(),pending=f.handoff();
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].expected,21);
  assert.equal(f.busyRunSheetRevisions.has(21),true);
  assert.deepEqual(closes(f),[]);
  await f.handoff();
  assert.equal(f.requests.length,1,'duplicate activation cannot race the confirmation');
  f.requests[0].finish();
  await pending;
  f.flush();
  assert.deepEqual(closes(f),[['close',f.exact]]);
  assert.equal(f.busyRunSheetRevisions.size,0);
  assert.equal(f.ui.scheduleDate,today);
  assert.equal(f.ui.scheduleMine,true);
});

test('a Run sheet row opens the chosen complete-details activity rather than the first missing-detail row',async()=>{
  const f=fixture(),targetId='fictional-complete-fields';
  const target=f.row(targetId,today),opener=f.rowButton(targetId,today);
  const before=structuredClone(f.state);
  assert.ok(opener,'a row with complete details still offers a live shortcut');
  f.rows=[f.previous,f.exact,f.other,target];
  const pending=f.handoff(opener);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].expected,21);
  assert.deepEqual(closes(f),[]);
  assert.ok(f.rowButtons.every(button=>button.getAttribute('aria-disabled')==='true'));
  await f.handoff(f.rowButton(id,today));
  await f.handoff();
  assert.equal(f.requests.length,1,'row and first-missing controls share the pending check');
  f.requests[0].finish();
  await pending;
  f.flush();
  assert.deepEqual(closes(f),[['close',target]]);
  assert.deepEqual(f.state,before);
  assert.equal(f.ui.scheduleDate,today);
  assert.equal(f.ui.scheduleMine,true);
});

test('an overnight Run sheet row in all dates keeps the date on the clicked occurrence',async()=>{
  for(const day of [yesterday,today]){
    const f=fixture({hosted:false,date:''});
    const start=f.rowButton(id,yesterday),carryover=f.rowButton(id,today);
    assert.ok(start&&carryover);
    assert.notEqual(start.dataset.runSheetRow,carryover.dataset.runSheetRow,'two displayed rows have separate snapshot targets');
    const target=day===today?f.exact:f.previous,otherDay=day===today?f.previous:f.exact;
    f.rows=[otherDay,target];
    await f.handoff(day===today?carryover:start);
    f.flush();
    assert.deepEqual(closes(f),[['close',target]]);
    assert.equal(f.ui.scheduleDate,'','the action preserves the all-dates scope');
    assert.equal(f.requests.length,0);
  }
  const f=fixture({hosted:false,date:''});
  f.rows=[f.previous];
  await f.handoff(f.rowButton(id,today));
  f.flush();
  assert.deepEqual(closes(f),[['close',f.heading]],'a missing carryover row must not focus the start-day occurrence');
  assert.match(f.calls.find(([kind])=>kind==='toast')?.[1],/no longer visible/i);
});

test('forged Run sheet row controls and stale snapshots cannot trigger a confirmation',async()=>{
  for(const reason of ['copied control','unknown key','unsafe key','action changed','detached','stale revision']){
    const f=fixture(),real=f.rowButton('fictional-complete-fields',today);
    assert.ok(real);
    let opener=real;
    if(reason==='copied control')opener={...real,dataset:{...real.dataset}};
    if(reason==='unknown key')real.dataset.runSheetRow='90-99';
    if(reason==='unsafe key')real.dataset.runSheetRow='0-1"]';
    if(reason==='action changed')real.dataset.action='review-run-sheet-details';
    if(reason==='detached')real.isConnected=false;
    if(reason==='stale revision')f.known=22;
    await f.handoff(opener);
    assert.equal(f.requests.length,0,reason);
    assert.deepEqual(closes(f),[],reason);
    if(reason==='stale revision')assert.equal(real.getAttribute('aria-disabled'),'true');
  }
});

test('exact date row is required; local demo and row fallback never choose another day',async()=>{
  for(const rowAvailable of [true,false]){
    const f=fixture({hosted:false});
    if(!rowAvailable)f.rows=[f.previous,f.other];
    await f.handoff();
    f.flush();
    assert.deepEqual(closes(f),[['close',rowAvailable?f.exact:f.heading]]);
    assert.equal(f.requests.length,0);
  }
});

test('known stale or wrong-scope handoff cannot leave the Run sheet or start a confirmation',async()=>{
  for(const reason of ['revision','known newer','actor','filter','date','access','detached','foreign','busy','syncing']){
    const f=fixture();
    let opener=f.button;
    if(reason==='revision')f.revision=22;
    if(reason==='known newer')f.known=22;
    if(reason==='actor')f.ui.actor='dev';
    if(reason==='filter')f.ui.scheduleMine=false;
    if(reason==='date')f.ui.scheduleDate=tomorrow;
    if(reason==='access')f.window.GatherAccessLost=true;
    if(reason==='detached')opener.isConnected=false;
    if(reason==='foreign')opener={...opener};
    if(reason==='busy')f.busyRunSheetRevisions.add(21);
    if(reason==='syncing')f.ui.syncing=true;
    await f.handoff(opener);
    assert.deepEqual(closes(f),[],reason);
    assert.equal(f.requests.length,0,reason);
  }
});

test('failed, changed, and late confirmations never jump into another live context',async()=>{
  for(const reason of ['failed','newer','unconfirmed','title','button','closed','filter','project','actor','hidden']){
    const f=fixture(),snapshot=f.ui.runSheet,pending=f.handoff(),[read]=f.requests;
    if(reason==='failed')read.reject(new Error('Fictional read error'));
    else if(reason==='newer')read.finish(false,22);
    else if(reason==='unconfirmed')read.finish(false);
    else{
      if(reason==='title')f.replaceTitle();
      if(reason==='button')f.replaceButton();
      if(reason==='closed')f.backdrop.hidden=true;
      if(reason==='filter')f.ui.scheduleMine=false;
      if(reason==='project')f.window.GatherMode.projectId='different-project';
      if(reason==='actor')f.ui.actor='dev';
      if(reason==='hidden')f.document.hidden=true;
      read.finish();
    }
    await pending;
    f.flush();
    assert.deepEqual(closes(f),[],reason);
    assert.equal(f.busyRunSheetRevisions.size,0,reason);
    if(reason==='failed'){
      assert.equal(snapshot.stale,false,'failed network check does not change the printable last-loaded snapshot');
      assert.match(f.status.textContent,/check the schedule.*try again/i);
    }
    if(reason==='newer'||reason==='unconfirmed'){
      assert.equal(snapshot.stale,true);
      assert.match(f.status.textContent,/Refresh the Run sheet/i);
    }
    if(reason==='button')assert.equal(f.status.textContent,'','late result cannot repaint replacement status');
    if(reason==='hidden')assert.match(f.status.textContent,/Jump paused/);
  }
});

test('an unsuccessful Run sheet row check keeps the dialog open and marks the offline copy until an exact retry succeeds',async()=>{
  const f=fixture(),snapshot=f.ui.runSheet,base=snapshot.text;
  const choice=()=>f.rowButton('fictional-complete-fields',today);
  assert.ok(f.copyWarnings.length>1);
  const pending=f.handoff(choice());
  assert.equal(f.requests.length,1);
  f.requests[0].reject(new Error('Fictional network failure'));
  await pending;
  assert.deepEqual(closes(f),[]);
  assert.equal(f.ui.runSheet,snapshot);
  assert.match(f.status.textContent,/check the schedule.*try again/i);
  assert.equal(f.checkStatus.textContent,offlineWarning);
  assert.equal(f.copyText.value,offlineWarning+'\n\n'+base);
  assert.equal(snapshot.text,base);
  assert.ok(f.copyWarnings.every(marker=>!marker.hidden&&marker.textContent===offlineWarning));
  f.print();
  assert.deepEqual(f.calls.filter(([kind])=>kind==='print'),[['print']]);
  assert.equal(f.requests.length,1,'offline printing does not retry the network');

  f.reopen();
  assert.equal(f.copyText.value,offlineWarning+'\n\n'+f.ui.runSheet.text);
  const retry=f.handoff(choice());
  f.requests[1].finish();
  await retry;
  assert.equal(closes(f).length,1,'verified retry finishes the requested jump');
  f.reopen();
  assert.ok(f.copyWarnings.every(marker=>marker.hidden));
  assert.equal(f.copyText.value,f.ui.runSheet.text);
  assert.doesNotMatch(f.checkStatus.textContent,/Could not check/);
  assert.equal(f.requests.length,2);
});

test('a failed Run sheet row check cannot add its warning to a different workspace or loaded revision',async()=>{
  for(const reason of ['workspace','revision']){
    const f=fixture(),pending=f.handoff(f.rowButton('fictional-complete-fields',today));
    if(reason==='workspace')f.window.GatherMode.projectId='fictional-different-project';
    else f.revision=f.ui.runSheet.revision+1;
    f.reopen();
    const replacement=f.ui.runSheet;
    f.requests[0].reject(new Error('Fictional read error after leaving the old revision'));
    await pending;
    f.current();
    assert.deepEqual(closes(f),[],reason);
    assert.equal(f.ui.runSheet,replacement,reason);
    assert.ok(f.copyWarnings.every(marker=>marker.hidden),reason);
    assert.equal(f.copyText.value,replacement.text,reason);
    assert.equal(f.status.textContent,'',reason);
  }
});

test('a pending handoff check cannot leave a reopened same-revision Run sheet printable after a stale result',async()=>{
  for(const [outcome,byRow] of [['newer',false],['inconclusive',false],['newer',true],['inconclusive',true]]){
    const f=fixture(),original=f.ui.runSheet;
    const opener=()=>byRow?f.rowButton('fictional-complete-fields',today):f.button;
    const pending=f.handoff(opener()),[read]=f.requests;
    assert.equal(f.busyRunSheetRevisions.has(21),true);
    f.reopen();
    const replacement=f.ui.runSheet;
    assert.notEqual(replacement,original);
    assert.equal(replacement.revision,original.revision);
    assert.equal(opener().getAttribute('aria-disabled'),'true','replacement stays busy until the old read settles');
    f.print();
    read.finish(false,outcome==='newer'?22:undefined);
    await pending;
    f.flush();
    assert.equal(f.busyRunSheetRevisions.size,0);
    assert.equal(f.ui.runSheet,replacement);
    assert.equal(f.ui.dialogKind,'run-sheet');
    assert.equal(f.current(),null,'replacement inherits the freshness result, not the old busy lock');
    assert.equal(opener().getAttribute('aria-disabled'),'true');
    assert.equal(f.status.textContent,'','late result does not repaint the replacement action status');
    f.print();
    assert.deepEqual(f.calls.filter(([kind])=>['close','toast','print'].includes(kind)),[],outcome);
    await f.handoff(opener());
    assert.equal(f.requests.length,1,'stale replacement cannot start another targeted check before refresh');
  }
});
