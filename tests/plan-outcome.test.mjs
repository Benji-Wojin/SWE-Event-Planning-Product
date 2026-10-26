import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['lib/plan-generation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {parsePlanItems,planRequestBody}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const item={id:'one',kind:'preparation',title:'Review fictional hall',category:'Venue',note:'Check the entrance with the venue contact.',dueDate:'',start:'',end:'',location:'',dependsOn:[],existingTaskIndex:null};
test('plan outcomes are independently validated, normalized and separate from instructions or progress',()=>{
  const before=structuredClone(item),parsed=parsePlanItems([{...item,scope:'  Entrance and access arrangements reviewed.\nOpen conditions recorded.  '}])[0];
  assert.equal(parsed.scope,'Entrance and access arrangements reviewed.\nOpen conditions recorded.');assert.equal(parsed.note,item.note);assert.deepEqual(item,before);
  for(const scope of [null,{},[],42,'x'.repeat(3001),'bad\u0001result','bad\u007fresult'])assert.throws(()=>parsePlanItems([{...item,scope}]));
  assert.equal(parsePlanItems([item])[0].scope,'','legacy note is not promoted to an agreed outcome');assert.equal(parsePlanItems([{...item,scope:' '}])[0].scope,'');
  assert.equal(parsePlanItems([{...item,scope:'x'.repeat(3000)}])[0].scope.length,3000);
  assert.throws(()=>parsePlanItems([{...item,scope:'A result',verifiedAt:'now'}]));
});
test('starting plans, suggestions and Ask Weft schemas request bounded human-reviewable outcomes with unchanged execution limits',()=>{
  for(const purpose of [undefined,'suggestions','assistant']){
    const request=planRequestBody({purpose}),schema=request.response_format.json_schema.schema.properties.items.items;
    assert.ok(schema.required.includes('scope'));assert.equal(schema.properties.scope.type,'string');assert.equal(schema.properties.scope.maxLength,240);assert.equal(schema.additionalProperties,false);
    assert.match(request.messages[0].content,/scope/);assert.match(request.messages[0].content,/Done when/);assert.equal(request.tools,undefined);
    assert.equal(request.max_completion_tokens,purpose==='assistant'?2000:4000);
  }
});
