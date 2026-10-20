import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let TaskChat;
before(async()=>{
  const bundle=await build({entryPoints:['app/plan/task-chat.tsx'],bundle:true,platform:'node',format:'esm',write:false,jsx:'automatic',plugins:[{name:'chat-ui',setup(b){
    b.onResolve({filter:/^react(?:\/jsx-runtime)?$|^@\/components\/ui\//},args=>({path:args.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:args.path==='react'?'export const useState=(v)=>globalThis.__taskChatHooks(v);':args.path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props}),jsxs=jsx;':'export const Button="button",Textarea="textarea",Label="label";'}));
  }}]});
  ({TaskChat}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
test('chat asks only the current clarification and preserves unsent input on transport rejection',async()=>{
  let message='',sent=[],dirty=[];
  globalThis.__taskChatHooks=()=>[message,value=>{message=value;}];
  const props={brief:{kind:'other',description:JSON.stringify([{role:'user',content:'Create signs task'}]),endDate:'',startTime:'',endTime:''},question:'Where should signs go?',applied:false,locked:false,configured:true,failed:false,onSend:async value=>{sent.push(value);return false;},onDirty:value=>dirty.push(value)};
  try {
    let tree=TaskChat(props);assert.match(text(tree),/one quick question/);
    nodes(tree).find(n=>n.type==='textarea').props.onChange({target:{value:'At check-in'}});
    tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(message,'At check-in');assert.equal(dirty.at(-1),true);
    assert.deepEqual(JSON.parse(sent[0].description),[{role:'user',content:'Create signs task'},{role:'assistant',content:'Where should signs go?'},{role:'user',content:'At check-in'}]);
    props.onSend=async()=>true;tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.equal(message,'');assert.equal(dirty.at(-1),false);
    props.brief.description=sent[0].description;tree=TaskChat(props);assert.doesNotMatch(text(tree),/one quick question/);
  }finally{delete globalThis.__taskChatHooks;}
});
test('written-draft followups share a bounded excerpt and disclose capability limits',async()=>{
  let message='Make it friendlier',sent;
  globalThis.__taskChatHooks=()=>[message,value=>{message=value;}];
  try{
    const tree=TaskChat({brief:{kind:'other',description:JSON.stringify([{role:'user',content:'Write a welcome message'}]),endDate:'',startTime:'',endTime:''},reply:'Welcome to our event.',applied:false,locked:false,configured:true,failed:false,onSend:async value=>{sent=value;return true;},onDirty(){},onNew(){}});
    assert.match(text(tree),/can’t browse/);assert.match(text(tree),/draft isn’t proof/);
    await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
    assert.deepEqual(JSON.parse(sent.description).slice(-2),[{role:'assistant',content:'Welcome to our event.'},{role:'user',content:'Make it friendlier'}]);
  }finally{delete globalThis.__taskChatHooks;}
});
test('long written drafts remain revisable within the per-message server limit',async()=>{
  let sent;
  globalThis.__taskChatHooks=()=>['Shorten it',()=>{}];
  try{
    for(const length of [1751,1800,1801,6000]){
      const tree=TaskChat({brief:{kind:'other',description:JSON.stringify([{role:'user',content:'Write a welcome message'}]),endDate:'',startTime:'',endTime:''},reply:'x'.repeat(length),applied:false,locked:false,configured:true,failed:false,onSend:async value=>{sent=value;return true;},onDirty(){},onNew(){}});
      await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
      const rows=JSON.parse(sent.description);assert.ok(rows.every(row=>row.content.length<=1800));assert.ok(sent.description.length<=4000);if(length>1800)assert.match(rows[1].content,/Earlier draft excerpt/);
    }
  }finally{delete globalThis.__taskChatHooks;}
});
