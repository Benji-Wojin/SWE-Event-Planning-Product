import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let taskFollowup,taskConversation;
before(async()=>{
  const bundle=await build({entryPoints:['lib/task-conversation.ts'],bundle:true,platform:'node',format:'esm',write:false});
  ({taskFollowup,taskConversation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
test('twenty sequential followups keep the latest answer and message inside existing server limits',()=>{
  let history=[];
  for(let turn=0;turn<20;turn++){
    const answer=turn?'Reply '+(turn-1)+' '+ 'a'.repeat(500):undefined,message='Message '+turn+' '+ 'b'.repeat(100);
    const next=taskFollowup(history,answer,message);
    assert.deepEqual(taskConversation(next.description),next.rows);assert.ok(next.description.length<=4000);assert.equal(next.rows.at(-1).content,message);if(answer)assert.equal(next.rows.at(-2).content,answer);
    if(turn>4)assert.equal(next.trimmed,true);history=next.rows;
  }
});
test('maximum-size new message and answer retain an excerpt of the previous request',()=>{
  const next=taskFollowup([{role:'user',content:'p'.repeat(1800)}],'a'.repeat(6000),'n'.repeat(1800));
  assert.ok(next.description.length<=4000);assert.equal(next.trimmed,true);assert.equal(next.rows.at(-1).content,'n'.repeat(1800));assert.match(next.rows.at(-2).content,/Earlier draft excerpt/);assert.equal(next.rows[0].role,'user');assert.deepEqual(taskConversation(next.description),next.rows);
});
test('preexisting consecutive user messages cannot prevent continuing a conversation',()=>{
  const next=taskFollowup(Array.from({length:8},(_,i)=>({role:'user',content:'Earlier '+i})),'Here are three suggestions.','Thanks, can you change the second?');
  assert.ok(next.trimmed);assert.deepEqual(taskConversation(next.description),next.rows);assert.equal(next.rows.at(-2).role,'assistant');
});
