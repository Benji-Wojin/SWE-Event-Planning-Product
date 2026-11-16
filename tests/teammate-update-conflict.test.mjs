import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

let app;
before(()=>{execFileSync(process.execPath,['scripts/prepare.mjs']);app=readFileSync('public/gather-assets/app.js','utf8');});
const id='fictional-task',actor='fictional-assignee',project='fictional-project';
const note='Fictional update: the venue confirmed a later pickup.';
const proposedDate='2027-01-03';
const openingTask={id,owner:actor,title:'Fictional venue pickup',status:'progress',revision:7,dueDate:'2027-01-02',
  reportedAt:'',verifiedAt:'',recoveryRequests:[],handoffs:[]};
const error=(status,message='Fictional transport result')=>Object.assign(new Error(message),{status});

function fragment(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`Missing source block: ${start}`);
  return app.slice(a,b);
}

test('pending workspace notice defers to the inline draft check without hiding the rest of the stale state',()=>{
  const status={hidden:true},inline={},body={prepend:node=>notices.push(node)},notices=[],calls=[];
  const backdrop={hidden:false};let inlineActive=true;
  const context=vm.createContext({ui:{dialogKind:'task',detailId:'fictional-task'},
    $:selector=>({'#workspaceSyncNotice':status,'#responseForm [data-teammate-update-conflict]':inlineActive?inline:null,
      '#dialogBackdrop':backdrop,'.dialog-body':body}[selector]||null),
    document:{createElement:()=>({setAttribute(){}})},store:{getState:()=>({tasks:[]})},
    paintTimelineScheduleStatus:value=>calls.push(['schedule',value]),paintTaskAcceptanceRefresh:()=>calls.push('acceptance'),
    paintCompletionReviewRefresh:()=>calls.push('completion'),rememberNewerSchedule:(_snapshot,revision)=>calls.push(['revision',revision]),
    canRefreshActivityReview:()=>false,
  });
  vm.runInContext(fragment('  function showPendingUpdate(','  function showRecoveryWriteConflict('),context);
  context.showPendingUpdate(23);
  assert.equal(status.hidden,false);
  assert.deepEqual(calls,[['revision',23],['schedule',true],'acceptance','completion']);
  assert.deepEqual(notices,[]);
  inlineActive=false;
  context.showPendingUpdate();
  assert.equal(notices.length,1);
  assert.match(notices[0].innerHTML,/Reload &amp; discard edits/);
});

function fixture({response='date',hosted=true,demo=false}={}){
  let revision=21,liveTask={...openingTask},generation=1,staleFloor=0,dialogVersion=0,zone='America/Los_Angeles';
  const ui={actor,view:'tasks',dialogKind:'task',detailId:id,pendingSave:false};
  const window=hosted?{GatherMode:{projectId:project,demo},GatherIdentity:{role:'member'}}:{};
  const calls=[],reads=[],writes=[],frames=[];
  const listeners={};
  const document={hidden:false,activeElement:null,body:{},addEventListener(name,fn){listeners[name]=fn;}};
  const state=()=>({event:{timeZone:zone},tasks:liveTask?[liveTask]:[],demoGeneration:generation});
  const nodes=new Map();
  function element(name,dataset={}){
    const attributes=new Map();
    const box={name,dataset,isConnected:true,hidden:false,disabled:false,textContent:'',children:[],classList:{contains:()=>false},
      focus(){document.activeElement=this;calls.push(['focus',name]);},scrollIntoView(){},
      closest(selector){if(selector==='#dialog')return dialog;if(selector==='form')return form;return null;},
      getClientRects:()=>[{}],matches(selector){return selector===':disabled'&&this.disabled;},
      setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),removeAttribute:key=>attributes.delete(key),
      append(...items){this.children.push(...items);},prepend(...items){this.children.unshift(...items);},replaceChildren(...items){this.children=items;},
      remove(){this.isConnected=false;},querySelector(selector){return $(selector,this);},
    };
    Object.defineProperty(box,'innerHTML',{get(){return this.html||'';},set(value){
      this.html=value;this.children=[...value.matchAll(/<(p|button)(\s[^>]+)>(.*?)<\/\1>/gs)].map(([,tag,raw,content])=>{
        const child=element(tag);child.textContent=content;
        for(const [,key,val=''] of raw.matchAll(/\b([a-z][\w-]*)(?:="([^"]*)")?/gi)){
          if(key.startsWith('data-'))child.dataset[dataName(key.slice(5))]=val;
          else if(['type','id'].includes(key))child[key]=val;
          else if(['hidden','disabled'].includes(key))child[key]=true;
          else child.setAttribute(key,val);
        }
        return child;
      });
    }});
    return box;
  }
  document.createElement=tag=>element(tag);
  const dialog={children:[],contains:e=>[title,form,sibling,...form.children,...form.children.flatMap(node=>node.children)].includes(e)},
    backdrop={hidden:false};
  let title=element('Task dialogue heading'),submit,form;
  function input(name,value='',original=''){
    return {...element(name),value,defaultValue:original,name,tagName:'INPUT',type:'text',validity:{badInput:false}};
  }
  function makeForm(selected=response,body=note,date=proposedDate){
    const controls={response:{...input('response',selected,'progress'),tagName:'SELECT',
      options:['progress','blocked','help','date','completed'].map(value=>({value,defaultSelected:value==='progress'}))},
      note:{...input('note',body),tagName:'TEXTAREA'},proposedDate:input('proposedDate',date)};
    controls.namedItem=name=>controls[name];
    return {...element(`Task update form ${dialogVersion}`,{id,revision:String(liveTask?.revision),workspaceRevision:String(revision),responseMode:selected}),
      id:'responseForm',elements:controls,summaries:[]};
  }
  const sibling={...element('Unsaved comment'),id:'commentForm',elements:{note:input('comment')},dirty:false};
  form=makeForm();submit={...element('Save update'),type:'submit'};document.activeElement=submit;
  function treeItems(root){return (root?.children||[]).flatMap(item=>[item,...treeItems(item)]);}
  function dataName(raw){return raw.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());}
  function $(selector,root){
    if(selector==='#dialog')return dialog;
    if(selector==='#dialogTitle')return title;
    if(selector==='#dialogBackdrop')return backdrop;
    if(selector==='#responseForm')return form;
    if(selector==='#commentForm')return sibling;
    if(selector==='button[type="submit"]')return submit;
    if(selector==='.form-error')return null;
    if(selector==='[data-proposed-date]')return nodes.get(selector)||nodes.set(selector,{hidden:form.elements.response.value!=='date'}).get(selector);
    const data=selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if(data)return treeItems(root||form).find(element=>element.isConnected&&Object.hasOwn(element.dataset,dataName(data[1]))&&
      (data[2]===undefined||element.dataset[dataName(data[1])]===data[2]))||null;
    if(selector.startsWith('#'))return treeItems(root||form).find(element=>element.isConnected&&element.id===selector.slice(1))||null;
    return null;
  }
  function $$(selector,root){
    if(selector==='form'||selector==='#dialog form')return [form,sibling];
    if(selector.includes('input')&&root?.elements)return Object.values(root.elements).filter(item=>item&&typeof item==='object');
    return [];
  }
  function replaceForm(preserve=false){
    const prior=form.elements;
    form.isConnected=false;submit.isConnected=false;title.isConnected=false;dialogVersion++;
    title=element('Replaced task dialogue heading');
    form=preserve?makeForm(prior.response.value,prior.note.value,prior.proposedDate.value):makeForm('progress','','');
    submit={...element('Save update'),type:'submit'};
  }
  const store={getState:state,getSnapshotRevision:()=>hosted?revision:undefined,
    refresh(canApply,options){
      return new Promise((resolve,reject)=>reads.push({options,canApply,reject,
        finish({next=22,task={...liveTask},gen=generation,nextZone=zone,result={verified:true,changed:true}}={}){
          if(!result.verified||result.pending){resolve(result);return;}
          const accepted=canApply(next,{event:{timeZone:nextZone},demoGeneration:gen,tasks:task?[task]:[]});
          if(accepted){revision=next;liveTask=task;generation=gen;zone=nextZone;}
          resolve(accepted?result:{pending:true,newerRevision:next});
        },
      }));
    },
  };
  for(const op of ['updateTask','requestRecovery','acceptTask','addComment'])store[op]=(...args)=>
    new Promise((resolve,reject)=>writes.push({op,args:structuredClone(args),revision,reject,
      finish(task={...liveTask,revision:liveTask.revision+1}){revision++;liveTask=task;resolve(task);},
    }));
  const context=vm.createContext({window,ui,document,store,$,$$,h:String,
    isOrganizer:()=>false,hiddenByClosedDisclosure:()=>false,
    hasUnsavedFields:root=>root===sibling?sibling.dirty:root===dialog?sibling.dirty:false,
    workspaceUpdatesPending:()=>false,scheduleRevisionIsStale:rev=>rev<staleFloor,recoveryConflictPending:()=>false,
    dateKey:()=> '2026-11-17',
    rememberNewerSchedule(_snapshot,rev){if(Number.isSafeInteger(rev))staleFloor=Math.max(staleFloor,rev);},
    showPendingUpdate:()=>calls.push(['pending']),showRecoveryWriteConflict:rev=>calls.push(['conflict',rev]),
    syncTaskResponseMode:()=>true,completionDraftHasEdits:()=>false,protectCompletionDraft:()=>true,
    recovery:{syncResponse:()=>{},},
    render:()=>calls.push(['render']),taskDialog(...args){calls.push(['dialog',...args]);replaceForm(args[1]!=='responseForm'&&!args[2]);},
    focusTaskRecovery:taskId=>calls.push(['focus request',taskId]),focusTaskDialogControl:element=>element?.focus(),
    focusScheduleTarget:element=>element?.focus(),toast:message=>calls.push(['toast',message]),
    formError:(target,result)=>calls.push(['error',target?.id,result.message]),requestAnimationFrame:fn=>frames.push(fn),
    copyText:async text=>{calls.push(['copy',text]);return true;},copyFallback:()=>assert.fail('copy succeeds in this fixture'),
    FormData:class {constructor(target){return Object.entries(target.elements).filter(([,input])=>typeof input?.value==='string').map(([name,input])=>[name,input.value]);}},
    queueMicrotask,AbortSignal,
    saveLock(){ui.pendingSave=true;return ()=>{ui.pendingSave=false;};},
  });
  vm.runInContext('const teammateUpdateConflicts=new WeakMap();\n'+
    fragment('  function isLiveTeammate(','  function syncTeammateWelcome(')+
    fragment('  const teammateUpdateTypes=','  async function refreshCompletionDraft(')+
    fragment("  document.addEventListener('click',async event=>{","    if(action==='return-to-completion-linked-impact')")+'});\n'+
    fragment("  document.addEventListener('submit',async event=>{","  document.addEventListener('change',"),context);
  return {context,calls,reads,writes,ui,window,document,store,sibling,backdrop,listeners,
    get form(){return form;},get submitButton(){return submit;},get revision(){return revision;},
    get task(){return liveTask;},set task(value){liveTask=value;},
    get draft(){return {response:form.elements.response.value,note:form.elements.note.value,proposedDate:form.elements.proposedDate.value};},
    replaceForm,flush(){for(const frame of frames.splice(0))frame();},find:$,
    submit(){return listeners.submit({target:form,submitter:submit,preventDefault(){}});},
    click(button){assert.ok(button);return listeners.click({target:{closest:()=>button},preventDefault(){}});},
    get check(){return $('[data-action="refresh-teammate-update"]',form);},
    get copy(){return $('[data-action="copy-teammate-update"]',form);},
    get status(){return $('[data-teammate-update-status]',form)?.textContent;},
  };
}

async function conflict(f){
  const pending=f.submit();assert.equal(f.writes.length,1);
  f.writes[0].reject(error(409));await pending;
  assert.match(f.status,/wasn’t saved.*draft is still here/i);
}

test('a rejected date proposal keeps the exact draft, checks latest read-only, and retries only on explicit Save',async()=>{
  const f=fixture(),original=f.form;
  await conflict(f);
  assert.deepEqual(f.writes[0].args,[id,{kind:'date',note,proposedDate},actor]);assert.equal(f.writes[0].revision,21);
  assert.deepEqual(f.draft,{response:'date',note,proposedDate});assert.equal(f.form,original);
  assert.equal(f.document.activeElement,f.check);assert.equal(f.submitButton.getAttribute('aria-disabled'),'true');
  await f.submit();assert.equal(f.writes.length,1);assert.equal(f.reads.length,0);
  await f.click({...f.check});assert.equal(f.reads.length,0,'forged controls do not start reads');
  await f.click(f.copy);
  assert.deepEqual(f.calls.find(([action])=>action==='copy'),['copy',`Propose a new date\nProposed date: ${proposedDate}\n${note}`]);
  const check=f.click(f.check);assert.equal(f.reads.length,1);assert.deepEqual({...f.reads[0].options},{requireFresh:true});
  await f.click(f.check);assert.equal(f.reads.length,1,'an already in-flight read is not repeated');
  f.reads[0].finish();await check;f.flush();
  assert.equal(f.writes.length,1);assert.equal(f.revision,22);assert.equal(f.task.revision,7);assert.notEqual(f.form,original);
  assert.deepEqual(f.draft,{response:'date',note,proposedDate});assert.equal(f.check,null);
  assert.ok(f.form.children.some(child=>/hasn’t been sent/.test(child.textContent)));
  const retry=f.submit();assert.equal(f.writes.length,2);
  assert.deepEqual(f.writes[1].args,f.writes[0].args);assert.equal(f.writes[1].revision,22);
  f.writes[1].finish();await retry;
  assert.ok(f.calls.some(([action,message])=>action==='toast'&&/Request saved/.test(message)));
});

test('a checked revision cannot replace changed ownership, completion, task details, or a date interpreted in a new zone',async()=>{
  for(const [change,latest,status] of [
    ['same workspace revision',{next:21},/revision couldn’t be confirmed/],
    ['owner',{task:{...openingTask,owner:'another-fictional-teammate',revision:8}},/no longer assigned/],
    ['completion',{task:{...openingTask,reportedAt:'2026-11-18T17:00:00Z',revision:8}},/completion report/],
    ['completed',{task:{...openingTask,status:'done',revision:8}},/complete/],
    ['edited task',{task:{...openingTask,revision:8,title:'Another pickup'}},/task itself changed/],
    ['archive',{task:{...openingTask,archivedAt:'2026-11-18',revision:8}},/no longer available/],
    ['missing',{task:null},/no longer available/],
    ['event zone',{nextZone:'America/New_York'},/proposed date needs a fresh review/],
  ]){
    const f=fixture(),initial=f.form;await conflict(f);
    const pending=f.click(f.check);f.reads[0].finish(latest);await pending;
    assert.match(f.status,status,change);assert.equal(f.form,initial,change);assert.equal(f.revision,21,change);
    assert.deepEqual(f.draft,{response:'date',note,proposedDate},change);
    await f.submit();assert.equal(f.writes.length,1,change);
    assert.equal(f.calls.filter(([action])=>action==='dialog').length,0,change);
  }
});

test('dirty sibling edits pause the read and prevent late adoption without losing either draft',async()=>{
  const f=fixture({response:'progress'}),form=f.form;await conflict(f);
  f.sibling.dirty=true;f.sibling.elements.note.value='Fictional comment still unsent';
  await f.click(f.check);assert.equal(f.reads.length,0);assert.match(f.status,/other task edits/);
  f.sibling.dirty=false;
  const pending=f.click(f.check);assert.equal(f.reads.length,1);
  f.sibling.dirty=true;f.reads[0].finish();await pending;
  assert.match(f.status,/other task edits/);assert.equal(f.form,form);assert.equal(f.revision,21);
  assert.equal(f.draft.note,note);assert.equal(f.sibling.elements.note.value,'Fictional comment still unsent');assert.equal(f.writes.length,1);
});

test('a closed or changed modal, ownership scope, or selected update type guards late refresh and preserves draft',async()=>{
  for(const variant of ['replacement','hidden','view','actor','access','response']){
    const f=fixture();await conflict(f);
    const pending=f.click(f.check),form=f.form;
    if(variant==='replacement')f.replaceForm();
    if(variant==='hidden')f.document.hidden=true;
    if(variant==='view')f.ui.view='overview';
    if(variant==='actor')f.ui.actor='other-fictional-teammate';
    if(variant==='access')f.window.GatherAccessLost=true;
    if(variant==='response')form.elements.response.value='help';
    f.reads[0].finish();await pending;f.flush();
    assert.equal(f.revision,21,variant);assert.equal(f.writes.length,1,variant);
    assert.equal(f.calls.filter(([action])=>action==='dialog').length,0,variant);
    assert.equal(form.elements.note.value,note,variant);
  }
});

test('uncertain and unrelated failures never claim that the update was definitively rejected',async()=>{
  for(const status of [undefined,408,429,500,400]){
    const f=fixture({response:'blocked'}),pending=f.submit();
    assert.equal(f.writes.length,1);f.writes[0].reject(error(status));await pending;
    assert.equal(f.status,undefined);assert.equal(f.reads.length,0);assert.equal(f.draft.note,note);
    assert.ok(f.calls.some(([action])=>action==='error'));
  }
});
