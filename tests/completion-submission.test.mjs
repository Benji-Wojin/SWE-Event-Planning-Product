import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/completion-ui.js','utf8');
function setup(fetch){
  const context=vm.createContext({fetch,FormData,AbortSignal,URLSearchParams,crypto,GatherMode:{projectId:'fictional-project'}});
  vm.runInContext(source,context);
  const status={textContent:''},form={dataset:{},querySelector:()=>status};
  return {ui:context.GatherCompletionUI,form,status};
}
const details=()=>({note:'Fictional work complete.',links:[],fileIds:[]});
const file=()=>new File(['Fictional finished work.'],'finished.txt',{type:'text/plain'});
const reply=(data,status=200)=>Response.json(data,{status});
const snapshot=()=>({revision:3,uploadsAvailable:true,files:[]});
const uploaded=()=>({revision:4,uploadedFileId:'exact-file-id',files:[{id:'unrelated-file-id',name:'finished.txt'},{id:'exact-file-id',name:'finished.txt'}]});

test('submission renders a simple optional file or link section without an upload or evidence label',()=>{
  const {ui}=setup(()=>{throw Error('Rendering must not fetch');});
  const html=ui.fields({links:['https://www.nasa.gov/?x=<bad>'],fileIds:['saved-file']});
  assert.match(html,/Add a file or link/);assert.match(html,/optional/);assert.match(html,/type="file"/);assert.match(html,/name="completionLinks"/);
  assert.doesNotMatch(html,/evidence|<details|Event info first|data-load-completion-files/i);
  assert.match(html,/&lt;bad&gt;/);assert.match(html,/Uploaded only when you submit/);
});
test('note-only and link-only submissions require no upload request',async()=>{
  const {ui,form}=setup(()=>{throw Error('No file must mean no fetch');});
  const value={...details(),links:['https://www.nasa.gov/']};
  assert.equal(await ui.prepare(form,value,null),value);
  assert.equal(await ui.prepare(form,value,new File([],'')),value);
});
test('explicit submit uploads once and attaches the exact returned file rather than matching a filename',async()=>{
  const calls=[];const {ui,form,status}=setup(async(url,options)=>{calls.push({url,options});return reply(calls.length===1?snapshot():uploaded());});
  const chosen=file(),value=await ui.prepare(form,details(),chosen);
  assert.deepEqual([...value.fileIds],['exact-file-id']);assert.equal(calls.length,2);
  assert.equal(calls[0].url,'/api/info?project=fictional-project');assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[1].url,'/api/info?project=fictional-project&upload=1');assert.equal(calls[1].options.method,'POST');
  assert.equal(calls[1].options.credentials,'same-origin');assert.equal(calls[1].options.headers['X-Gather-Request'],'1');
  assert.equal(calls[1].options.body.get('file').name,'finished.txt');assert.equal(calls[1].options.body.get('revision'),'3');
  assert.equal(form.dataset.completionUploaded,'true');assert.match(status.textContent,/Saving your completion/);
  // A failed later workspace save can be retried without making a second file.
  assert.deepEqual([...(await ui.prepare(form,details(),chosen)).fileIds],['exact-file-id']);assert.equal(calls.length,2);
});
test('ambiguous upload retries retain the same request id and revision',async()=>{
  const calls=[];const {ui,form}=setup(async(url,options)=>{calls.push({url,options});if(calls.length===1)return reply(snapshot());if(calls.length===2)throw Error('Lost response after commit');return reply(uploaded());});
  const chosen=file();await assert.rejects(ui.prepare(form,details(),chosen),/could not be confirmed/);
  assert.equal(form.dataset.completionUploaded,undefined);
  const value=await ui.prepare(form,details(),chosen);assert.deepEqual([...value.fileIds],['exact-file-id']);
  assert.equal(calls.length,3);assert.equal(calls[1].options.body.get('requestId'),calls[2].options.body.get('requestId'));
  assert.equal(calls[1].options.body.get('revision'),calls[2].options.body.get('revision'));
});
test('definite revision rejection refreshes metadata on retry and does not mark submission saved',async()=>{
  let calls=0;const {ui,form}=setup(async()=>{calls++;return calls===1||calls===3?reply({...snapshot(),revision:calls===1?3:4}):calls===2?reply({error:'Event info changed.'},409):reply(uploaded());});
  const chosen=file();await assert.rejects(ui.prepare(form,details(),chosen),/Event info changed/);assert.equal(form.dataset.completionUploaded,undefined);
  assert.deepEqual([...(await ui.prepare(form,details(),chosen)).fileIds],['exact-file-id']);assert.equal(calls,4);
});
test('unavailable storage, malformed receipts and inactive uploads fail closed',async()=>{
  for(const response of [{uploadedFileId:null,files:[{id:'exact-file-id'}]},{uploadedFileId:'exact-file-id',files:[{id:'exact-file-id',archivedAt:'2026-01-01'}]}]){
    let calls=0;const {ui,form}=setup(async()=>reply(++calls===1?snapshot():response));
    await assert.rejects(ui.prepare(form,details(),file()),/could not be identified/);assert.equal(form.dataset.completionUploaded,undefined);
  }
  const {ui,form}=setup(async()=>reply({...snapshot(),uploadsAvailable:false}));
  await assert.rejects(ui.prepare(form,details(),file()),/unavailable/);assert.equal(form.dataset.completionUploaded,undefined);
});
test('invalid files and attachment limits are rejected before any network request',async()=>{
  const {ui,form}=setup(()=>{throw Error('Must validate before fetch');});
  for(const chosen of [new File(['x'],'script.html'),new File([],'empty.txt'),new File([new Uint8Array(4*1024*1024+1)],'big.txt')])await assert.rejects(ui.prepare(form,details(),chosen),/up to 4 MB/);
  await assert.rejects(ui.prepare(form,{...details(),fileIds:['a','b','c','d','e']},file()),/Up to 5/);
});
test('the submit event captures attachment inputs before delegating to the reviewed submission flow',()=>{
  const app=readFileSync('legacy/app.js','utf8'),start=app.indexOf("document.addEventListener('submit'");
  const submit=app.slice(start,app.indexOf('const release=saveLock',start));
  assert.match(submit,/if\(isSubmission\)[\s\S]*collect\(form,[^\n]+[\s\S]*const submissionFile=form.elements.completionUpload\?\.files\?\.\[0\];[\s\S]*await saveReviewedSubmission\(form,submission,submissionFile,event.submitter\);\s*return;/);
});
test('removed attachment rows stay removed after sibling-form selection restoration',()=>{
  const {ui}=setup(()=>{throw Error('Mounting must not upload');});
  const option={value:'saved-file',selected:false};let removed=0;
  const button={dataset:{removeSubmissionFile:'saved-file'},closest:selector=>selector==='form'?{elements:{completionFileIds:{options:[option]}}}:{remove(){removed++;}}};
  ui.mount({querySelectorAll:selector=>selector==='[data-remove-submission-file]'?[button]:[]});
  assert.equal(removed,1);assert.equal(option.selected,false);
  option.selected=true;
  ui.mount({querySelectorAll:selector=>selector==='[data-remove-submission-file]'?[button]:[]});
  assert.equal(removed,1);button.onclick();assert.equal(option.selected,false);assert.equal(removed,2);
});
test('sibling saves preserve the same selected File without assigning a fakepath value',()=>{
  const app=readFileSync('legacy/app.js','utf8'),chosen=file();
  const input={type:'file',name:'completionUpload',tagName:'INPUT',value:'C:\\fakepath\\finished.txt',defaultValue:'',files:[chosen]};
  const form={id:'responseForm',inputs:[input]};
  const context=vm.createContext({ui:{dialogKind:'task'},$$:(_selector,root)=>root?root.inputs:[form]});
  vm.runInContext(app.slice(app.indexOf('  function taskDrafts('),app.indexOf('  function taskDialog(')),context);
  const drafts=context.taskDrafts('commentForm');assert.equal(drafts[0].files[0],chosen);
  const restored={type:'file',set value(_value){throw Error('Cannot restore nonempty file value');}};
  const rebuilt={dataset:{},elements:{namedItem:()=>restored}};
  context.drafts=drafts;context.document={getElementById:()=>rebuilt};
  context.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
  context.URLSearchParams=URLSearchParams;
  context.window={};
  vm.runInContext(source,context);
  const start=app.indexOf('      for(const draft of drafts)');
  const restore='const uploadedFiles=[];'+app.slice(start,app.indexOf('\n      for(const form of',start));
  vm.runInContext(restore,context);
  assert.equal(restored.files[0],chosen);
  context.DataTransfer=class{constructor(){throw Error('File restore unsupported');}};
  vm.runInContext('{'+restore+'}',context);
  assert.equal(rebuilt.dataset.completionAttachmentRecovery,'select-file');
});
test('a confirmed upload remains attachable by its exact ID when a sibling redraw cannot restore the picker',async()=>{
  let calls=0;
  const {ui,form}=setup(async()=>reply(++calls===1?snapshot():uploaded()));
  const chosen=file();
  await ui.prepare(form,details(),chosen);
  const restored=ui.restoreSelectedFile({set files(_){throw Error('Browser refused file restoration');}},chosen);
  assert.equal(restored.fileId,'exact-file-id');
  const evidence={...details(),fileIds:[restored.fileId]};
  assert.equal(await ui.prepare(form,evidence,null),evidence);
  assert.equal(calls,2,'restoring the saved ID does not upload it again');
});
