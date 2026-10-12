import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';

const at = '2026-10-12T06:00:00Z'; // October 11, 11pm at the Los Angeles event.
const zone = 'America/Los_Angeles';
const task = (patch = {}) => ({id:'menu',title:'Approve menu',status:'progress',owner:'maya',dueDate:'2026-10-11',acceptedAt:at,updatedAt:at,dependencies:[],...patch});

test('all viewers use the event day for deadlines and follow-up decisions', () => {
  const original = process.env.TZ;
  try {
    for (const viewer of ['America/Los_Angeles','Asia/Tokyo','Pacific/Auckland','UTC']) {
      process.env.TZ = viewer;
      const item = task();
      const info = GatherPriorities.analyze(item,[item],at,zone);
      assert.equal(info.label,'Due today');
      assert.equal(info.overdue,false);
      assert.equal(GatherCalendar.dayKey(at,zone),'2026-10-11');
      const review = task({dueDate:'2026-10-01',planReviewAfter:'2026-10-12',ownerRespondedAt:'2026-10-01T00:00:00Z',acceptedAt:'',updatedAt:'2026-10-01T00:00:00Z'});
      assert.equal(GatherPriorities.decision(review,[review],at,zone),null);
      assert.equal(GatherPriorities.analyze(item,[item],'2026-10-12T07:00:00Z',zone).label,'1 day overdue');
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('calendar offsets cross DST, leap day, and year end without adding 24-hour instants', () => {
  assert.equal(GatherCalendar.dayKey('2026-03-08T07:30:00Z',zone,1),'2026-03-08');
  assert.equal(GatherCalendar.dayKey('2026-11-01T06:30:00Z',zone,1),'2026-11-01');
  assert.equal(GatherCalendar.dayKey('2028-02-29T05:00:00Z',zone,1),'2028-02-29');
  assert.equal(GatherCalendar.dayKey('2027-01-01T07:30:00Z',zone,1),'2027-01-01');
  assert.equal(GatherCalendar.dayKey(at,''),'2026-10-12');
  assert.throws(()=>GatherCalendar.dayKey(at,'Not/AZone'));
});

test('deadline history and downstream urgency use the same event day', () => {
  const prerequisite=task({id:'collect',dueDate:'',status:'todo'});
  const parent=task({id:'approve',dueDate:'2026-10-14',hardDeadline:true,dependencies:[{taskId:'collect'}]});
  const tasks=[prerequisite,parent];
  const before=GatherPriorities.analyze(prerequisite,tasks,at,zone);
  const after=GatherPriorities.analyze(prerequisite,tasks,'2026-10-15T07:00:00Z',zone);
  assert.ok(after.score>before.score);
  const moved=task({dueDate:'2026-10-10',deadlineHistory:[
    {from:'2026-10-10',to:'2026-10-11',at:'2026-10-11T06:00:00Z'},
    {from:'2026-10-11',to:'2026-10-12',at},
  ]});
  assert.notEqual(GatherPriorities.decision(moved,[moved],at,zone)?.key,'repeated');
  assert.equal(GatherPriorities.decision(moved,[moved],at,'UTC')?.key,'repeated');
});

test('continuous planning suggestions use event-local cutoff dates without mutating saved work', () => {
  const store=GatherStore.createStore({storage:null,now:Date.parse(at)});
  store.completeSetup({timeZone:zone,dietaryOutstanding:3,cateringDeadline:'2026-10-14'});
  const raw=store.exportState();
  assert.ok(!store.getSuggestions().some(s=>s.id==='dietary-cutoff'));
  assert.equal(store.exportState(),raw);
  store.completeSetup({timeZone:'UTC'});
  assert.ok(store.getSuggestions().some(s=>s.id==='dietary-cutoff'));
});

test('recovery form minimum and suggested check-in follow event day for a distant viewer', () => {
  const context=vm.createContext({GatherCalendar,GatherPriorities,Date:class extends Date { constructor(value) { super(value === undefined ? at : value); } }});
  vm.runInContext(readFileSync('legacy/recovery-ui.js','utf8'),context);
  const ui=context.GatherRecoveryUI.create({store:{getState:()=>({event:{timeZone:zone}})}});
  const proposed={required:false,disabled:false,min:''};
  ui.syncResponse({elements:{response:{value:'date'},proposedDate:proposed},querySelector:()=>({hidden:true})});
  assert.equal(proposed.min,'2026-10-11');
  const form={elements:{action:{value:'checkin'},dueDate:{},owner:{value:''},scope:{},reviewAfter:{}},querySelectorAll:()=>[],querySelector:()=>({})};
  ui.syncDecision(form);
  assert.equal(form.elements.reviewAfter.min,'2026-10-12');
});

test('hosted and standalone clients load the shared calendar before consumers', () => {
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  for(const file of ['legacy/index.html','public/workspace.html']) {
    const html=readFileSync(file,'utf8');
    assert.ok(html.indexOf('calendar.js')>=0);
    assert.ok(html.indexOf('calendar.js')<html.indexOf('priorities.js'));
  }
  assert.equal(readFileSync('public/gather-assets/calendar.js','utf8'),readFileSync('legacy/calendar.js','utf8'));
});

test('per-task date labels do not clone the full workspace', () => {
  const source=readFileSync('legacy/app.js','utf8');
  let zoneReads=0;
  const context=vm.createContext({GatherCalendar,store:{getTimeZone(){zoneReads++;return zone;},getState(){throw new Error('Full snapshot requested for a date label');}}});
  vm.runInContext(source.slice(source.indexOf('  const dateKey ='),source.indexOf('  const dayLabel ='))+'globalThis.key=dateKey;',context);
  for(let i=0;i<600;i++)assert.equal(context.key(new Date(at)),'2026-10-11');
  assert.equal(zoneReads,600);
  const store=GatherStore.createStore({storage:null,now:Date.parse(at)});
  assert.equal(store.getTimeZone(),'UTC');
  store.completeSetup({timeZone:zone});
  assert.equal(store.getTimeZone(),zone);
});
