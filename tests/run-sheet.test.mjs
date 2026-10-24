import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';

const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:()=>{throw Error('No profile markup in a run sheet');},statusBadge:()=>{throw Error('No badge markup in a run sheet');}});
const now=Date.parse('2026-11-20T23:00:00Z');
const activity=(id,owner,start,end='',extra={})=>({id,title:id,owner,status:'todo',schedule:{start,end,location:'East hall'},...extra});
const state=()=>({event:{name:'School dance',timeZone:'America/Los_Angeles',bookingReference:'PRIVATE-EVENT'},members:[{id:'maya',name:'Maya Chen',email:'PRIVATE-EMAIL'}],tasks:[
  activity('Later','maya','2026-11-21T09:00'),
  activity('Check-in','maya','2026-11-20T17:30','2026-11-20T18:00',{note:'PRIVATE-NOTE',comments:[{text:'PRIVATE-COMMENT'}]}),
  activity('Sound check','','2026-11-20T17:00','2026-11-20T17:30'),
  {id:'prep',title:'PREPARATION-ONLY',dueDate:'2026-11-20'},
],guests:[{name:'PRIVATE-GUEST'}],files:[{name:'PRIVATE-FILE'}],messages:[{body:'PRIVATE-MAIL'}],privateRecords:[{reference:'PRIVATE-BOOKING'}]});

test('run sheet is an ordered event-zone snapshot of schedule facts, not a workspace export',()=>{
  const input=state(),before=structuredClone(input),html=ui.runSheet(input,now);
  assert.ok(html.indexOf('Sound check')<html.indexOf('Check-in'));
  assert.ok(html.indexOf('Check-in')<html.indexOf('Later'));
  assert.match(html,/School dance/);assert.match(html,/2026-11-20 · 15:00 · America\/Los_Angeles/);
  assert.match(html,/5:30 PM – 6:00 PM/);assert.match(html,/Maya Chen/);assert.match(html,/Unassigned/);
  assert.match(html,/No end time set/);assert.match(html,/This copy is not live/);
  assert.match(html,/scheduled times never mark work complete/);assert.match(html,/downloaded copies cannot be recalled/);
  assert.doesNotMatch(html,/PRIVATE-(?:EVENT|EMAIL|NOTE|COMMENT|GUEST|FILE|MAIL|BOOKING)|PREPARATION-ONLY|data-action|<form/);
  assert.deepEqual(input,before);
});

test('personal run sheets contain only the signed-in actor schedule, with truthful empty states',()=>{
  const input=state(),html=ui.runSheet(input,now,{mine:true,actor:'maya'});
  assert.match(html,/My activities · Maya Chen/);assert.match(html,/Check-in/);assert.doesNotMatch(html,/Sound check/);
  for(const actor of ['other','',undefined])assert.match(ui.runSheet(input,now,{mine:true,actor}),/No scheduled activities in this view/);
  assert.match(ui.runSheet({...input,tasks:[]},now),/No scheduled activities in this view/);
});

test('run sheet retains blocked/completed/review states and warns about entered owner overlaps',()=>{
  const input=state();input.tasks=[
    activity('Blocked','maya','2026-11-20T17:00','2026-11-20T18:00',{status:'blocked'}),
    activity('Pending','maya','2026-11-20T17:30','2026-11-20T18:30',{status:'done',requiresVerification:true,reportedAt:'2026-11-20T22:00Z'}),
    activity('Verified','maya','2026-11-20T17:30','2026-11-20T18:30',{status:'done',requiresVerification:true,verifiedAt:'2026-11-20T22:05Z'}),
  ];
  const html=ui.runSheet(input,now);
  assert.match(html,/2 activities have owner overlaps/);assert.equal((html.match(/<span>Owner overlap<\/span>/g)||[]).length,2);
  assert.match(html,/Awaiting verification/);assert.match(html,/>Blocked<\/td>/);assert.match(html,/>Done<\/td>/);
  assert.doesNotMatch(html,/Scheduled now/);
});

test('run sheet escapes entered facts and is stable across viewer time zones',()=>{
  const input=state();input.event.name='<script>EVENT</script>';input.members[0].name='<img src=x>';
  input.tasks[1].title='<svg onload=alert(1)>';input.tasks[1].schedule.location='</td><script>LOCATION</script>';
  const before=process.env.TZ;
  try{
    let expected;
    for(const zone of ['UTC','Asia/Tokyo','Pacific/Auckland']){
      process.env.TZ=zone;const html=ui.runSheet(input,now);
      if(expected)assert.equal(html,expected);expected=html;
      assert.doesNotMatch(html,/<script|<img|<svg/);assert.match(html,/&lt;script&gt;EVENT/);assert.match(html,/&lt;img/);assert.match(html,/&lt;svg/);
    }
  }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});

test('run-sheet controls preserve scope, open a snapshot, and print only the active run-sheet dialog',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const start=source.indexOf("      if(action==='run-sheet'");
  const end=source.indexOf("      if(action==='task')",start);
  assert.ok(start>=0&&end>start);
  let prints=0,opens=0,exists=true;
  const context=vm.createContext({action:'run-sheet',window:{print(){prints++;}},ui:{dialogKind:'',scheduleMine:true,actor:'maya'},Date,
    store:{getState:()=>({fixture:true})},schedule:{runSheet(s,time,scope){assert.equal(s.fixture,true);assert.deepEqual({...scope},{mine:true,actor:'maya'});return 'snapshot';}},
    openDialog(title,body,footer,wide,kind){opens++;assert.equal(body,'snapshot');assert.match(footer,/Print \/ save PDF/);assert.equal(wide,true);context.ui.dialogKind=kind;},$:()=>exists});
  const run=()=>vm.runInContext(source.slice(start,end),context);
  run();assert.equal(opens,1);assert.equal(prints,0);
  context.action='print-run-sheet';run();assert.equal(prints,1);
  for(const [key,value]of [['dialogKind','task'],['dialogKind','']]){context.ui[key]=value;run();assert.equal(prints,1);}
  context.ui.dialogKind='run-sheet';exists=false;run();assert.equal(prints,1);
  exists=true;context.window.GatherAccessLost=true;run();assert.equal(prints,1);
  context.action='run-sheet';run();assert.equal(opens,1);
  assert.match(source,/replacesDialog=\[[^\n]*'run-sheet'/);
});

test('print isolation hides every other body surface, retains table headers and removes dialog chrome',()=>{
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/@media print\{/);
  assert.match(css,/body:has\(#eventRunSheet\)>:not\(#dialogBackdrop\)\{display:none!important\}/);
  assert.match(css,/#eventRunSheet thead\{display:table-header-group\}/);
  assert.match(css,/#eventRunSheet tr\{break-inside:avoid\}/);
  assert.match(css,/body:has\(#eventRunSheet\) \.dialog-footer[^}]*display:none!important/);
  assert.match(css,/body:has\(#eventRunSheet\) #dialog\{[^}]*overflow:visible!important/);
});

test('phone run sheets stack labeled facts without changing the print table',()=>{
  const html=ui.runSheet(state(),now),css=readFileSync('legacy/styles.css','utf8');
  for(const label of ['Time','Owner','Status at snapshot'])assert.ok(html.includes('data-label="'+label+'"'));
  assert.match(css,/@media screen and \(max-width:640px\)/);
  assert.match(css,/\.run-sheet-table\{min-width:0\}/);
  assert.match(css,/content:attr\(data-label\)/);
  assert.match(html,/<th scope="col">Owner<\/th>/);assert.match(html,/<th scope="row">Check-in/);
});
