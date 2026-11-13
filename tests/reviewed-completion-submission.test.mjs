import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync('legacy/app.js','utf8');
const id='fictional-task';
const submission={note:'The accessible entrance has a named greeter.',links:[],fileIds:[]};
const file={name:'fictional-checklist.txt',size:120};
const attached={...submission,fileIds:['fictional_uploaded_file']};

function fixture({formId='responseForm',hosted=true,organizer=false}={}){
  let revision=hosted?21:undefined,task={id,revision:4,owner:'maya',status:formId==='responseForm'?'progress':'done',
    requiresVerification:true,reportedAt:formId==='responseForm'?'':'2026-11-13T17:00:00Z'};
  const ui={actor:organizer?'jack':'maya',view:'tasks',detailId:id,dialogKind:'task'};
  const window={GatherMode:{projectId:hosted?'fictional-project':'',demo:!hosted}};
  let demoGeneration=3,stale=false,known=0,title={};
  const dialog={isConnected:true,dataset:{}},backdrop={hidden:false},document={hidden:false};
  const submitter={isConnected:true,disabled:false};
  let status={textContent:''};
  const calls=[],preparations=[],writes=[],frames=[];
  function makeForm(){
    const attributes=new Map();
    const ownStatus=status;
    return {id:formId,isConnected:true,dataset:{id,revision:'4',taskRevision:'4',
      ...(!hosted?{completionDemoGeneration:String(demoGeneration)}:{}),
      ...(hosted?{workspaceRevision:'21'}:{})},closest:()=>dialog,contains:node=>node===submitter,
      querySelector:selector=>selector==='[data-submission-status]'?ownStatus:selector.includes('submit')?submitter:null,
      getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),
      removeAttribute:key=>attributes.delete(key),
    };
  }
  let form=makeForm();
  window.GatherCompletionUI={
    prepare(target,details,attachment,options){
      assert.equal(target,form);
      return new Promise((resolve,reject)=>preparations.push({details,attachment,options,reject,
        finish({uploaded=false}={}){
          if(uploaded)target.dataset.completionUploaded='true';
          resolve(uploaded?attached:details);
        },
      }));
    },
    celebrate(task){calls.push(['celebrate',task?.id]);},
  };
  function mutate(method,...args){
    return new Promise((resolve,reject)=>writes.push({method,args,reject,finish(){
      if(task)task={...task,revision:task.revision+1,reportedAt:'2026-11-13T17:30:00Z'};
      if(revision!==undefined)revision++;
      resolve(task);
    }}));
  }
  const store={
    getState:()=>({demoGeneration,tasks:task?[task]:[],members:[{id:'maya',active:true},{id:'jack',active:true}]}),
    getSnapshotRevision:()=>revision,
    reportCompletion:(...args)=>mutate('reportCompletion',...args),
    setCompletionEvidence:(...args)=>mutate('setCompletionEvidence',...args),
  };
  const context=vm.createContext({
    ui,window,document,store,isOrganizer:()=>organizer,
    $:selector=>({'#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,
      ['#'+formId]:form,'[data-submission-status]':status,'button[type="submit"]':submitter})[selector]||null,
    $$:()=>[],
    workspaceUpdatesPending:()=>stale,
    scheduleRevisionIsStale:value=>Number.isSafeInteger(value)&&value<known,
    recoveryConflictPending:value=>Number.isSafeInteger(value)&&value<known,
    showPendingUpdate(){stale=true;calls.push(['warning']);},
    showRecoveryWriteConflict(value){known=value+1;stale=true;calls.push(['conflict',value]);},
    saveLock(root,control){
      assert.equal(root,dialog);
      assert.equal(control,submitter);
      assert.ok(!ui.pendingSave);
      ui.pendingSave=true;
      return ()=>{delete ui.pendingSave;calls.push(['unlock']);};
    },
    formError(target,error){assert.equal(target,form);calls.push(['error',error.message]);},
    toast:message=>calls.push(['toast',message]),
    render:()=>calls.push(['render']),
    taskDialog(...args){calls.push(['dialog',...args]);title={};},
    dependencyInfo:()=>({open:[]}),
    requestAnimationFrame:fn=>frames.push(fn),
    focusTaskDialogControl:()=>calls.push(['focus']),
  });
  dialog.contains=node=>node===form||node===submitter||node===title;
  function sourceBlock(from,to){
    const start=app.indexOf(from),end=app.indexOf(to,start+from.length);
    assert.ok(start>=0&&end>start,'missing source block: '+from);
    return app.slice(start,end);
  }
  vm.runInContext(
    sourceBlock('  function acceptanceReviewPending(','  function paintAcceptanceRefresh(')+
    sourceBlock('  function completionDraftCanSubmit(','  function responseDialog('),
    context,
  );
  return {ui,window,document,backdrop,calls,preparations,writes,
    get status(){return status;},
    get form(){return form;},get task(){return task;},set task(value){task=value;},
    set revision(value){revision=value;},set stale(value){stale=value;},
    set demoGeneration(value){demoGeneration=value;},
    set confirmSnapshotRevision(value){store.confirmSnapshotRevision=value;},
    replaceForm(){status={textContent:'Replacement draft unchanged'};form=makeForm();title={};},
    save(attachment=file,target=form){return context.saveReviewedSubmission(target,submission,attachment,submitter);},
    flush(){for(const frame of frames.splice(0))frame();},
  };
}

const redraws=f=>f.calls.filter(([kind])=>['dialog','render','celebrate'].includes(kind));
const notices=f=>[f.status.textContent,...f.calls.flatMap(([kind,message])=>['toast','error'].includes(kind)?[message]:[])].join(' ');
const advance=async()=>{await Promise.resolve();await Promise.resolve();};
const unconfirmed=/not (?:submitted|saved|confirmed)|wasn’t saved|has not been|could not be confirmed/i;

test('reviewed completion and evidence edit await prepare and one exact save before refreshing the same task',async()=>{
  for(const [formId,organizer,expected] of [
    ['responseForm',false,'reportCompletion'],['completionEvidenceForm',true,'setCompletionEvidence'],
  ]){
    const f=fixture({formId,organizer}),pending=f.save();
    assert.equal(f.preparations.length,1);
    const [upload]=f.preparations;
    assert.equal(upload.details,submission);
    assert.equal(upload.attachment,file);
    assert.equal(upload.options.stillCurrent(),true);
    assert.equal(f.writes.length,0);
    assert.deepEqual(redraws(f),[]);
    await f.save();
    assert.equal(f.preparations.length,1,'duplicate submit cannot start a second upload');
    upload.finish({uploaded:true});
    await advance();
    assert.equal(f.writes.length,1);
    assert.equal(f.writes[0].method,expected);
    assert.deepEqual(f.writes[0].args,[id,attached,organizer?'jack':'maya',4]);
    assert.deepEqual(redraws(f),[]);
    f.writes[0].finish();
    await pending;
    f.flush();
    const dialogs=f.calls.filter(([kind])=>kind==='dialog');
    assert.equal(dialogs.length,1);
    assert.deepEqual(dialogs[0].slice(1,3),[id,formId]);
    assert.equal(f.ui.pendingSave,undefined);
  }
});

test('a hosted file submission checks the authoritative workspace before beginning any attachment work',async()=>{
  for(const state of ['newer','inconclusive','unchanged']){
    const f=fixture();
    f.confirmSnapshotRevision=async(expected,onNewer)=>{
      assert.equal(expected,21);
      if(state==='newer')onNewer(22);
      return state==='unchanged';
    };
    const pending=f.save();
    assert.equal(f.preparations.length,0);
    await advance();
    if(state==='unchanged'){
      assert.equal(f.preparations.length,1);
      f.preparations[0].reject(new Error('Stop before workspace write'));
    }
    await pending;
    assert.equal(f.preparations.length,Number(state==='unchanged'));
    assert.equal(f.writes.length,0);
    if(state==='newer')assert.deepEqual(f.calls.filter(([kind])=>kind==='conflict'),[['conflict',21]]);
    if(state==='inconclusive')assert.match(notices(f),/Could not confirm the latest task/);
  }
});

test('a stale review never begins attachment preparation or a task write',async()=>{
  for(const change of ['task revision','workspace revision','removed','owner','access','replacement','closed','pending sync']){
    const f=fixture(),old=f.form;
    if(change==='task revision')f.task={...f.task,revision:5};
    if(change==='workspace revision')f.revision=22;
    if(change==='removed')f.task=null;
    if(change==='owner')f.task={...f.task,owner:'dev'};
    if(change==='access')f.window.GatherAccessLost=true;
    if(change==='replacement')f.replaceForm();
    if(change==='closed')f.backdrop.hidden=true;
    if(change==='pending sync')f.stale=true;
    await f.save(file,old);
    assert.equal(f.preparations.length,0,change);
    assert.equal(f.writes.length,0,change);
    assert.deepEqual(redraws(f),[]);
  }
});

test('a missing recovered file blocks the report until the teammate decides how to proceed',async()=>{
  const f=fixture();
  f.form.dataset.completionAttachmentRecovery='check-file';
  await f.save();
  assert.match(notices(f),/explicitly continue without it/);
  assert.equal(f.preparations.length,0);
  assert.equal(f.writes.length,0);
});
test('context changes during upload prevent a task write and never redraw a superseded form',async()=>{
  for(const change of ['task revision','workspace revision','demo generation','actor','project','access','replacement','closed']){
    const f=fixture({hosted:change!=='demo generation'}),pending=f.save();
    const [upload]=f.preparations;
    assert.equal(upload.options.stillCurrent(),true);
    if(change==='task revision')f.task={...f.task,revision:5};
    if(change==='workspace revision')f.revision=22;
    if(change==='demo generation')f.demoGeneration=4;
    if(change==='actor')f.ui.actor='jack';
    if(change==='project')f.window.GatherMode.projectId='different-project';
    if(change==='access')f.window.GatherAccessLost=true;
    if(change==='replacement')f.replaceForm();
    if(change==='closed')f.backdrop.hidden=true;
    assert.equal(upload.options.stillCurrent(),false,change);
    upload.finish({uploaded:true});
    await pending;
    assert.equal(f.writes.length,0,change);
    assert.deepEqual(redraws(f),[],change);
    assert.equal(f.ui.pendingSave,undefined);
    if(change==='replacement')assert.equal(f.status.textContent,'Replacement draft unchanged');
    if(['task revision','workspace revision'].includes(change)){
      assert.match(notices(f),/file.{0,45}(?:saved|uploaded)|(?:saved|uploaded).{0,45}file/i);
      assert.match(notices(f),unconfirmed);
    }
  }
});

test('upload and task failures preserve the draft and never announce or render a saved completion',async()=>{
  for(const stage of ['upload','write','write 500','write conflict','other write conflict','superseded write']){
    const f=fixture(),pending=f.save(),upload=f.preparations[0];
    if(stage==='upload')upload.reject(new Error('Fictional upload not confirmed'));
    else{
      upload.finish({uploaded:true});
      await advance();
      assert.equal(f.writes.length,1);
      const [write]=f.writes;
      if(stage==='superseded write'){f.replaceForm();write.finish();}
      else if(stage==='write conflict'){
        f.revision=22;
        write.reject(Object.assign(new Error('The plan changed in another tab. Refresh before submitting.'),{status:409}));
      }else if(stage==='other write conflict'){
        write.reject(Object.assign(new Error('The submitted file is no longer available.'),{status:409}));
      }else write.reject(Object.assign(new Error('Fictional write failure'),stage==='write 500'?{status:500}:{}));
    }
    await pending;
    f.flush();
    assert.deepEqual(redraws(f),[],stage);
    assert.equal(f.ui.pendingSave,undefined);
    if(stage==='write'||stage==='write 500'){
      assert.match(notices(f),unconfirmed);
      assert.equal(f.form.dataset.completionSaveUnconfirmed,'true');
      await f.save();
      assert.equal(f.preparations.length,1,'unconfirmed saves must be checked before another attempt');
      assert.equal(f.writes.length,1);
    }
    if(stage==='write conflict')assert.deepEqual(f.calls.filter(([kind])=>kind==='conflict'),[['conflict',21]]);
    if(stage==='other write conflict'){
      assert.deepEqual(f.calls.filter(([kind])=>kind==='conflict'),[]);
      assert.equal(f.form.dataset.reviewNeedsRefresh,'true');
    }
  }
});

test('same-task sibling saves cannot give a dirty completion draft a newer review revision',()=>{
  const forms={
    responseForm:{elements:{response:{value:'completed'}},dataset:{revision:'4',workspaceRevision:'21'}},
    completionEvidenceForm:{dataset:{revision:'4',workspaceRevision:'21',reviewNeedsRefresh:'true',completionUploaded:'true'}},
  };
  const context=vm.createContext({$:selector=>forms[selector.slice(1)]||null});
  vm.runInContext(app.slice(app.indexOf('  const completionDraftKeys'),app.indexOf('  function priorityMarkup(')),context);
  const draftFields=[{form:'responseForm',name:'note'},{form:'completionEvidenceForm',name:'completionUpload'}];
  const captured=context.taskCompletionDraftContext(draftFields);
  for(const form of Object.values(forms))form.dataset={revision:'5',workspaceRevision:'22'};
  context.restoreTaskCompletionDraftContext(captured);
  assert.deepEqual(forms.responseForm.dataset,{revision:'4',workspaceRevision:'21'});
  assert.deepEqual(forms.completionEvidenceForm.dataset,{revision:'4',workspaceRevision:'21',reviewNeedsRefresh:'true',completionUploaded:'true'});
  assert.equal(context.taskCompletionDraftContext(draftFields,'responseForm').length,1);
  forms.responseForm.elements.response.value='progress';
  assert.equal(context.taskCompletionDraftContext([{form:'responseForm',name:'note'}]).length,0);
  forms.responseForm.dataset.completionSaveUnconfirmed='true';
  assert.equal(context.taskCompletionDraftContext([]).length,1,'a lost save receipt is retained even without dirty text');
});

function uploadFixture(){
  const source=readFileSync('legacy/completion-ui.js','utf8');
  let current=true,keys=0;
  const state={textContent:''},form={dataset:{},querySelector:()=>state},requests=[];
  const window={GatherMode:{projectId:'fictional-project'}};
  vm.runInNewContext(source,{window,URLSearchParams,AbortSignal,
    FormData:class{fields={};set(key,value){this.fields[key]=value;}},
    crypto:{randomUUID:()=>String(++keys)},
    fetch:(url,init)=>new Promise((resolve,reject)=>requests.push({
      url,init,reject,respond(data,status=200){resolve({ok:status>=200&&status<300,status,json:async()=>data});},
    })),
  });
  return {state,form,requests,window,
    set current(value){current=value;},
    prepare(){return window.GatherCompletionUI.prepare(form,submission,file,{stillCurrent:()=>current});},
  };
}

test('real attachment preparation skips the upload when context changed while loading Event info',async()=>{
  const f=uploadFixture(),pending=f.prepare();
  const result=pending.catch(error=>error);
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].init.method,undefined);
  f.current=false;
  f.requests[0].respond({uploadsAvailable:true,revision:7});
  await result;
  assert.equal(f.requests.length,1,'no upload POST after the reviewed context changes');
  assert.equal(f.form.dataset.completionUploaded,undefined);
});

test('real attachment preparation retains a confirmed upload for retry but does not paint a superseded form',async()=>{
  const f=uploadFixture(),pending=f.prepare();
  const result=pending.catch(error=>error);
  f.requests[0].respond({uploadsAvailable:true,revision:7});
  await advance();
  await advance();
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[1].init.method,'POST');
  assert.equal(f.requests[1].init.body.fields.revision,7);
  const before=f.state.textContent;
  f.current=false;
  f.requests[1].respond({uploadedFileId:attached.fileIds[0],files:[{id:attached.fileIds[0]}]});
  await result;
  assert.equal(f.state.textContent,before,'late upload cannot announce saving against a changed review');
  f.current=true;
  const details=await f.prepare();
  assert.deepEqual(JSON.parse(JSON.stringify(details)),attached);
  assert.equal(f.requests.length,2,'reuse the confirmed file instead of uploading it twice');
});
