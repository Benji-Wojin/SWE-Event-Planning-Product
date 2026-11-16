import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';

const app=readFileSync('legacy/app.js','utf8');
const start=app.indexOf('  function overview(s,');
const overview=app.slice(app.indexOf('  function assignableTaskOwner('),app.indexOf('  const ownerOptions ='))+
  app.slice(app.indexOf('  const attentionRoster ='),app.indexOf('  const reason ='))+
  app.slice(app.indexOf('  const completed ='),app.indexOf('  const completionText ='))+
  app.slice(start,app.indexOf('  function filteredTasks(s)',start));
const linkedResults=app.slice(app.indexOf('  function personalLinkedResults('),app.indexOf('  function openLinkedResults('));
function render({organizer=true,canCreate=organizer,hosted=true,tasks=[],actor='maya'}={}){
  const state={event:{date:'',setupCompletedAt:'fixture'},tasks,members:[],messages:[],activity:[]};
  const before=structuredClone(state),requests=[];
  const context=vm.createContext({
    window:{GatherMode:hosted?{}:undefined},ui:{actor},isOrganizer:()=>organizer,canCreateTasks:()=>canCreate,
    store:{getState:()=>state,getSuggestions:()=>[]},attention:()=>[],pending:()=>[],
    avatar:()=>'',completionText:()=>'',timeLabel:()=> '',
    dateKey:()=> '2026-11-01',dayLabel:value=>value,h:value=>String(value),icon:()=>'',insightMarkup:()=>'',
    pageHeading:(_eyebrow,title,copy,actions)=>'<h1>'+title+'</h1><p>'+copy+'</p>'+actions,
    addButton:()=>canCreate?'<button data-action="add-task">Add task</button>':'',
    empty:(title,copy)=>'<strong>'+title+'</strong><p>'+copy+'</p>',
    GatherInbox:{conversations:()=>[]},fetch:()=>{requests.push('fetch');throw Error('Rendering must be local');},
  });
  for(const file of ['calendar','priorities','planning-ui','recovery-ui','schedule-ui'])vm.runInContext(readFileSync('legacy/'+file+'.js','utf8'),context);
  context.GatherScheduleUI=context.window.GatherScheduleUI;
  context.recovery=context.window.GatherRecoveryUI.create({store:context.store,ui:{actor},h:context.h,options:()=>'',dayLabel:context.dayLabel,member:id=>({name:id})});
  vm.runInContext(linkedResults+overview+'globalThis.renderOverview=overview;',context);
  const html=context.renderOverview(state);
  assert.deepEqual(state,before);assert.deepEqual(requests,[]);
  return html;
}

test('empty organizer overview gives a plan-building starting point instead of an attention all-clear',()=>{
  const html=render();
  assert.match(html,/Start your event plan/);
  assert.match(html,/No tasks have been added yet/);
  assert.match(html,/starter checklist/);assert.match(html,/Opening the planner does not call AI/);
  assert.match(html,/data-action="draft-plan"/);assert.match(html,/data-action="add-task"/);
  assert.match(html,/aria-labelledby="emptyPlanHeading"/);assert.match(html,/<h2[^>]*id="emptyPlanHeading"/);
  assert.match(html,/class="panel empty-plan"/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.empty-plan\{[^}]*padding:clamp\(16px,3vw,24px\)/);
  assert.match(css,/\.empty-plan p\{[^}]*margin:12px 0/);
  assert.match(css,/\.empty-plan \.form-actions\{[^}]*justify-content:flex-start;flex-wrap:wrap/);
  assert.doesNotMatch(html,/No tasks need attention\.|No completed tasks\.|Recently completed/);
});

test('enabled teammates start with their own task controls, never organizer planning controls',()=>{
  const html=render({organizer:false,canCreate:true});
  assert.match(html,/No shared tasks yet/);assert.match(html,/for yourself or leave it unassigned/);
  assert.match(html,/data-action="add-task"/);
  assert.doesNotMatch(html,/data-action="draft-plan"|Start your event plan|starter checklist/);
});

test('read-only teammates get an honest waiting state and a people link without mutation controls',()=>{
  const html=render({organizer:false,canCreate:false});
  assert.match(html,/The shared plan is still empty/);assert.match(html,/The organizer can add the first tasks/);
  assert.match(html,/data-view="team"[^>]*>View people/);
  assert.doesNotMatch(html,/data-action="add-task"|data-action="draft-plan"|No tasks need attention\./);
});

test('standalone empty plans offer only the available manual path',()=>{
  const html=render({hosted:false});
  assert.match(html,/Start your event plan/);assert.match(html,/Add the first task/);
  assert.match(html,/data-action="add-task"/);
  assert.doesNotMatch(html,/data-action="draft-plan"|Opening the planner|starter checklist/);
});

test('adding work replaces the starting panel with the ordinary attention and results panels',()=>{
  const html=render({tasks:[{id:'fictional-task',status:'todo'}]});
  assert.doesNotMatch(html,/emptyPlanHeading|No tasks have been added yet/);
  assert.match(html,/Needs attention/);assert.match(html,/Recently completed/);
});

test('archived work does not count toward active Overview progress or stop its empty state',()=>{
  const archives=[{id:'retired',title:'Fictional retired work',status:'done',archivedAt:'2026-11-01'}];
  const empty=render({tasks:archives});
  assert.match(empty,/No active tasks in this plan/);
  assert.match(empty,/0<span class="muted"> \/ 0<\/span>/);
  const available=render({tasks:[...archives,{id:'live-done',title:'Current finished work',status:'done'},{id:'live-open',status:'todo'}]});
  assert.match(available,/1<span class="muted"> \/ 2<\/span>/);
  assert.match(available,/width:50%/);
  assert.match(available,/Current finished work/);
  assert.doesNotMatch(available,/Fictional retired work/);
});

test('populated Overview puts the signed-in planner’s personal next steps before project attention',()=>{
  const tasks=[{id:'mine',title:'My preparation',owner:'maya',status:'todo'},{id:'other',title:'Other person’s private focus',owner:'jack',status:'todo'}];
  for(const organizer of [true,false]){
    const html=render({organizer,tasks});
    assert.match(html,/Your next steps/);assert.match(html,/My preparation/);
    assert.doesNotMatch(html,/Other person’s private focus/);
    assert.ok(html.indexOf('Your next steps')<html.indexOf('<h2 class="section-title">Needs attention'));
    assert.match(html,/data-action="task-filter" data-filter="mine"[^>]*>View my tasks/);
  }
  assert.doesNotMatch(render(),/Your next steps/);
});

test('personal Overview does not suggest blocked work, but makes the personal review route visible',()=>{
  const html=render({organizer:false,tasks:[{id:'blocked',title:'Not ready to start',owner:'maya',status:'blocked'}]});
  assert.match(html,/Nothing ready to start/);assert.match(html,/Open My tasks/);
  assert.match(html,/View my tasks/);assert.doesNotMatch(html,/data-id="blocked"/);
});

test('personal Overview routes only your returned reports, even when blocked, until you resubmit',()=>{
  const store=GatherStore.createStore({storage:null});
  const report=(title,owner,feedback)=>{
    const task=store.addTask({title,owner,requiresVerification:true});
    store.reportCompletion(task.id,'Earlier fictional submission.',owner);
    store.returnCompletion(task.id,feedback);
    return task.id;
  };
  const mine=report('My returned report','maya','FICTIONAL_REVIEW_REASON_MINE');
  const other=report('Another teammate’s returned report','dev','FICTIONAL_REVIEW_REASON_OTHER');
  const ready=store.addTask({title:'Ordinary preparation',owner:'maya'}).id;
  const html=()=>render({organizer:false,tasks:store.getState().tasks.filter(task=>[mine,other,ready].includes(task.id))});
  for(const status of ['progress','blocked']){
    store.updateTask(mine,{status});
    const view=html();
    assert.match(view,/Completion changes requested/);
    assert.match(view,new RegExp(`data-action="review-returned-completion"[^>]*data-id="${mine}"`));
    assert.equal((view.match(/My returned report/g)||[]).length,1,'returned work should not also appear as a next-task suggestion');
    assert.match(view,/Ordinary preparation/);
    assert.doesNotMatch(view,/Another teammate’s returned report|FICTIONAL_REVIEW_REASON_/);
  }
  store.reportCompletion(mine,'Revised fictional submission.','maya');
  assert.doesNotMatch(html(),/Completion changes requested|review-returned-completion|My returned report/);
});

test('only organizers see pending reviews on Overview',()=>{
  const tasks=[{id:'review',title:'Fictional completion',status:'progress',owner:'jack',requiresVerification:true,reportedAt:'2026-11-01T12:00Z'}];
  const organizer=render({organizer:true,tasks});
  assert.match(organizer,/Waiting for your review/);
  assert.match(organizer,/Verify completion: Fictional completion/);
  assert.doesNotMatch(render({organizer:false,tasks}),/Waiting for your review|data-action="review-organizer-item"/);
});

test('plan-builder navigation still requires an explicit organizer action and preserves project scope',()=>{
  const handler=app.split('\n').find(line=>line.includes("if(action==='draft-plan'"));assert.ok(handler);
  for(const organizer of [true,false]){
    let routes=0;const location={href:'unchanged'};
    const context=vm.createContext({action:'draft-plan',isOrganizer:()=>organizer,window:{top:{location},GatherMode:{demo:false,projectUrl:path=>{routes++;return path+'?project=fictional';}}}});
    vm.runInContext('(function(){'+handler+'})()',context);
    assert.equal(routes,organizer?1:0);assert.equal(location.href,organizer?'/plan?project=fictional':'unchanged');
  }
});

test('View my tasks uses the existing explicit local filter navigation and clears stale filters',()=>{
  const handler=app.split('\n').find(line=>line.includes("if(action==='task-filter')"));assert.ok(handler);
  const setFilters=app.slice(app.indexOf('  function setTaskFilters('),app.indexOf('  function taskMapMarkup('));
  let navigations=0;const ui={tab:'attention',owner:'jack',status:'done',search:'old search',mapFocus:'old-task'};
  vm.runInNewContext(setFilters+handler,{action:'task-filter',el:{dataset:{filter:'mine'}},ui,navigate:(view,{beforeRender})=>{
    assert.equal(view,'tasks');assert.equal(beforeRender(),true);navigations++;
  }});
  assert.deepEqual(ui,{tab:'mine',owner:'',status:'',search:'',mapFocus:''});assert.equal(navigations,1);
});
