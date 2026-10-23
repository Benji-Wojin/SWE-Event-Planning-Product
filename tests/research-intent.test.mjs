import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let researchIntent;
before(async()=>{const b=await build({entryPoints:['lib/research-intent.ts'],bundle:true,write:false,format:'esm',platform:'node'});({researchIntent}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64')));});
test('natural web requests route locally; internal, quoted and negated requests do not authorize search',()=>{
  for(const q of ['Search my tasks for the catering decision','Search our saved draft','Find my next three steps','Find our budget','Search our files','Find venues, but don’t search online'])assert.equal(researchIntent(q),'planning',q);
  for(const q of ['Find event venues near there','Find venues near me','Find activities in that city'])assert.equal(researchIntent(q),'clarify',q);
  assert.equal(researchIntent('Search for "accessible venues in Seattle"'),'search');
  for(const q of ['Find me outdoor venues in Seattle','Can you find some free museum activities in Portland?','Please search the web for current outdoor safety guidance','Look up rain plan resources','Research accessible event checklists','Where can we find printable public park maps?'])assert.equal(researchIntent(q),'search',q);
  for(const q of ['Find my tasks','Find a task I can do','Find gaps in our plan','Find our saved draft','Do not search the web; write a checklist','Find venues without searching online','Write an announcement saying "find me a venue"','"Search the web for private bookings"','Draft a day-of checklist'])assert.equal(researchIntent(q),'planning',q);
  for(const q of ['Find me something','Find something for that','Search for it','Can you look up more?'])assert.equal(researchIntent(q),'clarify',q);
});
