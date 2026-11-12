import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:()=>'',statusBadge:()=>''});
const activity=(id,owner,start,end='',extra={})=>({id,title:id,owner,status:'todo',schedule:{start,end,location:'Hall'},...extra});
const state={
  event:{name:'School conference',timeZone:'America/Los_Angeles'},
  members:[{id:'maya',name:'Maya'},{id:'dev',name:'Dev'}],
  tasks:[
    activity('Overnight desk','maya','2026-11-20T23:30','2026-11-21T01:30',{dependencies:[{taskId:'setup'}],note:'PRIVATE-DESK-NOTE'}),
    activity('Ends at midnight','maya','2026-11-20T23:00','2026-11-21T00:00'),
    activity('No end time','maya','2026-11-20T23:45'),
    activity('Morning opening','maya','2026-11-21T09:00','2026-11-21T09:30'),
    activity('Another team checks in','dev','2026-11-21T00:30','2026-11-21T01:00'),
    activity('Sunday teardown','maya','2026-11-22T09:00'),
    {id:'setup',title:'PRIVATE-SETUP-TITLE',owner:'dev',status:'todo'},
  ],
};
const today=Date.parse('2026-11-21T09:00Z'), scope={mine:true,actor:'maya',date:'2026-11-21'};

test('selected event-local date includes overnight work, not exact-midnight ends or open-ended work from the prior day',()=>{
  const before=structuredClone(state),live=ui.view(state,false,today,scope),print=ui.runSheet(state,today,scope);
  for(const html of [live,print]){
    assert.match(html,/Overnight desk/);
    assert.match(html,/Continues from Fri, Nov 20, 2026/);
    assert.match(html,/Morning opening/);
    assert.doesNotMatch(html,/Ends at midnight|No end time|Sunday teardown|Another team checks in|PRIVATE-/);
    assert.match(html,/Potential location overlap/);
    assert.match(html,/Required work not complete/);
  }
  assert.match(print,/My activities · Maya · Sat, Nov 21, 2026/);
  assert.equal(print.match(/<caption>/g).length,1);
  assert.equal(ui.clock(state,today,scope).labels.get('Overnight desk'),'Scheduled now');
  assert.equal(ui.clock(state,today,scope).labels.get('Morning opening'),'Next');
  assert.equal(ui.clock(state,today,{...scope,date:'2026-11-22'}).markup,'');
  assert.equal(ui.clock(state,today,{...scope,date:'2026-11-20'}).labels.size,0);
  assert.deepEqual(state,before);
});

test('date filter keeps activity scope, has a truthful empty state, and safely falls back from invalid dates',()=>{
  const day={...scope,date:'2026-11-23'};
  assert.match(ui.view(state,false,today,day),/No activities assigned to you on this date/);
  assert.match(ui.view(state,false,today,day),/Show all dates/);
  const emptyPrint=ui.runSheet(state,today,day);
  assert.match(emptyPrint,/No scheduled activities in this scope on the selected date/);
  assert.doesNotMatch(emptyPrint,/<table/);
  for(const invalid of ['2026-02-30','2026-11-1','" onfocus="bad']){
    assert.equal(ui.runSheet(state,today,{...scope,date:invalid}),ui.runSheet(state,today,{...scope,date:''}));
    assert.match(ui.view(state,false,today,{...scope,date:invalid}),/name="scheduleDate" value=""/);
  }
});

test('a multi-day activity is visible on intermediate dates without expanding a date range',()=>{
  const long={...state,tasks:[activity('Multi-day booth','maya','2026-11-20T19:00','2026-11-24T17:00')]};
  const html=ui.runSheet(long,today,{date:'2026-11-23'});
  assert.match(html,/Multi-day booth/);
  assert.match(html,/Continues from Fri, Nov 20, 2026/);
  assert.equal(html.match(/<caption>/g).length,1);
});

test('activity-day shortcuts follow scope and skip empty dates without skipping overnight work',()=>{
  const fixture={...state,tasks:[
    activity('Overnight','maya','2026-11-20T23:30','2026-11-21T01:30'),
    activity('Ends at midnight','maya','2026-11-21T23:00','2026-11-22T00:00'),
    activity('Other owner','dev','2026-11-22T10:00'),
    activity('Next personal activity','maya','2026-11-25T10:00'),
  ]};
  const at='2026-11-21T03:30Z'; // Nov 20 in the event zone, not Nov 21 (UTC).
  const days=(date,mine=true)=>ui.activityDays(fixture,at,{...scope,date,mine});
  assert.deepEqual(days(''),{first:'2026-11-20',previous:'',next:'',today:'2026-11-20'});
  assert.deepEqual(days('2026-11-20'),{first:'',previous:'',next:'2026-11-21',today:'2026-11-20'});
  assert.equal(days('2026-11-21').next,'2026-11-25');
  assert.equal(days('2026-11-21',false).next,'2026-11-22');
  assert.deepEqual(days('2026-11-23'),{first:'',previous:'2026-11-21',next:'2026-11-25',today:'2026-11-20'});
  assert.equal(days('2026-11-25').next,'');
  assert.deepEqual(ui.activityDays(fixture,at,{...scope,actor:'nobody'}),{first:'',previous:'',next:'',today:''});
  const html=ui.view(fixture,false,at,{...scope,date:'2026-11-20'});
  assert.match(html,/id="schedule-jump-next"[^>]*>Next activity day/);
  assert.match(html,/id="schedule-jump-today"[^>]*>Today/);
  assert.doesNotMatch(html,/id="schedule-jump-(?:previous|first)"/);
});

test('calendar shortcuts handle month, leap day and representable date boundaries without expanding ranges',()=>{
  const long={...state,tasks:[activity('Long booth','maya','0001-01-01T01:00','9999-12-31T00:00')]};
  const days=date=>ui.activityDays(long,today,{...scope,date});
  assert.equal(days('0001-01-01').previous,'');
  assert.equal(days('2028-02-28').next,'2028-02-29');
  assert.equal(days('2028-03-01').previous,'2028-02-29');
  assert.equal(days('9999-12-31').previous,'9999-12-30');
  assert.equal(days('9999-12-31').next,'');
  assert.equal(days('0000-12-31').first,'0001-01-01');
});

test('only an explicit valid submission applies a date, and clearing restores focus',()=>{
  const source=readFileSync('legacy/app.js','utf8'),uiState={scheduleDate:''};
  const action=source.split('\n').find(line=>line.includes("if(action==='clear-schedule-date'"));
  const submit=source.match(/if\(form.id==='scheduleDateForm'\)\{[\s\S]*?\n    \}/)[0];
  let renders=0,focuses=0;
  const input={value:'2026-11-21',validity:{valid:true}};
  const context=vm.createContext({ui:uiState,window:{},form:{id:'scheduleDateForm',elements:{namedItem:name=>{assert.equal(name,'scheduleDate');return input;}}},action:'clear-schedule-date',
    render(){renders++;},$:selector=>{assert.equal(selector,'#scheduleDate');return {focus(){focuses++;}};}});
  assert.doesNotMatch(source,/if\(el.id==='scheduleDate'/);
  vm.runInContext('(()=>{'+submit+'})()',context);
  assert.equal(uiState.scheduleDate,'2026-11-21');assert.equal(renders,1);
  input.validity.valid=false;input.value='';
  vm.runInContext('(()=>{'+submit+'})()',context);
  assert.equal(uiState.scheduleDate,'2026-11-21');assert.equal(renders,1);
  vm.runInContext(action,context);
  assert.equal(uiState.scheduleDate,'');assert.equal(renders,2);assert.equal(focuses,2);
});

test('untimed activities remain visible across dates without becoming run-sheet entries',()=>{
  const fixture={...state,tasks:[...state.tasks,
    {id:'own-untimed',title:'My unscheduled briefing',owner:'maya',eventActivity:true,status:'todo'},
    {id:'other-untimed',title:'Another owner’s unscheduled briefing',owner:'dev',eventActivity:true,status:'todo'}]};
  const live=ui.view(fixture,false,today,scope),sheet=ui.runSheet(fixture,today,scope);
  assert.match(live,/My unscheduled briefing/);
  assert.match(live,/Undated activities are shown here regardless of the selected date/);
  assert.doesNotMatch(live,/Another owner’s unscheduled briefing/);
  assert.match(sheet,/1 planned activity is not shown.*not tied to the selected date/);
  assert.doesNotMatch(sheet,/unscheduled briefing/);
  assert.match(ui.preparationReview(fixture,today,scope),/review covers all event dates in this scope/);
});
