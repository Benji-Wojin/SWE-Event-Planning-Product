import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {build} from 'esbuild';

let Team;
before(async()=>{
  const result=await build({entryPoints:['app/team/page.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',
    plugins:[{name:'team-route-boundaries',setup(b){
      b.onResolve({filter:/^@\/lib\/(?:project-access|workspace-task-link)$/},args=>({path:resolve(args.path.slice(2)+'.ts')}));
      b.onResolve({filter:/^\.\/security$/},args=>args.importer.endsWith('/lib/project-access.ts')?{path:'@/lib/security',namespace:'mock'}:null);
      b.onResolve({filter:/^@\/|^react\/jsx-runtime$|^\.\/team-client$/},args=>({path:args.path,namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:{
        '@/app/chatgpt-auth':'export async function requireChatGPTUser(path){globalThis.__teamRouteReads.auth.push(path);if(!globalThis.__teamRouteReads.signedIn)throw {redirect:"/sign-in?return_to="+encodeURIComponent(path)};}',
        '@/lib/security':'export class HttpError extends Error{ constructor(status){super("fixture");this.status=status;} } export async function principal(){return {userId:"fixture-member"};}',
        '@/lib/runtime':'export const env={};',
        '@/lib/guided-tutorial-store':'export async function readTutorialProgress(){globalThis.__teamRouteReads.tutorial++;return {projectId:"main",events:[]};}',
        '@/lib/guided-tutorial':'export const nextTutorialMilestone=()=>"invite_created";',
        '@/components/account-layout':'export const AccountLayout="account-layout";',
        './team-client':'export const TeamClient="team-client";',
        'react/jsx-runtime':'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";',
      }[args.path]}));
    }}],
  });
  ({default:Team}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')));
});

const project='p_12345678-1234-4234-8234-123456789abc', task='fixture-owner-gap', receiptPlan='de22719e-0292-4545-a5dd-fd2e50c5969e';
const mode={project,from:'plan-handoff',receiptPlan};
async function render(params){
  const pending=await Team({searchParams:Promise.resolve(params)});
  const page=await pending.type(pending.props);
  assert.equal(page.type,'account-layout');
  assert.equal(page.props.children.type,'team-client');
  return page.props.children.props;
}

test('Team sign-in preserves the canonical handoff and returns only to the exact scoped plan or its heading',async()=>{
  const reads={auth:[],tutorial:0,signedIn:false};globalThis.__teamRouteReads=reads;
  try{
    const entry=`/team?project=${project}&from=plan-handoff&receiptPlan=${receiptPlan}&receiptTask=${task}&resumeGuide=1`;
    const params={...mode,receiptTask:task,resumeGuide:'1',next:'https://outside.example.test/'};
    await assert.rejects(render(params),error=>error.redirect==='/sign-in?return_to='+encodeURIComponent(entry));
    reads.signedIn=true;
    assert.deepEqual(await render(params),{projectId:project,guided:false,tutorial:false,
      handoffHref:`/plan?project=${project}&receiptPlan=${receiptPlan}&receiptTask=${task}&guide=1`});
    assert.deepEqual(reads.auth,[entry,entry]);
    assert.equal(reads.tutorial,0,'resuming a plan guide is not the invitation tutorial');
    assert.equal((await render(mode)).handoffHref,`/plan?project=${project}&receiptPlan=${receiptPlan}`);
    assert.equal((await render({...mode,resumeGuide:'1'})).handoffHref,`/plan?project=${project}&receiptPlan=${receiptPlan}&guide=1`);
  }finally{delete globalThis.__teamRouteReads;}
});

test('malformed, multivalued, missing-project, and mixed guided entries cannot opt into the plan handoff',async()=>{
  const reads={auth:[],tutorial:0,signedIn:true};globalThis.__teamRouteReads=reads;
  try{
    for(const params of [
      {...mode,project:'unscoped'}, {from:'plan-handoff'}, {...mode,project:[project,'main']},
      {...mode,from:['plan-handoff','other']}, {...mode,from:'elsewhere'},
      {...mode,receiptPlan:undefined}, {...mode,receiptPlan:['other',receiptPlan]}, {...mode,receiptPlan:'bad&project=main'},
      {...mode,receiptTask:['a',task]}, {...mode,receiptTask:'a&project=main'},
      {...mode,resumeGuide:'0'}, {...mode,resumeGuide:['1','1']}, {...mode,start:'1'}, {...mode,guide:'1'},
    ]){
      const props=await render({...params,next:'https://outside.example.test/'});
      assert.equal(props.handoffHref,'',JSON.stringify(params));
      assert.doesNotMatch(reads.auth.at(-1),/from=|receiptPlan=|receiptTask=|resumeGuide=|next=|outside\.example/);
    }
    assert.equal((await render({project,start:'1'})).guided,true,'ordinary invite onboarding remains available');
    assert.equal((await render({project:'main',guide:'1'})).tutorial,true,'the existing invitation tutorial remains scoped');
  }finally{delete globalThis.__teamRouteReads;}
});
