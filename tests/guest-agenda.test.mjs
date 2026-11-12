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

function agendaHarness(){
  const source=readFileSync('legacy/app.js','utf8');
  const code=source.slice(source.indexOf('  function updateGuestAgendaWarning('),source.indexOf('  function digestDialog('));
  const freshness=source.slice(source.indexOf('  let staleScheduleRevision'),source.indexOf('  function openRunSheet('));
  const field={
    agendaTitle:{value:'Guest schedule'},'include-0':{checked:false},'include-1':{checked:false},
    'title-0':{value:'Evening arrivals'},'location-0':{value:''},
  };
  const fields=[{},{}],form={elements:{namedItem:key=>field[key]},querySelector:selector=>fields[Number(selector.match(/\d+/)[0])]};
  const preview={value:'',selectionStart:0,selectionEnd:0,isConnected:true,focus(){actions.push('focused');},select(){this.selectionStart=0;this.selectionEnd=this.value.length;actions.push('selected');}};
  const warning={},status={},help={},button={setAttribute(key,value){this[key]=value;}},actions=[],timers=[];
  const fixture={revision:1,organizer:true,clipboard:true,markup:undefined,duringCopy:undefined,failedRead:false,newer:false,inconclusive:false,reads:0};
  const context=vm.createContext({
    window:{navigator:{onLine:true}},ui:{view:'timeline',timelineMode:'schedule',scheduleMine:true,scheduleDate:scope.date,actor:'jack'},
    store:{getState:()=>state,getSnapshotRevision:()=>fixture.revision,async confirmSnapshotRevision(expected,onNewer){
      fixture.reads++;
      if(fixture.failedRead)throw Error('Offline');
      if(fixture.newer){onNewer?.(expected+1);return false;}
      return !fixture.inconclusive&&expected===fixture.revision;
    }},GatherScheduleUI,schedule,isOrganizer:()=>fixture.organizer,
    $:selector=>({'#guestAgendaForm':form,'#guestAgendaText':preview,'#guestAgendaWarning':warning,'#guestAgendaSelectionStatus':status,'#guestAgendaCopyHelp':help,'[data-action="copy-guest-agenda"]':button})[selector],
    setTimeout(callback,delay){timers.push({callback,delay});},
    openDialog(_title,body,_footer,_wide,kind){fixture.markup=body;context.ui.dialogKind=kind;},
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
  return {source,context,fixture,field,fields,form,preview,warning,help,button,actions,timers,directCopy,selectFirst};
}

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
