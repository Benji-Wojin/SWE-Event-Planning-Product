import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/planning-ui.js';

const source=readFileSync('legacy/app.js','utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const dispatch=action=>source.split('\n').find(line=>line.startsWith(`      if(action==='${action}')`));
const task=(id,title,owner,status='todo',dependencies=[])=>({id,title,owner,status,note:'',category:'Event',dependencies});
const tasks=[
  task('venue','Book venue','jack'),
  task('entrance','Plan check-in','dev','todo',[{taskId:'venue',kind:'dependency'}]),
  task('photos','Share photos','maya','done'),
];
function fixture(){
  const state={tasks:structuredClone(tasks),members:[]};
  const ui={actor:'maya',tab:'all',owner:'',status:'',search:'',taskView:'map',mapFocus:'venue'};
  const nodes=Object.fromEntries(['#taskRows','#taskEmpty','#taskResultCount','#taskMap'].map(id=>[id,{}]));
  const events={},focus=[];
  nodes['#taskMap .task-map-scroll']={focus:()=>focus.push('map')};
  nodes['#taskMap .map-task-focused']={focus:()=>focus.push('focused task')};
  nodes['#taskSearch']={focus:()=>focus.push('search')};
  nodes['#dialogBackdrop']={hidden:true};
  let permitNavigation=true;
  let context;
  context=vm.createContext({
    ui,GatherPlanningUI,store:{getState:()=>state},document:{addEventListener:(type,handler)=>{events[type]=handler;}},
    $:key=>key.startsWith('#taskMap .')&&!nodes['#taskMap'].innerHTML?.includes(key.slice(10))?null:nodes[key],
    confirmCloseDialog:()=>true,confirmDiscard:()=>true,
    taskRow:t=>t.title,member:owner=>({name:owner}),navigate:(_view,{beforeRender})=>{
      if(!permitNavigation)return false;
      assert.equal(beforeRender(),true);
      context.renderTaskRows();
      return true;
    },
  });
  vm.runInContext(block('  const taskListStatus =', '  function canClaimTask(')+
    block('  function filteredTasks(', '  const options =')+
    block("  document.addEventListener('change',event=>", "  $('#dialogBackdrop').addEventListener('click'"),context);
  const change=(type,id,value)=>events[type]({target:{id,value,closest:()=>null,matches:()=>false}});
  const click=(action,fields={})=>vm.runInContext('(function(action,el,id){'+dispatch(action)+'})',
    context)(action,{dataset:fields},fields.id);
  const map=()=>nodes['#taskMap'].innerHTML;
  const count=()=>nodes['#taskResultCount'].textContent;
  const render=()=>context.renderTaskRows();
  render();
  return {ui,state,map,count,render,change,click,focus,rows:()=>nodes['#taskRows'].innerHTML,denyNavigation:()=>{permitNavigation=false;}};
}

test('active map preserves the unavailable warning without bringing an archived prerequisite back as a card',()=>{
  const f=fixture();
  f.state.tasks.find(task=>task.id==='venue').archivedAt='2026-11-01';
  const before=structuredClone(f.state);
  f.render();
  assert.equal(f.count(),'2 tasks');
  assert.match(f.map(),/Plan check-in\. Required work unavailable/);
  assert.doesNotMatch(f.map(),/Book venue|map-task-focused/);
  f.change('input','taskSearch','Book venue');
  assert.equal(f.count(),'0 tasks');
  assert.match(f.map(),/No tasks match/);
  assert.deepEqual(f.state,before);
});

test('People counts only current assignments and never offers an archived task to claim',()=>{
  const state={members:[{id:'dev',name:'Fictional teammate'}],tasks:[
    task('active','Current assignment','dev'),task('free','Current unassigned',''),
    {...task('reported','Unassigned but reported complete',''),reportedAt:'2026-10-31',requiresVerification:true},
    {...task('arch-assigned','Historical assignment','dev','blocked'),archivedAt:'2026-11-01'},
    {...task('arch-finished','Historical completed','dev','done'),archivedAt:'2026-11-01'},
    {...task('arch-free','Historical unassigned',''),archivedAt:'2026-11-01'},
  ]};
  const before=structuredClone(state);
  const context=vm.createContext({avatar:()=>'',icon:()=>'',h:String,ui:{actor:'dev'},empty:()=>'',pageHeading:()=>'',isOrganizer:()=>false,state});
  const markup=vm.runInContext(block('  function canClaimTask(', '  function attentionOwnerAction(')+
    block('  function teamView(s) {','  function timelineScheduleScope()')+'teamView(state);',context);
  assert.match(markup,/<strong>1<\/strong><span>Open/);
  assert.match(markup,/<strong>0<\/strong><span>Done/);
  assert.match(markup,/<strong>0<\/strong><span>Blocked/);
  assert.match(markup,/data-action="claim" data-id="free"/);
  assert.match(markup,/data-action="task" data-id="reported">Review completion/);
  assert.doesNotMatch(markup,/data-action="claim" data-id="reported"/);
  assert.doesNotMatch(markup,/Historical|arch-free/);
  assert.deepEqual(state,before);
});

test('each task filter abandons a prior focused Link map and the map agrees with empty results',()=>{
  for(const [type,id,value] of [['change','ownerFilter','missing'],['change','statusFilter','blocked'],['input','taskSearch','not a task']]){
    const f=fixture(),before=structuredClone(f.state);
    assert.match(f.map(),/map-task-focused[^>]*data-action="task" data-id="venue"/);
    assert.match(f.map(),/Plan check-in/,'connected work remains visible in a focused map');
    f.change(type,id,value);
    assert.equal(f.ui.mapFocus,'');
    assert.equal(f.count(),'0 tasks');
    assert.match(f.map(),/No tasks match/);
    assert.doesNotMatch(f.map(),/Book venue|map-clear/);
    f.change(type,id,'');
    assert.equal(f.count(),'3 tasks');
    assert.match(f.map(),/Share photos/);
    assert.doesNotMatch(f.map(),/map-task-focused/);
    assert.deepEqual(f.state,before);
  }
});

test('task tabs and People shortcuts use only their new focus scope after navigation succeeds',()=>{
  const tab=fixture();
  tab.click('task-filter',{filter:'done'});
  assert.equal(tab.count(),'1 task');
  assert.match(tab.map(),/Share photos/);
  assert.doesNotMatch(tab.map(),/Book venue|map-clear/);
  const people=fixture();
  people.click('person-tasks',{id:'dev'});
  assert.equal(people.count(),'1 task');
  assert.match(people.map(),/Plan check-in/);
  assert.match(people.map(),/Book venue/,'a matching seed keeps its connected context');
  assert.doesNotMatch(people.map(),/Share photos|map-clear/);
  const blocked=fixture();
  blocked.denyNavigation();
  blocked.click('person-tasks',{id:'dev'});
  assert.equal(blocked.ui.mapFocus,'venue');
  assert.equal(blocked.ui.owner,'');
});

test('the Status filter identifies saved review separately from work in progress or verified Done',()=>{
  const f=fixture(),reportedAt='2026-11-20T16:00:00.000Z';
  f.state.tasks.push(
    {...task('pending','Fictional pending report','maya','progress'),requiresVerification:true,reportedAt},
    {...task('legacy-pending','Fictional unverified Done','maya','done'),requiresVerification:true,reportedAt},
    {...task('ordinary','Fictional regular progress','maya','progress'),requiresVerification:true},
    {...task('verified','Fictional verified report','maya','done'),requiresVerification:true,reportedAt,verifiedAt:'2026-11-20T17:00:00.000Z'},
  );
  const before=structuredClone(f.state);
  f.change('change','statusFilter','awaiting-verification');
  assert.equal(f.count(),'2 tasks');
  assert.match(f.rows(),/Fictional pending report[\s\S]*Fictional unverified Done/);
  assert.doesNotMatch(f.rows(),/regular progress|verified report|Share photos/);
  f.change('change','statusFilter','progress');
  assert.equal(f.count(),'1 task');
  assert.equal(f.rows(),'Fictional regular progress');
  f.click('task-filter',{filter:'done'});
  assert.equal(f.count(),'2 tasks');
  assert.match(f.rows(),/Share photos[\s\S]*Fictional verified report/);
  assert.doesNotMatch(f.rows(),/unverified Done/);
  assert.deepEqual(f.state,before,'filtering does not alter either stored workflow status');
});

test('a removed focus falls back to current task seeds, and clearing an existing focus keeps keyboard focus in the map',()=>{
  const f=fixture();
  f.state.tasks=f.state.tasks.filter(task=>task.id!=='venue');
  f.render();
  assert.equal(f.count(),'2 tasks');
  assert.match(f.map(),/Plan check-in[\s\S]*Share photos|Share photos[\s\S]*Plan check-in/);
  assert.doesNotMatch(f.map(),/map-clear|map-task-focused/);
  const clear=fixture();
  clear.click('map-clear');
  assert.deepEqual(clear.focus,['map']);
  assert.match(clear.map(),/Share photos/);
});

test('opening an explicit task map focuses the selected card and waits for navigation before replacing filters',()=>{
  const f=fixture();
  f.change('change','ownerFilter','maya');
  f.click('map-focus',{id:'entrance'});
  assert.equal(f.ui.mapFocus,'entrance');
  assert.equal(f.ui.owner,'');
  assert.match(f.map(),/map-task-focused[^>]*data-action="task" data-id="entrance"/);
  assert.deepEqual(f.focus,['focused task']);
  const blocked=fixture();
  blocked.change('change','ownerFilter','maya');
  blocked.denyNavigation();
  blocked.click('map-focus',{id:'entrance'});
  assert.equal(blocked.ui.mapFocus,'');
  assert.equal(blocked.ui.owner,'maya');
  assert.deepEqual(blocked.focus,[]);
});
