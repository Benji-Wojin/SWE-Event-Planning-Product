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

test('restoration refuses a connected field hidden by collapse but can restore its summary',()=>{
  const f=fixture();assert.equal(f.ctx.restore(f.input,f.root),false);assert.notEqual(f.input.focused,true);
  assert.equal(f.ctx.restore(f.summary,f.root),true);assert.equal(f.summary.focused,true);
  f.details.open=true;assert.equal(f.ctx.restore(f.input,f.root),true);assert.equal(f.input.focused,true);
});
