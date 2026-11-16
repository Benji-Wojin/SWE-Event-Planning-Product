import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import '../legacy/navigation.js';

function surface(url) {
  const location=new URL(url), listeners=new Map(), writes=[];
  const win={location,history:{state:{framework:'preserve'},replaceState(state,_title,hash){writes.push({state,hash});location.href=new URL(hash,location).href;}},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    change(hash){location.hash=hash;for(const fn of listeners.get('hashchange')||[])fn();},writes};
  win.parent=win;return win;
}
function pair(path='/project?project=test#info',hash='#overview') {
  const host=surface('https://weft.example'+path),frame=surface('https://weft.example/workspace.html?project=test'+hash);
  frame.parent=host;return{host,frame,nav:GatherNavigation.create(frame)};
}
test('project and demo links open address-bar section before frame defaults',()=>{
  assert.equal(pair().nav.initial(),'info');
  assert.equal(pair('/demo?as=maya#timeline','#tasks').nav.initial(),'timeline');
  assert.equal(pair('/demo?as=maya','#tasks').nav.initial(),'tasks');
  assert.equal(pair('/project?project=test&message=test','#inbox').nav.initial(),'inbox');
  assert.equal(pair('/project#constructor','#overview').nav.initial(),'overview');
});
test('navigation updates both visible URL and frame without losing query or framework history state',()=>{
  const {nav,host,frame}=pair();nav.replace('timeline');
  assert.equal(host.location.href,'https://weft.example/project?project=test#timeline');
  assert.equal(frame.location.hash,'#timeline');
  assert.equal(host.writes[0].state,host.history.state);
  nav.replace('timeline');assert.equal(host.writes.length,1);
  nav.replace('__proto__');assert.equal(host.location.hash,'#overview');
});

test('day links only carry project and a valid date; the frame keeps the selected day after reload',()=>{
  const host=surface('https://weft.example/project?project=school&message=retain#timeline');
  const frame=surface('https://weft.example/workspace.html?project=school&message=retain');
  frame.parent=host;
  const nav=GatherNavigation.create(frame);
  nav.replaceScheduleDate('2028-02-29');
  assert.equal(host.location.href,'https://weft.example/project?project=school&message=retain&day=2028-02-29#timeline');
  assert.equal(nav.initialScheduleDate(),'2028-02-29');
  assert.equal(host.writes[0].state,host.history.state);
  assert.equal(GatherNavigation.scheduleLink(host.location.origin,'school','2028-02-29'),'https://weft.example/project?project=school&day=2028-02-29');
  nav.replaceScheduleDate('2028-02-30');
  assert.equal(nav.initialScheduleDate(),'2028-02-29');
  nav.replaceScheduleDate('');
  assert.equal(nav.initialScheduleDate(),'');
  assert.equal(host.location.href,'https://weft.example/project?project=school&message=retain#timeline');
  for(const invalid of ['2028-02-30','0000-01-01','2028-2-01','not-a-date']){
    assert.equal(GatherNavigation.scheduleLink(host.location.origin,'school',invalid),'');
  }
  const direct=surface('https://weft.example/workspace.html?project=school&day=2028-02-29');
  assert.equal(GatherNavigation.create(direct).initial(),'timeline');
  direct.location.search='?project=school&day=2028-02-29&day=2028-03-01';
  assert.equal(GatherNavigation.create(direct).initial(),'overview');
  const demo=surface('https://weft.example/workspace.html?demo=1&as=maya#timeline');
  GatherNavigation.create(demo).replaceScheduleDate('2028-02-29');
  assert.equal(demo.writes.length,0);
});
test('a receipt hint is consumed once without erasing project, guide or schedule date',()=>{
  const host=surface('https://weft.example/project?project=school&guide=1&day=2028-02-29&task=task-current&review=completion#timeline');
  const frame=surface('https://weft.example/workspace.html?project=school&guide=1&day=2028-02-29&task=task-current&review=completion#tasks');
  frame.parent=host;
  const nav=GatherNavigation.create(frame);
  assert.deepEqual(nav.takeInitialTaskLink(),{id:'task-current',review:'completion'});
  assert.deepEqual(nav.takeInitialTaskLink(),{id:'',review:''});
  assert.equal(host.location.href,'https://weft.example/project?project=school&guide=1&day=2028-02-29#timeline');
  assert.equal(frame.location.href,'https://weft.example/workspace.html?project=school&guide=1&day=2028-02-29#tasks');
  assert.equal(host.writes.length,1);assert.equal(frame.writes.length,1);
  assert.equal(host.writes[0].state,host.history.state);assert.equal(frame.writes[0].state,frame.history.state);
  assert.equal(nav.initialScheduleDate(),'2028-02-29');
});
test('review hints need a single valid task, a supported kind and a non-demo workspace',()=>{
  for(const [query,id,review] of [
    ['task=current','current',''],['task=current&review=amendment','current','amendment'],
    ['task=current&review=owner','current','owner'],['task=current&review=owner&review=owner','current',''],
    ['task=current&review=schedule','current','schedule'],['task=current&review=schedule&review=owner','current',''],
    ['task=current&review=completion&review=completion','current',''],['task=current&review=','current',''],
    ['task=current&review=help','current',''],['task=current&review=%22%3E','current',''],
    ['task=first&task=second&review=completion','',''],['task=%22%3E&review=completion','',''],
    ['task=&review=completion','',''],['review=completion','',''],
    ['demo=1&as=jack&task=current&review=amendment','current',''],
    ['demo=1&as=jack&task=current&review=owner','current',''],
    ['demo=1&as=jack&task=current&review=schedule','current',''],
  ]){
    const host=surface('https://weft.example/project?project=school&'+query+'#timeline');
    const frame=surface('https://weft.example/workspace.html?project=school&'+query+'#tasks');
    frame.parent=host;
    const nav=GatherNavigation.create(frame);
    assert.deepEqual(nav.takeInitialTaskLink(),{id,review},query);
    assert.deepEqual(nav.takeInitialTaskLink(),{id:'',review:''},query);
    for(const win of [host,frame]){
      assert.equal(win.location.searchParams.has('task'),false,query);
      assert.equal(win.location.searchParams.has('review'),false,query);
      assert.equal(win.location.searchParams.get('project'),'school',query);
      assert.equal(win.writes.length,1,query);
    }
  }
});
test('a planner editor origin is consumed with the task and review on the frame and visible URL',()=>{
  for(const review of ['owner','schedule','completion','amendment']){
    const query=`?project=school&guide=1&task=task-current&review=${review}&from=plan-receipt&unrelated=keep`;
    const host=surface('https://weft.example/project'+query+'#timeline');
    const frame=surface('https://weft.example/workspace.html'+query+'#tasks');
    frame.parent=host;
    const nav=GatherNavigation.create(frame);
    assert.equal(nav.takeInitialActivityLink(),'');
    assert.deepEqual(nav.takeInitialTaskLink(),{id:'task-current',review,fromPlanReceipt:true});
    assert.deepEqual(nav.takeInitialTaskLink(),{id:'',review:''});
    for(const win of [host,frame]){
      assert.equal(win.location.search,'?project=school&guide=1&unrelated=keep');
      assert.equal(win.writes.length,1);
      assert.equal(win.writes[0].state,win.history.state);
    }
  }
});
test('a planner origin needs one valid live project, task and editor review, without competing hints',()=>{
  for(const query of [
    'task=current&review=owner&from=plan-receipt',
    'project=&task=current&review=owner&from=plan-receipt',
    'project=school&project=other&task=current&review=owner&from=plan-receipt',
    'project=school&task=current&review=owner&from=plan-receipt&from=plan-receipt',
    'project=school&task=current&review=owner&from=not-plan-receipt',
    'project=school&task=current&review=owner&review=owner&from=plan-receipt',
    'project=school&task=current&task=other&review=owner&from=plan-receipt',
    'project=school&task=%22%3E&review=owner&from=plan-receipt',
    'project=school&task=current&review=help&from=plan-receipt',
    'project=school&task=current&from=plan-receipt',
    ...['completion','amendment','schedule'].flatMap(review=>
      ['demo=0&demo=1','day=','activity=other','welcome=1','message=other'].map(hint=>
        `project=school&task=current&review=${review}&from=plan-receipt&${hint}`)),
  ]){
    const params=new URLSearchParams(query);
    assert.equal(Object.hasOwn(GatherNavigation.taskLinkFrom(params),'fromPlanReceipt'),false,query);
    const frame=surface('https://weft.example/workspace.html?'+query);
    const nav=GatherNavigation.create(frame);
    assert.equal(nav.takeInitialActivityLink(),'',query);
    const result=nav.takeInitialTaskLink();
    assert.equal(Object.hasOwn(result,'fromPlanReceipt'),false,query);
    assert.deepEqual(frame.location.searchParams.getAll('from'),params.getAll('from').includes('plan-receipt')?[]:params.getAll('from'),query);
  }
});
test('a standalone stale planner marker is consumed without changing an unrelated parent',()=>{
  const query='?project=school&guide=1&from=plan-receipt';
  const frame=surface('https://weft.example/workspace.html'+query);
  const parent=surface('https://weft.example/other'+query);
  frame.parent=parent;
  assert.deepEqual(GatherNavigation.create(frame).takeInitialTaskLink(),{id:'',review:''});
  assert.equal(frame.location.search,'?project=school&guide=1');
  assert.equal(parent.writes.length,0);
});
test('a plan activity hint is one-shot, preserves the project, guide and explicit day, and never changes unrelated parents',()=>{
  const query='?project=school&activity=task-overnight&guide=1&day=2028-02-29';
  const host=surface('https://weft.example/project'+query+'#tasks');
  const frame=surface('https://weft.example/workspace.html'+query+'#timeline');
  frame.parent=host;
  const nav=GatherNavigation.create(frame);
  assert.equal(nav.takeInitialActivityLink(),'task-overnight');
  assert.equal(nav.takeInitialActivityLink(),'');
  for(const win of [host,frame]){
    assert.equal(win.writes.length,1);
    assert.equal(win.writes[0].state,win.history.state);
    assert.equal(win.location.search,'?project=school&guide=1&day=2028-02-29');
  }
  const unrelated=surface('https://weft.example/other'+query);
  const standalone=surface('https://weft.example/workspace.html'+query);
  standalone.parent=unrelated;
  assert.equal(GatherNavigation.create(standalone).takeInitialActivityLink(),'task-overnight');
  assert.equal(unrelated.writes.length,0);
});
test('activity hints require one exact live project and cannot replace task, review, or message links',()=>{
  for(const query of [
    'activity=valid','project=&activity=valid','project=school&project=other&activity=valid',
    'project=school&activity=first&activity=second','project=school&activity=%22%3E','project=school&activity=',
    'project=school&activity=valid&demo=1','project=school&activity=valid&task=another',
    'project=school&activity=valid&review=','project=school&activity=valid&message=another',
  ]){
    assert.equal(GatherNavigation.activityLinkFrom(new URLSearchParams(query)),'',query);
    const win=surface('https://weft.example/workspace.html?'+query);
    const nav=GatherNavigation.create(win);
    assert.equal(nav.takeInitialActivityLink(),'',query);
    assert.equal(win.location.searchParams.has('activity'),false,query);
    for(const key of ['task','review','message'])
      assert.deepEqual(win.location.searchParams.getAll(key),new URLSearchParams(query).getAll(key),query);
  }
});
test('hash changes in either surface reach existing guards, rejection restores both and disposal removes listeners',()=>{
  const {nav,host,frame}=pair();let calls=0;
  const unsubscribe=nav.subscribe(view=>{calls++;assert.ok(['tasks','timeline'].includes(view));nav.replace('info');});
  host.change('#tasks');assert.equal(host.location.hash,'#info');assert.equal(frame.location.hash,'#info');
  frame.change('#timeline');assert.equal(host.location.hash,'#info');assert.equal(frame.location.hash,'#info');
  unsubscribe();host.change('#tasks');frame.change('#timeline');assert.equal(calls,2);
});
test('standalone, unrelated and cross-origin embeds never change their parent',()=>{
  for(const path of ['https://weft.example/other#info','https://other.example/project#info']){
    const frame=surface('https://weft.example/workspace.html#tasks'),parent=surface(path);frame.parent=parent;
    const nav=GatherNavigation.create(frame);assert.equal(nav.initial(),'tasks');nav.replace('timeline');assert.equal(parent.writes.length,0);
  }
  const frame=surface('https://weft.example/workspace.html#tasks');
  Object.defineProperty(frame,'parent',{get(){throw new Error('SecurityError');}});
  const nav=GatherNavigation.create(frame);assert.equal(nav.initial(),'tasks');nav.replace('info');assert.equal(frame.location.hash,'#info');
});
test('hosted build loads navigation before the workspace and retains dirty-form guards',()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const html=readFileSync('public/workspace.html','utf8'),app=readFileSync('public/gather-assets/app.js','utf8');
  assert.ok(html.indexOf('-navigation.js')<html.indexOf('-hosted-store.js'));
  assert.match(html, /<script defer src="\/gather-assets\/versioned\/[a-f0-9]{20}-navigation.js"><\/script>/);
  assert.match(app,/ui.pendingSave\)\{navigation.replace\(ui.view\)/);
  assert.match(app,/!confirmCloseDialog\(\)\|\|!confirmDiscard\(\$\('#emailReviewForm'\)\)\)\{navigation.replace\(ui.view\)/);
});

test('the hosted owner form retains the planner return only after a successful shared save',async()=>{
  const app=readFileSync('public/gather-assets/app.js','utf8');
  const start=app.indexOf("      if(form.id==='taskDetailForm'){\n        const before="),end=app.indexOf("      if(form.id==='priorityForm')",start);
  assert.ok(start>=0&&end>start,'use the prepared hosted submission branch');
  const body=app.slice(start,end);
  assert.match(body,/await store\.updateTask\(/);
  const id='exact-task';
  const fixture=({scoped=true,draft=false}={})=>{
    const form={id:'taskDetailForm',dataset:{id}},frames=[],calls=[],document={activeElement:null};
    const link=scoped?{id}:null,ui={detailId:id,planReceiptReturn:link},details={id,status:'todo'};
    const back={isConnected:true,focus(options){assert.equal(options.preventScroll,true);calls.push('back focus');document.activeElement=back;}},title={},decoy={};
    const dialog={};
    const controls={'#dialog':dialog,'#planReceiptBack':back,'#dialogTitle':title};
    let success,fail;
    const savePromise=new Promise((resolve,reject)=>{success=resolve;fail=reject;});
    const run=vm.runInNewContext(`(async()=>{${body}})`,{form,ui,document,data:{owner:'teammate'},
      store:{getState:()=>({tasks:[details]}),updateTask(...args){calls.push(['save',...args]);return savePromise;}},
      protectCompletionDraft:()=>true,confirmFixedDate:()=>true,confirmTaskOwnerChange:()=>true,
      taskDrafts:()=>draft?[{}]:[],taskCompletionDraftContext:()=>[],activePlanReceiptReturn:key=>key===id?link:null,
      render(){calls.push('render');},taskDialog(...args){calls.push(['dialog',...args]);if(args[3])frames.push(()=>{document.activeElement=title;});},closeDialog(){calls.push('close');},
      returnToRelatedBatch:()=>false,returnToEventTaskReview:()=>false,requestAnimationFrame:fn=>frames.push(fn),
      $:selector=>controls[selector],toast:()=>{},member:()=>({name:'Organizer'}),window:{},
    });
    return {run,success,fail,frames,calls,document,title,decoy,controls};
  };
  for(const options of [{},{draft:true},{scoped:false}]){
    const f=fixture(options),saving=f.run();
    assert.equal(f.calls.length,1,'wait for the actual task save before rendering or focusing');
    f.success();await saving;
    const scoped=options.scoped!==false,focusBack=scoped&&!options.draft;
    const redraw=scoped||options.draft?['dialog',id,'taskDetailForm',...(focusBack?[true,true]:[])]:null;
    assert.deepEqual(f.calls.slice(1),['render',redraw||'close']);
    assert.equal(f.frames.length,focusBack?2:0);
    f.frames.forEach(fn=>fn());
    assert.equal(f.calls.includes('back focus'),focusBack);
  }
  for(const change of [f=>{f.document.activeElement=f.decoy;},f=>{f.controls['#dialogTitle']={};},f=>{f.controls['#planReceiptBack']={};}]){
    const moved=fixture(),saving=moved.run();moved.success();await saving;
    moved.frames[0]();change(moved);moved.frames[1]();
    assert.equal(moved.calls.includes('back focus'),false,'never steal moved focus or focus a replaced dialog');
  }
  const failed=fixture(),rejected=failed.run();failed.fail(new Error('fictional failure'));
  await assert.rejects(rejected,/fictional failure/);
  assert.equal(failed.calls.length,1);assert.equal(failed.frames.length,0);
});

function drawerFixture(){
  const app=readFileSync('legacy/app.js','utf8');
  const source=app.slice(app.indexOf('  function setDrawer('),app.indexOf('  function openDialog('));
  let active, mobile=true;
  const elements={},focus=[],listeners={};
  function element(id,options={}) {
    const classes=new Set();
    return {id,hidden:false,attributes:{},
      classList:{contains:value=>classes.has(value),toggle(value,on){on?classes.add(value):classes.delete(value);}},
      setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
      toggleAttribute(key,on){on?this.attributes[key]='':delete this.attributes[key];},
      contains:el=>el===elements['#sidebar']||el?.inDrawer,
      closest(){return this.hidden||this.inert?this:null;},matches:()=>false,getClientRects(){return this.hidden?[]:[{}];},
      querySelector:()=>elements['#currentNav'],
      addEventListener(type,callback){listeners[`${id}:${type}`]=callback;},
      focus(){active=this;focus.push(this.id);},...options,
    };
  }
  for(const id of ['sidebar','mobileOverlay','mobileMenu','mobileDrawerClose','mainContent','dialogBackdrop','currentNav','otherNav','workspaceSkipLink']) {
    elements['#'+id]=element(id,{hidden:id==='dialogBackdrop',inDrawer:['mobileDrawerClose','currentNav','otherNav'].includes(id)});
  }
  const document={body:{style:{}},get activeElement(){return active;},addEventListener(type,callback){listeners[`document:${type}`]=callback;}};
  let tourClosed=0;
  const bindingStart=app.indexOf("  document.addEventListener('keydown',event=>{"),bindingEnd=app.indexOf('  const routeChanged=',bindingStart);
  assert.ok(bindingStart>=0&&bindingEnd>bindingStart);
  const bound=app.slice(bindingStart,bindingEnd);
  const setDrawer=vm.runInNewContext(source+'\n'+bound+'\nsetDrawer;',{document,ui:{view:'tasks'},
    $:id=>elements[id]??(id.includes('skip')?elements['#workspaceSkipLink']:id.includes('data-view')||id.includes('aria-current')?elements['#currentNav']:null),
    $$:()=>[elements['#currentNav'],elements['#otherNav']],matchMedia:()=>({matches:mobile,addEventListener(type,callback){listeners[`viewport:${type}`]=callback;}}),
    tour:{close(options){assert.equal(options.restoreFocus,false);tourClosed++;}}});
  return {app,document,elements,setDrawer,focus,listeners,get tourClosed(){return tourClosed;},
    set mobile(value){mobile=value;},set active(value){active=elements['#'+value]??document.body;},get active(){return active;},
  };
}

test('mobile drawer focuses its container and keeps the Close control inside the active focus boundary',()=>{
  const f=drawerFixture(),{app,document,elements,setDrawer}=f;
  f.active='mobileMenu';setDrawer(true);
  assert.equal(f.tourClosed,1);
  assert.equal(f.active,elements['#sidebar']);assert.equal(elements['#sidebar'].attributes.role,'dialog');
  assert.equal(elements['#sidebar'].attributes['aria-modal'],'true');
  assert.equal(elements['#mobileMenu'].attributes['aria-expanded'],'true');
  assert.equal(elements['#mainContent'].inert,true);assert.equal(elements['#sidebar'].inert,false);
  assert.equal(elements['#workspaceSkipLink'].inert,true);
  assert.equal(elements['#mobileDrawerClose'].hidden,false);
  f.active='mobileDrawerClose';setDrawer(false);
  assert.equal(f.active,elements['#mobileMenu']);assert.equal(elements['#sidebar'].inert,true);
  assert.equal(elements['#mainContent'].inert,false);assert.equal(elements['#workspaceSkipLink'].inert,false);
  assert.equal(elements['#mobileDrawerClose'].hidden,true);assert.equal(document.body.style.overflow,'');
  assert.equal(elements['#mobileMenu'].attributes['aria-expanded'],'false');
  f.mobile=false;setDrawer(false);assert.equal(elements['#sidebar'].inert,false);
  assert.equal(f.tourClosed,1,'closing or desktop resize does not dismiss an unrelated tour');
  assert.match(readFileSync('legacy/index.html','utf8'),/id="sidebar"[^>]+tabindex="-1"/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/:focus-visible\{outline:3px solid/);
  assert.match(css,/\.sidebar\[tabindex="-1"\]:focus\{outline:none\}/);
  assert.match(app,/event.shiftKey&&document.activeElement===first/);
  assert.match(app,/!event.shiftKey&&document.activeElement===last/);
});

test('resize never leaves focus in navigation controls hidden by the new viewport',()=>{
  for(const origin of ['mobileDrawerClose','mobileOverlay','sidebar','body','otherNav']){
    const f=drawerFixture(),{document,elements,setDrawer}=f;
    f.active='mobileMenu';setDrawer(true);
    f.active=origin;f.focus.length=0;f.mobile=false;f.listeners['viewport:change']();
    assert.equal(f.active,elements[origin==='otherNav'?'#otherNav':'#currentNav'],origin);
    assert.deepEqual(f.focus,origin==='otherNav'?[]:['currentNav'],origin);
    assert.equal(elements['#sidebar'].inert,false);assert.equal(elements['#mainContent'].inert,false);
    assert.equal(elements['#workspaceSkipLink'].inert,false);assert.equal(elements['#mobileDrawerClose'].hidden,true);
    assert.equal(elements['#sidebar'].attributes.role,undefined);assert.equal(elements['#sidebar'].attributes['aria-modal'],undefined);
    assert.equal(document.body.style.overflow,'');
  }
  const f=drawerFixture();
  f.mobile=false;f.setDrawer(false);
  f.active='otherNav';f.focus.length=0;f.mobile=true;f.listeners['viewport:change']();
  assert.equal(f.active,f.elements['#mobileMenu']);
  assert.deepEqual(f.focus,['mobileMenu']);
  assert.equal(f.elements['#sidebar'].inert,true);
  assert.equal(f.elements['#mobileDrawerClose'].hidden,true);
});

test('Close, overlay click, and Escape dismiss the mobile navigation and all restore the menu',()=>{
  for(const [origin,close] of [['mobileDrawerClose',f=>f.listeners['mobileDrawerClose:click']()],
    ['mobileOverlay',f=>f.listeners['mobileOverlay:click']()],
    ['currentNav',f=>f.listeners['document:keydown']({key:'Escape',preventDefault(){}})]]){
    const f=drawerFixture();
    f.active='mobileMenu';f.listeners['mobileMenu:click']();
    assert.equal(f.active,f.elements['#sidebar']);
    f.active=origin;f.focus.length=0;close(f);
    assert.deepEqual(f.focus,['mobileMenu'],origin);
    assert.equal(f.elements['#sidebar'].classList.contains('open'),false);
    assert.equal(f.elements['#mobileOverlay'].classList.contains('open'),false);
    assert.equal(f.elements['#mobileDrawerClose'].hidden,true);
  }
});

test('both local and hosted markup expose a native drawer Close while the overlay stays pointer-only',()=>{
  for(const filename of ['legacy/index.html','public/workspace.html']){
    const html=readFileSync(filename,'utf8');
    const sidebar=html.match(/<aside\b[^>]*id="sidebar"[^>]*>[\s\S]*?<\/aside>/)?.[0]||'';
    const close=sidebar.match(/<button\b[^>]*id="mobileDrawerClose"[^>]*>[\s\S]*?<\/button>/)?.[0]||'';
    assert.match(close,/type="button"/);
    assert.match(close,/hidden/);
    assert.match(close,/aria-label="Close navigation"|>Close(?: navigation)?</);
    const overlay=html.match(/<div\b[^>]*id="mobileOverlay"[^>]*>/)?.[0]||'';
    assert.match(overlay,/aria-hidden="true"/);
    assert.doesNotMatch(overlay,/tabindex|role=/i);
    assert.equal((html.match(/\bid="mobileDrawerClose"/g)||[]).length,1);
  }
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/\.sidebar-close\{display:none\}/);
  const closeRule=css.match(/\.sidebar\.open \.sidebar-close\{[^}]*44px[^}]*\}/)?.[0]||'';
  assert.match(closeRule,/(?:min-)?width:\s*44px/);
  assert.match(closeRule,/(?:min-)?height:\s*44px/);
});

test('drawer view activation focuses the new content only after successful navigation and retains dismissal behavior',()=>{
  const app=readFileSync('legacy/app.js','utf8');
  const segment=(start,end)=>{const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return app.slice(a,b);};
  const source=segment('  function navigate(', '  function confirmTaskOwnerChange(')+
    segment('  function navigateFromViewControl(', "  document.addEventListener('click'");
  for(const variant of ['drawer','desktop','same view','denied by draft','sidebar veto','hosted save pending']){
    const events=[],drawerOpen=variant!=='desktop';
    let open=drawerOpen;
    const sidebar={classList:{contains:name=>name==='open'&&open},contains:el=>el===control&&drawerOpen};
    const view=variant==='same view'?'overview':'tasks';
    const control={dataset:{view},closest:selector=>selector==='#sidebar.open'&&open?sidebar:null};
    const ui={view:'overview',pendingSave:variant==='hosted save pending'};
    const context=vm.createContext({ui,labels:{overview:'Overview',tasks:'Tasks'},control,taskLinkUnavailable:false,privateEpoch:0,guideViewReady:'',
      $:selector=>selector==='#dialogBackdrop'?{hidden:true}:selector==='#sidebar'?sidebar:null,
      matchMedia:()=>({matches:drawerOpen}),planSidebar:{canLeave:()=>variant!=='sidebar veto'},
      confirmCloseDialog:()=>true,confirmDiscard:()=>variant!=='denied by draft',
      recordGuideViewClick:value=>events.push(['record',value]),navigation:{replace:value=>events.push(['replace',value])},
      setDrawer(next,{restoreFocus=true}={}){open=next;events.push(['drawer',next,restoreFocus]);},
      render:()=>events.push(['render',ui.view]),window:{scrollTo:()=>events.push(['scroll'])},
      skipToContent(){assert.equal(open,false);assert.equal(ui.view,'tasks');events.push(['focus content']);},
    });
    vm.runInContext(source+'\nnavigateFromViewControl(control);',context);
    const expected={
      drawer:[['record','tasks'],['replace','tasks'],['drawer',false,false],['render','tasks'],['scroll'],['focus content']],
      desktop:[['record','tasks'],['replace','tasks'],['drawer',false,true],['render','tasks'],['scroll']],
      'same view':[['drawer',false,true]],'denied by draft':[],
      'sidebar veto':[['record','tasks'],['replace','overview']],
      'hosted save pending':[['record','tasks'],['replace','overview']],
    }[variant];
    assert.deepEqual(events,expected,variant);
    if(['denied by draft','sidebar veto','hosted save pending'].includes(variant))assert.equal(open,true,'declined navigation keeps the drawer and its focused control');
  }
});
test('restored pages keep dirty dialogs and in-flight saves never close the form',()=>{
  const app=readFileSync('legacy/app.js','utf8');
  const source=app.slice(app.indexOf('  const routeChanged='),app.indexOf('  let unsubscribeNavigation='));
  const ui={view:'info',pendingSave:false},calls=[];
  const context={ui,navigation:{replace:view=>calls.push(['replace',view])},$:()=>({hidden:false}),
    confirmCloseDialog:()=>{calls.push(['confirm']);return false;},confirmDiscard:()=>true,closeDialog:()=>calls.push(['close']),navigate:view=>calls.push(['navigate',view])};
  const changed=vm.runInNewContext(source+'\nrouteChanged;',context);
  changed('info');assert.deepEqual(calls,[],'BFCache returning to the same section must preserve the form');
  ui.pendingSave=true;changed('tasks');assert.deepEqual(calls,[['replace','info']]);
  ui.pendingSave=false;calls.length=0;changed('tasks');assert.deepEqual(calls,[['confirm'],['replace','info']]);
  calls.length=0;context.confirmCloseDialog=()=>true;changed('tasks');assert.deepEqual(calls,[['close'],['navigate','tasks']]);
});

test('drawer Tab trap handles initial container focus in both directions and both boundaries',()=>{
  const app=readFileSync('legacy/app.js','utf8');
  const source=app.slice(app.indexOf("  document.addEventListener('keydown',event=>{"),app.indexOf("  $('#mobileMenu').addEventListener"));
  let handler,active,prevented=0;
  const first={focus(){active=first;}},last={focus(){active=last;}};
  const sidebar={classList:{contains:()=>true},contains:el=>[sidebar,first,last].includes(el),focus(){active=sidebar;}};
  let controls=[first,last];
  const document={addEventListener(_type,fn){handler=fn;},get activeElement(){return active;}};
  vm.runInNewContext(source,{document,$:id=>id==='#dialogBackdrop'?{hidden:true}:sidebar,
    matchMedia:()=>({matches:true}),focusable:()=>controls,ui:{}});
  const tab=shiftKey=>{prevented=0;handler({key:'Tab',shiftKey,preventDefault(){prevented++;}});};
  active=sidebar;tab(false);assert.equal(active,first);assert.equal(prevented,1);
  active=sidebar;tab(true);assert.equal(active,last);assert.equal(prevented,1);
  active=first;tab(true);assert.equal(active,last);assert.equal(prevented,1);
  active=last;tab(false);assert.equal(active,first);assert.equal(prevented,1);
  active={};tab(true);assert.equal(active,last);assert.equal(prevented,1);
  controls=[];active=sidebar;tab(false);assert.equal(active,sidebar);assert.equal(prevented,1);
});
