import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
let plan,research,page,policy,databaseCalls=0,authCalls=0;
before(async()=>{
  globalThis.__comingSoonEnv={GATHER_ORIGIN:'https://weft.example',get DB(){databaseCalls++;throw Error('Disabled assistant must not access data');}};
  globalThis.__comingSoonAuth=()=>{authCalls++;return {userId:'fictional',email:'fictional@example.com'};};
  mkdirSync('work',{recursive:true});
  const outdir=mkdtempSync(join(process.cwd(),'work/coming-soon-'));
  await build({entryPoints:{plan:'app/api/plan/route.ts',research:'app/api/research/route.ts',page:'app/plan/page.tsx',policy:'lib/release-policy.ts'},outdir,outExtension:{'.js':'.mjs'},bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react-dom'],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},plugins:[{name:'fictional-runtime',setup(b){
    b.onResolve({filter:/^@\/lib\/runtime$/},()=>({path:'runtime',namespace:'fixture'}));
    b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='runtime'?'export const env=globalThis.__comingSoonEnv;':'export async function getChatGPTUser(){return globalThis.__comingSoonAuth();} export async function requireChatGPTUser(){return globalThis.__comingSoonAuth();}'}));
  }}]});
  for(const name of ['plan','research','page','policy']){
    const module=await import(pathToFileURL(join(outdir,name+'.mjs')).href);
    if(name==='plan')plan=module;if(name==='research')research=module;if(name==='page')page=module;if(name==='policy')policy=module;
  }
});
test('real release policy stays off regardless of env switches',()=>{
  process.env.ASK_WEFT_ENABLED='true';assert.equal(policy.ASK_WEFT_ENABLED,false);delete process.env.ASK_WEFT_ENABLED;
});
test('assistant GET and all POST actions reject before auth, data, body parsing or provider work',async()=>{
  const beforeAuth=authCalls;
  for(const path of ['/api/plan?project=fictional&mode=assistant','/api/plan?demo=1&as=jack&mode=assistant']){
    const get=await plan.GET(new Request('https://weft.example'+path));assert.equal(get.status,503);assert.match((await get.json()).error,/coming soon/);assert.match(get.headers.get('Cache-Control'),/no-store/);
    for(const action of ['generate','save','apply','configure','discard']){
      const request=new Request('https://weft.example'+path,{method:'POST',headers:{Origin:'https://weft.example','Content-Type':'application/json'},body:JSON.stringify({action})});
      const response=await plan.POST(request);assert.equal(response.status,503);assert.equal(request.bodyUsed,false);
    }
  }
  assert.equal(databaseCalls,0);assert.equal(authCalls,beforeAuth);
});
test('Ask Weft research is also unavailable, with no data or provider access',async()=>{
  const beforeAuth=authCalls;
  for(const method of ['GET','POST']){
    const response=await research[method](new Request('https://weft.example/api/research?project=fictional',{method,...(method==='POST'?{body:'{}'}:{})}));assert.equal(response.status,503);
  }
  assert.equal(databaseCalls,0);assert.equal(authCalls,beforeAuth);
});
test('direct assistant links show coming soon without mounting a chat or iframe',async()=>{
  for(const embed of [undefined,'1']){
    const html=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({project:'fictional&other=1',mode:'assistant',embed})}));
    assert.match(html,/Ask Weft/);assert.match(html,/Coming soon/);assert.match(html,/project=fictional%26other%3D1/);assert.doesNotMatch(html,/<iframe|<textarea|<form/);
  }
});
test('workspace button is natively disabled and cannot dispatch an assistant launch',()=>{
  for(const file of ['legacy/index.html','public/workspace.html']){
    const html=readFileSync(file,'utf8'),button=html.match(/<button[^>]*id="askWeftButton"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button);assert.match(button,/ disabled/);assert.match(button,/aria-disabled="true"/);assert.match(button,/Coming soon/);assert.doesNotMatch(button,/data-action/);
  }
  assert.doesNotMatch(readFileSync('legacy/app.js','utf8'),/agentPopup\.open\(/);
});
