import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export {planRequestBody,eventKinds} from './lib/plan-generation';export {starterChecklist} from './lib/starter-checklists';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {planRequestBody,eventKinds,starterChecklist}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('the default next-steps button fits after every built-in starter without extra user input',()=>{
  for(const kind of eventKinds){
    const event={name:'Fictional event for a local acceptance check',date:'2027-02-12',timeZone:'America/Los_Angeles',location:'Fictional hall',guestCount:80,outdoor:false,transportNeeded:false};
    const existingTasks=[{title:'Confirm the fictional welcome route',start:'2027-02-12T17:00'},...starterChecklist(kind).items.map(item=>({title:item.title,start:''}))];
    const context={event,existingTasks,feedback:[],purpose:'suggestions',brief:{kind,description:event.name,endDate:'',startTime:'',endTime:''},today:'2026-10-26'};
    const request=planRequestBody(context);
    assert.ok(Buffer.byteLength(JSON.stringify(request))<8000,kind+' retains room below the unchanged 9000-byte budget');
    assert.equal(request.max_completion_tokens,4000);assert.equal(request.tools,undefined);
    assert.deepEqual(JSON.parse(request.messages[1].content),context,'do not silently discard the disclosed context');
    for(const phrase of [/GAP REVIEW/,/untrusted/,/NO tools/,/Done when/,/existingTaskIndex/,/specific prerequisite output/,/not.*complete safety/])assert.match(request.messages[0].content,phrase);
  }
});
test('large contexts still fail closed; compact prompting never bypasses the guard',()=>{
  assert.throws(()=>planRequestBody({purpose:'suggestions',brief:{description:'x'.repeat(20000)}}),/context_limit/);
});
