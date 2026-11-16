import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const project='fictional-project',actor='fictional-organizer';
const progress=(steps=['started','project_created'],projectId=project,firstTaskId=null)=>({projectId,firstTaskId,events:steps.map(checkpoint=>({checkpoint}))});

function fragment(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,start);
  return app.slice(from,to);
}

function fixture({guided=true,tasks=[],organizer=true,allowed=true,view='overview'}={}){
  const state={tasks},calls=[],requests=[],frames=[];
  const window={GatherMode:{projectId:project,demo:false,projectUrl:path=>path+'?project='+project}};
  const document={hidden:false,body:{},activeElement:null};
  const ui={view,actor,dialogKind:'',pendingSave:false,lastFocus:null};
  const backdrop={hidden:true},dialog={},panel={hidden:true,dataset:{},contains:()=>false};
  const viewRoot={},receipt={hidden:true,innerHTML:''},highlights=[];
  let title,marker,skip,form;
  function node(name){
    return {name,id:name,isConnected:true,hidden:false,dataset:{},
      closest:()=>null,getClientRects:()=>[{}],focus(){document.activeElement=this;calls.push(['focus',name]);}};
  }
  const opener=node('overviewAddTask');
  function paintDialog(kind='',heading='',body='',footer='',focusHeading=false){
    for(const element of [title,marker,skip,form])if(element)element.isConnected=false;
    ui.dialogKind=kind;
    title=node('dialogTitle');title.textContent=heading;
    marker=body.includes('id="guideTaskWaiting"')?node('guideTaskWaiting'):null;
    skip=/data-action="guide-task-without-step"/.test(body+footer)?node('guide-task-without-step'):null;
    if(skip)skip.dataset.action='guide-task-without-step';
    form=body.includes('id="newTaskForm"')?node('newTaskForm'):null;
    if(form)form.elements={title:{value:'',focus(){document.activeElement=this;calls.push(['focus','task title']);}}};
    backdrop.hidden=false;dialog.contains=target=>[title,marker,skip,form].filter(Boolean).includes(target);
    document.activeElement=focusHeading?title:form?.elements.title||title;
  }
  function select(selector){
    if(selector==='#dialog')return dialog;
    if(selector==='#dialogTitle')return title;
    if(selector==='#guideTaskWaiting')return marker;
    if(selector==='#dialogBackdrop')return backdrop;
    if(selector==='#workspaceGuide')return panel;
    if(selector==='#viewRoot')return viewRoot;
    if(selector==='#guideTaskReceipt')return receipt;
    if(selector==='#overviewAddTask')return opener;
    if(selector==='#newTaskForm')return form;
    if(selector.includes('guide-task-without-step'))return skip;
    return null;
  }
  const context=vm.createContext({ui,window,document,AbortSignal,guidedWorkspace:guided,
    $(selector,root){if(selector==='#guideTaskReceipt')assert.equal(root,viewRoot);return select(selector);},
    $$(selector){assert.equal(selector,'#taskRows .task-name-button');return tasks.map(({id})=>({dataset:{id},
      closest(query){assert.equal(query,'tr');return {classList:{add:mark=>highlights.push([id,mark])}};}}));},
    store:{getState:()=>state,addTask(){assert.fail('opening either editor must not create work');}},
    canCreateTasks:()=>allowed,isOrganizer:()=>organizer,h:String,icon:()=>'',ownerOptions:()=>'',options:()=>'',statusOptions:()=>'',
    statusBadge:()=>'',render(){assert.fail('restoring the task card must not rerender the view');},
    navigate(){assert.fail('restoring the task card must not navigate');},
    requestAnimationFrame:fn=>frames.push(fn),queueMicrotask,openDialog(heading,body,footer='',wide=false,kind='',focusHeading=false){
      const previous=backdrop.hidden?document.activeElement:undefined;
      if(previous)ui.lastFocus=previous;
      paintDialog(kind,heading,body,footer,focusHeading);
      calls.push(['dialog',{heading,body,footer,wide,kind,focusHeading}]);
    },closeDialog(){
      for(const element of [title,marker,skip,form])if(element)element.isConnected=false;
      backdrop.hidden=true;ui.dialogKind='';document.activeElement=ui.lastFocus;calls.push(['close']);
    },
    toast:message=>calls.push(['toast',message]),fetch(url,settings){
      assert.equal(url,'/api/tutorial','no other endpoint may be used by the mocked flow');
      const method=settings.method||'GET',payload=settings.body&&JSON.parse(settings.body);
      assert.equal(settings.cache,'no-store');assert.equal(settings.credentials,'same-origin');
      return new Promise((resolve,reject)=>requests.push({method,payload,
        reply(data){resolve({ok:true,json:async()=>data});},
        fail(){reject(new Error('Fictional guide unavailable'));},
      }));
    },
  });
  vm.runInContext(fragment('  let guideProgress =','  let joinWelcome =')+
    fragment('  const guideSteps =','  const planSidebar=')+
    fragment('  function guideTaskPanel(','  function assignmentCandidates(')+
    fragment('  function newTaskDialog(','  function followupDialog('),context);
  document.activeElement=opener;
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));for(const fn of frames.splice(0))fn();};
  return {state,ui,window,document,backdrop,calls,requests,opener,receipt,panel,highlights,flush,
    get title(){return title;},get marker(){return marker;},get skip(){return skip;},get form(){return form;},
    boot(){return context.loadInitialGuide();},
    open(){return context.openGuideAwareTask(opener);},
    withoutStep(control=skip){return context.finishGuideTaskWait(control);},
    resume(){return context.finishGuideTaskWait();},
    close(){return context.closeDialog();},
    editOther(){paintDialog('other editor','Other task editor','<form id="newTaskForm">');form.elements.title.value='Fictional in-progress draft';},
    replaceMarker(){marker.isConnected=false;marker=node('new-guideTaskWaiting');},
    set organizer(value){organizer=value;},set allowed(value){allowed=value;},
  };
}

const dialogs=f=>f.calls.filter(([kind])=>kind==='dialog').map(([,dialog])=>dialog);
const requests=f=>f.requests.map(item=>item.method);
const toolbar=dialog=>dialog.body+dialog.footer;
function ordinary(f){
  const last=dialogs(f).at(-1);
  assert.match(last.body,/id="newTaskForm"/);
  assert.doesNotMatch(last.body,/data-guide-task|Save first task|guideTaskWaiting/);
  return f.form;
}
async function ackObservation(f){
  await f.flush();
  assert.deepEqual(requests(f),['GET','POST']);
  assert.deepEqual(f.requests[1].payload,{checkpoint:'add_task_clicked',project});
  f.requests[1].reply(progress(['started','project_created','add_task_clicked']));
  await f.flush();
  assert.deepEqual(requests(f),['GET','POST'],'no additional guide reads or duplicate observations');
}

test('an empty guided workspace opens a waiting dialog immediately, then one guided form when the saved step is known',async()=>{
  const f=fixture(),loading=f.boot();
  assert.equal(f.open(),true);
  const initial=dialogs(f)[0],marker=f.marker;
  assert.equal(initial.kind,'guide-task-loading');assert.equal(initial.focusHeading,true);
  assert.match(initial.body,/id="guideTaskWaiting" role="status"/);
  assert.match(initial.footer,/type="button"[^>]*data-action="guide-task-without-step"[^>]*>Add without the guide/);
  assert.match(initial.footer,/data-action="close-dialog"[^>]*>Cancel/);
  assert.doesNotMatch(toolbar(initial),/newTaskForm|type="submit"/);
  assert.equal(f.document.activeElement,f.title);assert.equal(f.ui.lastFocus,f.opener);
  assert.equal(f.open(),false,'repeated Add during loading neither reopens nor records another click');
  await f.flush();assert.deepEqual(requests(f),['GET']);
  f.requests[0].reply(progress());await loading;
  const guided=dialogs(f).at(-1);
  assert.match(guided.body,/id="newTaskForm" data-guide-task="true"/);
  assert.match(guided.body,/Save first task/);
  assert.equal(marker.isConnected,false);
  assert.equal(f.document.activeElement,f.form.elements.title);
  assert.equal(f.ui.lastFocus,f.opener,'switching editors keeps the original page opener');
  await ackObservation(f);
  assert.equal(dialogs(f).length,2);
});

test('Add without the guide opens the ordinary form immediately and a late GET or observation cannot overwrite edits',async()=>{
  const f=fixture(),loading=f.boot();f.open();
  const button=f.skip;
  assert.equal(f.withoutStep({...button}),false,'copying a button is not the visible fallback control');
  button.disabled=true;assert.equal(f.withoutStep(),false);button.disabled=false;
  assert.equal(f.withoutStep(),true);
  const form=ordinary(f);form.elements.title.value='Fictional title already typed';
  assert.equal(f.withoutStep(button),false);
  await f.flush();assert.deepEqual(requests(f),['GET']);
  f.requests[0].reply(progress());await loading;
  await ackObservation(f);
  assert.equal(f.form,form);assert.equal(form.elements.title.value,'Fictional title already typed');
  assert.equal(dialogs(f).length,2);
});

test('loading error, malformed response, unbound guide, completed step or new shared tasks use the ordinary form',async()=>{
  for(const reason of ['network','malformed','unbound','completed','nonempty']){
    const f=fixture(),loading=f.boot();f.open();await f.flush();
    if(reason==='network')f.requests[0].fail();
    else if(reason==='malformed')f.requests[0].reply({projectId:project,events:[null]});
    else if(reason==='unbound')f.requests[0].reply(progress(undefined,'different-project'));
    else if(reason==='completed')f.requests[0].reply(progress(['started','project_created','task_created']));
    else {f.state.tasks.push({id:'task-from-teammate'});f.requests[0].reply(progress());}
    await loading;
    const form=ordinary(f);
    if(['network','malformed'].includes(reason))assert.match(f.calls.find(([kind])=>kind==='toast')?.[1],/can still add your task/);
    else assert.ok(!f.calls.some(([kind])=>kind==='toast'),reason);
    await ackObservation(f);
    assert.equal(f.form,form,reason);
    assert.equal(dialogs(f).length,2);
  }
});

test('normal and already-populated workspaces do not wait for the first-task guide',async()=>{
  for(const options of [{guided:false},{tasks:[{id:'existing-task'}]}]){
    const f=fixture(options),loading=f.boot();assert.equal(f.open(),true);
    ordinary(f);assert.equal(dialogs(f).length,1);
    if(options.guided===false){await loading;await f.flush();assert.deepEqual(requests(f),[]);}
    else {await f.flush();f.requests[0].reply(progress());await loading;await ackObservation(f);}
    assert.equal(dialogs(f).length,1);
  }
  const forbidden=fixture({allowed:false});assert.equal(forbidden.open(),false);
  assert.deepEqual(forbidden.calls,[]);assert.deepEqual(requests(forbidden),[]);
});

test('initial guide progress does not manufacture a click, and an already-recorded click is not recorded again',async()=>{
  const f=fixture(),loading=f.boot();
  await f.flush();assert.deepEqual(requests(f),['GET']);
  f.requests[0].reply(progress(['started','project_created','add_task_clicked']));await loading;
  assert.deepEqual(f.calls,[],'loading the guide alone does not open an editor');
  assert.equal(f.open(),true);await f.flush();
  assert.equal(dialogs(f).length,1);
  assert.match(dialogs(f)[0].body,/data-guide-task="true"/);
  assert.deepEqual(requests(f),['GET']);
});

test('a closed, replaced or wrong-scope waiting dialog is never reopened by old guide progress',async()=>{
  for(const change of ['cancel','other editor','new marker','different view','different project','different actor','lost access','lost role']){
    const f=fixture(),loading=f.boot();f.open();await f.flush();
    if(change==='cancel')f.close();
    if(change==='other editor')f.editOther();
    if(change==='new marker')f.replaceMarker();
    if(change==='different view')f.ui.view='timeline';
    if(change==='different project')f.window.GatherMode.projectId='other-project';
    if(change==='different actor')f.ui.actor='other-actor';
    if(change==='lost access')f.window.GatherAccessLost=true;
    if(change==='lost role'){f.organizer=false;f.allowed=false;}
    const title=f.title;
    f.requests[0].reply(progress());await loading;await f.flush();
    const lostScope=['different project','different actor','lost access','lost role'].includes(change);
    assert.deepEqual(requests(f),lostScope?['GET']:['GET','POST'],change);
    for(const request of f.requests.slice(1))request.reply(progress(['started','project_created','add_task_clicked']));
    await f.flush();
    assert.equal(dialogs(f).length,1,change);
    assert.equal(f.title,title,change);
    if(change==='cancel')assert.equal(f.backdrop.hidden,true);
    if(change==='other editor')assert.equal(f.form.elements.title.value,'Fictional in-progress draft');
  }
});

test('guide settlement waits until the document is visible and does not replace a form while a save is pending',async()=>{
  for(const pause of ['hidden','save']){
    const f=fixture(),loading=f.boot();f.open();await f.flush();
    if(pause==='hidden')f.document.hidden=true;else f.ui.pendingSave=true;
    f.requests[0].reply(progress());await loading;
    assert.equal(f.resume(),false);assert.equal(dialogs(f).length,1);
    assert.equal(f.ui.dialogKind,'guide-task-loading');
    f.document.hidden=false;f.ui.pendingSave=false;
    assert.equal(f.resume(),true);
    assert.match(dialogs(f).at(-1).body,/data-guide-task="true"/);
    await ackObservation(f);
    assert.equal(dialogs(f).length,2);
  }
});

const completedTaskSteps=['started','project_created','task_created'];
const savedFirst={id:'saved-first-task',title:'Fictional duplicate title',status:'todo'};
const similarTask={...savedFirst,id:'different-task-same-title'};

test('resuming on Shared tasks shows only the recorded task without navigating, refocusing or replacing a draft',async()=>{
  const f=fixture({view:'tasks',tasks:[similarTask,savedFirst]}),loading=f.boot();
  f.editOther();const draft=f.form,focused=f.document.activeElement;
  assert.equal(f.receipt.hidden,true);
  await f.flush();assert.deepEqual(requests(f),['GET']);
  f.requests[0].reply(progress(completedTaskSteps,project,savedFirst.id));await loading;
  assert.equal(f.receipt.hidden,false);
  assert.match(f.receipt.innerHTML,/data-action="task" data-id="saved-first-task">Open task details/);
  assert.match(f.receipt.innerHTML,/Fictional duplicate title/);
  assert.doesNotMatch(f.receipt.innerHTML,/data-id="different-task-same-title"/);
  assert.deepEqual(f.highlights,[[savedFirst.id,'guide-first-task-row']]);
  assert.equal(f.form,draft);assert.equal(draft.elements.title.value,'Fictional in-progress draft');
  assert.equal(f.document.activeElement,focused);assert.equal(f.ui.view,'tasks');
  assert.deepEqual(f.calls,[]);assert.deepEqual(requests(f),['GET']);
});

test('resuming outside Shared tasks offers a deliberate review without opening the task or taking focus',async()=>{
  const f=fixture({view:'budget',tasks:[savedFirst]}),loading=f.boot();
  await f.flush();f.requests[0].reply(progress(completedTaskSteps,project,savedFirst.id));await loading;
  assert.match(f.panel.innerHTML,/data-action="guide-task-reveal">Review your first task/);
  assert.equal(f.receipt.hidden,true);assert.deepEqual(f.highlights,[]);
  assert.equal(f.document.activeElement,f.opener);assert.equal(f.ui.view,'budget');
  assert.deepEqual(f.calls,[]);assert.deepEqual(requests(f),['GET']);
});

test('an absent, archived, malformed or wrong-scope first-task ID never falls back to another task',async()=>{
  for(const reason of ['old event','archived','removed','malformed id','wrong project','uncommitted','other actor','access lost','ordinary workspace']){
    const f=fixture({view:'tasks',guided:reason!=='ordinary workspace',tasks:[similarTask,
      ...(reason==='removed'?[]:[reason==='archived'?{...savedFirst,archivedAt:'2026-01-02'}:savedFirst])]}),loading=f.boot();
    await f.flush();
    if(reason==='other actor')f.ui.actor='different-fictional-actor';
    if(reason==='access lost')f.window.GatherAccessLost=true;
    const id=reason==='old event'?null:reason==='malformed id'?{id:savedFirst.id}:savedFirst.id;
    const steps=reason==='uncommitted'?['started','project_created','add_task_clicked']:completedTaskSteps;
    if(reason==='ordinary workspace')assert.deepEqual(requests(f),[]);
    else f.requests[0].reply(progress(steps,reason==='wrong project'?'other-project':project,id));
    await loading;
    assert.equal(f.receipt.hidden,true,reason);assert.equal(f.receipt.innerHTML,'',reason);assert.deepEqual(f.highlights,[],reason);
    assert.doesNotMatch(f.panel.innerHTML||'',/Review your first task/,reason);
  }
});

test('choosing the ordinary form suppresses a late saved-task walkthrough in this session',async()=>{
  const f=fixture({view:'tasks'}),loading=f.boot();f.open();
  assert.equal(f.withoutStep(),true);const form=ordinary(f);
  form.elements.title.value='Fictional ordinary draft';f.state.tasks.push(savedFirst);
  await f.flush();f.requests[0].reply(progress([...completedTaskSteps,'add_task_clicked'],project,savedFirst.id));await loading;
  assert.equal(f.form,form);assert.equal(form.elements.title.value,'Fictional ordinary draft');
  assert.equal(f.receipt.hidden,true);assert.deepEqual(f.highlights,[]);assert.deepEqual(requests(f),['GET']);
});
