import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const schedule=GatherScheduleUI.create({h,options:()=>'',person:()=>'',statusBadge:()=>''});
const state={
  event:{name:'School arts evening',timeZone:'America/Los_Angeles'},members:[{id:'jack',name:'PRIVATE-OWNER'}],
  tasks:[
    {id:'overnight',title:'Internal overnight roster',owner:'jack',status:'blocked',note:'PRIVATE-NOTE',schedule:{start:'2030-03-15T23:30',end:'2030-03-16T00:30',location:'PRIVATE-LOCATION'}},
    {id:'welcome',title:'Welcome',owner:'jack',schedule:{start:'2030-03-16T09:00',end:'',location:'PRIVATE-DOOR'}},
    {id:'later',title:'Next day',owner:'jack',schedule:{start:'2030-03-17T09:00',end:'',location:''}},
    {id:'other',title:'OTHER-OWNER',owner:'other',schedule:{start:'2030-03-16T08:30',end:'',location:''}},
    {id:'preparation',title:'PRIVATE-PREPARATION',owner:'jack',dueDate:'2030-03-16'},
  ],
};
const scope={mine:true,actor:'jack',date:'2030-03-16'};
const snapshot=GatherScheduleUI.guestAgendaSnapshot(state,scope);

test('guest agenda includes only explicitly selected and reviewed fields from the current schedule scope',()=>{
  const before=structuredClone(state);
  assert.equal(GatherScheduleUI.guestAgenda(snapshot,'School arts evening',[]),'');
  const agenda=GatherScheduleUI.guestAgenda(snapshot,'  School arts evening  ',[
    {included:true,title:'Evening arrivals',location:'  Main entrance  '},
    {included:false,title:'Welcome',location:'PRIVATE-DRAFT'},
  ]);
  assert.equal(agenda,'School arts evening\nTimes: America/Los_Angeles\n\n2030-03-15 23:30 – 2030-03-16 00:30 · Evening arrivals · Main entrance');
  assert.doesNotMatch(agenda,/PRIVATE-|Internal overnight roster|OTHER-OWNER|Next day|Welcome|blocked/);
  assert.deepEqual(state,before);
  assert.equal(GatherScheduleUI.guestAgenda(snapshot,'School arts evening',[{included:true,title:' '}]),'');
  assert.equal(GatherScheduleUI.guestAgenda(snapshot,'Guest\nagenda',[{included:false},{included:true,title:'Welcome\u0000guests'}]),
    'Guest agenda\nTimes: America/Los_Angeles\n\n2030-03-16 09:00 · Welcome guests');
});

test('agenda form starts with nothing selected and does not prefill any internal locations',()=>{
  const html=schedule.guestAgendaForm({...snapshot,activities:snapshot.activities.map(slot=>({...slot,title:'<img src=x onerror="fictional">' }))},state.event.name);
  assert.match(html,/name="include-0"/);
  assert.doesNotMatch(html,/checked|PRIVATE-|<img/);
  assert.match(html,/&lt;img src=x onerror=&quot;fictional&quot;&gt;/);
  assert.match(html,/data-agenda-fields="0" hidden/);
  assert.match(html,/readonly/);
  assert.match(html,/aria-describedby="guestAgendaCopyHelp"/);
});

test('agenda form identifies the actual source, not just the date',()=>{
  const button=/<button[^>]+data-action="all-guest-agenda-activities"[^>]*>Start over with all activities<\/button>/;
  const date=GatherScheduleUI.dateLabel(scope.date);
  for(const mine of [true,false]){
    const source=GatherScheduleUI.guestAgendaSnapshot(state,{...scope,mine});
    const html=schedule.guestAgendaForm(source,state.event.name);
    assert.equal(source.mine,mine);
    assert.match(html,mine?/My activities only/:/All activities/);
    assert.ok(html.includes(date));
    assert.match(html,/America\/Los_Angeles/);
    assert.equal(button.test(html),mine);
    assert.equal(html.includes('OTHER-OWNER'),!mine);
    assert.doesNotMatch(html,/PRIVATE-|Next day/);
  }
});

test('agenda source identity stays separate from the guest-visible model and markup',()=>{
  const replaced=structuredClone(state),oldKey=GatherScheduleUI.guestAgendaSourceKey(state,scope);
  replaced.tasks.find(task=>task.id==='overnight').id='private-identical-replacement';
  const sameAgenda=GatherScheduleUI.guestAgendaSnapshot(replaced,scope);
  assert.deepEqual(sameAgenda,snapshot,'a different task can look the same in a guest snapshot');
  assert.notEqual(GatherScheduleUI.guestAgendaSourceKey(replaced,scope),oldKey);
  assert.doesNotMatch(JSON.stringify(sameAgenda)+schedule.guestAgendaForm(sameAgenda,state.event.name),/private-identical-replacement|sourceKey|PRIVATE-LOCATION/);
});

function agendaHarness(){
  const source=readFileSync('legacy/app.js','utf8');
  const code=source.slice(source.indexOf('  function updateGuestAgendaWarning('),source.indexOf('  function digestDialog('));
  const freshness=source.slice(source.indexOf('  let staleScheduleRevision'),source.indexOf('  function openRunSheet('));
  const field={
    agendaTitle:{value:'Guest schedule'},'include-0':{checked:false},'include-1':{checked:false},
    'title-0':{value:'Evening arrivals'},'location-0':{value:''},
    'title-1':{value:''},'location-1':{value:''},
  };
  const fields=[{},{}],form={isConnected:true,elements:{namedItem:key=>field[key]},querySelector:selector=>fields[Number(selector.match(/\d+/)?.[0])]};
  const preview={value:'',selectionStart:0,selectionEnd:0,isConnected:true,focus(){actions.push('focused');},select(){this.selectionStart=0;this.selectionEnd=this.value.length;actions.push('selected');}};
  const control=()=>({isConnected:true,setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];},
    getClientRects:()=>[{}],closest:()=>null});
  const warning={},status={},help={},button=control(),refreshButton=control(),refreshStatus={isConnected:true},actions=[],timers=[],refreshReads=[];
  const syncNotice={hidden:true},backdrop={hidden:false},dialog={isConnected:true,contains(node){return [fixture.form,fixture.preview,button,refreshButton].includes(node);}};
  const fixture={revision:1,organizer:true,clipboard:true,markup:undefined,duringCopy:undefined,failedRead:false,newer:false,inconclusive:false,reads:0,
    state,confirm:true,prompts:0,opens:0,form,preview};
  const context=vm.createContext({
    window:{navigator:{onLine:true},GatherMode:{projectId:'fictional-project',demo:false}},document:{hidden:false},
    ui:{view:'timeline',timelineMode:'schedule',scheduleMine:true,scheduleDate:scope.date,actor:'jack'},
    store:{getState:()=>fixture.state,getSnapshotRevision:()=>fixture.revision,async confirmSnapshotRevision(expected,onNewer){
      fixture.reads++;
      if(fixture.failedRead)throw Error('Offline');
      if(fixture.newer){onNewer?.(expected+1);return false;}
      return !fixture.inconclusive&&expected===fixture.revision;
    },refresh(canApply,options){return new Promise((resolve,reject)=>refreshReads.push({options,reject,canApply,
      finish({revision=2,next=fixture.state,result={verified:true,changed:revision!==fixture.revision}}={}){
        if(!result.verified||result.pending){resolve(result);return;}
        const accepted=canApply(revision,next);
        if(accepted){fixture.revision=revision;fixture.state=next;}
        resolve(accepted?result:{pending:true,newerRevision:revision});
      },
    }));}},GatherScheduleUI,schedule,isOrganizer:()=>fixture.organizer,
    $:selector=>({'#guestAgendaForm':fixture.form,'#guestAgendaText':fixture.preview,'#guestAgendaWarning':warning,'#guestAgendaSelectionStatus':status,
      '#guestAgendaCopyHelp':help,'[data-action="copy-guest-agenda"]':button,'[data-action="refresh-guest-agenda"]':refreshButton,
      '#guestAgendaRefreshStatus':refreshStatus,'#workspaceSyncNotice':syncNotice,'#dialogBackdrop':backdrop,'#dialog':dialog})[selector],
    workspaceUpdatesPending:()=>!syncNotice.hidden,recoveryConflictPending:()=>false,
    showPendingUpdate(){syncNotice.hidden=false;},render(){actions.push('rendered');},refreshSuggestionSurfaces(){},
    focusTaskDialogControl(element,host){assert.equal(element,refreshStatus);assert.equal(host,dialog);actions.push('schedule check status focused');},
    setTimeout(callback,delay){timers.push({callback,delay});},
    openDialog(_title,body,_footer,_wide,kind){fixture.opens++;fixture.markup=body;context.ui.dialogKind=kind;},
    confirmDiscard(root){assert.equal(root,form);fixture.prompts++;return fixture.confirm;},
    copyText:async value=>{actions.push(value);fixture.duringCopy?.();return fixture.clipboard;},toast:message=>actions.push(message),
  });
  assert.ok(freshness.includes('function rememberNewerSchedule'));
  vm.runInContext(freshness+code,context);
  const directCopy=(target=preview)=>{
    let prevented=false;
    context.guardGuestAgendaPreviewCopy({target,preventDefault(){prevented=true;}});
    return {prevented,text:!prevented&&target===preview?preview.value.slice(preview.selectionStart,preview.selectionEnd):''};
  };
  const selectFirst=()=>{field['include-0'].checked=true;context.syncGuestAgenda(form);};
  return {source,context,fixture,field,fields,form,preview,warning,help,button,actions,timers,directCopy,selectFirst,
    refreshButton,refreshStatus,refreshReads,backdrop,syncNotice};
}

test('starting over with all guest activities preserves date and leaves Timeline scope and clipboard untouched',()=>{
  const {source,context,fixture,field,preview,button,actions,selectFirst}=agendaHarness();
  fixture.state={...state,tasks:[...state.tasks,{id:'unassigned',owner:'',title:'Fictional unassigned activity',
    schedule:{start:'2030-03-16T10:30',end:'',location:'PRIVATE-UNASSIGNED-LOCATION'}}]};
  const before=structuredClone(fixture.state);
  context.guestAgendaDialog();selectFirst();
  const original=context.ui.guestAgenda,markup=fixture.markup,text=preview.value;
  assert.ok(text);
  assert.doesNotMatch(markup,/OTHER-OWNER|Fictional unassigned activity/);
  fixture.confirm=false;context.useAllGuestActivities();
  assert.equal(fixture.prompts,1);
  assert.equal(fixture.opens,1);
  assert.equal(context.ui.guestAgenda,original);
  assert.equal(preview.value,text);
  assert.equal(field['include-0'].checked,true);

  fixture.confirm=true;context.useAllGuestActivities();
  assert.equal(fixture.prompts,2);
  assert.equal(fixture.opens,2);
  assert.notEqual(context.ui.guestAgenda,original);
  assert.equal(context.ui.guestAgenda.snapshot.mine,false);
  assert.equal(context.ui.guestAgenda.snapshot.date,scope.date);
  assert.equal(context.ui.scheduleMine,true);
  assert.equal(context.ui.scheduleDate,scope.date);
  assert.equal(context.ui.guestAgenda.text,'');
  assert.equal(preview.value,'');
  assert.equal(button['aria-disabled'],'true');
  assert.match(fixture.markup,/All activities/);
  assert.match(fixture.markup,/Internal overnight roster/);
  assert.match(fixture.markup,/OTHER-OWNER/);
  assert.match(fixture.markup,/Fictional unassigned activity/);
  assert.doesNotMatch(fixture.markup,/\bchecked\b|Evening arrivals|Next day|PRIVATE-|all-guest-agenda-activities/);
  assert.equal(fixture.reads,0);
  assert.deepEqual(actions,[]);
  assert.deepEqual(fixture.state,before);
  assert.match(source,/action==='all-guest-agenda-activities'[^\n]*useAllGuestActivities\(/);
});

test('widening a guest draft refuses invalid or stale candidates before asking to discard',()=>{
  const {context,fixture,actions,selectFirst}=agendaHarness();
  context.guestAgendaDialog();selectFirst();
  const original=context.ui.guestAgenda,markup=fixture.markup;
  const unchanged=()=>{
    assert.equal(fixture.prompts,0);assert.equal(fixture.opens,1);
    assert.equal(context.ui.guestAgenda,original);assert.equal(fixture.markup,markup);
    assert.equal(fixture.reads,0);
  };
  const blockers=[
    [()=>fixture.organizer=false,()=>fixture.organizer=true],
    [()=>context.window.GatherAccessLost=true,()=>context.window.GatherAccessLost=false],
    [()=>original.copying=true,()=>original.copying=false],
    [()=>original.stale=true,()=>original.stale=false],
    [()=>fixture.revision++,()=>fixture.revision--],
  ];
  for(const [apply,reset] of blockers){apply();context.useAllGuestActivities();unchanged();reset();}
  fixture.state={...state,tasks:[...state.tasks,...Array.from({length:81},(_,index)=>({id:'extra-'+index,owner:'other',title:'Fictional extra activity',
    schedule:{start:'2030-03-16T11:00',end:'',location:''}}))]};
  actions.length=0;
  context.useAllGuestActivities();unchanged();
  assert.match(actions.at(-1),/80 (?:activities|entries)/);
  assert.match(actions.at(-1),/draft is unchanged/i);
});

test('organizer agenda only copies the current preview, with selection fallback and stale/access fencing',async()=>{
  const {context,fixture,field,fields,form,preview,warning,button,actions,selectFirst}=agendaHarness();
  fixture.organizer=false;context.guestAgendaDialog();assert.equal(fixture.markup,undefined);
  fixture.organizer=true;context.guestAgendaDialog();assert.match(fixture.markup,/name="include-0"/);
  assert.equal(preview.value,'');assert.equal(button['aria-disabled'],'true');
  selectFirst();
  assert.equal(fields[0].hidden,false);assert.equal(fields[1].hidden,true);
  assert.match(preview.value,/Evening arrivals/);assert.doesNotMatch(preview.value,/PRIVATE-|Welcome/);
  fixture.failedRead=true;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),['Could not confirm the latest schedule. Reconnect or try again before copying.']);
  fixture.failedRead=false;
  const expected=preview.value;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),[expected,'Guest agenda copied. Nothing was sent.']);
  fixture.clipboard=false;await context.copyGuestAgenda();assert.deepEqual(actions.splice(0),[expected,'focused','selected','Copy the selected preview manually. Nothing was sent.']);
  field['title-0'].value='Not previously previewed';
  await context.copyGuestAgenda();assert.deepEqual(actions.splice(0),['The preview changed. Review it before copying again.']);
  assert.match(preview.value,/Not previously previewed/);
  fixture.clipboard=true;
  fixture.duringCopy=()=>{field['title-0'].value='Edited while copying';context.syncGuestAgenda(form);};
  await context.copyGuestAgenda();
  assert.match(actions[0],/Not previously previewed/);
  assert.match(actions[1],/older agenda was copied.*copy it again/);
  assert.match(preview.value,/Edited while copying/);
  actions.length=0;
  fixture.duringCopy=()=>{fixture.revision=2;};
  await context.copyGuestAgenda();
  assert.match(actions[0],/Edited while copying/);
  assert.match(actions[1],/older agenda was copied.*Don’t share it/);
  assert.equal(preview.value,'');
  actions.length=0;fixture.duringCopy=undefined;
  fixture.revision=2;await context.copyGuestAgenda();assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);
  assert.ok(actions.every(action=>!action.includes('Evening arrivals')));
  context.guestAgendaDialog();context.syncGuestAgenda(form);actions.length=0;
  fixture.newer=true;await context.copyGuestAgenda();
  assert.equal(preview.value,'');
  assert.deepEqual(actions.splice(0),['This agenda is not current. Check the warning before copying.']);
  context.window.GatherAccessLost=true;actions.length=0;
  await context.copyGuestAgenda();assert.deepEqual(actions,[]);
});

test('manual copy is limited to the exact checked preview after automatic clipboard fails',async()=>{
  const {source,context,fixture,field,form,preview,help,actions,timers,directCopy,selectFirst}=agendaHarness();
  assert.match(source,/document\.addEventListener\('copy',\s*guardGuestAgendaPreviewCopy/);
  context.guestAgendaDialog();selectFirst();
  const expected=preview.value;
  preview.selectionEnd=expected.length;
  assert.equal(directCopy().prevented,true,'the ordinary preview cannot bypass the freshness check');
  assert.equal(directCopy(field['title-0']).prevented,false,'other input text keeps normal copy behavior');
  assert.equal(fixture.reads,0);
  actions.length=0;
  fixture.clipboard=false;await context.copyGuestAgenda();
  assert.deepEqual(actions.slice(0,3),[expected,'focused','selected']);
  assert.equal(fixture.reads,1);
  assert.match(help.textContent,/Copy the selected text now/);
  assert.deepEqual(directCopy(),{prevented:false,text:expected});
  assert.equal(directCopy().prevented,true,'the checked manual fallback is single-use');
  assert.match(help.textContent,/Use Copy guest agenda/);
  await context.copyGuestAgenda();
  preview.selectionStart=1;
  assert.equal(directCopy().prevented,true,'a partial selection is not the reviewed guest agenda');
  await context.copyGuestAgenda();
  field['location-0'].value='Public entrance';context.syncGuestAgenda(form);
  preview.selectionStart=0;preview.selectionEnd=preview.value.length;
  assert.equal(directCopy().prevented,true,'edits invalidate the prior manual copy');
  field['location-0'].value='';context.syncGuestAgenda(form);
  preview.selectionEnd=preview.value.length;
  assert.equal(directCopy().prevented,true,'reverting edits does not restore the old permission');
  await context.copyGuestAgenda();
  assert.deepEqual(directCopy(),{prevented:false,text:expected});
  await context.copyGuestAgenda();
  const expiry=timers.at(-1);
  assert.ok(expiry.delay>0&&expiry.delay<=30000);
  expiry.callback();
  assert.equal(directCopy().prevented,true,'the manual fallback expires');
  fixture.clipboard=true;await context.copyGuestAgenda();
  assert.equal(directCopy().prevented,true,'successful automatic copy does not enable a manual copy');
});

test('an inconclusive agenda check can retry without losing edits, but a confirmed newer revision blocks the draft',async()=>{
  const {context,fixture,field,preview,warning,button,actions,directCopy,selectFirst}=agendaHarness();
  context.guestAgendaDialog();selectFirst();
  const expected=preview.value;
  fixture.inconclusive=true;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),['Could not confirm the latest schedule. Try again before copying.']);
  assert.equal(preview.value,expected);assert.equal(field['include-0'].checked,true);
  assert.equal(button['aria-disabled'],'false');
  preview.selectionEnd=preview.value.length;
  assert.equal(directCopy().prevented,true);
  actions.length=0;
  fixture.inconclusive=false;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),[expected,'Guest agenda copied. Nothing was sent.']);
  fixture.newer=true;await context.copyGuestAgenda();
  assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);
  assert.equal(button['aria-disabled'],'true');
  const reads=fixture.reads;
  fixture.newer=false;actions.length=0;await context.copyGuestAgenda();
  assert.equal(fixture.reads,reads,'a confirmed stale draft cannot retry copy even if the next response would look unchanged');
  assert.equal(preview.value,'');assert.ok(actions.every(action=>action!==expected));
});

test('a visibility or connection reset invalidates even a clipboard fallback that has not yet resolved',async()=>{
  const {context,fixture,preview,actions,directCopy,selectFirst}=agendaHarness();
  context.guestAgendaDialog();selectFirst();
  fixture.clipboard=false;
  fixture.duringCopy=()=>context.resetGuestAgendaManualCopy();
  const expected=preview.value;
  await context.copyGuestAgenda();
  assert.equal(preview.value,expected);
  assert.deepEqual(actions.splice(0),[expected,'The preview changed. Review it before copying again.']);
  preview.selectionEnd=preview.value.length;
  assert.equal(directCopy().prevented,true);
  fixture.duringCopy=undefined;
  await context.copyGuestAgenda();
  assert.deepEqual(directCopy(),{prevented:false,text:expected});
});

function staleAgenda(){
  const f=agendaHarness();
  f.fixture.state=structuredClone(state);
  f.context.guestAgendaDialog();
  f.field.agendaTitle.value='  Fictional guest schedule  ';
  f.field['include-0'].checked=true;
  f.field['title-0'].value='  Evening arrivals  ';
  f.field['location-0'].value='  Guest-facing entrance  ';
  f.field['title-1'].value='Unselected draft title';
  f.field['location-1'].value='Unselected draft location';
  f.context.syncGuestAgenda(f.form);
  f.expected=f.preview.value;f.raw=structuredClone(f.field);f.draft=f.context.ui.guestAgenda;
  f.fixture.newer=true;
  return f;
}

async function discoverStaleAgenda(f){
  await f.context.copyGuestAgenda();f.fixture.newer=false;
  assert.equal(f.fixture.reads,1);assert.equal(f.preview.value,'');assert.equal(f.button['aria-disabled'],'true');
  f.actions.length=0;
}

test('a verified unchanged schedule refresh keeps every guest field and requires an independent copy action',async()=>{
  const f=staleAgenda();await discoverStaleAgenda(f);
  const updated=structuredClone(f.fixture.state);
  updated.event.bookingReference='New private datum is not part of the draft';
  updated.tasks.find(task=>task.id==='overnight').note='New internal note not shown';
  updated.tasks.find(task=>task.id==='other').schedule.start='2030-03-16T08:40';
  updated.tasks.find(task=>task.id==='later').schedule.start='2030-03-17T10:00';
  f.context.document.activeElement=f.refreshButton;
  const refreshing=f.context.refreshGuestAgenda(f.refreshButton);
  assert.equal(f.refreshReads.length,1);assert.equal(f.refreshReads[0].options.requireFresh,true);
  await f.context.refreshGuestAgenda(f.refreshButton);
  assert.equal(f.refreshReads.length,1,'a duplicate check during a read is harmless');
  assert.equal(f.preview.value,'');assert.equal(f.fixture.reads,1);
  f.refreshReads[0].finish({next:updated});await refreshing;
  assert.equal(f.fixture.opens,1,'a harmless revision does not replace the agenda form');
  assert.equal(f.context.ui.guestAgenda,f.draft);assert.equal(f.draft.revision,2);
  assert.deepEqual(f.field,f.raw);assert.equal(f.preview.value,f.expected);
  assert.equal(f.button['aria-disabled'],'false');assert.equal(f.fixture.reads,1);
  assert.equal(f.refreshButton.hidden,true);assert.match(f.refreshStatus.textContent,/Schedule checked/);
  assert.ok(f.actions.includes('schedule check status focused'));
  assert.ok(!f.actions.includes(f.expected),'checking the schedule never copies the draft');
  f.preview.selectionEnd=f.expected.length;
  assert.equal(f.directCopy().prevented,true,'checking latest does not authorize manual copy');
  f.actions.length=0;
  await f.context.copyGuestAgenda();
  assert.equal(f.fixture.reads,2,'explicit copy confirms the revision again');
  assert.deepEqual(f.actions,[f.expected,'Guest agenda copied. Nothing was sent.']);
});

test('matching-looking replacement IDs, scoped membership, changed times or zones stay locked',async()=>{
  for(const [variant,change] of [
    ['same title and time but replacement ID',data=>data.tasks.find(task=>task.id==='overnight').id='private-replacement-id'],
    ['changed start',data=>data.tasks.find(task=>task.id==='overnight').schedule.start='2030-03-15T23:45'],
    ['changed end',data=>data.tasks.find(task=>task.id==='overnight').schedule.end='2030-03-16T00:45'],
    ['changed zone',data=>data.event.timeZone='America/New_York'],
    ['changed private location',data=>data.tasks.find(task=>task.id==='overnight').schedule.location='PRIVATE-CHANGED-LOCATION'],
    ['changed source title',data=>data.tasks.find(task=>task.id==='overnight').title='PRIVATE-CHANGED-TITLE'],
    ['changed event name',data=>data.event.name='New event name'],
    ['row moved out of Mine',data=>data.tasks.find(task=>task.id==='overnight').owner='other'],
    ['new row in same scope',data=>data.tasks.push({id:'private-added-id',title:'New activity',owner:'jack',schedule:{start:'2030-03-16T10:00',end:'',location:''}})],
  ]){
    const f=staleAgenda();await discoverStaleAgenda(f);
    const next=structuredClone(f.fixture.state);change(next);
    const checking=f.context.refreshGuestAgenda(f.refreshButton);
    f.refreshReads[0].finish({next});await checking;
    assert.equal(f.draft.revision,1,variant);assert.equal(f.preview.value,'',variant);
    assert.equal(f.button['aria-disabled'],'true',variant);assert.deepEqual(f.field,f.raw,variant);
    assert.equal(f.fixture.opens,1,variant);assert.equal(f.directCopy().prevented,true,variant);
    assert.match(f.warning.textContent,/schedule changed.*edits are still here/i,variant);
    await f.context.copyGuestAgenda();assert.equal(f.fixture.reads,1,variant);
    assert.ok(!f.actions.includes(f.expected),variant);
    assert.doesNotMatch(f.fixture.markup+f.warning.textContent,/private-(replacement|added)-id|PRIVATE-/,variant);
  }
});

test('inconclusive, older and failed refreshes keep the old draft gated and let the organizer retry',async()=>{
  const f=staleAgenda();await discoverStaleAgenda(f);
  const inconclusive=f.context.refreshGuestAgenda(f.refreshButton);
  f.refreshReads.at(-1).finish({result:{changed:false}});await inconclusive;
  assert.equal(f.preview.value,'');assert.equal(f.button['aria-disabled'],'true');
  const older=f.context.refreshGuestAgenda(f.refreshButton);
  f.refreshReads.at(-1).finish({revision:1});await older;
  assert.equal(f.draft.revision,1);assert.equal(f.preview.value,'');
  const offline=f.context.refreshGuestAgenda(f.refreshButton);
  f.refreshReads.at(-1).reject(Error('Fictional offline'));await offline;
  assert.equal(f.draft.revision,1);assert.equal(f.preview.value,'');assert.deepEqual(f.field,f.raw);
  const confirmed=f.context.refreshGuestAgenda(f.refreshButton);
  f.refreshReads.at(-1).finish();await confirmed;
  assert.equal(f.draft.revision,2);assert.equal(f.preview.value,f.expected);assert.deepEqual(f.field,f.raw);
  assert.equal(f.fixture.reads,1);assert.ok(!f.actions.includes(f.expected));
});

test('an in-flight schedule read cannot bless a replaced guest form or a different live scope',async()=>{
  for(const change of ['actor','project','access','hidden','organizer','form','view']){
    const f=staleAgenda();await discoverStaleAgenda(f);
    const checking=f.context.refreshGuestAgenda(f.refreshButton);
    if(change==='actor')f.context.ui.actor='different-organizer';
    if(change==='project')f.context.window.GatherMode.projectId='different-project';
    if(change==='access')f.context.window.GatherAccessLost=true;
    if(change==='hidden')f.context.document.hidden=true;
    if(change==='organizer')f.fixture.organizer=false;
    if(change==='form')f.fixture.form={...f.form};
    if(change==='view')f.context.ui.view='overview';
    f.refreshReads[0].finish();await checking;
    assert.equal(f.draft.revision,1,change);assert.equal(f.preview.value,'',change);
    assert.equal(f.button['aria-disabled'],'true',change);assert.deepEqual(f.field,f.raw,change);
    assert.equal(f.fixture.reads,1,change);assert.ok(!f.actions.includes(f.expected),change);
  }
});

test('refresh uses the widened draft scope rather than the unchanged My activities Timeline filter',async()=>{
  const f=staleAgenda();
  await f.context.refreshGuestAgenda(f.refreshButton);
  assert.equal(f.refreshReads.length,0,'the hidden refresh control cannot read a fresh draft');
  f.context.useAllGuestActivities();
  assert.equal(f.context.ui.scheduleMine,true);
  f.draft=f.context.ui.guestAgenda;
  assert.equal(f.draft.snapshot.mine,false);
  f.context.syncGuestAgenda(f.form);
  await discoverStaleAgenda(f);
  const next=structuredClone(f.fixture.state);
  next.tasks.find(task=>task.id==='other').schedule.start='2030-03-16T08:45';
  const checking=f.context.refreshGuestAgenda(f.refreshButton);
  f.refreshReads[0].finish({next});await checking;
  assert.equal(f.context.ui.guestAgenda,f.draft);assert.equal(f.draft.revision,1);
  assert.match(f.warning.textContent,/schedule changed.*edits are still here/i);
  assert.equal(f.preview.value,'');assert.deepEqual(f.field,f.raw);assert.equal(f.fixture.reads,1);
});
