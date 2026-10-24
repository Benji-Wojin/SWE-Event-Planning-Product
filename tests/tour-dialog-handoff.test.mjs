import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function fixture(){
  let box,remembered=0,restored=0,removed=0,disconnected=0;
  const listeners={},original={isConnected:true,focus(){restored++;}};
  const target={getBoundingClientRect:()=>({left:20,top:70,bottom:100,width:200}),closest:()=>null,classList:{add(){},remove(){}}};
  const document={activeElement:original,body:{append(el){box=el;}},querySelectorAll(selector){return selector==='.tour-highlight'?[]:[target];},addEventListener(event,fn){listeners[event]=fn;},createElement(){return {style:{},offsetHeight:240,setAttribute(){},innerHTML:'',querySelector:()=>({focus(){}}),remove(){removed++;}};}};
  const context=vm.createContext({document,window:{innerWidth:390,innerHeight:844,addEventListener(){}},localStorage:{getItem:()=>null,setItem(){remembered++;}},ResizeObserver:class{observe(){}disconnect(){disconnected++;}}});
  vm.runInContext(readFileSync('legacy/planning-ui.js','utf8'),context);
  return {tour:context.GatherPlanningUI.createTour({navigate:()=>true,isOrganizer:()=>true,storageKey:'fictional'}),listeners,document,get box(){return box;},stats:()=>({remembered,restored,removed,disconnected})};
}

test('closing a dormant tour never marks it seen or steals focus',()=>{
  const f=fixture();f.tour.close({restoreFocus:false});f.tour.close();
  assert.deepEqual(f.stats(),{remembered:0,restored:0,removed:0,disconnected:0});
});

test('handoff dismisses the active tour without restoring background focus and releases Escape',()=>{
  const f=fixture();f.tour.start();assert.match(f.box.innerHTML,/Welcome to Weft/);
  f.tour.close({restoreFocus:false});
  assert.equal(f.stats().removed,1);assert.equal(f.stats().restored,0);assert(f.stats().disconnected>0);
  let intercepted=0;f.listeners.keydown({key:'Escape',preventDefault(){intercepted++;},stopImmediatePropagation(){intercepted++;}});
  assert.equal(intercepted,0,'the modal Escape handler must be allowed to run');
  const before=f.stats();f.tour.close();assert.deepEqual(f.stats(),before,'dismissal is idempotent');
});

test('normal skip and Escape retain opener focus restoration; a dismissed tour can be reopened',()=>{
  const f=fixture();f.tour.start();f.tour.close();assert.equal(f.stats().restored,1);
  f.tour.start();assert.match(f.box.innerHTML,/QUICK TOUR · 1/);
  let prevented=0;f.listeners.keydown({key:'Escape',preventDefault(){prevented++;},stopImmediatePropagation(){prevented++;}});
  assert.equal(prevented,2);assert.equal(f.stats().restored,2);assert.equal(f.stats().removed,2);
});

test('shared dialog handoff preserves its opener and applies modal focus after dismissing the tour',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf('  function openDialog(');
  const fragment=source.slice(start,source.indexOf('  function closeDialog(',start));
  const actions=[],opener={},body={style:{}},elements={
    '#sidebar':{classList:{contains:()=>false}},'#dialogBackdrop':{hidden:true,dataset:{},classList:{add(){actions.push('show');}}},
    '#dialog':{innerHTML:'',className:''},'#appShell':{inert:false},
  },ui={};
  const context=vm.createContext({document:{activeElement:opener,body},$:(id)=>elements[id],ui,h:s=>s,icon:()=>'',setDrawer(){throw Error('No drawer open');},
    tour:{close(options){assert.equal(options.restoreFocus,false);assert.equal(ui.lastFocus,opener);actions.push('tour-dismiss');}},
    focusable:()=>[{matches:()=>true,focus(){actions.push('modal-focus');}}],requestAnimationFrame(fn){fn();}});
  vm.runInContext(fragment+'openDialog("Add task","form","",false,"task");',context);
  assert.deepEqual(actions,['tour-dismiss','show','modal-focus']);assert.equal(ui.lastFocus,opener);assert.equal(elements['#appShell'].inert,true);
});

test('Ask Weft dismisses the tour only after existing permissions and discard checks pass',()=>{
  const source=readFileSync('legacy/app.js','utf8'),start=source.indexOf("      if(action==='ai-task-assistant'");
  const fragment=source.slice(start,source.indexOf('\n',start));let allowed=true,discard=true;const calls=[];
  const context=vm.createContext({action:'ai-task-assistant',canCreateTasks:()=>allowed,window:{GatherMode:{}},confirmDiscard:()=>discard,
    $:()=>({hidden:true}),closeDialog(){throw Error('No dialog open');},tour:{close(options){assert.equal(options.restoreFocus,false);calls.push('tour-dismiss');}},agentPopup:{open(){calls.push('assistant-open');}}});
  const run=()=>vm.runInContext('(function(){'+fragment+'})();',context);
  allowed=false;run();assert.deepEqual(calls,[]);allowed=true;discard=false;run();assert.deepEqual(calls,[]);
  discard=true;run();assert.deepEqual(calls,['tour-dismiss','assistant-open']);
});
