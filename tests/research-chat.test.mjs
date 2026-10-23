import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let useResearch;
before(async()=>{const result=await build({entryPoints:['app/plan/use-research.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({loader:'js',contents:'export const useState=v=>globalThis.__researchHooks.state(v),useRef=v=>globalThis.__researchHooks.ref(v),useEffect=(fn,deps)=>globalThis.__researchHooks.effect(fn,deps);'}));}}]});({useResearch}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')));});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('integrated research hook never auto-posts, blocks duplicate/lost-response sends and clears revoked results',async()=>{
  const values=[],effects=[];let index=0,sendFails=true,revoked=false,calls=[];
  globalThis.__researchHooks={state(v){const n=index++;if(!(n in values))values[n]=v;return [values[n],v=>values[n]=v];},ref(v){const n=index++;return values[n]??={current:v};},effect(fn){const n=index++;if(!(n in values)){values[n]=true;effects.push(fn);}}};
  const base={configured:true,revision:'r1',status:'empty',query:'',answer:'',sources:[],retryAfter:0},oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{calls.push({url,options});if(revoked)return Response.json({error:'Access changed'},{status:403});if(options.method==='POST'){const sent=JSON.parse(options.body);assert.deepEqual(Object.keys(sent).sort(),['consent','consentVersion','query','requestId','revision']);assert.equal(sent.query,'Find outdoor venues in Seattle');assert.equal(sent.consent,true);if(sendFails)throw Error('Lost response');}return Response.json(base);};
  const render=()=>{index=0;return useResearch('project=main',false,()=>{});};
  try{
    let controller=render();for(const effect of effects)effect();await tick();controller=render();assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
    const first=controller.search('Find outdoor venues in Seattle');assert.equal(await controller.search('Find outdoor venues in Seattle'),false);assert.equal(await first,false);controller=render();assert.equal(controller.uncertain,true);assert.match(controller.error,/Check search status/);assert.equal(await controller.search('Find outdoor venues in Seattle'),false);assert.equal(calls.length,2);
    sendFails=false;base.status='ready';base.query='Find outdoor venues in Seattle';base.answer='PRIVATE RESULT';await controller.reload();controller=render();assert.equal(controller.data.answer,'PRIVATE RESULT');assert.equal(controller.uncertain,false);
    revoked=true;await controller.reload();controller=render();assert.equal(controller.data,null);assert.equal(calls.filter(c=>c.options.method==='POST').length,1);
  }finally{globalThis.fetch=oldFetch;delete globalThis.__researchHooks;}
});
test('pending searches and reloads cannot display a result or error after changing project scope',async()=>{
  for(const mode of ['search','reload','error']){
    const values=[],effects=[];let index=0,query='project=a',held,hold=false;
    globalThis.__researchHooks={state(v){const n=index++;if(!(n in values))values[n]=v;return [values[n],v=>values[n]=v];},ref(v){const n=index++;return values[n]??={current:v};},effect(fn,deps){const n=index++;if(values[n]?.dep!==deps[0]){values[n]?.cleanup?.();values[n]={dep:deps[0]};effects.push(()=>values[n].cleanup=fn());}}};
    const original=globalThis.fetch;
    globalThis.fetch=async(url)=>{
      if(hold&&url.endsWith('project=a'))return new Promise((resolve,reject)=>held={resolve,reject});
      return Response.json({configured:true,revision:'r1',status:'ready',query:'',answer:url.endsWith('project=b')?'B RESULT':'A RESULT',sources:[]});
    };
    const render=()=>{index=0;const c=useResearch(query,false,()=>{});while(effects.length)effects.shift()();return c;};
    try{
      render();await tick();let c=render();hold=true;
      const pending=mode==='search'?c.search('Find outdoor venues in Seattle'):c.reload();
      query='project=b';assert.equal(render().data,null);await tick();c=render();assert.equal(c.data.answer,'B RESULT');
      if(mode==='error')held.reject(Error('A PRIVATE ERROR'));else held.resolve(Response.json({configured:true,revision:'r2',status:'ready',query:'',answer:'A PRIVATE RESULT',sources:[]}));
      await pending;c=render();assert.equal(c.data.answer,'B RESULT');assert.equal(c.error,'');assert.equal(c.busy,false);
    }finally{globalThis.fetch=original;delete globalThis.__researchHooks;}
  }
});
