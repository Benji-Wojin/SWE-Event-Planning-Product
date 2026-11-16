import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

let app;
before(()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  app=readFileSync('public/gather-assets/app.js','utf8');
});
const id='fictional-task',requestId='fictional-request',actor='fictional-organizer',project='fictional-project';
const assignee='fictional-assignee',newOwner='fictional-new-owner';
const dueDate='2027-01-03',reviewAfter='2026-12-31',note='Fictional decision: the venue confirmed a new pickup day.';
const request={id:requestId,kind:'date',status:'pending',createdBy:assignee,originalOwner:assignee,
  originalDueDate:'2027-01-02',proposedDate:dueDate,createdAt:'2026-12-01T08:00:00Z',note:'Fictional original proposal'};
const task={id,revision:7,owner:assignee,status:'progress',dueDate:request.originalDueDate,hardDeadline:true,
  title:'Fictional venue pickup',scope:'Fictional opening outcome',reportedAt:'',verifiedAt:'',requiresVerification:true,recoveryRequests:[request]};
const members=[{id:actor,active:true},{id:assignee,active:true},{id:newOwner,active:true}];
const fail=(status,message='Fictional transport failure')=>Object.assign(new Error(message),{status});

function fragment(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,`Missing source block: ${start}`);
  return app.slice(a,b);
}

function fixture({action='date',original=requestId,stale=false}={}){
  let revision=21,currentTask=structuredClone(task),currentMembers=structuredClone(members),zone='America/Los_Angeles',
    staleFloor=stale?21:0,organizer=true;
  const ui={actor,view:'overview',dialogKind:'task',detailId:id,pendingSave:false};
  const window={GatherMode:{projectId:project,demo:false},GatherIdentity:{actorId:actor,role:'admin'}};
  const state=()=>({tasks:currentTask?[currentTask]:[],members:currentMembers,event:{timeZone:zone}});
  const calls=[],reads=[],writes=[],frames=[],listeners={};
  const document={hidden:false,activeElement:null,body:{},addEventListener(name,fn){listeners[name]=fn;}};
  const camel=str=>str.replace(/-([a-z])/g,(_,x)=>x.toUpperCase());
  function element(name,dataset={}){
    const attrs=new Map(),el={name,dataset,isConnected:true,hidden:false,disabled:false,children:[],textContent:'',
      classList:{contains:()=>false},prepend(...nodes){this.children.unshift(...nodes);},append(...nodes){this.children.push(...nodes);},
      replaceChildren(...nodes){this.children=nodes;},querySelector(query){return $(query,this);},
      focus(){document.activeElement=this;calls.push(['focus',name]);},scrollIntoView(){},remove(){this.isConnected=false;},
      closest(selector){if(selector==='form'||selector==='#recoveryDecisionForm')return form;if(selector==='#dialog')return dialog;return null;},
      setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),removeAttribute:key=>attrs.delete(key),
      matches(selector){return selector===':disabled'&&this.disabled;},getClientRects:()=>[{}]};
    Object.defineProperty(el,'innerHTML',{get(){return this.html||'';},set(value){
      this.html=value;this.children=[...value.matchAll(/<(p|button)(\s[^>]+)>(.*?)<\/\1>/gs)].map(([,tag,props,content])=>{
        const child=element(tag);child.textContent=content;
        for(const [,key,val=''] of props.matchAll(/\b([a-z][\w-]*)(?:="([^"]*)")?/gi)){
          if(key.startsWith('data-'))child.dataset[camel(key.slice(5))]=val;
          else if(['type','id'].includes(key))child[key]=val;
          else if(['hidden','disabled'].includes(key))child[key]=true;
          else child.setAttribute(key,val);
        }
        return child;
      });
    }});
    return el;
  }
  document.createElement=tag=>element(tag);
  function field(name,value,type='text'){
    return {...element(name),name,value,type,tagName:'INPUT',defaultValue:'',validity:{badInput:false,valid:true},
      reportValidity(){return this.validity.valid;},select(){}};
  }
  function makeForm(draft={action,requestId:original,owner:newOwner,dueDate,reviewAfter,note,
    scope:'Fictional smaller outcome',confirmHardDeadline:true}){
    const controls=Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,field(key,String(value),
      key==='requestId'?'hidden':['dueDate','reviewAfter'].includes(key)?'date':'text')]));
    controls.confirmHardDeadline.type='checkbox';controls.confirmHardDeadline.checked=draft.confirmHardDeadline;
    controls.confirmHardDeadline.value='on';controls.namedItem=name=>controls[name];
    controls.action.options=['date','reassign','scope','checkin'].map(value=>({value}));
    controls.owner.options=['',...currentMembers.map(m=>m.id)].map(value=>({value}));
    for(const [value,names] of [['date',['dueDate','confirmHardDeadline']],['reassign',['owner']],['scope',['scope']]])
      for(const name of names)controls[name].disabled=draft.action!==value;
    controls.requestId.defaultValue=original;
    const {kind,createdBy}=currentTask?.recoveryRequests?.find(item=>item.id===original)||{};
    return {...element('Organizer decision draft',{id,requestId:original,revision:String(currentTask?.revision),workspaceRevision:String(revision),
      requestKind:kind||'',requestAuthor:createdBy||'',decisionZone:zone}),id:'recoveryDecisionForm',elements:controls};
  }
  let form=makeForm(),submit=element('Confirm plan'),title=element('Task heading');
  document.activeElement=submit;
  const sibling={...element('Sibling comment'),id:'commentForm',elements:{text:field('text','')},dirty:false};
  const dialog={contains(el){return [form,sibling,submit,title,...tree(form)].includes(el);}},backdrop={hidden:false};
  const syncNotice={hidden:!stale};
  function tree(el){return (el?.children||[]).flatMap(child=>[child,...tree(child)]);}
  function $(selector,root){
    const exact={'#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,'#recoveryDecisionForm':form,
      '#commentForm':sibling,'button[type="submit"]':submit,'#workspaceSyncNotice':syncNotice};
    if(Object.hasOwn(exact,selector))return exact[selector];
    const data=selector.match(/^\[data-([a-z-]+)(?:="([^"]+)")?\]$/);
    if(data)return tree(root||form).find(item=>item.isConnected&&Object.hasOwn(item.dataset,camel(data[1]))&&
      (data[2]===undefined||item.dataset[camel(data[1])]===data[2]))||null;
    return selector.startsWith('#')?tree(root||form).find(el=>el.isConnected&&el.id===selector.slice(1))||null:null;
  }
  function $$(selector,root){if(selector==='form'||selector==='#dialog form')return [form,sibling];
    return root?.elements?Object.values(root.elements).filter(value=>value?.name):[];}
  const draft=()=>Object.fromEntries(Object.entries(form.elements).filter(([,input])=>typeof input?.value==='string')
    .map(([name,input])=>[name,input.type==='checkbox'?input.checked:input.value]));
  function replaceForm(preserve=false){
    const data=preserve?draft():undefined;
    form.isConnected=submit.isConnected=title.isConnected=false;
    form=makeForm(data);submit=element('Confirm plan');title=element('Fresh task heading');
  }
  const store={getState:state,getSnapshotRevision:()=>revision,
    refresh(canApply,options){return new Promise((resolve,reject)=>reads.push({options,canApply,reject,
      finish({rev=22,nextTask=currentTask,nextMembers=currentMembers,nextZone=zone,
        result={verified:true,changed:true}}={}){
        if(!result.verified||result.pending){resolve(result);return;}
        const accepted=canApply(rev,{tasks:nextTask?[nextTask]:[],members:nextMembers,event:{timeZone:nextZone}});
        if(accepted){revision=rev;currentTask=nextTask;currentMembers=nextMembers;zone=nextZone;}
        resolve(accepted?result:{pending:true,newerRevision:rev});
      },
    }));},
    resolveRecovery(...args){return new Promise((resolve,reject)=>writes.push({args:structuredClone(args),revision,reject,finish(){
      revision++;currentTask={...currentTask,revision:currentTask.revision+1,recoveryRequests:[{...request,status:'resolved'}]};resolve(currentTask);
    }}));},
  };
  const context=vm.createContext({ui,window,document,store,$,$$,h:String,
    isOrganizer:()=>organizer,hiddenByClosedDisclosure:()=>false,
    hasUnsavedFields:root=>root===sibling&&sibling.dirty,
    completionDraftHasEdits:()=>false,protectCompletionDraft:()=>true,
    assignableTaskOwner:member=>!!member&&member.active!==false&&!member.sample,
    GatherPriorities:{pendingRequest:item=>item.recoveryRequests?.find(row=>row.status==='pending')},
    GatherCalendar:{dayKey:(_date,_zone,days)=>days?'2026-12-02':'2026-12-01'},
    dateKey:()=> '2026-12-01',scheduleRevisionIsStale:rev=>rev<=staleFloor,recoveryConflictPending:rev=>rev<=staleFloor,
    workspaceUpdatesPending:()=>!syncNotice.hidden||revision<=staleFloor,
    rememberNewerSchedule(_snapshot,rev){if(Number.isSafeInteger(rev))staleFloor=Math.max(staleFloor,rev-1);},
    showPendingUpdate(){syncNotice.hidden=false;calls.push(['generic stale']);},
    showRecoveryWriteConflict(rev=revision){syncNotice.hidden=false;staleFloor=Math.max(staleFloor,rev);calls.push(['conflict',rev]);},
    toast:message=>calls.push(['toast',message]),formError:(_form,error)=>calls.push(['error',error.message]),
    requestAnimationFrame:fn=>frames.push(fn),queueMicrotask,AbortSignal,
    saveLock(){ui.pendingSave=true;return ()=>{ui.pendingSave=false;};},
    render:()=>calls.push(['render']),taskDialog(...args){calls.push(['dialog',...args]);replaceForm(!args[1]&&!args[2]);},
    focusTaskRecovery:(...args)=>calls.push(['recovery focus',...args]),focusTaskDialogControl:el=>el?.focus(),focusScheduleTarget:el=>el?.focus(),
    copyText:async copy=>{calls.push(['copy',copy]);return true;},
    FormData:class {constructor(target){return Object.entries(target.elements).flatMap(([name,input])=>
      typeof input?.value!=='string'||input.disabled||input.type==='checkbox'&&!input.checked?[]:[[name,input.value]]);}},
  });
  vm.runInContext('const organizerDecisionConflicts=new WeakMap();\n'+
    fragment('  const organizerDecisionActions=','  const teammateUpdateTypes=')+
    fragment("  document.addEventListener('click',async event=>{","    if(action==='return-to-completion-linked-impact')")+'});\n'+
    fragment("  document.addEventListener('submit',async event=>{","  document.addEventListener('change',"),context);
  return {ui,window,document,context,calls,reads,writes,sibling,syncNotice,backdrop,draft,replaceForm,find:$,
    get form(){return form;},get submitButton(){return submit;},get revision(){return revision;},
    set organizer(value){organizer=value;},set task(value){currentTask=value;},set floor(value){staleFloor=value;},
    set revision(value){revision=value;},
    flush(){for(const frame of frames.splice(0))frame();},
    submit(){return listeners.submit({target:form,submitter:submit,preventDefault(){}});},
    click(control){assert.ok(control);return listeners.click({target:{closest:()=>control},preventDefault(){}});},
    get check(){return $('[data-action="refresh-organizer-decision"]',form);},
    get copy(){return $('[data-action="copy-organizer-decision"]',form);},
    get status(){return $('[data-organizer-decision-status]',form)?.textContent;},
  };
}

async function rejected(f){
  const pending=f.submit();assert.equal(f.writes.length,1);
  f.writes[0].reject(fail(409));await pending;
  assert.ok(f.check,'a definitive rejection offers an inline check');
  assert.match(f.status,/draft.*still here|draft.*unchanged/i);
}

test('the actual organizer form stamps the exact pending request and rendered revisions, not a generic decision',()=>{
  const context=vm.createContext({
    GatherPriorities:{pendingRequest:t=>t.recoveryRequests?.find(row=>row.status==='pending'),
      decision:()=>({label:'Fictional check-in'}),suggestion:()=>({text:'Fictional next step',targets:[]})},
    GatherCalendar:{dayKey:()=>reviewAfter},
  });
  vm.runInContext(readFileSync('legacy/recovery-ui.js','utf8'),context);
  const recovery=context.GatherRecoveryUI.create({store:{getState:()=>({event:{timeZone:'America/Los_Angeles'},tasks:[task],members})},
    ui:{actor},h:String,options:()=>'',dayLabel:String,member:id=>({name:id})});
  const markup=recovery.recoveryMarkup(task,true,21);
  assert.match(markup,/<form id="recoveryDecisionForm"[^>]*data-id="fictional-task"[^>]*data-revision="7"[^>]*data-workspace-revision="21"/);
  assert.match(markup,/data-request-kind="date"[^>]*data-request-author="fictional-assignee"[^>]*data-decision-zone="America\/Los_Angeles"/);
  assert.match(markup,/name="requestId" value="fictional-request"/);
  assert.doesNotMatch(recovery.recoveryMarkup(task,true),/data-workspace-revision/);
  const generic=recovery.recoveryMarkup({...task,recoveryRequests:[]},true,21);
  assert.match(generic,/name="requestId" value=""/);
  assert.doesNotMatch(generic,/data-workspace-revision|data-request-author/);
});

test('a rejected organizer date decision is checked by GET only, preserving every field until an explicit retry',async()=>{
  const f=fixture(),opening=f.form,draft=f.draft();await rejected(f);
  assert.equal(f.form,opening);assert.deepEqual(f.draft(),draft);assert.equal(f.writes[0].revision,21);
  assert.deepEqual(f.writes[0].args,[id,{action:'date',requestId,dueDate,reviewAfter,note,confirmHardDeadline:true},actor]);
  assert.equal(f.submitButton.getAttribute('aria-disabled'),'true');assert.equal(f.document.activeElement,f.check);
  await f.submit();assert.equal(f.writes.length,1);
  await f.click({...f.check});assert.equal(f.reads.length,0);
  await f.click(f.copy);
  const copied=f.calls.find(([event])=>event==='copy')?.[1];
  assert.ok(copied?.includes(note));assert.ok(copied?.includes(dueDate));assert.ok(copied?.includes(reviewAfter));
  const checking=f.click(f.check);assert.equal(f.reads.length,1);assert.equal(f.reads[0].options.requireFresh,true);
  await f.click(f.check);assert.equal(f.reads.length,1,'only one check while reading');
  f.reads[0].finish();await checking;f.flush();
  assert.equal(f.writes.length,1);assert.equal(f.revision,22);assert.notEqual(f.form,opening);
  assert.deepEqual(f.draft(),draft);assert.equal(f.check,null);
  assert.ok(f.form.children.some(node=>/hasn’t been sent|hasn’t been saved/i.test(node.textContent)));
  const retry=f.submit();assert.equal(f.writes.length,2);assert.equal(f.writes[1].revision,22);
  assert.deepEqual(f.writes[1].args,f.writes[0].args);
  f.writes[1].finish();await retry;
  assert.ok(f.calls.some(([event,message])=>event==='toast'&&/Organizer response saved/.test(message)));
});

test('a pre-known stale requested decision starts with a read-only check and zero rejected writes',async()=>{
  for(const afterOpening of ['stale notice','known newer revision']){
    const f=fixture({stale:afterOpening==='stale notice'}),opening=f.form,draft=f.draft();
    if(afterOpening==='known newer revision')f.revision=22;
    await f.submit();
    assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);assert.ok(f.check);
    assert.equal(f.form,opening);assert.deepEqual(f.draft(),draft);
    const checking=f.click(f.check);f.reads[0].finish();await checking;
    assert.equal(f.writes.length,0);assert.equal(f.revision,22);assert.deepEqual(f.draft(),draft);
    const sending=f.submit();assert.equal(f.writes.length,1);assert.equal(f.writes[0].revision,22);
    f.writes[0].finish();await sending;
  }
});

test('the organizer cannot reuse an old draft after the exact request, assignee, or task changes',async()=>{
  const changes=[
    ['same workspace',{rev:21}],
    ['task changed',{nextTask:{...task,revision:8,title:'Fictional changed title'}}],
    ['request replaced',{nextTask:{...task,recoveryRequests:[{...request,id:'new-fictional-request'}]}}],
    ['request resolved',{nextTask:{...task,recoveryRequests:[{...request,status:'resolved'}]}}],
    ['request author changed',{nextTask:{...task,recoveryRequests:[{...request,createdBy:'different-teammate'}]}}],
    ['request kind changed',{nextTask:{...task,recoveryRequests:[{...request,kind:'help'}]}}],
    ['completion reported',{nextTask:{...task,reportedAt:'2026-12-02T18:00:00Z'}}],
    ['task done',{nextTask:{...task,status:'done',revision:8}}],
    ['assignee changed',{nextTask:{...task,revision:8,owner:newOwner}}],
    ['archived',{nextTask:{...task,archivedAt:'2026-12-02'}}],
    ['removed',{nextTask:null}],
    ['event time zone changed',{nextZone:'America/New_York'}],
  ];
  for(const [variant,latest] of changes){
    const f=fixture(),draft=f.draft(),opening=f.form;await rejected(f);
    const reading=f.click(f.check);assert.equal(f.reads.length,1,variant);
    f.reads[0].finish(latest);await reading;
    assert.equal(f.revision,21,variant);assert.equal(f.form,opening,variant);assert.deepEqual(f.draft(),draft,variant);
    assert.ok(f.check,variant);await f.submit();assert.equal(f.writes.length,1,variant);
  }
});

test('a check leaves invalid or elapsed dates editable and preserves a corrected draft without sending it',async()=>{
  const f=fixture();await rejected(f);
  f.form.elements.dueDate.validity.badInput=true;
  await f.click(f.check);assert.equal(f.reads.length,0);assert.match(f.status,/Finish editing the decision dates/);
  f.form.elements.dueDate.validity.badInput=false;
  f.form.elements.reviewAfter.value='2026-12-01';
  const earlyCheckIn=f.click(f.check);f.reads.at(-1).finish();await earlyCheckIn;
  assert.match(f.status,/check-in is now too early/);assert.equal(f.draft().reviewAfter,'2026-12-01');assert.equal(f.revision,21);
  f.form.elements.reviewAfter.value=reviewAfter;
  f.form.elements.dueDate.value=task.dueDate;
  const sameDueDate=f.click(f.check);f.reads.at(-1).finish();await sameDueDate;
  assert.match(f.status,/due date needs a fresh review/);assert.equal(f.revision,21);
  f.form.elements.dueDate.value='2027-01-04';
  const corrected=f.click(f.check);f.reads.at(-1).finish();await corrected;
  assert.equal(f.revision,22);assert.equal(f.draft().dueDate,'2027-01-04');assert.equal(f.draft().reviewAfter,reviewAfter);
  assert.equal(f.writes.length,1);
});

test('a reassign draft cannot revive a removed, former, or sample teammate from an old roster',async()=>{
  for(const member of [null,{id:newOwner,active:false},{id:newOwner,active:true,sample:true}]){
    const f=fixture({action:'reassign'}),initial=f.form;await rejected(f);
    const checking=f.click(f.check);
    f.reads[0].finish({nextMembers:[...members.filter(item=>item.id!==newOwner),...(member?[member]:[])]});await checking;
    assert.equal(f.revision,21);assert.equal(f.form,initial);assert.equal(f.draft().owner,newOwner);
    assert.ok(f.check);await f.submit();assert.equal(f.writes.length,1);
  }
});

test('queued sibling edits or a changed modal deny late adoption without dropping the draft',async()=>{
  const f=fixture(),opening=f.form,draft=f.draft();await rejected(f);
  f.sibling.dirty=true;f.sibling.elements.text.value='Fictional unsent linked comment';
  await f.click(f.check);assert.equal(f.reads.length,0);
  f.sibling.dirty=false;
  const pending=f.click(f.check);assert.equal(f.reads.length,1);
  f.sibling.dirty=true;f.reads[0].finish();await pending;
  assert.equal(f.form,opening);assert.equal(f.revision,21);assert.deepEqual(f.draft(),draft);
  assert.equal(f.sibling.elements.text.value,'Fictional unsent linked comment');assert.equal(f.writes.length,1);

  for(const variant of ['different actor','no organizer','hidden','new dialog','changed action','request input changed']){
    const g=fixture();await rejected(g);
    const check=g.click(g.check),old=g.form;
    if(variant==='different actor')g.ui.actor='different-fictional-organizer';
    if(variant==='no organizer')g.organizer=false;
    if(variant==='hidden')g.document.hidden=true;
    if(variant==='new dialog')g.replaceForm();
    if(variant==='changed action')g.form.elements.action.value='scope';
    if(variant==='request input changed')g.form.elements.requestId.value='different-fictional-request';
    g.reads[0].finish();await check;g.flush();
    assert.equal(g.revision,21,variant);assert.equal(g.writes.length,1,variant);assert.equal(old.elements.note.value,note,variant);
  }
});

test('generic resolve and uncertain results do not claim an exact request was definitively rejected',async()=>{
  for(const [status,original] of [[409,''],[undefined,requestId],[408,requestId],[429,requestId],[500,requestId],[400,requestId]]){
    const f=fixture({original}),pending=f.submit();
    assert.equal(f.writes.length,1);f.writes[0].reject(fail(status));await pending;
    assert.equal(f.check,null);assert.equal(f.reads.length,0);assert.equal(f.draft().note,note);
  }
});

test('a replaced request retains its previous decision for copying across repeated active and archived redraws',()=>{
  const oldNote='Fictional unsent decision <do not apply to the next request>';
  const nextRequestId='fictional-replacement-request';
  let panel=null,form=null,allow=false;
  const prompts=[];
  const expected=`Agree a new date\nNew due date: ${dueDate} (external deadline change confirmed)\n${oldNote}\nNext check-in: ${reviewAfter}`;
  const encode=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const decode=text=>text.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  function editor(id,value=''){
    const elements={requestId:{defaultValue:id,value:id,type:'hidden'},action:{defaultValue:'date',value:'date'},
      dueDate:{value:dueDate,defaultValue:dueDate},owner:{value:'',defaultValue:''},scope:{value:'',defaultValue:''},
      note:{value,defaultValue:''},reviewAfter:{value:reviewAfter,defaultValue:reviewAfter},
      confirmHardDeadline:{type:'checkbox',checked:true,defaultChecked:true}};
    return {elements,querySelector:()=>null};
  }
  const dialog={querySelector:selector=>selector==='#previousOrganizerDecisionDraft'?panel:null};
  const body={prepend(section){
    const match=section.innerHTML.match(/<textarea[^>]*\breadonly>([\s\S]*?)<\/textarea>/);
    assert.ok(match,'the preserved decision is copyable but not editable');
    assert.doesNotMatch(section.innerHTML,/<do not apply/,'user draft is escaped');
    panel={id:section.id,textarea:{value:decode(match[1]),readOnly:true}};
  }};
  form=editor(requestId,oldNote);
  const context=vm.createContext({
    window:{confirm(message){prompts.push(message);return allow;}},isOrganizer:()=>true,h:encode,
    document:{createElement(tag){assert.equal(tag,'section');return {};}},
    GatherPriorities:{pendingRequest:current=>current.recoveryRequests.find(item=>item.status==='pending')},
    $(selector,root){
      if(selector==='#dialog')return dialog;
      if(selector==='#recoveryDecisionForm'){assert.equal(root,dialog);return form;}
      if(selector==='#previousOrganizerDecisionDraft textarea'){assert.equal(root,dialog);return panel?.textarea;}
      if(selector==='.dialog-body'){assert.equal(root,dialog);return body;}
      return null;
    },
    $$(selector,root){assert.equal(selector,'input,textarea,select');return root.elements?Object.values(root.elements):[];},
    remount(nextRequest){panel=null;form=nextRequest?editor(nextRequest):null;},
  });
  const capture=fragment('    const keepDecisionDraft=','    const previousFocus=sameTask?');
  const mechanics=fragment('  function hasUnsavedFields(','  function hasAcceptanceReturnDraft(')+
    fragment('  const organizerDecisionActions=','  function organizerDecisionInScope(')+
    fragment('  function organizerDecisionDraftText(','  function paintOrganizerDecisionConflict(');
  vm.runInContext(mechanics+`
    function rebuild(task,{sameTask=true,discardDrafts=false,submittedForm=''}={}){
      ${capture}
      remount(task.archivedAt?'':GatherPriorities.pendingRequest(task)?.id);
      paintRetainedOrganizerDecision(retainedDecision);
    }`,context);
  const rendering=fragment('  function taskDialog(','  function syncRecoveryForms(');
  assert.equal((rendering.match(/paintRetainedOrganizerDecision\(retainedDecision\)/g)||[]).length,2,'both active and archived render paths restore the copied draft');
  const next={...task,recoveryRequests:[{...request,id:nextRequestId}]};
  context.rebuild(next);
  assert.equal(panel.id,'previousOrganizerDecisionDraft');assert.equal(panel.textarea.value,expected);
  assert.equal(form.elements.requestId.value,nextRequestId);assert.equal(form.elements.note.value,'');
  context.rebuild(next);
  assert.equal(panel.textarea.value,expected,'an ordinary same-task redraw neither loses nor duplicates it');
  context.rebuild({...next,archivedAt:'2026-12-02'});
  assert.equal(panel.textarea.value,expected);assert.equal(form,null);
  assert.equal(context.hasUnsavedFields(dialog),true,'a read-only retained textarea is still unsaved work');
  assert.equal(context.confirmDiscard(dialog),false);assert.equal(panel.textarea.value,expected);
  assert.deepEqual(prompts,['Discard your unsaved changes?']);
  allow=true;assert.equal(context.confirmDiscard(dialog),true);
  context.rebuild(next,{discardDrafts:true});
  assert.equal(panel,null);assert.equal(context.hasUnsavedFields(dialog),false);
});
