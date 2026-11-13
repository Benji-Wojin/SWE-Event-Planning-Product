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

test('mobile drawer focuses its container, traps Tab, and restores the opener without removing link focus styles',()=>{
  const app=readFileSync('legacy/app.js','utf8');
  const source=app.slice(app.indexOf('  function setDrawer('),app.indexOf('  function openDialog('));
  let active, mobile=true;
  const elements={};
  for(const id of ['sidebar','mobileOverlay','mobileMenu','mainContent','dialogBackdrop']) {
    const classes=new Set();
    elements['#'+id]={id,hidden:id==='dialogBackdrop',attributes:{},
      classList:{contains:value=>classes.has(value),toggle(value,on){on?classes.add(value):classes.delete(value);}},
      setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
      toggleAttribute(key,on){on?this.attributes[key]='':delete this.attributes[key];},
      contains:el=>el===elements['#sidebar']||el?.inDrawer,
      focus(){active=this;},
    };
  }
  const document={body:{style:{}},get activeElement(){return active;}};
  let tourClosed=0;
  const setDrawer=vm.runInNewContext(source+'\nsetDrawer;',{document,$:id=>elements[id],matchMedia:()=>({matches:mobile}),tour:{close(options){assert.equal(options.restoreFocus,false);tourClosed++;}}});
  active=elements['#mobileMenu'];setDrawer(true);
  assert.equal(tourClosed,1);
  assert.equal(active,elements['#sidebar']);assert.equal(elements['#sidebar'].attributes.role,'dialog');
  assert.equal(elements['#mainContent'].inert,true);assert.equal(elements['#sidebar'].inert,false);
  setDrawer(false);assert.equal(active,elements['#mobileMenu']);assert.equal(elements['#sidebar'].inert,true);
  assert.equal(elements['#mainContent'].inert,false);assert.equal(document.body.style.overflow,'');
  mobile=false;setDrawer(false);assert.equal(elements['#sidebar'].inert,false);
  assert.equal(tourClosed,1,'closing or desktop resize does not dismiss an unrelated tour');
  assert.match(readFileSync('legacy/index.html','utf8'),/id="sidebar"[^>]+tabindex="-1"/);
  const css=readFileSync('legacy/styles.css','utf8');
  assert.match(css,/:focus-visible\{outline:3px solid/);
  assert.match(css,/\.sidebar\[tabindex="-1"\]:focus\{outline:none\}/);
  assert.match(app,/event.shiftKey&&document.activeElement===first/);
  assert.match(app,/!event.shiftKey&&document.activeElement===last/);
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
