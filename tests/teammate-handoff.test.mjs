import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/priorities.js';

const source=readFileSync('legacy/app.js','utf8');
const start=source.indexOf('  function acceptanceCandidates(');
const end=source.indexOf('  function syncAcceptanceSelection(',start);
const task=(id,owner='',fields={})=>({id,owner,title:id,status:'todo',revision:1,...fields});
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function context(tasks=[],{role='member',demo=false,lost=false,welcome=true}={}){
  const host={hidden:true,innerHTML:'',contains:()=>false};
  const state={event:{name:'Fictional <School> dance'},tasks};
  const actions=[];
  let dialog;
  const ctx=vm.createContext({
    ui:{actor:'maya',view:'overview',search:'old',taskView:'map'},
    window:{GatherMode:{demo},GatherIdentity:{role},GatherAccessLost:lost},
    joinWelcome:welcome,renderedTeammateHandoff:'',document:{activeElement:null},
    $:selector=>selector==='#workspaceHandoff'?host:null,store:{getState:()=>state},
    GatherPriorities,h:escape,statuses:{todo:'To do',progress:'In progress',blocked:'Blocked'},dayLabel:value=>value,
    navigate:view=>{ctx.ui.view=view;actions.push(view);return true;},
    filteredTasks:()=>state.tasks.filter(item=>item.owner==='maya'),
    skipToContent:()=>actions.push('focus'),toast:message=>actions.push(message),
    openDialog:(title,markup)=>{dialog={title,markup};},
  });
  vm.runInContext(source.slice(start,end),ctx);
  return {ctx,host,state,actions,run:js=>vm.runInContext(js,ctx),dialog:()=>dialog};
}

test('new teammates get orientation that accurately distinguishes no work, claimable work and assigned work',()=>{
  const f=context();
  f.run('paintTeammateHandoff()');
  assert.match(f.host.innerHTML,/Welcome to Fictional &lt;School&gt; dance/);
  assert.match(f.host.innerHTML,/Nothing is assigned to you yet/);
  assert.match(f.host.innerHTML,/data-action="event-info" aria-haspopup="dialog">Event details[\s\S]*data-view="timeline">Timeline[\s\S]*data-view="team">People/);
  assert.doesNotMatch(f.host.innerHTML,/data-view="info"/);
  assert.doesNotMatch(f.host.innerHTML,/Find unassigned tasks|Review assignments|Create a project/);
  f.state.tasks=[task('other-work','other'),task('ready-to-claim')];
  f.run('paintTeammateHandoff()');
  assert.match(f.host.innerHTML,/Find unassigned tasks/);
  f.state.tasks.push(task('already accepted','maya',{acceptedAt:'2031-01-01'}));
  f.run('paintTeammateHandoff()');
  assert.match(f.host.innerHTML,/Open My tasks/);
  assert.doesNotMatch(f.host.innerHTML,/other-work/);
});

test('the welcome is member-only and actual pending assignments surface on returning Overview',()=>{
  for(const options of [{role:'admin'},{demo:true},{lost:true}]){
    const f=context([task('mine','maya')],options);
    f.run('paintTeammateHandoff()');assert.equal(f.host.hidden,true);
  }
  const f=context([task('another teammate','other'),task('past report','maya',{reportedAt:'2031-01-01'})],{welcome:false});
  f.run('paintTeammateHandoff()');assert.equal(f.host.hidden,true);
  f.state.tasks.push(task('actual assignment','maya'));
  f.run('paintTeammateHandoff()');
  assert.equal(f.host.hidden,false);
  assert.match(f.host.innerHTML,/1 assignment is ready/);
  assert.doesNotMatch(f.host.innerHTML,/Dismiss welcome|another teammate|past report/);
  f.state.tasks.at(-1).acceptedAt='2031-01-01';
  f.run('paintTeammateHandoff()');assert.equal(f.host.hidden,true);
});

test('assignment handoff uses the real personal review without writing or selecting anything',()=>{
  const f=context([
    task('review-mine','maya',{title:'Review mine',scope:'Signed & confirmed',note:'Call before noon',dueDate:'2030-11-18',
      schedule:{start:'2030-11-19T17:00'}}),
    task('ignore other','other',{scope:'Do not display'}),
  ]);
  f.run("openHandoffTasks('review')");
  assert.deepEqual(f.actions,['tasks','focus']);assert.equal(f.ctx.ui.tab,'mine');
  assert.equal(f.ctx.ui.taskView,'list');assert.equal(f.ctx.ui.search,'');
  const {markup}=f.dialog();
  assert.match(markup,/Done when:<\/strong> Signed &amp; confirmed/);
  assert.match(markup,/Latest update:<\/strong> Call before noon/);
  assert.match(markup,/Open task details for Review mine/);
  assert.match(markup,/aria-labelledby="accept-title-review-mine" aria-describedby="accept-date-review-mine accept-activity-review-mine accept-outcome-review-mine"/);
  assert.match(markup,/id="accept-date-review-mine">To do · Due 2030-11-18/);
  assert.match(markup,/id="accept-activity-review-mine">Activity starts 2030-11-19 17:00/);
  assert.match(markup,/id="accept-outcome-review-mine">/);
  assert.doesNotMatch(markup,/\bchecked\b|ignore other|Do not display/);
});

test('personal assignment review describes work readiness without changing who can accept',()=>{
  const verifiedAt='2030-11-18T13:00:00Z';
  const f=context([
    task('one','maya',{dependencies:[{taskId:'outside-pending',kind:'dependency'}]}),
    task('several','maya',{dependencies:[{taskId:'outside-pending',kind:'dependency'},{taskId:'unavailable',kind:'dependency'}]}),
    task('linked-ready','maya',{status:'blocked',dependencies:[{taskId:'outside-done',kind:'dependency'}]}),
    task('marked-blocked','maya',{status:'blocked'}),
    task('help','maya',{recoveryRequests:[{kind:'help',status:'pending',note:'FICTIONAL_PRIVATE_REQUEST'}]}),
    task('related-only','maya',{dependencies:[{taskId:'outside-pending',kind:'related'}]}),
    task('ready','maya',{dependencies:[{taskId:'outside-done',kind:'dependency'}]}),
    task('outside-pending','other',{title:'FICTIONAL_OTHER_PREREQUISITE',status:'done',requiresVerification:true,note:'FICTIONAL_PRIVATE_RESULT'}),
    task('outside-done','other',{title:'FICTIONAL_OTHER_VERIFIED',status:'done',requiresVerification:true,verifiedAt}),
  ]);
  const before=structuredClone(f.state);
  f.run("openHandoffTasks('review')");
  assert.deepEqual(f.actions,['tasks','focus']);
  const markup=f.dialog().markup;
  for(const [id,label] of [
    ['one','Waiting on 1 required task before completion.'],
    ['several','Waiting on 2 required tasks before completion.'],
    ['linked-ready','Review linked results before resuming.'],
    ['marked-blocked','Blocked · review the latest update.'],
    ['help','Help requested · waiting for the organizer.'],
  ]){
    const checkbox=markup.match(new RegExp(`<input[^>]+name="acceptTask"[^>]+value="${id}"[^>]*>`))?.[0];
    assert.match(checkbox,new RegExp(`aria-describedby="[^"]*accept-readiness-${id}(?:\\s|")`));
    assert.doesNotMatch(checkbox,/\b(?:disabled|checked)\b/);
    const cue=markup.match(new RegExp(`id="accept-readiness-${id}"[^>]*>([\\s\\S]*?)<\\/span>`))?.[1].replace(/<[^>]+>/g,'');
    assert.equal(cue,label);
  }
  assert.doesNotMatch(markup,/accept-readiness-(?:related-only|ready)|FICTIONAL_(?:OTHER|PRIVATE)|outside-(?:pending|done)|unavailable/);
  assert.equal((markup.match(/name="acceptTask"/g)||[]).length,7);
  assert.deepEqual(f.state,before);
});

test('read-only event details show the shared venue and date, with clear missing states',()=>{
  const f=context();
  f.ctx.isOrganizer=()=>false;
  const a=source.indexOf('  function contextDialog('),b=source.indexOf('  function ',a+5);
  vm.runInContext(source.slice(a,b),f.ctx);
  f.run('contextDialog()');
  assert.equal(f.dialog().title,'Event details');
  assert.match(f.dialog().markup,/<dt>Event date<\/dt><dd>Not set yet/);
  assert.match(f.dialog().markup,/<dt>Location<\/dt><dd>Not set yet/);
  assert.doesNotMatch(f.dialog().markup,/No due date|<form/);
  Object.assign(f.state.event,{date:'2030-11-23',location:'Fictional <Park>'});
  f.run('contextDialog()');
  assert.match(f.dialog().markup,/<dt>Event date<\/dt><dd>[^<]*2030/);
  assert.match(f.dialog().markup,/<dt>Location<\/dt><dd>Fictional &lt;Park&gt;/);
});

test('orienting from the welcome moves focus to the destination only after navigation succeeds',()=>{
  const a=source.indexOf('  function navigateFromViewControl('),b=source.indexOf("  document.addEventListener('click'",a);
  for(const [fromHandoff,valid,consent,expected] of [
    [true,true,true,['navigate:timeline','focus']],
    [true,false,true,['navigate:timeline']],
    [false,true,true,['navigate:timeline']],
    [true,true,false,[]],
  ]){
    const actions=[];
    const ctx=vm.createContext({ui:{view:'overview'},$:()=>({hidden:true}),confirmDiscard:()=>consent,
      recordGuideViewClick:()=>{},navigate:view=>{actions.push('navigate:'+view);return valid;},
      skipToContent:()=>actions.push('focus'),control:{dataset:{view:'timeline'},closest:()=>fromHandoff?{}:null}});
    vm.runInContext(source.slice(a,b)+'navigateFromViewControl(control);',ctx);
    assert.deepEqual(actions,expected);
  }
});

test('welcome navigation consumes only the one-time scalar flag in the frame and outer project',()=>{
  const navigation=readFileSync('legacy/navigation.js','utf8');
  const ctx=vm.createContext({URL,URLSearchParams});
  vm.runInContext(navigation,ctx);
  function surface(url){
    const state={existing:true};
    const page={location:new URL(url),history:{state,replaceState(next,_unused,target){
      assert.equal(next,state);page.location=new URL(target,page.location.href);
    }}};
    return page;
  }
  const host=surface('https://fixture.example/project?project=fictional&welcome=1#overview');
  const frame=surface('https://fixture.example/workspace.html?project=fictional&welcome=1#tasks');
  frame.parent=host;
  const route=ctx.GatherNavigation.create(frame);
  assert.equal(route.takeJoinWelcome(),true);
  assert.equal(route.takeJoinWelcome(),false);
  assert.equal(host.location.href,'https://fixture.example/project?project=fictional#overview');
  assert.equal(frame.location.href,'https://fixture.example/workspace.html?project=fictional#tasks');
  const duplicate=surface('https://fixture.example/workspace.html?project=fictional&welcome=1&welcome=1&guide=1');
  assert.equal(ctx.GatherNavigation.create(duplicate).takeJoinWelcome(),false);
  assert.equal(duplicate.location.search,'?project=fictional&guide=1');
});
