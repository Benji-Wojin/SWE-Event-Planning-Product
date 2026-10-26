import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

test('prepared outputs replace complete files atomically, preserving prior bytes on write failure',()=>{
  const source=readFileSync('scripts/prepare.mjs','utf8'),start=source.indexOf('function writeFileSync(');
  const wrapper=source.slice(start,source.indexOf("mkdirSync('public/gather-assets'",start));
  for(const failure of ['', 'write', 'rename']){
    const files=new Map([['public/asset.js','previous complete bytes']]),calls=[];
    const context=vm.createContext({process:{pid:123},writePreparedFile(path,content){
      assert.equal(files.get('public/asset.js'),'previous complete bytes');calls.push(['write',path]);
      if(failure==='write')throw Error('write failed');files.set(path,content);
    },renameSync(from,to){
      assert.equal(files.get('public/asset.js'),'previous complete bytes');calls.push(['rename',from,to]);
      if(failure==='rename')throw Error('rename failed');files.set(to,files.get(from));files.delete(from);
    }});
    vm.runInContext(wrapper,context);
    if(failure){assert.throws(()=>context.writeFileSync('public/asset.js','new complete bytes'));assert.equal(files.get('public/asset.js'),'previous complete bytes');}
    else{context.writeFileSync('public/asset.js','new complete bytes');assert.equal(files.get('public/asset.js'),'new complete bytes');assert.deepEqual(calls,[['write','public/asset.js.tmp-123'],['rename','public/asset.js.tmp-123','public/asset.js']]);}
  }
});

test('workspace preloads code in parallel with fresh data, using matching content-addressed URLs',()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  const html=readFileSync('public/workspace.html','utf8');
  const urls=[...new Set(html.match(/\/gather-assets\/versioned\/[a-f0-9]{20}-[a-z-]+\.(?:js|css)/g))];
  assert.equal(urls.length,20);
  assert.ok(urls.some(url=>url.endsWith('-wrap-up.js')));
  assert.ok(urls.some(url=>url.endsWith('-reschedule.js')));
  assert.ok(urls.some(url=>url.endsWith('-completion-ui.js')));
  assert.ok(urls.some(url=>url.endsWith('-planning-ui.js')));
  assert.ok(urls.some(url=>url.endsWith('-budget.js')));
  assert.ok(urls.some(url=>url.endsWith('-budget-ui.js')));
  for(const url of urls){
    const hash=createHash('sha256').update(readFileSync('public'+url)).digest('hex').slice(0,20);
    assert.ok(url.includes('/'+hash+'-'),url+' must match its bytes');
  }
  const app=urls.find(url=>url.endsWith('-app.js'));
  assert.ok(html.indexOf(`rel="preload" as="script" href="${app}"`)<html.indexOf('</head>'));
  const store=readFileSync('public'+urls.find(url=>url.endsWith('-hosted-store.js')),'utf8');
  assert.ok(store.includes('script.src = '+JSON.stringify(app)));
  assert.ok(store.indexOf('publish(await request())')<store.indexOf('document.body.append(script)'),'preload must not execute before identity/data validation');
  assert.match(store,/cache: 'no-store'/);
  assert.doesNotMatch(html,/rel="(?:prefetch|preload)"[^>]+(?:\/api\/|\/account|\/feedback|\/signin)/);
  for(const tag of html.match(/<script[^>]+>/g)){
    if(tag.includes('-theme.js'))assert.doesNotMatch(tag,/defer/);
    else assert.match(tag,/defer/,'workspace scripts must download together, execute in document order');
  }
});

test('long-lived caching is limited to fingerprinted public code, with compatible unversioned fallbacks',()=>{
  const config=readFileSync('next.config.ts','utf8');
  assert.match(config,/source: '\/gather-assets\/versioned\/:path\*',[\s\S]*?max-age=31536000, immutable/);
  assert.equal((config.match(/Cache-Control/g)||[]).length,1);
  assert.equal(readFileSync('public/gather-assets/hosted-store.js','utf8'),readFileSync('legacy/hosted-store.js','utf8'));
  assert.match(readFileSync('lib/security.ts','utf8'),/no-store/);
});
