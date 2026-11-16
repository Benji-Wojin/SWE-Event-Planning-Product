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
    const receipt=await Project({searchParams:Promise.resolve({project:'school',guide:'1',day:'2032-02-29',task:'task-123',review:'completion'})});
    globalThis.__signedOut=true;
    await assert.rejects(receipt.type(receipt.props),/sign-in/);
    assert.equal(globalThis.__returnPath,'/project?project=school&guide=1&day=2032-02-29&task=task-123&review=completion');
    globalThis.__signedOut=false;
    assert.equal((await receipt.type(receipt.props)).props.children[1].props.src,'/workspace.html?project=school&guide=1&day=2032-02-29&task=task-123&review=completion#tasks');
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
    assert.equal(await landing({project:'school',task:'task-123',review:'amendment'}),'/workspace.html?project=school&task=task-123&review=amendment#tasks');
    assert.equal(await landing({project:'school',guide:'1',task:'task-123',review:'owner'}),'/workspace.html?project=school&guide=1&task=task-123&review=owner#tasks');
    assert.equal(globalThis.__returnPath,'/project?project=school&guide=1&task=task-123&review=owner');
    assert.equal(await landing({project:'school',guide:'1',task:'task-123',review:'schedule'}),'/workspace.html?project=school&guide=1&task=task-123&review=schedule#tasks');
    assert.equal(globalThis.__returnPath,'/project?project=school&guide=1&task=task-123&review=schedule');
    for (const review of ['owner', 'schedule', 'completion', 'amendment']) {
      const page = await Project({searchParams: Promise.resolve({project:'school',guide:'1',task:'task-123',review,from:'plan-receipt'})});
      const query = `project=school&guide=1&task=task-123&review=${review}&from=plan-receipt`;
      globalThis.__signedOut = true;
      await assert.rejects(page.type(page.props), /sign-in/);
      assert.equal(globalThis.__returnPath, '/project?' + query);
      globalThis.__signedOut = false;
      assert.equal((await page.type(page.props)).props.children[1].props.src, '/workspace.html?' + query + '#tasks');
    }
    const returnable = {project:'school',task:'task-123',review:'owner',from:'plan-receipt'};
    for (const conflicts of [
      {project:undefined}, {project:['school']}, {project:''}, {task:['task-123']}, {task:'invalid task'},
      {review:['owner']}, {review:'help'}, {review:'review-blocked'}, {review:''}, {review:undefined},
      {demo:'1'}, {demo:['1']}, {day:'2032-02-29'}, {day:'not-a-day'}, {message:'mail-1'}, {activity:'other-task'}, {welcome:'1'},
      {from:['plan-receipt']}, {from:'https://external.example/'},
    ]) {
      assert.doesNotMatch(await landing({...returnable,...conflicts}), /[?&]from=/, JSON.stringify(conflicts));
      assert.doesNotMatch(globalThis.__returnPath, /[?&]from=/, JSON.stringify(conflicts));
    }
    for (const review of ['completion','amendment']) {
      for (const competing of [{day:''},{activity:'another-task'},{message:'mail-1'},{welcome:'1'},{demo:['0','1']}]) {
        assert.doesNotMatch(await landing({...returnable,review,...competing}), /[?&]from=/, JSON.stringify(competing));
        assert.doesNotMatch(globalThis.__returnPath, /[?&]from=/, JSON.stringify(competing));
      }
    }
    for(const review of ['help','review-blocked',['completion','amendment'],'']){
      assert.equal(await landing({project:'school',task:'task-123',review}),'/workspace.html?project=school&task=task-123#tasks');
    }
    assert.equal(await landing({project:'school',task:['task-123','task-456'],review:'completion'}),'/workspace.html?project=school');
    assert.equal(await landing({project:'school',review:'completion'}),'/workspace.html?project=school');
    const scheduled=await Project({searchParams:Promise.resolve({project:'school',guide:'1',activity:'task-123',welcome:'1'})});
    globalThis.__signedOut=true;
    await assert.rejects(scheduled.type(scheduled.props),/sign-in/);
    assert.equal(globalThis.__returnPath,'/project?project=school&guide=1&activity=task-123');
    globalThis.__signedOut=false;
    assert.equal((await scheduled.type(scheduled.props)).props.children[1].props.src,'/workspace.html?project=school&guide=1&activity=task-123#timeline');
    for (const activity of [['task-123','task-456'],'bad activity','']) {
      assert.equal(await landing({project:'school',activity}),'/workspace.html?project=school');
    }
    assert.equal(await landing({activity:'task-123'}),'/workspace.html?project=main');
    assert.equal(await landing({project:'school',activity:'task-123',demo:['0','1']}),'/workspace.html?project=school');
    assert.equal(await landing({project:'school',activity:'task-123',task:'task-456',review:'owner'}),'/workspace.html?project=school&task=task-456&review=owner#tasks');
    assert.equal(await landing({project:'school',activity:'task-123',message:'mail-1'}),'/workspace.html?project=school&message=mail-1#inbox');
    assert.equal(await landing({project:'school',activity:'task-123',review:'owner'}),'/workspace.html?project=school');
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

test('the standalone planner preserves a valid receipt return hint through sign-in without sending it to the planner API', async () => {
  const stubs = {
    '@/app/chatgpt-auth': 'export async function requireChatGPTUser(path){ globalThis.__planReturnPath=path; if(globalThis.__planSignedOut) throw Error("sign-in"); }',
    '@/components/theme-toggle': 'export const ThemeToggle="theme-toggle";',
    './plan-client': 'export const PlanReview="plan-review";',
    './suggestion-feed': 'export const SuggestionFeed="suggestion-feed";',
    'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
  };
  const bundle = await build({entryPoints:['app/plan/page.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'plan-page-stubs',setup(b){
    b.onResolve({filter:/./}, args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'plan-page-test'}:null);
    b.onLoad({filter:/./,namespace:'plan-page-test'},args=>({contents:stubs[args.path],loader:'js'}));
  }}]});
  const { default: Plan } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const render = params => Plan({ searchParams: Promise.resolve(params) });
  const planProps = node => [].concat(node.props.children).find(child => child?.type === 'plan-review')?.props;
  const valid = { project: 'school & plus', guide: '1', receiptTask: 'task-123' };
  try {
    globalThis.__planSignedOut = true;
    await assert.rejects(render(valid), /sign-in/);
    assert.equal(globalThis.__planReturnPath, '/plan?project=school%20%26%20plus&guide=1&receiptTask=task-123');
    globalThis.__planSignedOut = false;
    const props = planProps(await render(valid));
    assert.equal(props.receiptTask, 'task-123');
    assert.equal(props.receiptHandoff, true);
    assert.equal(props.query, 'project=school%20%26%20plus');
    assert.equal(props.guided, true);

    for (const variant of [
      { project: undefined }, { project: ['school'] }, { project: '' },
      { receiptTask: ['task-123'] }, { receiptTask: 'bad task' },
      { demo: '1' }, { demo: ['1'] }, { mode: 'suggestions' }, { mode: 'assistant' }, { embed: '1' },
    ]) {
      const rendered = await render({ ...valid, ...variant });
      assert.ok(!planProps(rendered)?.receiptTask, JSON.stringify(variant));
      assert.doesNotMatch(globalThis.__planReturnPath, /[?&]receiptTask=/, JSON.stringify(variant));
    }
    assert.equal(planProps(await render({ receiptTask: 'task-123' })).receiptHandoff, false);
    assert.equal(planProps(await render({ project: 'main', receiptTask: 'task-123' })).receiptHandoff, true);
  } finally {
    delete globalThis.__planSignedOut;
    delete globalThis.__planReturnPath;
  }
});
