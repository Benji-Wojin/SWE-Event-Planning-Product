import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let proposal,answers;
before(async()=>{
  const bundle=await build({entryPoints:['lib/date-availability.ts'],bundle:true,platform:'node',format:'esm',write:false});
  ({datePollProposal:proposal,datePollAnswers:answers}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
const input=()=>({title:'  Fictional team date options  ',dates:['2028-03-02','2028-02-29'],timeZone:'Asia/Tokyo'});
test('date options are bounded, unique real calendar days in an explicit validated zone',()=>{
  const value=input(),copy=structuredClone(value),result=proposal(value);
  assert.equal(result.title,'Fictional team date options');assert.deepEqual(result.dates,['2028-02-29','2028-03-02']);assert.equal(result.timeZone,'Asia/Tokyo');assert.deepEqual(value,copy);
  for(const extra of [{title:''},{title:'x'.repeat(161)},{title:'bad\nname'},{timeZone:'Bad/Zone'},{timeZone:''},{dates:['2027-02-29','2028-01-01']},{dates:['2028-03-01','2028-03-01']},{dates:['2028-01-01']},{dates:['bad','2028-01-01']},{dates:Array(13).fill('2028-01-01')},{closedAt:'forged'},{responses:[]}])assert.throws(()=>proposal({...value,...extra}));
});
test('responses accept only dates in this poll and explicit availability, without identity fields or duplicates',()=>{
  const poll=proposal(input());
  const value=[{date:'2028-03-02',availability:'maybe'},{date:'2028-02-29',availability:'available'}],copy=structuredClone(value);
  assert.deepEqual(answers(poll,value),value.toReversed());assert.deepEqual(value,copy);assert.deepEqual(answers(poll,[]),[]);
  for(const bad of [{},null,[null],[{date:'foreign',availability:'available'}],[{date:'2028-03-02',availability:''}],[{date:'2028-03-02',availability:'yes'}],[{date:'2028-03-02',availability:'available',actor:'other'}],[value[0],value[0]]])assert.throws(()=>answers(poll,bad));
});
