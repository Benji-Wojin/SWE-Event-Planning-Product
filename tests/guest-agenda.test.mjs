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
});

test('organizer agenda only copies the current preview, with selection fallback and stale/access fencing',async()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const code=source.slice(source.indexOf('  function updateGuestAgendaWarning('),source.indexOf('  function digestDialog('));
  const field={
    agendaTitle:{value:'Guest schedule'},'include-0':{checked:false},'include-1':{checked:false},
    'title-0':{value:'Evening arrivals'},'location-0':{value:''},
  };
  const fields=[{},{}],form={elements:{namedItem:key=>field[key]},querySelector:selector=>fields[Number(selector.match(/\d+/)[0])]};
  const preview={value:'',isConnected:true,focus(){actions.push('focused');},select(){actions.push('selected');}};
  const warning={},status={},button={setAttribute(key,value){this[key]=value;}},actions=[];
  let revision=1,organizer=true,clipboard=true,markup,duringCopy,failedRead=false,newer=false;
  const context=vm.createContext({
    window:{navigator:{onLine:true}},ui:{view:'timeline',timelineMode:'schedule',scheduleMine:true,scheduleDate:scope.date,actor:'jack'},
    store:{getState:()=>state,getSnapshotRevision:()=>revision,confirmSnapshotRevision:async expected=>{if(failedRead)throw Error('Offline');return !newer&&!failedRead&&expected===revision;}},GatherScheduleUI,schedule,isOrganizer:()=>organizer,
    $:selector=>({'#guestAgendaForm':form,'#guestAgendaText':preview,'#guestAgendaWarning':warning,'#guestAgendaSelectionStatus':status,'[data-action="copy-guest-agenda"]':button})[selector],
    openDialog(_title,body,_footer,_wide,kind){markup=body;context.ui.dialogKind=kind;},
    copyText:async value=>{actions.push(value);duringCopy?.();return clipboard;},toast:message=>actions.push(message),
  });
  vm.runInContext(code,context);
  organizer=false;context.guestAgendaDialog();assert.equal(markup,undefined);
  organizer=true;context.guestAgendaDialog();assert.match(markup,/name="include-0"/);
  assert.equal(preview.value,'');assert.equal(button['aria-disabled'],'true');
  field['include-0'].checked=true;context.syncGuestAgenda(form);
  assert.equal(fields[0].hidden,false);assert.equal(fields[1].hidden,true);
  assert.match(preview.value,/Evening arrivals/);assert.doesNotMatch(preview.value,/PRIVATE-|Welcome/);
  failedRead=true;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),['Could not confirm the latest schedule. Reconnect or try again before copying.']);
  failedRead=false;
  const expected=preview.value;await context.copyGuestAgenda();
  assert.deepEqual(actions.splice(0),[expected,'Guest agenda copied. Nothing was sent.']);
  clipboard=false;await context.copyGuestAgenda();assert.deepEqual(actions.splice(0),[expected,'focused','selected','Copy the selected preview manually. Nothing was sent.']);
  field['title-0'].value='Not previously previewed';
  await context.copyGuestAgenda();assert.deepEqual(actions.splice(0),['The preview changed. Review it before copying again.']);
  assert.match(preview.value,/Not previously previewed/);
  clipboard=true;
  duringCopy=()=>{field['title-0'].value='Edited while copying';context.syncGuestAgenda(form);};
  await context.copyGuestAgenda();
  assert.match(actions[0],/Not previously previewed/);
  assert.match(actions[1],/older agenda was copied.*copy it again/);
  assert.match(preview.value,/Edited while copying/);
  actions.length=0;
  duringCopy=()=>{revision=2;};
  await context.copyGuestAgenda();
  assert.match(actions[0],/Edited while copying/);
  assert.match(actions[1],/older agenda was copied.*Don’t share it/);
  assert.equal(preview.value,'');
  actions.length=0;duringCopy=undefined;
  revision=2;await context.copyGuestAgenda();assert.equal(preview.value,'');assert.match(warning.textContent,/shared plan changed/);
  assert.ok(actions.every(action=>!action.includes('Evening arrivals')));
  context.guestAgendaDialog();context.syncGuestAgenda(form);actions.length=0;
  newer=true;await context.copyGuestAgenda();
  assert.equal(preview.value,'');
  assert.deepEqual(actions.splice(0),['This agenda is not current. Check the warning before copying.']);
  context.window.GatherAccessLost=true;actions.length=0;
  await context.copyGuestAgenda();assert.deepEqual(actions,[]);
});
