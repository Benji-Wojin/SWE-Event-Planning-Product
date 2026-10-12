import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import '../legacy/navigation.js';

function surface(url) {
  const location=new URL(url), listeners=new Map(), writes=[];
  const win={location,history:{state:{framework:'preserve'},replaceState(state,_title,hash){writes.push({state,hash});location.hash=hash;}},
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
  assert.ok(html.indexOf('/gather-assets/navigation.js')<html.indexOf('/gather-assets/hosted-store.js'));
  assert.ok(html.includes('<script src="/gather-assets/navigation.js"></script>'));
  assert.match(app,/ui.pendingSave\)\{navigation.replace\(ui.view\)/);
  assert.match(app,/!confirmDiscard\(\$\('#dialog'\),\$\('#emailReviewForm'\)\)\)\{navigation.replace\(ui.view\)/);
});
test('restored pages keep dirty dialogs and in-flight saves never close the form',()=>{
  const app=readFileSync('legacy/app.js','utf8');
  const source=app.slice(app.indexOf('  const routeChanged='),app.indexOf('  let unsubscribeNavigation='));
  const ui={view:'info',pendingSave:false},calls=[];
  const context={ui,navigation:{replace:view=>calls.push(['replace',view])},$:()=>({hidden:false}),
    confirmDiscard:()=>{calls.push(['confirm']);return false;},closeDialog:()=>calls.push(['close']),navigate:view=>calls.push(['navigate',view])};
  const changed=vm.runInNewContext(source+'\nrouteChanged;',context);
  changed('info');assert.deepEqual(calls,[],'BFCache returning to the same section must preserve the form');
  ui.pendingSave=true;changed('tasks');assert.deepEqual(calls,[['replace','info']]);
  ui.pendingSave=false;calls.length=0;changed('tasks');assert.deepEqual(calls,[['confirm'],['replace','info']]);
  calls.length=0;context.confirmDiscard=()=>true;changed('tasks');assert.deepEqual(calls,[['close'],['navigate','tasks']]);
});
