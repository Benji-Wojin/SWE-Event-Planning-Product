import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const project='p_12345678-1234-4234-8234-123456789abc';
const teamHref=`/team?guide=1&project=${project}`;
const steps=['started','project_created','task_created','budget_viewed','event_details_viewed'];

function fragment(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,start);
  return app.slice(from,to);
}

function fixture({guided=true,observed=false}={}){
  const host={hidden:false},button={dataset:{action:'guide-invite'},disabled:false,isConnected:true,
    getClientRects:()=>[{}],closest:()=>null};
  const ui={pendingSave:false,actor:'fictional-organizer'};
  const document={hidden:false,addEventListener(event,fn){assert.equal(event,'click');click=fn;}};
  const mode={projectId:project,demo:false,projectUrl(path){
    const target=new URL(path,'https://fictional.example.test');
    target.searchParams.set('project',project);
    return target.pathname+target.search;
  }};
  const initial={projectId:project,events:[...steps,...(observed?['invite_clicked']:[])].map(checkpoint=>({checkpoint}))};
  const requests=[],navigationAttempts=[],navigation=[],trace=[];
  let click,unload,organizer=true,editorDirty=false,declineUnload=false;
  const window={GatherMode:mode,addEventListener(event,fn){assert.equal(event,'beforeunload');unload=fn;},top:{location:{
    set href(path){
      trace.push('navigate');navigationAttempts.push(path);
      let prevented=false;
      const event={returnValue:undefined,preventDefault(){prevented=true;}};
      unload(event);
      if(prevented&&declineUnload){assert.equal(event.returnValue,'');return;}
      navigation.push(path);
    },
  }}};
  const blockedGuideQueue=new Promise(()=>{});
  const context=vm.createContext({ui,window,document,initial,blockedGuideQueue,guidedWorkspace:guided,
    isOrganizer:()=>organizer,hiddenByClosedDisclosure:()=>false,
    $(selector,root){if(selector==='#workspaceGuide')return host;if(selector==='[data-action="guide-invite"]'){
      assert.equal(root,host);return button;
    }return null;},
    hasAcceptanceReturnDraft:()=>false,unsavedDialog:()=>false,unsavedReview:()=>editorDirty,
    planSidebar:{unsaved:()=>false},agentPopup:{unsaved:()=>false},
    confirmDiscard(){assert.fail('guide navigation must not discard local edits before beforeunload');},
    fetch(path,options){trace.push('telemetry');return new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}));},
  });
  vm.runInContext(fragment('  let guideProgress =','  let joinWelcome =')+
    'guideProgress=initial;guideQueue=blockedGuideQueue;\n'+
    fragment('  function guideObservation(','  function syncGuide(')+
    fragment("  document.addEventListener('click',async event=>{","    if(action==='review-personal-completion')")+'});\n'+
    fragment("  window.addEventListener('beforeunload'",'  let attentionDay='),context);
  return {host,button,ui,window,document,initial,requests,navigationAttempts,navigation,trace,
    set organizer(value){organizer=value;},set editorDirty(value){editorDirty=value;},set declineUnload(value){declineUnload=value;},
    click(control=button){return click({preventDefault(){trace.push('prevented');},target:{closest:()=>control}});},
  };
}

test('opening the guide invitation navigates synchronously while old guide reads and new click telemetry are both pending',async()=>{
  const f=fixture(),opened=f.click();
  assert.deepEqual(f.trace,['telemetry','navigate']);
  assert.deepEqual(f.navigation,[teamHref]);
  assert.equal(f.requests.length,1);
  const [{path,options,reject}]=f.requests;
  assert.equal(path,'/api/tutorial');assert.equal(options.method,'POST');assert.equal(options.keepalive,true);
  assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(options.headers['X-Gather-Request'],'1');assert.equal(options.headers['Content-Type'],'application/json');
  assert.deepEqual(JSON.parse(options.body),{checkpoint:'invite_clicked',project});
  reject(new Error('Fictional telemetry failure'));await opened;
  assert.deepEqual(f.navigation,[teamHref]);assert.equal(f.requests.length,1);
});

test('declining beforeunload preserves the Inbox draft and permits another navigation without duplicate click telemetry',async()=>{
  const f=fixture();f.editorDirty=true;f.declineUnload=true;
  await f.click();
  assert.deepEqual(f.navigation,[]);assert.deepEqual(f.navigationAttempts,[teamHref]);assert.equal(f.requests.length,1);
  f.declineUnload=false;
  await f.click();
  assert.deepEqual(f.navigation,[teamHref]);assert.deepEqual(f.navigationAttempts,[teamHref,teamHref]);assert.equal(f.requests.length,1);

  const observed=fixture({observed:true});await observed.click();
  assert.deepEqual(observed.navigation,[teamHref]);assert.deepEqual(observed.requests,[]);
});

test('only the current bound organizer can use the exact visible guide invitation control',async()=>{
  for(const reason of ['ordinary workspace','forged button','hidden host','hidden page','disconnected button','inert ancestor','missing layout','disabled button','lost role','lost access','different project','pending save']){
    const f=fixture({guided:reason!=='ordinary workspace'});
    if(reason==='hidden host')f.host.hidden=true;
    if(reason==='hidden page')f.document.hidden=true;
    if(reason==='disconnected button')f.button.isConnected=false;
    if(reason==='inert ancestor')f.button.closest=selector=>selector==='[hidden],[inert]'?{}:null;
    if(reason==='missing layout')f.button.getClientRects=()=>[];
    if(reason==='disabled button')f.button.disabled=true;
    if(reason==='lost role')f.organizer=false;
    if(reason==='lost access')f.window.GatherAccessLost=true;
    if(reason==='different project')f.window.GatherMode.projectId='different-fictional-project';
    if(reason==='pending save')f.ui.pendingSave=true;
    await f.click(reason==='forged button'?{...f.button}:f.button);
    assert.deepEqual(f.requests,[],reason);assert.deepEqual(f.navigationAttempts,[],reason);
  }
});
