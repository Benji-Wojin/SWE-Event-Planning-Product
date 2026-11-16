import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/priorities.js';

const app=readFileSync('legacy/app.js','utf8');
const block=(begin,end)=>{
  const start=app.indexOf(begin),finish=app.indexOf(end,start+begin.length);
  assert.ok(start>=0&&finish>start,begin);
  return app.slice(start,finish);
};
const h=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const activeRoster=[{id:'jack',name:'Organizer',role:'Organizer'},
  {id:'teammate',name:'Active teammate',role:'Teammate',active:true},
  {id:'former',name:'Former teammate',role:'Teammate',active:false},
  {id:'sample',name:'Example assistant',role:'Teammate · example',active:true}];
const task=(patch={})=>({id:'task-current',title:'Welcome <guests>',owner:'',status:'todo',category:'Venue',
  dueDate:'',acceptedAt:'',updatedAt:'2026-09-24T12:00:00Z',dependencies:[],...patch});
const now=new Date('2026-09-24T12:00:00Z');

function render(current,{organizer=true,demo=false,tab='attention'}={}){
  const state={members:structuredClone(activeRoster),tasks:[current],messages:[],activity:[],
    event:{timeZone:'UTC',date:'',setupCompletedAt:'done'}};
  const before=structuredClone(state),mutations=[];
  const member=id=>state.members.find(person=>person.id===id)||{name:'Unassigned'};
  const context=vm.createContext({state,current,ui:{tab,view:'tasks',actor:organizer?'jack':'teammate'},
    window:{GatherMode:{projectId:'fixture',demo}},h,member,
    GatherPriorities:{...GatherPriorities,
      analyze:(row,rows,_when,zone,roster)=>GatherPriorities.analyze(row,rows,now,zone,roster),
      rank:(rows,_when,all,zone,roster)=>GatherPriorities.rank(rows,now,all,zone,roster),
      decision:(row,rows,_when,zone,roster)=>GatherPriorities.decision(row,rows,now,zone,roster)},
    store:{getState:()=>state,getSuggestions:()=>[],claimTask:()=>mutations.push('claim'),updateTask:()=>mutations.push('update')},
    isOrganizer:()=>organizer,completionText:()=>'',timeLabel:h,relative:h,icon:()=>'',
    latestUpdateRecord:()=>({text:''}),updateAttribution:()=>'',commitment:()=>'',
    due:row=>h(row.dueDate),statusBadge:h,avatar:()=>'',person:id=>h(member(id).name),
    guideTaskId:'',dependencyInfo:()=>({open:[]}),recovery:{organizerReviewPanel:()=>'',nextUpPanel:()=>'',recoveryReply:()=>null},
    linkedResultsPanel:()=>'',dateKey:()=> '2026-09-24',dayLabel:h,pageHeading:()=>'',addButton:()=>'',
    GatherInbox:{conversations:()=>[]},GatherPlanningUI:{emptyPlanMarkup:()=>''},empty:copy=>h(copy),insightMarkup:()=>'',
  });
  const fragments=[block('  function assignableTaskOwner(', '  const ownerOptions ='),
    block('  const attentionRoster =','  const completionText ='),
    block('  const completionNeedsReview =','  const empty ='),
    block('  function attentionItemMarkup(', '  function filteredTasks(')];
  const markup=vm.runInContext(fragments.join('\n')+'\n({overview:overview(state),row:taskRow(current)});',context);
  assert.deepEqual(state,before,'rendering does not change the workspace');
  assert.deepEqual(mutations,[]);
  return markup;
}

const ownerCell=row=>row.match(/<td\b[^>]*class="task-cell-owner"[^>]*>([\s\S]*?)<\/td>/)?.[1]||'';

test('Overview and the Needs attention task list direct organizers to the existing owner editor',()=>{
  for(const [owner,label] of [['','Assign owner'],['former','Reassign owner'],['sample','Reassign owner']]){
    const {overview,row}=render(task({owner}));
    for(const markup of [overview,ownerCell(row)]){
      assert.match(markup,new RegExp('data-action="review-attention-owner"[^>]*data-id="task-current"[^>]*>'+label+'</button>'),owner||'unassigned');
      assert.doesNotMatch(markup,/data-action="claim"|<guests>|Acceptance pending|Waiting for owner acceptance/);
    }
    if(owner)assert.match(overview,/Owner unavailable/i);
  }
});

test('owner actions leave valid teammate claims and completion review intact',()=>{
  const teammate=render(task(),{organizer:false});
  for(const markup of [teammate.overview,ownerCell(teammate.row)]){
    assert.match(markup,/data-action="claim"[^>]*data-id="task-current"/);
    assert.doesNotMatch(markup,/data-action="review-attention-owner"/);
  }
  for(const owner of ['','former'])for(const organizer of [true,false]){
    const pending=render(task({owner,requiresVerification:true,reportedAt:now.toISOString()}),{organizer});
    assert.match(pending.overview,organizer?/Verify completion/:/Awaiting organizer verification/);
    assert.doesNotMatch(pending.overview+ownerCell(pending.row),/data-action="(?:claim|review-attention-owner)"/);
  }
  for(const owner of ['teammate','sample']){
    const available=render(task({owner}),{demo:owner==='sample'});
    assert.doesNotMatch(available.overview+ownerCell(available.row),/data-action="review-attention-owner"|Owner unavailable/i);
  }
});

test('a legacy Done report awaiting verification never offers Reopen or reveals the note on a teammate’s Overview card',()=>{
  const current=task({owner:'teammate',status:'done',requiresVerification:true,reportedAt:now.toISOString(),note:'Private report details <fixture>'});
  const completionCell=markup=>markup.match(/<td\b[^>]*class="task-cell-completion"[^>]*>[\s\S]*?<\/td>/)?.[0]||'';
  const teammate=render(current,{organizer:false}),organizer=render(current);
  for(const {overview,row} of [teammate,organizer]){
    assert.match(completionCell(row),/data-action="task" data-id="task-current" data-task-focus="inspect"/);
    assert.doesNotMatch(completionCell(row),/toggle-task|aria-label="Reopen|check-button/);
    assert.doesNotMatch(overview,/Recently completed[\s\S]*data-id="task-current"/);
  }
  assert.match(teammate.overview,/Awaiting organizer verification[\s\S]*The report is saved\. The organizer will review it\./);
  assert.match(teammate.overview,/data-action="task" data-id="task-current"[^>]*>View report<\/button>/);
  assert.doesNotMatch(teammate.overview,/Verify completion|Private report details/);
  assert.match(organizer.overview,/data-action="task" data-id="task-current"[^>]*>Review completion<\/button>/);
  assert.match(organizer.overview,/Private report details &lt;fixture&gt;/);
});

test('pending help and date requests retain their own organizer review route ahead of any owner action',()=>{
  for(const [kind,label] of [['help','Review help request'],['date','Review date proposal']])for(const owner of ['','former']){
    const recoveryRequests=[{kind,status:'pending'}];
    const {overview,row}=render(task({owner,recoveryRequests}));
    assert.match(overview,new RegExp('data-action="task" data-id="task-current" data-open-recovery[^>]*>'+label+'</button>'));
    assert.match(row,/data-action="task" data-id="task-current" data-task-focus="details" data-open-recovery/);
    assert.doesNotMatch(overview+ownerCell(row),/data-action="(?:claim|review-attention-owner)"/);
    const teammate=render(task({owner,recoveryRequests}),{organizer:false});
    assert.doesNotMatch(teammate.overview+teammate.row,/data-open-recovery|data-action="(?:claim|review-attention-owner)"/);
    const completed=render(task({owner,recoveryRequests,requiresVerification:true,reportedAt:now.toISOString()}));
    assert.match(completed.overview,/data-action="task" data-id="task-current"[^>]*>Review completion<\/button>/);
    assert.doesNotMatch(completed.overview,/data-open-recovery|data-action="(?:claim|review-attention-owner)"/);
  }
});

function ownerReviewFixture({view='overview',tab='attention',organizer=true,patch={}}={}){
  const ownerTask=task({owner:'former',...patch});
  const state={members:structuredClone(activeRoster),tasks:[ownerTask,task({id:'decoy'})]};
  const ui={view,tab,actor:organizer?'jack':'teammate'},mode={projectId:'fixture',demo:false};
  const document={hidden:false,activeElement:null},frames=[],calls=[];
  const section={},viewRoot={contains:node=>node===section},backdrop={hidden:true},dialog={},title={};
  const disclosure={open:false},field={value:ownerTask.owner};
  const form={dataset:{id:ownerTask.id},closest:selector=>selector==='details'?disclosure:null};
  const opener={isConnected:true,dataset:{action:'review-attention-owner',id:ownerTask.id},
    getClientRects:()=>[{}],closest:selector=>selector===(view==='overview'?'.attention-list':'#taskRows')?section:null};
  const freshness={pending:false,stale:false};
  const context=vm.createContext({ui,document,GatherPriorities,window:{GatherMode:mode},store:{getState:()=>state,getSnapshotRevision:()=>3,
    claimTask:()=>calls.push(['claim']),updateTask:()=>calls.push(['update'])},
    isOrganizer:()=>organizer,workspaceUpdatesPending:()=>freshness.pending,scheduleRevisionIsStale:()=>freshness.stale,
    requestAnimationFrame:callback=>frames.push(callback),showPendingUpdate:()=>calls.push(['show pending update']),
    taskDialog:(...args)=>{calls.push(['open',...args]);ui.dialogKind='task';ui.detailId=args[0];backdrop.hidden=false;document.activeElement=title;},
    focusTaskDialogControl:(control,root)=>{assert.equal(control,field);assert.equal(root,dialog);document.activeElement=field;calls.push(['focus owner']);},
    $:(selector,root)=>selector==='#viewRoot'?viewRoot:selector==='#dialogBackdrop'?backdrop:selector==='#dialog'?dialog:
      selector==='#dialogTitle'&&root===dialog?title:selector==='#taskDetailForm'&&root===dialog?form:
        selector==='select[name="owner"]'&&root===form?field:null,
  });
  vm.runInContext(block('  function assignableTaskOwner(', '  const ownerOptions =')+
    block('  const attentionRoster =','  const reason =')+
    block('  function attentionOwnerAction(', '  function taskRow(')+
    block('  function focusTaskOwnerEditor(', '  function focusTaskScheduleEditor('),context);
  return {state,ownerTask,ui,window:context.window,mode,document,freshness,opener,backdrop,disclosure,field,form,title,calls,
    open:(trigger=opener,id=ownerTask.id)=>context.openAttentionOwnerReview(id,trigger),
    flush(){for(const callback of frames.splice(0))callback();}};
}

test('an organizer’s owner action opens only the exact owner field without claiming, assigning, or recording acceptance',()=>{
  for(const view of ['overview','tasks']){
    const fixture=ownerReviewFixture({view}),before=structuredClone(fixture.state);
    assert.equal(fixture.open(),true);
    assert.equal(fixture.calls[0][1],fixture.ownerTask.id,'open the activity by exact ID');
    assert.equal(fixture.calls[0].at(-1).readOnly,true,'opening the task does not start resource writes');
    assert.equal(fixture.disclosure.open,false,'focus starts at the task heading');
    fixture.flush();
    assert.equal(fixture.disclosure.open,true);
    assert.equal(fixture.document.activeElement,fixture.field);
    assert.deepEqual(fixture.calls.at(-1),['focus owner']);
    assert.equal(fixture.calls.length,2,'opening navigates and focuses without a mutation');
    assert.deepEqual(fixture.state,before);
  }
});

test('owner review guards the action and does not move focus past a changed or stale task',()=>{
  for(const reason of ['teammate','other tab','wrong element','detached','pending save','access lost','hidden page','archive']){
    const f=ownerReviewFixture({organizer:reason!=='teammate',view:reason==='other tab'?'tasks':'overview',
      tab:reason==='other tab'?'mine':'attention',patch:reason==='archive'?{archivedAt:now.toISOString()}:undefined});
    if(reason==='wrong element')f.opener.closest=()=>null;
    if(reason==='detached')f.opener.isConnected=false;
    if(reason==='pending save')f.ui.pendingSave=true;
    if(reason==='access lost')f.window.GatherAccessLost=true;
    if(reason==='hidden page')f.document.hidden=true;
    assert.equal(f.open(),false,reason);
    f.flush();
    assert.deepEqual(f.calls,[],reason);
  }
  for(const reason of ['assigned','pending report','pending help','archive','different actor','different project','focus moved','stale']){
    const f=ownerReviewFixture();
    assert.equal(f.open(),true);
    if(reason==='assigned')f.ownerTask.owner='teammate';
    if(reason==='pending report')f.ownerTask.reportedAt=now.toISOString();
    if(reason==='pending help')f.ownerTask.recoveryRequests=[{kind:'help',status:'pending'}];
    if(reason==='archive')f.ownerTask.archivedAt=now.toISOString();
    if(reason==='different actor')f.ui.actor='other';
    if(reason==='different project')f.mode.projectId='other';
    if(reason==='focus moved')f.document.activeElement={};
    if(reason==='stale')f.freshness.stale=true;
    f.flush();
    assert.equal(f.disclosure.open,false,reason);
    assert.deepEqual(f.calls.slice(1),reason==='stale'?[['show pending update']]:[],reason);
  }

  const completed=ownerReviewFixture({patch:{requiresVerification:true,reportedAt:now.toISOString()}});
  assert.equal(completed.open(),true,'a formerly actionable live button still opens the task for review');
  completed.flush();
  assert.equal(completed.disclosure.open,false);
  assert.equal(completed.calls.length,1,'an existing completion report is not put behind owner editing');
});
