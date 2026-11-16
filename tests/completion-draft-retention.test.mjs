import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const id='fictional-task';
const note='The accessible entrance is staffed and checked.';
const links='https://example.com/fictional-route';
const file={name:'fictional-checklist.txt',size:40};

function block(source,from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'missing source block: '+from);
  return source.slice(start,end);
}

function fixture({owner='maya',editing=false,initial='completed',withDraft=true}={}){
  const calls=[],prompts=[],decisions=[],handlers={},writes=[];
  const dialog={},backdrop={hidden:false},status={textContent:''},rows={innerHTML:'saved file'};
  const recoveryPanel={remove:()=>calls.push(['remove recovery'])};
  let task={id,owner,status:'progress',revision:4,requiresVerification:true,
    reportedAt:editing?'2026-11-13T16:00:00Z':''};
  const ui={actor:'maya',view:'tasks',detailId:id,dialogKind:'task'};
  function valueField(name,value,defaultValue=''){
    return {name,value,defaultValue,tagName:'TEXTAREA',focus:()=>calls.push(['focus',name])};
  }
  const responseInput={name:'response',value:initial,tagName:'SELECT',options:[
    {value:'progress',defaultSelected:!editing},{value:'completed',defaultSelected:editing},
    {value:'blocked'},{value:'help'},{value:'date'},
  ]};
  const fileInput={name:'completionUpload',type:'file',value:withDraft?'C:\\fakepath\\fictional-checklist.txt':'',
    defaultValue:'',files:withDraft?[file]:[]};
  Object.defineProperty(fileInput,'value',{get:()=>fileInput.files.length?'C:\\fakepath\\fictional-checklist.txt':'',
    set:value=>{if(value==='')fileInput.files=[];}});
  const picker={name:'completionFileIds',tagName:'SELECT',multiple:true,
    options:withDraft?[{value:'prior_file',selected:true,defaultSelected:false}]:[],
    get selectedOptions(){return this.options.filter(option=>option.selected);},
    set innerHTML(markup){if(!markup)this.options=[];},get innerHTML(){return '';}};
  const fields={response:responseInput,note:valueField('note',withDraft?note:''),
    completionNote:valueField('completionNote',withDraft?note:''),
    completionLinks:valueField('completionLinks',withDraft?links:''),
    completionUpload:fileInput,completionFileIds:picker,proposedDate:valueField('proposedDate',''),
  };
  fields.namedItem=name=>fields[name];
  const formSelector=editing?'#completionEvidenceForm':'#responseForm';
  const discardButtons=[];
  const completionForm={
    id:formSelector.slice(1),dataset:{id,revision:'4',workspaceRevision:'21',responseMode:initial},isConnected:true,
    elements:fields,classList:{contains:()=>false},
    prepend:element=>discardButtons.unshift(element),
    querySelector:selector=>({'[data-submission-status]':status,'[data-submission-files]':rows,
      '[data-proposed-date]':{},'[data-completion-draft-recovery]':recoveryPanel,
      '[data-action="discard-completion-draft"]':discardButtons[0]})[selector]||null,
    closest:()=>dialog,
  };
  responseInput.form=completionForm;
  responseInput.closest=selector=>selector==='#responseForm'||selector==='form'?completionForm:null;
  responseInput.matches=()=>false;
  const document={addEventListener:(name,fn)=>{handlers[name]=fn;},createElement:()=>({dataset:{}})};
  const window={confirm(message){prompts.push(message);return decisions.shift()??false;}};
  function find(selector,root){
    if(selector===formSelector)return completionForm;
    if(selector==='#dialog')return dialog;
    if(selector==='#dialogBackdrop')return backdrop;
    if(root===completionForm)return completionForm.querySelector(selector);
    return null;
  }
  const context=vm.createContext({
    ui,window,document,$:find,$$:(_selector,root)=>root===completionForm?Object.values(fields).filter(item=>typeof item==='object'):[],
    teammateUpdateConflicts:new WeakMap(),
    recovery:{syncResponse(form){form.dataset.responseMode=form.elements.response.value;calls.push(['sync',form.elements.response.value]);}},
    store:{
      getState:()=>({tasks:[task],demoGeneration:1}),getSnapshotRevision:()=>21,
      updateTask(...args){writes.push(['updateTask',...args]);task={...task,...args[1]};return task;},
      resolveRecovery(...args){writes.push(['resolveRecovery',...args]);return task;},
      resumeTask(...args){writes.push(['resumeTask',...args]);return task;},
      requestRecovery(...args){writes.push(['requestRecovery',...args]);return task;},
      addDependency(...args){writes.push(['addDependency',...args]);return task;},
      reportCompletion(){assert.fail('No completion submitted in a draft protection flow');},
    },
    render:()=>calls.push(['render']),taskDialog:(...args)=>calls.push(['dialog',...args]),
    toast:message=>calls.push(['toast',message]),closeDialog:()=>calls.push(['close']),
    formError:(_target,error)=>calls.push(['error',error.message]),
    saveLock:()=>()=>calls.push(['release']),
    isOrganizer:()=>ui.actor==='jack',
    hasAcceptanceReturnDraft:()=>false,
    confirmFixedDate:()=>true,confirmTaskOwnerChange:()=>true,workspaceUpdatesPending:()=>false,
    taskDrafts:()=>[{form:completionForm.id,name:'note',value:fields.note.value}],
    focusTaskRecovery:()=>{},returnToRelatedBatch:()=>false,returnToEventTaskReview:()=>false,
    FormData:class{constructor(target){return Object.entries(target.fields||{response:fields.response.value,note:fields.note.value});}},
  });
  vm.runInContext(
    block(app,'  function hasUnsavedFields(','  function hasAcceptanceReturnDraft(')+
    block(app,'  function completionDraftHasEdits(','  function priorityMarkup(')+
    block(app,'  function clearCompletionAttachmentRecovery(','  async function refreshCompletionDraft('),context,
  );
  vm.runInContext(block(app,"  document.addEventListener('click'","  document.addEventListener('input'"),context);
  return {context,ui,window,dialog,backdrop,status,rows,calls,prompts,decisions,handlers,writes,fields,discardButtons,
    get task(){return task;},set task(value){task=value;},get form(){return completionForm;},
    mode(value){fields.response.value=value;return context.syncTaskResponseMode(completionForm);},
    change(value){fields.response.value=value;return handlers.change({target:responseInput});},
    submit(form=completionForm,values,submitter){
      if(typeof form==='string')form={id:form,dataset:{id},elements:{},classList:{contains:()=>false},
        closest:()=>dialog,querySelector:()=>null,fields:values};
      return handlers.submit({target:form,submitter,preventDefault(){}});
    },
    clickResume(){
      const button={dataset:{action:'resume-task',id},closest:selector=>selector==='#dialog'?dialog:null,isConnected:true};
      return handlers.click({target:{closest:()=>button},preventDefault(){}});
    },
    clickDiscard(){
      const button=discardButtons[0];
      button.closest=selector=>selector==='form'?completionForm:null;
      return handlers.click({target:{closest:()=>button},preventDefault(){}});
    },
    atRisk(kind,patch={}){return context.completionDraftAtRisk(task,kind,patch);},
    protect(kind,patch={},writer){return context.protectCompletionDraft(task,kind,patch,writer);},
    edits(options){return context.completionDraftHasEdits(completionForm,options);},
  };
}

test('canceling the mode switch restores Report complete without changing any text or attachments',()=>{
  for(const next of ['progress','blocked','help','date']){
    const f=fixture();
    f.decisions.push(false);
    assert.equal(f.mode(next),false,next);
    assert.equal(f.prompts.length,1,next);
    assert.match(f.prompts[0],/completion draft/i);
    assert.equal(f.fields.response.value,'completed');
    assert.equal(f.form.dataset.responseMode,'completed');
    assert.equal(f.fields.note.value,note);
    assert.equal(f.fields.completionLinks.value,links);
    assert.deepEqual(f.fields.completionUpload.files,[file]);
    assert.deepEqual(f.fields.completionFileIds.selectedOptions.map(option=>option.value),['prior_file']);
    assert.deepEqual(f.writes,[]);
    assert.ok(!f.calls.some(([kind])=>kind==='discard'));
  }
});

test('actual delegated change and submit cannot reinterpret a completion note as progress',async()=>{
  const canceled=fixture();
  canceled.decisions.push(false);
  canceled.change('blocked');
  assert.equal(canceled.fields.response.value,'completed');
  assert.equal(canceled.fields.note.value,note);
  const intercepted=fixture();
  intercepted.decisions.push(false);
  intercepted.fields.response.value='progress';
  await intercepted.submit();
  assert.deepEqual(intercepted.writes,[]);
  assert.equal(intercepted.fields.response.value,'completed');
  assert.equal(intercepted.fields.note.value,note);
  const explicit=fixture();
  explicit.decisions.push(true);
  explicit.fields.response.value='progress';
  await explicit.submit();
  assert.deepEqual(explicit.writes,[]);
  assert.equal(explicit.fields.note.value,'');
  explicit.fields.note.value='New explicit progress note.';
  await explicit.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(explicit.writes)),[['updateTask',id,
    {status:'progress',note:'New explicit progress note.'},'maya']]);
});

test('actual delegated sibling operations leave report and evidence drafts intact and never write when at risk',async()=>{
  const report=fixture();
  await report.submit('taskDetailForm',{owner:'dev',status:'progress'});
  await report.submit('taskDetailForm',{owner:'maya',status:'done'});
  await report.submit('recoveryDecisionForm',{action:'reassign',owner:'dev',note:'Review change.'});
  assert.deepEqual(report.writes,[]);
  assert.equal(report.fields.note.value,note);
  assert.equal(report.calls.filter(([kind])=>kind==='error').length,3);
  assert.equal(report.discardButtons.length,1,'repeated blocked writes expose one explicit way to discard');
  assert.equal(report.discardButtons[0].type,'button');
  await report.submit('taskDetailForm',{title:'A benign title edit'});
  assert.equal(report.writes.length,1);
  assert.equal(report.writes[0][0],'updateTask');
  assert.equal(report.fields.note.value,note);
  const evidence=fixture({editing:true});
  evidence.task={...evidence.task,status:'blocked'};
  await evidence.clickResume();
  await evidence.submit('responseForm',{response:'progress',note:'New progress would withdraw the report.'});
  assert.deepEqual(evidence.writes,[]);
  assert.equal(evidence.fields.completionNote.value,note);
  assert.ok(evidence.calls.some(([kind,text])=>kind==='toast'&&/completion draft/i.test(text)));
});

test('a required link that would hide completion is blocked; a Related link still saves',async()=>{
  const f=fixture();
  const related={taskId:'fictional-prerequisite',kind:'related',reason:'Coordinate nearby work.'};
  await f.submit('relationshipAddForm',{...related,kind:'dependency'});
  assert.deepEqual(f.writes,[]);
  assert.equal(f.fields.note.value,note);
  assert.equal(f.discardButtons.length,1);
  await f.submit('relationshipAddForm',related);
  assert.deepEqual(JSON.parse(JSON.stringify(f.writes)),[['addDependency',id,related,'maya']]);
});

test('the explicit discard action requires confirmation and redraws read-only without a write',async()=>{
  const f=fixture({editing:true});
  f.form.dataset.completionUploaded='true';
  assert.equal(f.protect('response',{response:'progress'}),false);
  f.decisions.push(false,true);
  await f.clickDiscard();
  assert.ok(!f.calls.some(([kind])=>kind==='dialog'));
  assert.equal(f.fields.completionNote.value,note);
  assert.match(f.prompts[0],/uploaded file stays in Event info/i);
  await f.clickDiscard();
  const redraw=f.calls.find(([kind])=>kind==='dialog');
  assert.deepEqual(redraw.slice(1,-1),[id,'completionEvidenceForm',false,true,'',undefined,'']);
  assert.equal(redraw.at(-1).readOnly,true);
  assert.deepEqual(f.writes,[]);
  f.form.dataset.completionSaveUnconfirmed='true';
  await f.clickDiscard();
  assert.equal(f.prompts.length,2,'unconfirmed save cannot be discarded via a preexisting button');
  assert.equal(f.calls.filter(([kind])=>kind==='dialog').length,1);
});

test('an explicit mode switch discards completion inputs before syncing the new mode without submitting anything',()=>{
  const f=fixture();
  f.form.dataset.reviewNeedsRefresh='true';
  f.form.dataset.completionUploaded='true';
  f.form.dataset.completionAttachmentRecovery='check-file';
  f.decisions.push(true);
  assert.equal(f.mode('progress'),true);
  assert.equal(f.prompts.length,1);
  assert.equal(f.fields.response.value,'progress');
  assert.equal(f.form.dataset.responseMode,'progress');
  assert.equal(f.fields.note.value,'','completion note must not become progress text');
  assert.equal(f.fields.completionLinks.value,'');
  assert.deepEqual(f.fields.completionUpload.files,[]);
  assert.deepEqual(f.fields.completionFileIds.selectedOptions,[]);
  assert.equal(f.form.dataset.completionAttachmentRecovery,undefined);
  assert.deepEqual(f.writes,[]);
  assert.ok(f.calls.some(([kind,mode])=>kind==='sync'&&mode==='progress'));
});
test('if a redraw can no longer offer Report complete, the retained note cannot become a progress update',async()=>{
  const f=fixture();
  f.form.dataset.completionModeUnavailable='true';
  f.fields.response.value='progress';
  await f.submit();
  assert.deepEqual(f.writes,[]);
  assert.equal(f.fields.note.value,note);
  assert.equal(f.fields.note.readOnly,true);
  assert.deepEqual(f.fields.completionUpload.files,[file]);
});

test('empty completion can change mode without confirmation, while an unconfirmed save cannot switch',()=>{
  const empty=fixture({withDraft:false});
  assert.equal(empty.mode('progress'),true);
  assert.deepEqual(empty.prompts,[]);
  const pending=fixture();
  pending.form.dataset.completionSaveUnconfirmed='true';
  pending.decisions.push(true);
  assert.equal(pending.mode('blocked'),false);
  assert.equal(pending.fields.response.value,'completed');
  assert.equal(pending.fields.note.value,note);
  assert.deepEqual(pending.fields.completionUpload.files,[file]);
  assert.equal(pending.form.dataset.completionSaveUnconfirmed,'true');
  assert.deepEqual(pending.writes,[]);
  assert.ok(pending.calls.some(([kind,message])=>kind==='error'&&/confirm|check/i.test(message)));
});

test('only sibling operations that could remove the exact open completion draft are blocked',()=>{
  const f=fixture();
  for(const [kind,patch] of [
    ['details',{owner:'dev'}],['details',{status:'done'}],['reassign',{owner:'dev'}],['required-link',{}],
  ]){
    assert.equal(f.atRisk(kind,patch),f.form,kind);
    assert.equal(f.protect(kind,patch,{id:'otherForm'}),false,kind);
    assert.equal(f.fields.note.value,note);
  }
  for(const [kind,patch] of [
    ['details',{title:'A different title'}],['details',{owner:'maya',status:'progress'}],
    ['reassign',{owner:'maya'}],
  ]){
    assert.equal(f.atRisk(kind,patch),null,kind);
    assert.equal(f.protect(kind,patch,{id:'otherForm'}),true,kind);
  }
  assert.deepEqual(f.prompts,[],'sibling actions are blocked, not a discard prompt');
  assert.ok(f.calls.some(([kind,message])=>kind==='error'&&/completion/i.test(message)));
  f.ui.detailId='another-task';
  assert.equal(f.atRisk('details',{owner:'dev'}),null);
});

test('completion evidence drafts are protected when a pending report would be withdrawn',()=>{
  const f=fixture({editing:true});
  for(const [kind,patch] of [
    ['details',{owner:'dev'}],['details',{status:'blocked'}],['details',{note:'Replacement progress'}],
    ['resume',{}],['response',{response:'progress'}],['response',{response:'blocked'}],
  ]){
    assert.equal(f.atRisk(kind,patch),f.form,kind+' '+JSON.stringify(patch));
  }
  assert.equal(f.atRisk('details',{title:'Benign title'}),null);
  f.task={...f.task,requiresVerification:false};
  assert.equal(f.atRisk('reassign',{owner:'dev'}),f.form,'a pending report still has evidence after verification policy is turned off');
  const empty=fixture({editing:true,withDraft:false});
  assert.equal(empty.atRisk('response',{response:'progress'}),null);
  empty.form.dataset.completionUploaded='true';
  assert.equal(empty.atRisk('response',{response:'progress'}),null,'informational upload receipt alone is not an unsent draft');
  empty.form.dataset.completionSaveUnconfirmed='true';
  assert.equal(empty.atRisk('response',{response:'progress'}),empty.form);
});
