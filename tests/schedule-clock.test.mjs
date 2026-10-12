import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/schedule-ui.js';

const zone='America/Los_Angeles',at='2026-10-03T16:30:00Z'; // 09:30 at the event.
const activity=(id,start,end,extra={})=>({id,title:id,owner:'maya',status:'todo',schedule:{start:'2026-10-03T'+start,end:end?'2026-10-03T'+end:'',location:''},...extra});
const ids=tasks=>tasks.map(t=>t.id);
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ui=GatherScheduleUI.create({h,options:()=>'',person:h,statusBadge:h});

test('event clock distinguishes current windows, simultaneous next starts, and past ends without changing tasks',()=>{
  const tasks=[activity('past','08:00','09:00'),activity('current','09:00','10:00'),activity('next-b','10:00','11:00'),activity('next-a','10:00','10:30'),activity('later','11:00','12:00')];
  const original=structuredClone(tasks),live=GatherScheduleUI.timing(tasks,zone,at);
  assert.equal(live.local,'2026-10-03T09:30');
  assert.deepEqual(ids(live.current),['current']);assert.deepEqual(ids(live.next),['next-a','next-b']);
  assert.equal(live.labels.get('past'),'Past scheduled end');assert.equal(live.labels.get('current'),'Scheduled now');
  assert.equal(live.labels.get('next-a'),'Next');assert.equal(live.labels.has('later'),false);
  assert.deepEqual(tasks,original);
  assert.deepEqual(GatherScheduleUI.timing([...tasks].reverse(),zone,at),live);
  const end=GatherScheduleUI.timing(tasks,zone,'2026-10-03T17:00:00Z');
  assert.equal(end.labels.get('current'),'Past scheduled end');assert.deepEqual(ids(end.current),['next-a','next-b']);
  assert.deepEqual(ids(end.next),['later']);
});

test('unknown ends never become assumed current activities; completed and reported work retain distinct meaning',()=>{
  const tasks=[activity('unknown','09:30',''),activity('blocked','09:00','10:00',{status:'blocked'}),
    activity('done','09:00','10:00',{status:'done'}),activity('verified','09:00','10:00',{status:'done',requiresVerification:true,reportedAt:at,verifiedAt:at}),
    activity('waiting','09:00','10:00',{status:'progress',requiresVerification:true,reportedAt:at}),
    activity('unassigned','10:00','11:00',{owner:''}),{id:'preparation',status:'todo',dueDate:'2026-10-02'}];
  const live=GatherScheduleUI.timing(tasks,zone,at);
  assert.deepEqual(ids(live.current),['blocked']);assert.deepEqual(ids(live.next),['unassigned']);
  assert.equal(live.labels.get('unknown'),'Start time reached · no end set');
  for(const id of ['done','verified','waiting','preparation'])assert.equal(live.labels.has(id),false);
  const later=GatherScheduleUI.timing(tasks,zone,'2026-10-04T17:00:00Z');
  assert.deepEqual(later.current,[]);assert.equal(later.labels.get('unknown'),'Start time reached · no end set');
  const html=ui.view({tasks,event:{timeZone:zone}},false,at);
  assert.match(html,/Awaiting verification/);assert.match(html,/data-id="done"/);assert.doesNotMatch(html,/<form/);
});

test('clock uses the event zone across viewer zones, midnight, overnight activities and DST',()=>{
  const before=process.env.TZ;
  try{
    for(const viewer of ['UTC','Asia/Tokyo','Pacific/Auckland']){
      process.env.TZ=viewer;assert.equal(GatherScheduleUI.momentKey(at,zone),'2026-10-03T09:30');
      assert.equal(GatherScheduleUI.momentKey('2026-10-04T07:00:00Z',zone),'2026-10-04T00:00');
    }
  }finally{if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
  assert.equal(GatherScheduleUI.momentKey('2026-03-08T09:59:00Z',zone),'2026-03-08T01:59');
  assert.equal(GatherScheduleUI.momentKey('2026-03-08T10:00:00Z',zone),'2026-03-08T03:00');
  // Entered wall times repeat with the event's local clock during a DST fallback.
  assert.equal(GatherScheduleUI.momentKey('2026-11-01T08:30:00Z',zone),'2026-11-01T01:30');
  assert.equal(GatherScheduleUI.momentKey('2026-11-01T09:30:00Z',zone),'2026-11-01T01:30');
  const night={...activity('night','23:30',''),schedule:{start:'2026-10-03T23:30',end:'2026-10-04T01:00'}};
  assert.deepEqual(ids(GatherScheduleUI.timing([night],zone,'2026-10-04T07:30:00Z').current),['night']);
  for(const [time,z]of [[at,''],[at,'Invalid/Zone'],['bad time',zone]]){
    const result=GatherScheduleUI.timing([night],z,time);assert.equal(result.local,null);assert.equal(result.labels.size,0);
  }
});

test('focus links escape task content, show future dates, and remain read-only',()=>{
  const task=activity('id"<>','09:30','10:30',{title:'<img src=x onerror=alert(1)>'});
  const future={...activity('future','09:00','10:00'),schedule:{start:'2026-10-04T09:00',end:'2026-10-04T10:00'}};
  const state={tasks:[task,future],event:{timeZone:zone}},clock=ui.clock(state,at);
  assert.match(clock.markup,/Scheduled now/);assert.match(clock.markup,/data-id="id&quot;&lt;&gt;"/);
  assert.match(clock.markup,/&lt;img/);assert.doesNotMatch(clock.markup,/<img|<form|data-action="(?:toggle-task|claim)"/);
  assert.match(clock.markup,/Oct 4, 2026/);
  assert.equal(ui.clock({tasks:[],event:{timeZone:zone}},at).markup,'');
  assert.equal(ui.clock({...state,event:{timeZone:''}},at).markup,'');
});

test('minute refresh updates only clock cues, restores activity focus, preserves drafts, and catches page return',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const fragment=source.slice(source.indexOf('  function refreshScheduleClock()'),source.indexOf('  function refreshAttentionDate()'));
  let reads=0,replacements=0,focused=false,restores=0;
  const target={innerHTML:'old',contains:()=>focused,replaceChildren(content){this.innerHTML=content;replacements++;}};
  const badge={dataset:{schedulePhase:'current'},textContent:'Next',hidden:false};
  const backdrop={hidden:true};
  const context=vm.createContext({window:{},document:{hidden:false,activeElement:{},createElement(){return {innerHTML:'',get content(){return this.innerHTML;}};}},
    ui:{view:'timeline',timelineMode:'schedule',scheduleMine:true,actor:'maya'},store:{getState(){reads++;return {}; }},schedule:{clock(state,now,scope){assert.deepEqual({...scope},{mine:context.ui.scheduleMine,actor:context.ui.actor});return {markup:'new',labels:new Map([['current','Scheduled now']])};}},
    $:selector=>selector==='#dialogBackdrop'?backdrop:target,$$:()=>[badge],restoreFocus(previous,scope){assert.equal(previous,context.document.activeElement);assert.equal(scope,target);restores++;}});
  vm.runInContext(fragment+'globalThis.refresh=refreshScheduleClock;',context);
  context.refresh();assert.equal(reads,1);assert.equal(replacements,1);assert.equal(badge.textContent,'Scheduled now');
  context.refresh();assert.equal(replacements,1,'unchanged markup is not replaced');
  target.innerHTML='old';focused=true;context.refresh();assert.equal(replacements,2,'clock groups stay current even with a focused link');assert.equal(restores,1,'focus follows the same activity');
  focused=false;backdrop.hidden=false;context.refresh();assert.equal(reads,3,'dialog and its draft are not read or replaced');
  backdrop.hidden=true;
  for(const [object,key,value]of [[context.window,'GatherAccessLost',true],[context.document,'hidden',true],[context.ui,'pendingSave',true],[context.ui,'view','tasks'],[context.ui,'timelineMode','deadlines']]){
    const previous=object[key];object[key]=value;context.refresh();assert.equal(reads,3);object[key]=previous;
  }
  assert.match(source,/setInterval\(refreshAttentionDate,60000\)/);
  assert.match(source,/window\.addEventListener\('focus',refreshAttentionDate\)/);
  assert.match(source,/window\.addEventListener\('pageshow',refreshAttentionDate\)/);
  assert.match(source,/function refreshAttentionDate\(\) \{\s*refreshScheduleClock\(\)/);
});
