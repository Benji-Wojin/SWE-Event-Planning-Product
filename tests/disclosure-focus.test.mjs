import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const filterSource=source.slice(source.indexOf('  function hiddenByClosedDisclosure('),source.indexOf('  function skipToContent('));
const restoreSource=source.slice(source.indexOf('  function restoreFocus('),source.indexOf('  function saveLock('));
function element(tag,extra={}){
  return {tagName:tag,parentElement:null,children:[],tabIndex:0,disabled:false,hidden:false,inert:false,isConnected:true,dataset:{},textContent:'',
    matches(selector){return selector===':disabled'?this.disabled:['INPUT','SELECT','TEXTAREA'].includes(this.tagName);},
    getClientRects(){return this.noRects?[]:[{}];},
    closest(){for(let el=this;el;el=el.parentElement)if(el.hidden||el.inert)return el;return null;},
    contains(other){for(let el=other;el;el=el.parentElement)if(el===this)return true;return false;},
    focus(){this.focused=true;},...extra};
}
function append(parent,...children){for(const child of children){parent.children.push(child);child.parentElement=parent;}return parent;}
function fixture(){
  const root=element('SECTION'),close=element('BUTTON'),details=element('DETAILS',{open:false}),summary=element('SUMMARY'),input=element('INPUT');
  append(root,close,details);append(details,summary,input);
  const controls=[close,summary,input],document={getElementById:()=>null,contains:el=>root.contains(el)};
  const ctx=vm.createContext({$$:()=>controls,document});
  vm.runInContext(filterSource+restoreSource+'globalThis.controls=focusable;globalThis.restore=restoreFocus;',ctx);
  return {root,close,details,summary,input,controls,ctx};
}

test('collapsed details content is excluded even when it has layout rectangles; visible summary stays reachable',()=>{
  const f=fixture();assert.equal(f.input.getClientRects().length,1);
  assert.deepEqual([...f.ctx.controls(f.root)],[f.close,f.summary]);
  f.details.open=true;assert.deepEqual([...f.ctx.controls(f.root)],[f.close,f.summary,f.input]);
  f.details.open=false;assert.deepEqual([...f.ctx.controls(f.root)],[f.close,f.summary]);
});

test('nested closed disclosures keep only summaries visible through every ancestor',()=>{
  const f=fixture(),inner=element('DETAILS',{open:false}),innerSummary=element('SUMMARY'),innerInput=element('INPUT'),insideSummary=element('BUTTON');
  append(f.details,inner);append(inner,innerSummary,innerInput);append(f.summary,insideSummary);
  f.controls.push(innerSummary,innerInput,insideSummary);
  assert.deepEqual([...f.ctx.controls(f.root)],[f.close,f.summary,insideSummary]);
  f.details.open=true;assert.deepEqual([...f.ctx.controls(f.root)],[f.close,f.summary,f.input,innerSummary,insideSummary]);
  inner.open=true;assert.equal(f.ctx.controls(f.root).includes(innerInput),true);
  const noSummary=element('DETAILS',{open:false}),content=element('INPUT');append(f.root,noSummary);append(noSummary,content);f.controls.push(content);
  assert.equal(f.ctx.controls(f.root).includes(content),false);
});

test('only the first direct summary escapes a closed disclosure and existing disabled/hidden/inert rules remain',()=>{
  const f=fixture(),second=element('SUMMARY');append(f.details,second);f.controls.push(second);
  assert.equal(f.ctx.controls(f.root).includes(second),false);
  for(const prop of ['disabled','hidden','inert','noRects']){f.close[prop]=true;assert.equal(f.ctx.controls(f.root).includes(f.close),false);f.close[prop]=false;}
  f.close.tabIndex=-1;assert.equal(f.ctx.controls(f.root).includes(f.close),false);
});

test('dialog entry chooses a visible field or close control, never a collapsed field',()=>{
  const f=fixture(),backdrop={hidden:true,dataset:{},classList:{add(){}}},shell={inert:false},ui={};
  f.close.matches=()=>false;
  const dialog={className:'',innerHTML:'',focus(){throw Error('Visible close control should be used');}};
  Object.assign(f.ctx,{ui,document:{activeElement:{},body:{style:{}}},tour:{close(){}},h:String,icon:()=>'',requestAnimationFrame:fn=>fn(),$:selector=>({'#sidebar':{classList:{contains:()=>false}},'#dialogBackdrop':backdrop,'#dialog':dialog,'#appShell':shell})[selector]});
  const start=source.indexOf('  function openDialog('),end=source.indexOf('  function closeDialog(',start);
  vm.runInContext(source.slice(start,end)+'openDialog("Task","body");',f.ctx);
  assert.equal(f.close.focused,true);assert.notEqual(f.input.focused,true);
  f.details.open=true;f.close.focused=false;backdrop.hidden=true;
  vm.runInContext('openDialog("Task","body");',f.ctx);assert.equal(f.input.focused,true);assert.equal(f.close.focused,false);
});

test('assignment review and linked task details start on the heading rather than an editable field',()=>{
  const f=fixture(),backdrop={hidden:true,dataset:{},classList:{add(){}}},ui={};
  f.details.open=true;
  const dialog={className:'',innerHTML:'',scrollTop:420};
  const heading={focus(options){this.options=options;}};
  Object.assign(f.ctx,{ui,document:{activeElement:{},body:{style:{}}},tour:{close(){}},h:String,icon:()=>'',requestAnimationFrame:fn=>fn(),
    $:selector=>({'#sidebar':{classList:{contains:()=>false}},'#dialogBackdrop':backdrop,'#dialog':dialog,'#appShell':{},'#dialogTitle':heading})[selector]});
  const start=source.indexOf('  function openDialog('),end=source.indexOf('  function closeDialog(',start);
  vm.runInContext(source.slice(start,end)+'openDialog("Accept assignments","body","",false,"acceptance");',f.ctx);
  assert.equal(heading.tabIndex,-1);assert.equal(heading.options.preventScroll,true);assert.equal(dialog.scrollTop,0);
  assert.notEqual(f.input.focused,true);
  heading.tabIndex=0;heading.options=null;dialog.scrollTop=420;
  vm.runInContext('openDialog("Task from receipt","body","",false,"task",true);',f.ctx);
  assert.equal(heading.tabIndex,-1);assert.equal(heading.options.preventScroll,true);assert.equal(dialog.scrollTop,0);
  assert.notEqual(f.input.focused,true);
});

test('Tab and Shift+Tab from the programmatically focused dialog heading stay in the dialog',()=>{
  let active,handler,prevented;
  const heading={},first={focus(){active=first;}},last={focus(){active=last;}};
  const dialog={id:'dialog',contains:el=>[dialog,heading,first,last].includes(el)};
  const ctx=vm.createContext({document:{get activeElement(){return active;},addEventListener(_type,fn){handler=fn;}},
    $:selector=>({'#dialogBackdrop':{hidden:false},'#dialog':dialog,'#dialogTitle':heading})[selector],
    focusable:()=>[first,last]});
  const start=source.indexOf("  document.addEventListener('keydown'"),end=source.indexOf("  $('#mobileMenu').addEventListener",start);
  vm.runInContext(source.slice(start,end),ctx);
  for(const [shiftKey,target] of [[false,first],[true,last]]){
    active=heading;prevented=false;
    handler({key:'Tab',shiftKey,preventDefault(){prevented=true;}});
    assert.equal(active,target);assert.equal(prevented,true);
  }
});

test('restoration refuses a connected field hidden by collapse but can restore its summary',()=>{
  const f=fixture();assert.equal(f.ctx.restore(f.input,f.root),false);assert.notEqual(f.input.focused,true);
  assert.equal(f.ctx.restore(f.summary,f.root),true);assert.equal(f.summary.focused,true);
  f.details.open=true;assert.equal(f.ctx.restore(f.input,f.root),true);assert.equal(f.input.focused,true);
});

function taskListFixture(){
  const body=element('BODY'),root=element('DIV',{id:'viewRoot'}),rows=element('TBODY',{id:'taskRows'});
  const document={
    body,activeElement:body,contains:el=>body.contains(el),
    getElementById:id=>walk(body).find(el=>el.id===id)||null,
  };
  function walk(parent){return parent.children.flatMap(child=>[child,...walk(child)]);}
  function matches(el,selector){
    if(selector.includes(','))return selector.split(',').some(part=>matches(el,part.trim()));
    if(selector.includes(' ')){
      const [ancestor,child]=selector.split(/\s+/);
      return matches(el,child)&&Boolean(el.closest(ancestor));
    }
    const base=/^[^\[]*/.exec(selector)[0];
    if(base.startsWith('#')&&el.id!==base.slice(1))return false;
    if(base.startsWith('.')&&!el.classes?.includes(base.slice(1)))return false;
    if(base&&!base.startsWith('#')&&!base.startsWith('.')&&base.toUpperCase()!==el.tagName)return false;
    return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,key,value])=>{
      const actual=key==='tabindex'?el.tabIndex:key.startsWith('data-')?el.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:el.attributes?.[key];
      return value===undefined?actual!==undefined:String(actual)===value;
    });
  }
  function make(tag,props={}){
    return element(tag,{...props,closest(selector){
      if(selector==='[hidden],[inert]'){
        for(let node=this;node;node=node.parentElement)if(node.hidden||node.inert)return node;
        return null;
      }
      for(let node=this;node;node=node.parentElement)if(matches(node,selector))return node;
      return null;
    },focus(options){document.activeElement=this;this.focusOptions=options;}});
  }
  function button(taskFocus,id='same',action='task',textContent='Open task'){
    return make('BUTTON',{dataset:{taskFocus,id,action},textContent});
  }
  const $=(selector,scope=body)=>walk(scope===document?body:scope).find(el=>matches(el,selector))||null;
  const $$=(selector,scope=body)=>walk(scope===document?body:scope).filter(el=>matches(el,selector));
  const inspect=button('inspect'),name=button('name'),owner=button('owner'),other=button('inspect','other');
  const outside=button('inspect'),search=make('INPUT',{id:'taskSearch'}),heading=make('H1',{textContent:'Tasks'});
  const filter=(id,active)=>make('BUTTON',{classes:['filter-tab'],dataset:{action:'task-filter',filter:id},attributes:{'aria-pressed':String(active)}});
  const inactive=filter('all',false),active=filter('mine',true);
  append(body,root);
  append(root,outside,append(make('DIV',{hidden:true,inert:true}),make('H1',{textContent:'Overview'})),heading,search,inactive,active,rows);
  append(rows,inspect,name,owner,other);
  const ui={view:'tasks',taskView:'list'};
  const ctx=vm.createContext({$, $$,document,ui,window:{}});
  vm.runInContext(filterSource+restoreSource+
    'globalThis.restore=restoreFocus;globalThis.restoreView=restoreViewFocus;',ctx);
  return {button,inspect,name,owner,other,outside,search,heading,inactive,active,document,root,rows,body,ui,ctx};
}

test('a rebuilt task row keeps its exact focused affordance despite changed text',()=>{
  const f=taskListFixture();
  const previous=f.button('inspect','same','task','View old title');
  previous.isConnected=false;
  f.inspect.textContent='View new title';
  assert.equal(f.ctx.restore(previous,f.root),true);
  assert.equal(f.document.activeElement,f.inspect);
  assert.equal(f.inspect.focusOptions.preventScroll,true);
  assert.notEqual(f.document.activeElement,f.outside);
  f.document.activeElement=f.body;
  const previousOwner=f.button('owner','same','task','Assigned to Jacquie');
  previousOwner.isConnected=false;
  f.owner.textContent='Assigned to Maya';
  f.ctx.restoreView(previousOwner,f.root);
  assert.equal(f.document.activeElement,f.owner);
});

test('a passive update does not move focus onto a newly available mutation',()=>{
  const f=taskListFixture();
  const previous=f.button('owner','same','task','Assigned to Maya');
  previous.isConnected=false;
  f.owner.dataset.action='claim';
  f.owner.textContent='Claim task';
  assert.equal(f.ctx.restore(previous,f.root),false);
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.name);
});

test('completion and reopening are distinct task-row focus targets even with the same action',()=>{
  const f=taskListFixture();
  const previous=f.button('complete','same','toggle-task','Complete the task');
  previous.isConnected=false;
  f.inspect.dataset.action='toggle-task';
  f.inspect.dataset.taskFocus='reopen';
  f.inspect.textContent='Reopen the task';
  assert.equal(f.ctx.restore(previous,f.root),false);
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.name,'a background completion never focuses Reopen');
  f.document.activeElement=f.body;
  f.inspect.dataset.taskFocus='complete';
  f.inspect.textContent='Complete the renamed task';
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.inspect,'a title-only edit can keep focus on Complete');
});

test('task row focus falls back to its name, then the active view filter, then heading',()=>{
  const f=taskListFixture();
  const previous=f.button('links');
  previous.isConnected=false;
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.name,'removed link button falls back to the same task');
  f.name.disabled=true;
  f.document.activeElement=f.body;
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.active,'skip a disabled name and inactive view filter');
  f.rows.children=[f.other];
  f.document.activeElement=f.body;
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.active,'a filtered-out task does not jump to another row');
  f.active.hidden=true;
  f.document.activeElement=f.body;
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.heading,'skip both the hidden filter and the retained hidden Overview heading');
  assert.equal(f.heading.tabIndex,-1);
});

test('row fallback does not steal focus or run outside the Tasks view',()=>{
  const f=taskListFixture();
  const previous=f.button('links');
  previous.isConnected=false;
  f.document.activeElement=f.search;
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.search);
  f.document.activeElement=f.body;
  f.ctx.restoreView(f.inspect,f.root);
  assert.equal(f.document.activeElement,f.body,'a connected element was not replaced');
  f.ui.view='overview';
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.body);
  f.ui.view='tasks';f.ui.taskView='map';
  f.ctx.restoreView(previous,f.root);
  assert.equal(f.document.activeElement,f.body);
});
