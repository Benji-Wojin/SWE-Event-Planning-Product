import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';
import '../legacy/navigation.js';

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

test('all-dates Timeline and run sheet include the overnight handoff under each displayed day',()=>{
  const before=structuredClone(state),allDates={...scope,date:''};
  const model=ui.runSheetModel(state,today,allDates),selected=ui.runSheetModel(state,today,scope);
  const [friday,saturday,sunday]=model.days;
  assert.deepEqual(model.days.map(day=>day.label),['Fri, Nov 20, 2026','Sat, Nov 21, 2026','Sun, Nov 22, 2026']);
  assert.deepEqual(friday.rows.map(row=>row.title),['Ends at midnight','Overnight desk','No end time']);
  assert.deepEqual(saturday.rows.map(row=>row.title),['Overnight desk','Morning opening']);
  assert.deepEqual(sunday.rows.map(row=>row.title),['Sunday teardown']);
  assert.equal(saturday.rows[0].range,friday.rows[1].range,'carry-in preserves the entered time range');
  assert.equal(friday.rows[1].continues,'');
  assert.equal(saturday.rows[0].continues,'Continues from Fri, Nov 20, 2026');
  assert.deepEqual(saturday,selected.days[0]);

  const timeline=ui.view(state,false,today,allDates);
  const timelineRows=[...timeline.matchAll(/<button class="schedule-row"([^>]*)>([\s\S]*?)<\/button>/g)];
  const overnight=timelineRows.filter(([,attributes])=>attributes.includes('data-id="Overnight desk"'));
  assert.deepEqual(overnight.map(([,attrs])=>attrs.match(/data-schedule-day="([^"]+)"/)?.[1]),['2026-11-20','2026-11-21']);
  assert.doesNotMatch(overnight[0][2],/Continues from/);
  assert.match(overnight[1][2],/Continues from Fri, Nov 20, 2026/);
  assert.deepEqual(timelineRows.filter(([,attrs])=>attrs.includes('data-schedule-day="2026-11-21"'))
    .map(([,attrs])=>attrs.match(/data-id="([^"]+)"/)?.[1]),['Overnight desk','Morning opening']);

  const print=ui.runSheetMarkup(model),text=ui.runSheetText(model);
  const saturdayPrint=print.split('<caption>Sat, Nov 21, 2026</caption>')[1]?.split('</table>')[0]||'';
  const saturdayText=text.split('\nSat, Nov 21, 2026\n')[1]?.split('\nSun, Nov 22, 2026\n')[0]||'';
  for(const output of [saturdayPrint,saturdayText]){
    assert.match(output,/Overnight desk[\s\S]*Continues from Fri, Nov 20, 2026[\s\S]*Morning opening/);
    assert.doesNotMatch(output,/Ends at midnight|No end time|Sunday teardown/);
  }
  for(const output of [print,text]){
    assert.equal((output.match(/1 activity has unfinished required work/g)||[]).length,1);
    assert.doesNotMatch(output,/2 activities have unfinished required work/);
    assert.equal((output.match(/3 activities have potential location overlap/g)||[]).length,1,
      'each scoped activity contributes once even if its warning is on multiple date rows');
    assert.doesNotMatch(output,/4 activities have potential location overlap/);
  }
  for(const output of [timeline,print,text])assert.doesNotMatch(output,/Another team checks in|PRIVATE-/);
  assert.deepEqual(state,before);
});

test('the live phase follows an overnight activity to the right day at midnight',()=>{
  const fixture={...state,tasks:[state.tasks[0]]},allDates={...scope,date:''};
  const read=at=>[...ui.view(fixture,false,at,allDates).matchAll(/data-schedule-phase="Overnight desk" data-schedule-phase-day="([^"]+)"( hidden)?>([^<]*)</g)]
    .map(([,date,hidden,label])=>[date,hidden?'':label]);
  const friday='2026-11-20',saturday='2026-11-21';
  assert.deepEqual(read('2026-11-21T07:00Z'),[[friday,'Next'],[saturday,'']]);
  assert.deepEqual(read('2026-11-21T07:45Z'),[[friday,'Scheduled now'],[saturday,'']]);
  assert.deepEqual(read('2026-11-21T08:15Z'),[[friday,''],[saturday,'Scheduled now']]);
  assert.deepEqual(read('2026-11-21T10:00Z'),[[friday,''],[saturday,'Past scheduled end']]);
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

test('all-dates groups stay bounded to in-scope starts and continuation boundaries',()=>{
  const fixture={...state,tasks:[
    activity('Fictional long booth','maya','2026-11-20T19:00','2099-11-24T00:00'),
    activity('Fictional intermediate check','maya','2026-11-25T08:00','2026-11-25T09:00'),
    activity('Other owner’s check','dev','2026-11-26T08:00','2026-11-26T09:00'),
    activity('Fictional same-day slot','maya','2099-11-24T08:00','2099-11-24T09:00'),
  ]};
  const personal={...scope,date:''},shared={...personal,mine:false};
  const labels=['2026-11-20','2026-11-21','2026-11-25','2099-11-23','2099-11-24'];
  const dates=ui.runSheetModel(fixture,today,personal).days;
  assert.deepEqual(dates.map(day=>day.label),labels.map(day=>GatherScheduleUI.dateLabel(day)));
  assert.deepEqual(dates.map(day=>day.rows.map(row=>row.title)),[
    ['Fictional long booth'],['Fictional long booth'],['Fictional long booth','Fictional intermediate check'],
    ['Fictional long booth'],['Fictional same-day slot'],
  ]);
  assert.equal((ui.view(fixture,false,today,personal).match(/<section class="schedule-day">/g)||[]).length,labels.length);
  const extra=ui.runSheetModel(fixture,today,shared).days.find(day=>day.label===GatherScheduleUI.dateLabel('2026-11-26'));
  assert.deepEqual(extra?.rows.map(row=>row.title),['Fictional long booth','Other owner’s check']);
  const intermediate=ui.runSheetModel(fixture,today,{...personal,date:'2035-05-14'}).days;
  assert.deepEqual(intermediate.map(day=>day.rows.map(row=>row.title)),[['Fictional long booth']]);
  assert.equal(intermediate[0].rows[0].continues,'Continues from Fri, Nov 20, 2026');
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
  const locations=[];
  const input={value:'2026-11-21',validity:{valid:true}};
  const context=vm.createContext({ui:uiState,window:{},form:{id:'scheduleDateForm',elements:{namedItem:name=>{assert.equal(name,'scheduleDate');return input;}}},action:'clear-schedule-date',
    navigation:{replaceScheduleDate:day=>locations.push(day)},
    render(){renders++;},$:selector=>{assert.equal(selector,'#scheduleDate');return {focus(){focuses++;}};}});
  assert.doesNotMatch(source,/if\(el.id==='scheduleDate'/);
  vm.runInContext('(()=>{'+submit+'})()',context);
  assert.equal(uiState.scheduleDate,'2026-11-21');assert.equal(renders,1);
  input.validity.valid=false;input.value='';
  vm.runInContext('(()=>{'+submit+'})()',context);
  assert.equal(uiState.scheduleDate,'2026-11-21');assert.equal(renders,1);
  vm.runInContext(action,context);
  assert.equal(uiState.scheduleDate,'');assert.equal(renders,2);assert.equal(focuses,2);
  assert.deepEqual(locations,['2026-11-21','']);
});

test('passive Timeline renders keep an unsubmitted date without changing the committed filter',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf('  function captureScheduleDateDraft('),end=source.indexOf('  function render() {',start);
  assert.ok(start>=0&&end>start);
  for(const [base,value,nextBase,view,mode,expected] of [
    ['', '2026-11-21', '', 'timeline', 'schedule', '2026-11-21'],
    ['2026-11-20','', '2026-11-20', 'timeline', 'schedule', ''],
    ['2026-11-20','2026-11-21','2026-11-22','timeline','schedule','2026-11-22'],
    ['2026-11-20','2026-11-21','', 'timeline','schedule',''],
    ['2026-11-20','2026-11-21','2026-11-20','overview','schedule','2026-11-20'],
    ['2026-11-20','2026-11-21','2026-11-20','timeline','deadlines','2026-11-20'],
  ]){
    let field={defaultValue:base,value};
    const ui={scheduleDate:base,view:'timeline',timelineMode:'schedule'};
    const ctx=vm.createContext({ui,$:id=>id==='#scheduleDate'?field:null});
    vm.runInContext(source.slice(start,end)+'globalThis.draft=captureScheduleDateDraft();',ctx);
    field={defaultValue:nextBase,value:nextBase};
    Object.assign(ui,{scheduleDate:nextBase,view,timelineMode:mode});
    vm.runInContext('restoreScheduleDateDraft(draft);',ctx);
    assert.equal(field.value,expected);
    assert.equal(ui.scheduleDate,nextBase,'a passive render cannot commit the input');
  }
  assert.match(source,/const scheduleDateDraft=captureScheduleDateDraft\(\);[\s\S]*restoreScheduleDateDraft\(scheduleDateDraft\);/);
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

test('a shared day copy action is available only for a selected day in a real hosted project',()=>{
  const html=ui.view(state,false,today,{...scope,shareDay:true});
  assert.match(html,/type="button" data-action="copy-schedule-day" aria-describedby="scheduleDayShareHelp">Copy day link/);
  assert.match(html,/Recipients still need project access/);
  assert.doesNotMatch(ui.view(state,false,today,{...scope,shareDay:false}),/Copy day link/);
  assert.doesNotMatch(ui.view(state,false,today,{...scope,date:'',shareDay:true}),/Copy day link/);
});

test('copy submits only the live day URL and falls back without writing workspace state',async()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf("      if(action==='copy-schedule-day'");
  const end=source.indexOf("      if(action==='run-sheet'",start);
  assert.ok(start>=0&&end>start);
  const run=new vm.Script('(async()=>{'+source.slice(start,end)+'})()');
  const seen=[],window={GatherMode:{projectId:'school',demo:false}};
  let success=true;
  const context=vm.createContext({action:'copy-schedule-day',el:{isConnected:true},window,GatherNavigation,
    ui:{scheduleDate:'2026-11-21',scheduleMine:true,actor:'maya'},location:{origin:'https://weft.example'},
    copyText:async value=>{seen.push(value);return success;},toast:value=>seen.push(value),
    copyFallback:(url,title)=>seen.push([url,title]),$:()=>({hidden:true}),
  });
  const link='https://weft.example/project?project=school&day=2026-11-21';
  await run.runInContext(context);
  assert.deepEqual(seen.splice(0),[link,'Day link copied. Recipients still need project access.']);
  success=false;
  await run.runInContext(context);
  assert.deepEqual(seen.splice(0),[link,[link,'Copy the schedule day link']]);
  window.GatherAccessLost=true;
  await run.runInContext(context);
  assert.deepEqual(seen,[]);
});
