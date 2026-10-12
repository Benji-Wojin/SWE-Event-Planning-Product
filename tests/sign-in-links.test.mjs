import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
let links,button;
before(async()=>{
  const directory=mkdtempSync(join(tmpdir(),'weft-signin-links-'));
  await build({entryPoints:{links:'lib/workspace-return.ts',button:'app/signin-with-chatgpt/sign-in-button.tsx'},outdir:directory,bundle:true,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'sign-in-test',setup(b){
    b.onResolve({filter:/^(react(?:\/jsx-runtime)?|next-auth\/react)$/},args=>({path:args.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:{
      react:'export const useState = value => [value, () => {}];',
      'react/jsx-runtime':'export const Fragment="fragment"; export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;',
      'next-auth/react':'export async function signIn(provider,options){globalThis.__signInLink={provider,options};}',
    }[args.path]}));
  }}]});
  links=await import(pathToFileURL(join(directory,'links.js')));button=await import(pathToFileURL(join(directory,'button.js')));
});
test('workspace return paths retain project or demo identity and recognized section',()=>{
  for(const section of ['overview','tasks','inbox','updates','team','info','timeline','memory','details'])
    assert.equal(links.workspaceSignInReturn('/project?project=p_test','#'+section),'/project?project=p_test#'+section);
  assert.equal(links.workspaceSignInReturn('/demo?as=maya','#timeline'),'/demo?as=maya#timeline');
  assert.equal(links.workspaceSignInReturn('/project?project=p_test&message=m1','#inbox'),'/project?project=p_test&message=m1#inbox');
});
test('sign-in fragment never changes destinations or overrides an explicit section',()=>{
  for(const path of ['/','/settings?project=p_test','/join?token=fictional','//evil.example/project','https://evil.example/project','/project#tasks','/project\\evil','/project\n'])
    assert.equal(links.workspaceSignInReturn(path,'#info'),path);
  for(const hash of ['','#constructor','#https://evil.example','#info?extra=1','#%69nfo','info','#info\n'])
    assert.equal(links.workspaceSignInReturn('/project?project=p_test',hash),'/project?project=p_test');
});
test('actual sign-in button passes section callback to the existing Google SDK flow',async()=>{
  const prior=globalThis.window;
  try {
    globalThis.window={location:{hash:'#timeline'}};
    const rendered=button.SignInButton({returnTo:'/project?project=p_test'});
    rendered.props.children[0].props.onClick();
    await Promise.resolve();
    assert.deepEqual(globalThis.__signInLink,{provider:'google',options:{callbackUrl:'/project?project=p_test#timeline'}});
  } finally {globalThis.window=prior;delete globalThis.__signInLink;}
});
