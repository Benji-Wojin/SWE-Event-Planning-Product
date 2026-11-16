import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/reschedule.js';
import '../legacy/schedule-ui.js';
import '../legacy/store.js';

const now=Date.parse('2026-10-03T16:30:00Z'),archive='2026-09-30T12:00:00Z';
const date='2026-10-03',event={name:'Fictional school dance',date,timeZone:'UTC'};
const members=[{id:'jack',name:'Organizer'},{id:'maya',name:'Maya'}];
const task=(id,extra={})=>({id,title:id,revision:1,owner:'maya',status:'todo',dueDate:'',dependencies:[],...extra});
const slot=(start=date+'T16:00',end=date+'T17:00')=>({start,end,location:'Fictional hall'});
const reload=fixture=>{
  let saved=JSON.stringify(fixture);
  return GatherStore.createStore({storage:{
    getItem:key=>key===GatherStore.STORAGE_KEY?saved:null,
    setItem(key,value){if(key===GatherStore.STORAGE_KEY)saved=value;},
  }});
};
const h=String;
const schedule=GatherScheduleUI.create({h,statusBadge:status=>status,options:rows=>rows.map(row=>row[1]).join(', ')});
const mine={mine:true,actor:'maya',date};
const state=tasks=>({event,members,tasks});
const archivedTitle=/Archived fixture/;

test('archive stays out of live event work and sharing but remains unavailable to an active dependent',()=>{
  const dependent=task('Live setup',{schedule:slot(),dependencies:[{taskId:'Archived fixture completed'}]});
  const complete=task('Live completed',{status:'done',schedule:slot(date+'T17:00',date+'T18:00')});
  const other=task('Live other owner',{owner:'jack',schedule:slot('2026-10-04T13:00','2026-10-04T14:00')});
  const ownOverlap=task('Archived fixture own overlap',{archivedAt:archive,schedule:slot()});
  const otherOverlap=task('Archived fixture other overlap',{owner:'jack',archivedAt:archive,schedule:slot()});
  const archived=[
    ownOverlap,otherOverlap,
    task('Archived fixture completed',{status:'done',verifiedAt:archive,requiresVerification:true,archivedAt:archive,
      completionEvidence:{note:'Historical only'},schedule:slot('2026-10-02T23:00',date+'T00:30')}),
    task('Archived fixture pending',{requiresVerification:true,reportedAt:archive,archivedAt:archive}),
    task('Archived fixture unscheduled',{archivedAt:archive,eventActivity:true,owner:'',dueDate:'2026-10-01'}),
  ];
  const snapshot=state([dependent,complete,other,...archived]),before=structuredClone(snapshot);
  for(const scope of [mine,{actor:'jack'}]){
    const live=schedule.view(snapshot,true,now,scope),clock=schedule.clock(snapshot,now,scope,true).markup;
    const review=schedule.preparationReview(snapshot,now,scope,true),model=schedule.runSheetModel(snapshot,now,scope);
    const guest=GatherScheduleUI.guestAgendaSnapshot(snapshot,scope);
    for(const markup of [live,clock,review,schedule.runSheetMarkup(model),schedule.runSheetText(model),schedule.guestAgendaForm(guest,event.name)])
      assert.doesNotMatch(markup,archivedTitle);
    for(const markup of [live,clock,schedule.runSheetMarkup(model)])assert.doesNotMatch(markup,/owner overlaps|potential location overlap/i);
    assert.match(review,/Required work: 1 unavailable/);
    assert.match(live,/Live completed/);
    assert.deepEqual(guest.activities.map(row=>row.title),scope.mine?['Live setup','Live completed']:['Live setup','Live completed','Live other owner']);
  }
  assert.deepEqual(schedule.activityDays(snapshot,now,mine),{first:'',previous:'',next:'',today:date});
  assert.deepEqual(schedule.reviewAcceptanceTasks(snapshot,mine).map(t=>t.id),[dependent.id]);
  assert.deepEqual(schedule.reviewAssignmentTasks(snapshot,{},'unassigned'),[]);
  assert.equal(GatherScheduleUI.overlapPairIsCurrent(snapshot,dependent.id,ownOverlap.id,'owner'),false);
  assert.equal(GatherScheduleUI.overlapPairIsCurrent(snapshot,dependent.id,otherOverlap.id,'location'),false);
  assert.equal(GatherScheduleUI.timing(archived,event.timeZone,now).current.length,0);
  assert.equal(schedule.firstTimeTask(snapshot,archived.at(-1).id,{}),undefined);
  assert.equal(schedule.reviewScheduleTask(snapshot,{},'activity-time',archived.at(-1).id),null);
  assert.throws(()=>schedule.activityReviewForm(snapshot,archived.at(-1).id),/Reopen the event review/);
  assert.match(schedule.details(ownOverlap,true,event,snapshot.tasks),/Archived activity schedule/);
  assert.doesNotMatch(schedule.details(ownOverlap,true,event,snapshot.tasks),/scheduleForm/);
  assert.deepEqual(snapshot,before);
});

test('archived-only Timeline has honest empty states and no actions that require a live scheduled activity',()=>{
  const archived=task('Archived fixture former plan',{archivedAt:archive,dueDate:date,schedule:slot()});
  const snapshot=state([archived]);
  const source=readFileSync('legacy/app.js','utf8');
  const context=vm.createContext({ui:{timelineMode:'schedule'},schedule,window:{},store:{},h,
    pageHeading:(_k,_t,_b,controls)=>controls,isOrganizer:()=>true,addButton:()=>'',firstScheduleReceiptMarkup:()=>'',
    timelineScheduleScope:()=>({}),workspaceUpdatesPending:()=>false,scheduleRevisionIsStale:()=>false,empty:title=>title});
  vm.runInContext(source.slice(source.indexOf('  function timelineView('),source.indexOf('  function updatesView(')),context);
  const html=context.timelineView(snapshot);
  assert.match(html,/No scheduled activities/);
  assert.doesNotMatch(html,/data-action="(?:run-sheet|draft-guest-agenda)"|scheduleDateForm|Archived fixture/);
  context.ui.timelineMode='deadlines';
  assert.match(context.timelineView(snapshot),/No open tasks/);
  assert.doesNotMatch(context.timelineView(snapshot),archivedTitle);
  assert.match(schedule.picker(state([{...archived,schedule:null}])),/No unscheduled active tasks/);
  assert.match(schedule.preparationReview(snapshot,now),/0 scheduled activities in this scope/);
  assert.match(schedule.preparationReview(snapshot,now),/No active tasks in this plan/);
  assert.match(schedule.preparationReview(snapshot,now,mine),/does not mean the whole event is ready/);
});

test('moving or directly rescheduling an archived activity cannot change its saved record',()=>{
  const original=GatherStore.createStore({storage:null});
  original.completeSetup(event);
  const archived=original.addTask({title:'Archived fixture saved activity',dueDate:date,schedule:slot()});
  const live=original.addTask({title:'Active saved activity',dueDate:date,schedule:slot()});
  const fixture=original.getState();
  fixture.tasks.find(t=>t.id===archived.id).archivedAt=archive;
  const store=reload(fixture);
  const before=store.exportState(),toDate='2026-10-10';
  assert.ok(!GatherReschedule.preview(store.getState(),toDate).rows.some(row=>row.id===archived.id));
  const selection=t=>({id:t.id,revision:t.revision,moveDue:true,moveSchedule:true});
  const input={fromDate:date,toDate,timeZone:event.timeZone,tasks:[selection(live),selection(archived)]};
  assert.throws(()=>store.rescheduleEvent(input),/A selected task changed/);
  assert.throws(()=>store.setTaskSchedule(archived.id,null),/Archived tasks cannot be rescheduled/);
  assert.equal(store.exportState(),before);
  assert.deepEqual(store.rescheduleEvent({...input,tasks:[selection(live)]}),{date:toDate,changedTaskCount:1});
  assert.deepEqual(store.getState().tasks.find(t=>t.id===archived.id),JSON.parse(before).tasks.find(t=>t.id===archived.id));
});

test('only active scheduled activities constrain a change to the event time zone',()=>{
  const original=GatherStore.createStore({storage:null});
  original.completeSetup(event);
  const archived=original.addTask({title:'Historical DST gap',schedule:slot('2026-03-08T02:30','2026-03-08T03:30')});
  const live=original.addTask({title:'Current activity',schedule:slot()});
  const fixture=original.getState();
  fixture.tasks.find(t=>t.id===archived.id).archivedAt=archive;
  const archivedOnly=reload({...fixture,tasks:fixture.tasks.filter(t=>t.id===archived.id)});
  const mixed=reload(fixture);
  const history=archivedOnly.getState().tasks;
  assert.equal(archivedOnly.updateEvent({timeZone:''}).timeZone,'');
  assert.equal(archivedOnly.updateEvent({timeZone:'America/Los_Angeles'}).timeZone,'America/Los_Angeles');
  assert.deepEqual(archivedOnly.getState().tasks,history);
  const before=mixed.exportState();
  assert.throws(()=>mixed.updateEvent({timeZone:''}),/need an event time zone/);
  assert.throws(()=>mixed.updateEvent({timeZone:'America/Los_Angeles'}),/Confirm the time zone change/);
  assert.equal(mixed.exportState(),before);
  assert.equal(mixed.updateEvent({timeZone:'America/Los_Angeles',confirmScheduleTimeZone:true}).timeZone,'America/Los_Angeles');
  assert.deepEqual(mixed.getState().tasks,JSON.parse(before).tasks);
  const withActiveGap=reload({...fixture,tasks:fixture.tasks.map(t=>t.id===live.id?{...t,schedule:archived.schedule}:t)});
  assert.throws(()=>withActiveGap.updateEvent({timeZone:'America/Los_Angeles',confirmScheduleTimeZone:true}),/Current activity.*does not exist/);
});
