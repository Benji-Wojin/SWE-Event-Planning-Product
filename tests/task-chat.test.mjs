import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
let TaskChat;
before(async()=>{
  const bundle=await build({entryPoints:['app/plan/task-chat.tsx'],bundle:true,platform:'node',format:'esm',write:false,jsx:'automatic',plugins:[{name:'chat-ui',setup(b){
    b.onResolve({filter:/^react(?:\/jsx-runtime)?$|^@\/components\/ui\//},args=>({path:args.path,namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:args.path==='react'?'export const useState=(v)=>globalThis.__taskChatHooks(v),useRef=v=>({current:v}),useEffect=()=>{};':args.path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";':'export const Button="button",Textarea="textarea",Label="label";'}));
  }}]});
  ({TaskChat}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
test('task context prepares an editable private message only after a click; it never sends or replaces current text by itself',async()=>{
  let message='Unsent current message',seeds=[],dismissed=0,sends=0;
  globalThis.__taskChatHooks=initial=>[message??initial,value=>message=value];
  const props={brief:{description:''},applied:false,locked:false,configured:true,failed:false,taskContextTitle:'Plan a fictional school dance <script>',onSend:async()=>{sends++;return true;},onDirty(){},onNew:value=>seeds.push(value),onDismissTaskContext:()=>dismissed++};
  try{
    let tree=TaskChat(props);assert.equal(message,'Unsent current message');assert.equal(sends,0);assert.match(text(tree),/Task notes are not copied/);assert.match(text(tree),/will not change or link the original task automatically/);
    nodes(tree).find(n=>text(n)==='Prepare new message'&&n.type==='button').props.onClick();assert.equal(seeds.length,1);assert.ok(seeds[0].includes(JSON.stringify(props.taskContextTitle)));assert.equal(message,'Unsent current message');assert.equal(sends,0);
    nodes(tree).find(n=>text(n)==='Keep current conversation'&&n.type==='button').props.onClick();assert.equal(dismissed,1);assert.equal(message,'Unsent current message');
    tree=TaskChat({...props,locked:true});assert.equal(nodes(tree).find(n=>text(n)==='Prepare new message'&&n.type==='button').props.disabled,true);
    message=null;tree=TaskChat({...props,initialMessage:seeds[0]});assert.equal(nodes(tree).find(n=>n.type==='textarea').props.value,seeds[0]);assert.equal(sends,0);
    nodes(tree).find(n=>text(n)==='New conversation'&&n.type==='button').props.onClick({type:'click'});assert.equal(seeds.at(-1),undefined,'React event is not treated as seed text');
  }finally{delete globalThis.__taskChatHooks;}
});
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
    assert.match(text(tree),/cited research/);assert.match(text(tree),/draft isn’t proof/);
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
test('one composer routes standalone web requests, discloses transmission and preserves failed drafts',async()=>{
  let message='Find outdoor venues in Seattle',searches=[],plans=[],dirty=true,resolve;
  globalThis.__taskChatHooks=()=>[message,value=>message=value];
  const research={data:{configured:true,status:'ready',query:'Prior private search',answer:'DO NOT COPY WEB RESULT',sources:[],generatedAt:new Date().toISOString()},busy:false,error:'',uncertain:false,search:async q=>{searches.push(q);return new Promise(r=>resolve=r);},reload:async()=>{}};
  const props={brief:{kind:'other',description:JSON.stringify([{role:'user',content:'Plan a welcome task'}]),endDate:'',startTime:'',endTime:''},applied:false,locked:false,configured:true,failed:false,onSend:async value=>{plans.push(value);return true;},onDirty:value=>dirty=value,onNew(){},research};
  try{
    let tree=TaskChat(props),form=nodes(tree).find(n=>n.type==='form');assert.equal(nodes(tree).filter(n=>n.type==='textarea').length,1);assert.match(text(tree),/this message only/);assert.match(text(tree),/Send & search/);
    const first=form.props.onSubmit({preventDefault(){}});await form.props.onSubmit({preventDefault(){}});assert.equal(searches.length,1);assert.equal(plans.length,0);resolve(false);await first;assert.equal(message,'Find outdoor venues in Seattle');assert.equal(dirty,true);
    props.research={...research,data:{...research.data,configured:false}};tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(searches.length,1);assert.equal(plans.length,0);assert.match(text(tree),/Nothing will be sent/);
    message='Find me something';props.research=research;tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(searches.length,1);assert.equal(plans.length,0);assert.match(text(tree),/What would you like me to find/);
    message='Write a welcome announcement';tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(plans.length,1);assert.doesNotMatch(plans[0].description,/Prior private search|DO NOT COPY WEB RESULT/);
  }finally{delete globalThis.__taskChatHooks;}
});
test('web limits are independent of planning transcript capacity; Enter respects composition and Shift',async()=>{
  let message='Find venues '+'x'.repeat(1200),searches=0,plans=0,submits=0;
  globalThis.__taskChatHooks=()=>[message,v=>message=v];
  const props={brief:{description:JSON.stringify([{role:'user',content:'x'.repeat(1800)},{role:'assistant',content:'y'.repeat(1700)},{role:'user',content:'z'.repeat(400)}])},applied:false,locked:false,configured:true,failed:false,onSend:async()=>{plans++;return true;},onDirty(){},onNew(){},research:{data:{configured:true,status:'empty'},search:async()=>{searches++;return true;},reload:async()=>{},busy:false,error:'',uncertain:false}};
  try{
    let tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(searches,0);
    message='Find venues in Seattle';tree=TaskChat(props);await nodes(tree).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(searches,1);assert.equal(plans,0);
    const handler=nodes(tree).find(n=>n.type==='textarea').props.onKeyDown,base={key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},currentTarget:{form:{requestSubmit(){submits++;}}},preventDefault(){}};handler({...base,shiftKey:true});handler({...base,nativeEvent:{isComposing:true}});assert.equal(submits,0);handler(base);assert.equal(submits,1);
  }finally{delete globalThis.__taskChatHooks;}
});
