import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const navigationSource=readFileSync('legacy/navigation.js','utf8');
const origin='https://fictional.example.test';
const scope='a'.repeat(64),otherScope='b'.repeat(64);
const storageKey=value=>'weft-teammate-welcome-v1:'+value;

function fragment(start,end){
  const from=app.indexOf(start),to=app.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,start);
  return app.slice(from,to);
}

function surface(path){
  const listeners=new Map(),historyState={existing:'fixture history state'};
  const page={location:new URL(path,origin),history:{state:historyState,replaceState(value,_unused,target){
    assert.equal(value,historyState);page.location=new URL(target,page.location.href);
  }},addEventListener(name,fn){
    if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);
  },removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){
    for(const fn of listeners.get(event.type)||[])fn(event);
  }};
  return page;
}

function tab({blocked=[]}={}){
  const entries=new Map(),operations=[];
  const vault={getItem(key){operations.push(['read',key]);if(blocked.includes('read'))throw Error('Storage denied');return entries.get(key)??null;},
    setItem(key,value){operations.push(['mark',key,value]);if(blocked.includes('mark'))throw Error('Storage denied');entries.set(key,value);},
    removeItem(key){operations.push(['clear',key]);if(blocked.includes('clear'))throw Error('Storage denied');entries.delete(key);},
  };
  return {entries,operations,vault};
}

function boot(tab,{query='project=fictional-project',view='',role='member',opaque=scope,demo=false,lost=false,
  tasks=[],storageAccessorBlocked=false}={}){
  const host=surface(`/project?${query}${view}`),frame=surface(`/workspace.html?${query}${view}`);
  const active={name:'Previous focus'};
  frame.parent=host;frame.GatherMode={demo,projectId:new URLSearchParams(query).get('project')};
  frame.GatherIdentity=role?{role,actorId:'fictional-teammate'}:null;
  frame.GatherAccessLost=lost;
  Object.defineProperty(frame,'sessionStorage',{get(){if(storageAccessorBlocked)throw Error('Storage getter denied');return tab.vault;}});
  const ui={view:'overview',actor:'fictional-teammate'},state={event:{name:'Fictional rehearsal'},tasks};
  const focused=[],visited=[];let click,context;
  const document={hidden:false,activeElement:active,addEventListener(name,fn){assert.equal(name,'click');click=fn;}};
  const workspace={hidden:true,innerHTML:'',contains:element=>element===dismiss||element===heading};
  const backdrop={hidden:true};
  const control=name=>({name,isConnected:true,disabled:false,closest:()=>null,getClientRects:()=>[{}],focus(){document.activeElement=this;focused.push(name);}});
  const dismiss={...control('Dismiss welcome'),dataset:{action:'dismiss-handoff'}},heading=control('Welcome heading'),root=control('Workspace content');
  const store={getState:()=>state,getReminderScope:()=>opaque,
    save(){assert.fail('welcome state must not write project data');}};
  function paint(){context.paintTeammateHandoff();}
  function select(selector){
    if(selector==='#workspaceHandoff')return workspace;
    if(selector==='#workspaceHandoffTitle'&&workspace.innerHTML.includes('id="workspaceHandoffTitle"'))return heading;
    if((selector.includes('dismiss-handoff')||selector==='#workspaceHandoffDismiss')&&workspace.innerHTML.includes('data-action="dismiss-handoff"'))return dismiss;
    if(selector==='#viewRoot')return root;
    if(selector==='#dialogBackdrop')return backdrop;
    return null;
  }
  context=vm.createContext({window:frame,document,ui,store,URL,URLSearchParams,h:String,$:select,
    restoreFocus:()=>false,confirmCloseDialog:()=>true,confirmDiscard:()=>true,hasAcceptanceReturnDraft:()=>false,
    Event:class {constructor(type){this.type=type;}},
    GatherScheduleUI:{scheduledTimelineDay:()=>''},setDrawer(){},loadInitialGuide(){},
    navigate(view){ui.view=view;visited.push(view);context.navigation.replace(view);paint();return true;},
  });
  Object.defineProperty(context,'sessionStorage',{get(){return frame.sessionStorage;}});
  vm.runInContext(navigationSource,context);
  context.navigation=frame.GatherNavigation.create(frame);
  vm.runInContext(fragment('  let joinWelcome =','  const unconfirmedRelatedSaves=')+
    fragment('  function waitsForAcceptance(','  function acceptanceHandoffInScope(')+
    fragment('  function teammateHandoff(','  function openHandoffTasks(')+
    fragment('  const routeChanged=view=>','  window.addEventListener(\'beforeunload\'')+
    fragment("  document.addEventListener('click',async event=>{","      if(action==='review-organizer-item')")+'}finally{release();}});\n'+
    fragment('  ui.scheduleDate=navigation.initialScheduleDate();','  void loadInitialGuide();'),context);
  return {host,frame,ui,workspace,focused,visited,dismiss,document,active,
    hasWelcome:()=>workspace.innerHTML.includes('Dismiss welcome'),
    click(control=dismiss){return click({target:{closest:()=>control},preventDefault(){}});},
    show(view){return context.navigate(view);},
    pageShow(persisted){frame.dispatchEvent({type:'pageshow',persisted});},
  };
}

test('a fresh accepted invitation consumes the hint but keeps the exact welcome pending through reload until dismissal',async()=>{
  const browser=tab(),first=boot(browser,{query:'project=fictional-project&welcome=1'});
  assert.equal(first.hasWelcome(),true);
  assert.deepEqual(first.focused,['Welcome heading']);
  assert.equal(first.host.location.search,'?project=fictional-project');
  assert.equal(first.frame.location.search,'?project=fictional-project');
  assert.deepEqual([...browser.entries],[[storageKey(scope),'pending']]);
  const reload=boot(browser,{query:first.host.location.search.slice(1),view:first.host.location.hash});
  assert.equal(reload.hasWelcome(),true);assert.deepEqual(reload.visited,['overview']);
  assert.deepEqual(reload.focused,[]);assert.equal(reload.document.activeElement,reload.active);
  assert.equal(boot(tab()).hasWelcome(),false,'an independent tab with no pending marker does not inherit the welcome');
  await reload.click({...reload.dismiss});assert.equal(reload.hasWelcome(),true,'only the current rendered control can dismiss');
  await reload.click();
  assert.equal(reload.hasWelcome(),false);assert.equal(reload.workspace.hidden,true);
  assert.equal(browser.entries.has(storageKey(scope)),false);
  assert.equal(boot(browser).hasWelcome(),false);
});

test('a pending welcome waits for Overview without replacing a task or activity deep link',()=>{
  const browser=tab();boot(browser,{query:'project=fictional-project&welcome=1'});
  for(const [query,section] of [['task=fictional-task','tasks'],['activity=fictional-activity','timeline']]){
    const deep=boot(browser,{query:`project=fictional-project&${query}`});
    assert.deepEqual(deep.visited,[section]);assert.equal(deep.hasWelcome(),false);assert.deepEqual(deep.focused,[]);
    assert.equal(browser.entries.get(storageKey(scope)),'pending');
    deep.show('overview');assert.equal(deep.hasWelcome(),true);assert.deepEqual(deep.focused,[]);
  }
});

test('only the exact live teammate account/project scope can activate, resume or clear a welcome marker',async()=>{
  const browser=tab(),original=boot(browser,{query:'project=fictional-project&welcome=1'});
  for(const options of [{opaque:otherScope},{opaque:otherScope,query:'project=another-project'}]){
    const current=boot(browser,options);
    assert.equal(current.hasWelcome(),false);
    await current.click();assert.equal(browser.entries.get(storageKey(scope)),'pending');
  }
  for(const options of [{role:'admin'},{role:null},{demo:true},{lost:true}]){
    const operations=browser.operations.length;
    const current=boot(browser,{query:'project=fictional-project&welcome=1',...options});
    assert.equal(current.hasWelcome(),false);
    await current.click();assert.equal(browser.entries.get(storageKey(scope)),'pending');assert.equal(browser.operations.length,operations);
  }
  const operations=browser.operations.length;
  const invalid=boot(browser,{opaque:'unvalidated raw identity'});
  assert.equal(invalid.hasWelcome(),false);assert.equal(browser.operations.length,operations);
  assert.ok(browser.operations.every(([,key])=>[storageKey(scope),storageKey(otherScope)].includes(key)));
  assert.deepEqual([...browser.entries],[[storageKey(scope),'pending']]);
  await original.click();assert.equal(browser.entries.has(storageKey(scope)),false);
  assert.equal(boot(browser,{query:'project=fictional-project&welcome=1'}).hasWelcome(),true,'a fresh invitation may start a welcome again');
});

test('only a fresh eligible Overview welcome starts a marker, not competing or invalid hints',()=>{
  for(const [query,view] of [['welcome=1&welcome=1',''],['welcome=1&task=fictional-task',''],
    ['welcome=1&activity=fictional-activity',''],['welcome=1','#tasks'],['welcome=0','']]){
    const browser=tab(),current=boot(browser,{query:'project=fictional-project&'+query,view});
    assert.equal(current.hasWelcome(),false,query+view);assert.equal(browser.entries.size,0);
  }
  const malformed=tab();malformed.entries.set(storageKey(scope),'true');
  assert.equal(boot(malformed).hasWelcome(),false,'only the exact pending sentinel is accepted');
});

test('browser-history restoration takes the current dismissal without hiding outstanding task assignments',async()=>{
  const browser=tab(),tasks=[{id:'fictional-pending',owner:'fictional-teammate',status:'todo'}];
  const older=boot(browser,{query:'project=fictional-project&welcome=1',tasks});
  const newer=boot(browser,{tasks});
  await newer.click();
  assert.equal(newer.hasWelcome(),false);assert.match(newer.workspace.innerHTML,/Review your task assignments/);
  older.pageShow(false);assert.equal(older.hasWelcome(),true);
  older.document.activeElement=older.active;
  older.pageShow(true);
  assert.equal(older.hasWelcome(),false);assert.match(older.workspace.innerHTML,/Review your task assignments/);
  assert.deepEqual(older.visited,['overview']);assert.deepEqual(older.focused,['Welcome heading']);
  assert.equal(browser.entries.has(storageKey(scope)),false);

  const revoked=boot(browser,{query:'project=fictional-project&welcome=1',tasks});
  const operationsBeforeRestore=browser.operations.length;
  revoked.frame.GatherAccessLost=true;
  revoked.pageShow(true);
  assert.equal(revoked.hasWelcome(),false);
  assert.equal(revoked.workspace.hidden,true);
  assert.equal(browser.operations.length,operationsBeforeRestore);
});

test('blocked storage leaves a usable in-memory welcome and dismisses it without affecting the workspace',async()=>{
  for(const [blocked,storageAccessorBlocked] of [[['read','mark','clear'],false],[[],true]]){
    const browser=tab({blocked});
    const current=boot(browser,{query:'project=fictional-project&welcome=1',storageAccessorBlocked});
    assert.equal(current.hasWelcome(),true);assert.equal(browser.entries.size,0);
    current.show('team');assert.equal(current.hasWelcome(),false);
    current.show('overview');assert.equal(current.hasWelcome(),true);
    current.pageShow(true);assert.equal(current.hasWelcome(),true);
    await current.click();assert.equal(current.hasWelcome(),false);assert.equal(current.workspace.hidden,true);
  }
  const browser=tab({blocked:['clear']}),current=boot(browser,{query:'project=fictional-project&welcome=1'});
  await current.click();assert.equal(current.hasWelcome(),false);
  assert.equal(browser.entries.get(storageKey(scope)),'pending','simulated denied clear leaves storage unchanged');
  current.pageShow(true);assert.equal(current.hasWelcome(),false,'a denied clear must not undo the in-memory dismissal on restore');
});
