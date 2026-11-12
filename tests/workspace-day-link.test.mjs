import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('the signed-in project wrapper forwards valid workspace hints through sign-in without mixing join and deep links',async()=>{
  const stub={
    '@/app/chatgpt-auth':'export async function requireChatGPTUser(path){ globalThis.__returnPath=path; if(globalThis.__signedOut) throw Error("sign-in"); }',
    '@/components/app-open':'export function AppOpen(){ throw Error("Not needed for this test"); }',
    'react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
  };
  const output=await build({entryPoints:['app/project/page.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'page-stubs',setup(b){
    b.onResolve({filter:/./},a=>Object.hasOwn(stub,a.path)?{path:a.path,namespace:'test-stub'}:null);
    b.onLoad({filter:/./,namespace:'test-stub'},a=>({contents:stub[a.path],loader:'js'}));
  }}]});
  const {default:Project}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
  const props=await Project({searchParams:Promise.resolve({project:'school',day:'2032-02-29'})});
  try{
    globalThis.__signedOut=true;
    await assert.rejects(props.type(props.props),/sign-in/);
    assert.equal(globalThis.__returnPath,'/project?project=school&day=2032-02-29');
    globalThis.__signedOut=false;
    const iframe=(await props.type(props.props)).props.children[1];
    assert.equal(iframe.props.src,'/workspace.html?project=school&day=2032-02-29#timeline');
    const guided=await Project({searchParams:Promise.resolve({project:'school',guide:'1',day:'2032-02-29'})});
    assert.equal((await guided.type(guided.props)).props.children[1].props.src,'/workspace.html?project=school&guide=1&day=2032-02-29#timeline');
    const receipt=await Project({searchParams:Promise.resolve({project:'school',guide:'1',day:'2032-02-29',task:'task-123'})});
    globalThis.__signedOut=true;
    await assert.rejects(receipt.type(receipt.props),/sign-in/);
    assert.equal(globalThis.__returnPath,'/project?project=school&guide=1&day=2032-02-29&task=task-123');
    globalThis.__signedOut=false;
    assert.equal((await receipt.type(receipt.props)).props.children[1].props.src,'/workspace.html?project=school&guide=1&day=2032-02-29&task=task-123#tasks');
    const invalidTask=await Project({searchParams:Promise.resolve({project:'school',day:'2032-02-29',task:['a','b']})});
    assert.equal((await invalidTask.type(invalidTask.props)).props.children[1].props.src,'/workspace.html?project=school&day=2032-02-29#timeline');
    for(const day of ['2030-02-29',['2032-02-29','2032-03-01'],'0000-01-01']){
      const next=await Project({searchParams:Promise.resolve({project:'school',day,message:'mail-1'})});
      const body=await next.type(next.props);
      assert.equal(globalThis.__returnPath,'/project?project=school&message=mail-1');
      assert.equal(body.props.children[1].props.src,'/workspace.html?project=school&message=mail-1#inbox');
    }
    const landing = async params => {
      const page = await Project({searchParams:Promise.resolve(params)});
      return (await page.type(page.props)).props.children[1].props.src;
    };
    assert.equal(await landing({project:'school',welcome:'1',invite:'not-forwarded'}),'/workspace.html?project=school&welcome=1');
    assert.equal(globalThis.__returnPath,'/project?project=school&welcome=1');
    for (const welcome of [['1'],['1','1'],'0','true','']) {
      assert.equal(await landing({project:'school',welcome}),'/workspace.html?project=school');
    }
    assert.equal(await landing({project:['school','other'],welcome:'1'}),'/workspace.html?project=main');
    assert.equal(await landing({welcome:'1'}),'/workspace.html?project=main');
    assert.equal(await landing({project:'school',welcome:'1',guide:'1'}),'/workspace.html?project=school&guide=1');
    assert.equal(await landing({project:'school',welcome:'1',task:'task-123',message:'mail-1',day:'2032-02-29'}),'/workspace.html?project=school&message=mail-1&day=2032-02-29&task=task-123#tasks');
  }finally{
    delete globalThis.__returnPath;
    delete globalThis.__signedOut;
  }
});
