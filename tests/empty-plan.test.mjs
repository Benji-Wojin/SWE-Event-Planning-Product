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
  app.slice(app.indexOf('  const taskListStatus ='),app.indexOf('  function canClaimTask('))+
  app.slice(app.indexOf('  const completed ='),app.indexOf('  const completionText ='))+
  app.slice(app.indexOf('  const addButton ='),app.indexOf('  const sourceButton ='))+
  app.slice(app.indexOf('  function activityItem('),app.indexOf('  function attentionItemMarkup('))+
  app.slice(start,app.indexOf('  function filteredTasks(s)',start));
const linkedResults=app.slice(app.indexOf('  function personalLinkedResults('),app.indexOf('  function openLinkedResults('));
function render({organizer=true,canCreate=organizer,hosted=true,demo=false,tasks=[],actor='maya',
  setupCompleted=true,showGuideTask=false,members=[],messages=[],suggestions=[],activity=[]}={}){
  const state={event:{date:'',setupCompletedAt:setupCompleted?'fixture':''},tasks,members,messages,activity};
  const before=structuredClone(state),requests=[];
  const h=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const context=vm.createContext({
    window:{GatherMode:hosted?{demo,projectUrl:path=>path+'?project=fixture'}:undefined},ui:{actor},isOrganizer:()=>organizer,canCreateTasks:()=>canCreate,
    store:{getState:()=>state,getSuggestions:()=>suggestions},attention:()=>[],pending:s=>s.messages.filter(message=>!message.appliedTaskId&&!message.ignoredAt),
    avatar:()=>'',completionText:()=>'',timeLabel:()=> '',member:id=>members.find(person=>person.id===id)||{name:id},
    dateKey:()=> '2026-11-01',dayLabel:value=>value,h,icon:()=>'',
    pageHeading:(_eyebrow,title,copy,actions)=>'<h1>'+title+'</h1><p>'+copy+'</p>'+actions,
    empty:(title,copy)=>'<strong>'+title+'</strong><p>'+copy+'</p>',
    guideTaskPanel:(s,away)=>{assert.equal(s,state);assert.equal(away,true);return '<section id="fixtureGuidePanel">Guide result</section>';},
    fetch:()=>{requests.push('fetch');throw Error('Rendering must be local');},
  });
  for(const file of ['calendar','priorities','planning-ui','recovery-ui','schedule-ui','inbox'])vm.runInContext(readFileSync('legacy/'+file+'.js','utf8'),context);
  context.GatherScheduleUI=context.window.GatherScheduleUI;
  context.GatherInbox=context.window.GatherInbox;
  context.recovery=context.window.GatherRecoveryUI.create({store:context.store,ui:{actor},h:context.h,options:()=>'',dayLabel:context.dayLabel,member:id=>({name:id})});
  vm.runInContext(linkedResults+overview+'globalThis.renderOverview=overview;',context);
  const html=context.renderOverview(state,showGuideTask);
  assert.deepEqual(state,before);assert.deepEqual(requests,[]);
  return html;
}

const tag=(html,id)=>html.match(new RegExp(`<[^<>]+\\bid="${id}"[^<>]*>`))?.[0];
const startPanel=html=>html.match(/<section\b[^>]*aria-labelledby="emptyPlanHeading"[^>]*>[\s\S]*?<\/section>/)?.[0];
const countAction=(html,action)=>Array.from(html.matchAll(new RegExp(`data-action="${action}"`,'g'))).length;
function region(html,id){
  const open=tag(html,id);assert.ok(open,id);
  const name=open.match(/^<(\w+)/)[1],start=html.indexOf(open);
  let depth=0;
  for(const match of html.slice(start).matchAll(new RegExp(`<(\\/?)${name}\\b[^>]*>`,'g'))){
    depth+=match[1]?-1:1;
    if(depth===0)return html.slice(start,start+match.index+match[0].length);
  }
  assert.fail(`Unclosed region: ${id}`);
}

test('empty organizer overview gives a plan-building starting point instead of an attention all-clear',()=>{
  const html=render();
  assert.match(html,/Start your event plan/);
  assert.match(html,/No tasks have been added yet/);
  assert.match(html,/starter checklist/);assert.match(html,/Opening the planner does not call AI/);
  assert.match(html,/data-action="draft-plan"/);assert.match(html,/data-action="add-task"/);
  assert.match(html,/aria-labelledby="emptyPlanHeading"/);assert.match(html,/<h2[^>]*id="emptyPlanHeading"/);
  assert.match(html,/class="panel empty-plan"/);
  const panel=startPanel(html);
  assert.match(panel,/<button\b[^>]*\bclass="[^"<>]*\bbtn-primary\b[^"<>]*"[^>]*data-action="add-task"[^>]*>Add task<\/button>/);
  for(const action of ['draft-plan','invite']){
    assert.match(panel,new RegExp(`<button\\b[^>]*\\bclass="[^"<>]*\\bbtn-secondary\\b[^"<>]*"[^>]*data-action="${action}"`));
    assert.ok(panel.indexOf('data-action="add-task"')<panel.indexOf(`data-action="${action}"`));
    assert.equal(countAction(html,action),1);
  }
  assert.equal(countAction(html,'add-task'),1,'there is one first-task CTA, not a second header duplicate');
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.empty-plan\{[^}]*padding:clamp\(16px,3vw,24px\)/);
  assert.match(css,/\.empty-plan p\{[^}]*margin:12px 0/);
  assert.match(css,/\.empty-plan \.form-actions\{[^}]*justify-content:flex-start;flex-wrap:wrap/);
  assert.doesNotMatch(html,/No tasks need attention\.|No completed tasks\.|Recently completed/);
});

test('the first task follows setup and guide in the header without replacing real sidebar and history content',()=>{
  const html=render({setupCompleted:false,showGuideTask:true,
    members:[{id:'maya',name:'Fictional organizer'}],
    suggestions:[{id:'short-timeline',source:'Fixture project check',title:'Review the short timeline',body:'A check from the ordinary project rules.'}],
    messages:[{id:'fixture-mail',threadId:'fixture-thread',subject:'Vendor timing',sender:'Fictional supplier',body:'Access begins at noon.',
      receivedAt:'2026-11-01T10:00:00Z',suggested:{mode:'new',analysisVersion:4}}],
    activity:[{actor:'maya',text:'Updated the event date',at:'2026-11-01T08:00:00Z'}],
  });
  const header=region(html,'overviewHeader'), main=region(html,'overviewMain');
  const order=['<h1>Overview</h1>','setup-notice','fixtureGuidePanel','id="emptyPlanHeading"'].map(part=>header.indexOf(part));
  assert.ok(order.every((offset,index)=>offset>=0&&(index===0||offset>order[index-1])),order.join(', '));
  assert.match(header,/href="\/setup\?project=fixture" target="_top"/);
  assert.equal(countAction(header,'add-task'),1);
  assert.doesNotMatch(html,/aria-label="Project status"|stat-grid|0<span class="muted"> \/ 0<\/span>/);
  assert.match(tag(main,'overviewMain'),/\bhidden\b/);
  assert.doesNotMatch(main,/emptyPlanHeading|Needs attention|Recently completed/);
  assert.match(region(html,'thoughtPartner'),/id="planningSidebarSlot"/);
  assert.match(region(html,'overviewSuggestions'),/Review the short timeline/);
  const email=region(html,'overviewEmail');
  assert.match(email,/data-action="source" data-id="fixture-mail"/);
  assert.match(email,/Vendor timing.*Fictional supplier: Access begins at noon\./);
  const history=region(html,'overviewActivity');
  assert.doesNotMatch(tag(history,'overviewActivity'),/\bhidden\b/);
  assert.match(history,/Fictional organizer<\/strong> Updated the event date/);
  assert.ok(html.indexOf(header)<html.indexOf(region(html,'thoughtPartner')));
  for(const options of [{organizer:false},{demo:true},{hosted:false}]){
    assert.doesNotMatch(render({setupCompleted:false,...options}),/Finish project setup/);
  }
});

test('enabled teammates start with their own task controls, never organizer planning controls',()=>{
  const html=render({organizer:false,canCreate:true});
  assert.match(html,/No shared tasks yet/);assert.match(html,/for yourself or leave it unassigned/);
  assert.match(startPanel(html),/<button\b[^>]*\bbtn-primary\b[^>]*data-action="add-task"/);
  assert.equal(countAction(html,'add-task'),1);
  assert.doesNotMatch(html,/data-action="(?:draft-plan|invite)"|Start your event plan|starter checklist/);
});

test('read-only teammates get an honest waiting state and a people link without mutation controls',()=>{
  const html=render({organizer:false,canCreate:false});
  assert.match(html,/The shared plan is still empty/);assert.match(html,/The organizer can add the first tasks/);
  assert.match(html,/data-view="team"[^>]*>View people/);
  assert.doesNotMatch(html,/data-action="(?:add-task|draft-plan|invite)"|No tasks need attention\./);
});

test('standalone empty plans offer only the available manual path',()=>{
  const html=render({hosted:false});
  assert.match(html,/Start your event plan/);assert.match(html,/Add the first task/);
  assert.match(html,/data-action="add-task"/);
  assert.doesNotMatch(html,/data-action="(?:draft-plan|invite)"|Opening the planner|starter checklist/);
});

test('adding work replaces the starting panel with the ordinary attention and results panels',()=>{
  const html=render({tasks:[{id:'fictional-task',status:'todo'}]});
  assert.doesNotMatch(html,/emptyPlanHeading|No tasks have been added yet/);
  assert.match(html,/Needs attention/);assert.match(html,/Recently completed/);
  assert.match(html,/<section\b[^>]*aria-label="Project status"/);
  assert.doesNotMatch(tag(html,'overviewMain'),/\bhidden\b/);
});

test('Overview counts only completed work even when older unverified reports have stored Done status',()=>{
  const report='2026-10-31T19:00:00.000Z',verified='2026-10-31T20:00:00.000Z';
  const html=render({tasks:[
    {id:'legacy-pending',title:'Fictional old unverified report',status:'done',requiresVerification:true,reportedAt:report,completedAt:report},
    {id:'verified',title:'Fictional verified work',status:'done',requiresVerification:true,reportedAt:report,verifiedAt:verified,completedAt:verified},
    {id:'ordinary',title:'Fictional active task',status:'progress'},
    {id:'archived',title:'Fictional old archived task',status:'done',archivedAt:verified},
  ]});
  assert.match(html,/data-filter="done"[^>]*><span class="stat-label">Completed<\/span><strong class="stat-number">1<span class="muted"> \/ 3<\/span>/);
  assert.match(html,/class="progress-fill" style="width:33%"/);
  const recent=html.slice(html.indexOf('Recently completed'),html.indexOf('id="thoughtPartner"'));
  assert.match(recent,/Fictional verified work/);
  assert.doesNotMatch(recent,/Fictional old unverified report|Fictional old archived task/);
  assert.match(html,/data-action="review-organizer-item" data-id="legacy-pending" data-review-kind="completion"/);
});

test('Add task keeps a single Overview focus target across the first save, only for allowed planners',()=>{
  const tasks=[{id:'first-task',status:'todo'}];
  for(const [organizer,canCreate] of [[true,true],[false,true],[false,false]])for(const visibleTasks of [[],tasks]){
    const html=render({organizer,canCreate,tasks:visibleTasks});
    const targets=Array.from(html.matchAll(/\bid="overviewAddTask"/g));
    assert.equal(targets.length,Number(canCreate));
    if(canCreate)assert.match(tag(html,'overviewAddTask'),/data-action="add-task"/);
  }
  const start=app.indexOf("      if(action==='add-task'||action==='guide-add-task'){");
  const end=app.indexOf("      if(action==='guide-task-reveal'",start);
  assert.ok(start>=0&&end>start);
  for(const sameControl of [true,false]){
    const calls=[],view={},control={id:'overviewAddTask',focus(){calls.push('focus');}};
    vm.runInNewContext(app.slice(start,end),{action:'add-task',el:control,
      $(selector,root){if(selector==='#viewRoot')return view;assert.equal(root,view);return sameControl?control:{};},
      openGuideAwareTask(opener){assert.equal(opener,control);calls.push('dialog');},
    });
    assert.deepEqual(calls,sameControl?['focus','dialog']:['dialog']);
  }
});

test('archived work does not count toward active Overview progress or stop its empty state',()=>{
  const archives=[{id:'retired',title:'Fictional retired work',status:'done',archivedAt:'2026-11-01'}];
  const empty=render({tasks:archives});
  assert.match(empty,/No active tasks in this plan/);
  assert.doesNotMatch(empty,/aria-label="Project status"|stat-grid|0<span class="muted"> \/ 0<\/span>|Fictional retired work/);
  assert.match(tag(empty,'overviewMain'),/\bhidden\b/);
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
  const pending=html();
  assert.doesNotMatch(pending,/Completion changes requested|review-returned-completion|Revised fictional submission/);
  assert.match(pending,/Awaiting organizer verification/);
  assert.match(pending,new RegExp(`data-action="review-personal-completion"[^>]*data-id="${mine}" data-review-kind="pending"`));
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
