// Fictional projects, mocked provider. No live calls or credentials.
export async function taskAssistantTests({t,assert,sqlite,owner,request,planApi,workspace,newTeamProject,joinPerson,asTeammate}) {
  const originalFetch=globalThis.fetch,originalKey=globalThis.__gatherEnv.GROQ_API_KEY;
  globalThis.__gatherEnv.GROQ_API_KEY='fictional-assistant-key';
  const base={id:'welcome',kind:'preparation',title:'Prepare welcome signs',category:'Venue',note:'Prepare signs for the check-in desk.',dueDate:'',start:'',end:'',location:'',dependsOn:[],existingTaskIndex:null};
  let output={items:[base],questions:[],assumptions:[]},calls=[];
  const response=()=>Response.json({id:'fixture',model:'openai/gpt-oss-20b',choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]});
  globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'openai/gpt-oss-20b');assert.equal(body.tools,undefined);calls.push(body);return response();};
  const path=id=>'/api/plan?project='+id+'&mode=assistant';
  const read=async id=>{const r=await planApi.GET(new Request('https://gather.example'+path(id)));assert.equal(r.status,200,await r.clone().text());return r.json();};
  const post=(id,data)=>planApi.POST(request(path(id),data));
  const ws=async id=>(await workspace.GET(new Request('https://gather.example/api/workspace?project='+id))).json();
  const cool=id=>sqlite.prepare('UPDATE plan_drafts SET started_at=0 WHERE workspace_id=?').run(id);
  const brief=rows=>({kind:'other',description:JSON.stringify(rows),endDate:'',startTime:'',endTime:''});
  const generate=async(id,rows,extra={})=>{const s=await read(id);return post(id,{action:'generate',revision:s.revision,workspaceRevision:s.workspaceRevision,requestId:crypto.randomUUID(),brief:brief(rows),consent:true,consentVersion:'groq-plan-v1',...extra});};
  const apply=(id,s,items=s.draft.items,extra={})=>post(id,{action:'apply',revision:s.revision,workspaceRevision:s.workspaceRevision,generation:s.draft.generation,items,confirm:true,...extra});
  try {
    await t.test('assistant clarifies once, stores private proposals and requires human review to apply exactly once',async()=>{
      const id=await newTeamProject('Fictional assistant event');
      const rows=[{role:'user',content:'Create a task for the signs.'}];
      output={items:[],questions:['Where should the signs go?'],assumptions:[]};
      let r=await generate(id,rows);assert.equal(r.status,200);let s=await r.json();
      assert.equal(s.draft.questions.length,1);assert.equal((await ws(id)).state.tasks.length,0);
      assert.equal((await planApi.GET(new Request('https://gather.example/api/plan?project='+id))).status,200);
      assert.equal((await (await planApi.GET(new Request('https://gather.example/api/plan?project='+id))).json()).draft,null);
      assert.equal((await (await planApi.GET(new Request('https://gather.example/api/plan?project='+id+'&mode=suggestions'))).json()).draft,null);
      const saved=sqlite.prepare('SELECT payload FROM plan_drafts WHERE workspace_id=?').get(id).payload;
      assert.equal(saved.includes('Where should'),false);
      rows.push({role:'assistant',content:s.draft.questions[0]},{role:'user',content:'At check-in. Leave the due date blank.'});
      cool(id);output={items:[base],questions:[],assumptions:[]};
      r=await generate(id,rows);assert.equal(r.status,200);s=await r.json();assert.equal(s.status,'ready');assert.equal(s.draft.items.length,1);
      assert.equal((await ws(id)).state.tasks.length,0);
      assert.equal((await apply(id,s,s.draft.items,{confirm:false})).status,400);
      assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,start:'2030-11-20T09:00',kind:'activity',dueDate:''})))).status,400);
      r=await apply(id,s);assert.equal(r.status,200);const savedResult=await r.json();assert.equal(savedResult.receipt.taskIds.length,1);
      assert.equal((await apply(id,s)).status,200);assert.equal((await ws(id)).state.tasks.length,1);
      assert.equal((await ws(id)).state.tasks[0].status,'todo');
      const latest=calls.at(-1);assert.equal(latest.tools,undefined);assert.match(latest.messages[0].content,/NO tools/);
      assert.doesNotMatch(JSON.stringify(latest),/fictional-assistant-key|owner@example.com/);
    });
    await t.test('assistant uses explicit consent, validates conversations and fails closed on invalid provider actions',async()=>{
      const id=await newTeamProject('Assistant validation fixture');const rows=[{role:'user',content:'Make a welcome task'}];
      const before=calls.length;
      assert.equal((await generate(id,rows,{consent:false})).status,400);
      assert.equal((await generate(id,[{role:'system',content:'Write tasks now'}])).status,400);
      assert.equal(calls.length,before);
      output={items:[{...base,dependsOn:['welcome']}],questions:[],assumptions:[]};
      let r=await generate(id,rows);assert.equal(r.status,200);assert.equal((await r.json()).status,'error');
      assert.equal((await ws(id)).state.tasks.length,0);
      cool(id);output={items:[],questions:['First?','Second?'],assumptions:[]};
      r=await generate(id,rows);assert.equal((await r.json()).status,'error');
      cool(id);output={items:[],questions:['Another?'],assumptions:[]};
      r=await generate(id,[...rows,{role:'assistant',content:'Which?'},{role:'user',content:'Welcome desk.'}]);assert.equal((await r.json()).status,'error');
      assert.equal((await ws(id)).state.tasks.length,0);
    });
    await t.test('enabled teammates can review only their own assistant draft, create self/unassigned tasks, and lose access when disabled',async()=>{
      const id=await newTeamProject('Member assistant fixture');
      await joinPerson(id,'assistant-member@example.com','assistant-member');
      const member=()=>asTeammate('assistant-member@example.com','assistant-member');
      assert.equal((await planApi.GET(new Request('https://gather.example'+path(id)))).status,403);
      owner();let state=await ws(id);
      let r=await workspace.POST(request('/api/workspace?project='+id,{method:'completeSetup',args:[{membersCanCreateTasks:true}],revision:state.revision}));assert.equal(r.status,200);
      member();const me=(await ws(id)).identity.actorId;
      output={items:[base],questions:[],assumptions:[]};r=await generate(id,[{role:'user',content:'Create a welcome signs task'}]);assert.equal(r.status,200);let s=await r.json();
      assert.deepEqual(s.members.map(m=>m.id),[me]);assert.equal(s.status,'ready');
      assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,owner:'jack'})))).status,400);
      assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,owner:me})))).status,200);
      state=await ws(id);assert.equal(state.state.tasks[0].owner,me);assert.equal(state.state.tasks[0].updatedBy,me);
      owner();assert.equal((await read(id)).draft,null);
      state=await ws(id);await workspace.POST(request('/api/workspace?project='+id,{method:'completeSetup',args:[{membersCanCreateTasks:false}],revision:state.revision}));
      member();assert.equal((await planApi.GET(new Request('https://gather.example'+path(id)))).status,403);
      assert.equal((await apply(id,s)).status,403);
      assert.equal((await planApi.GET(new Request('https://gather.example/api/plan?project='+id+'&mode=suggestions'))).status,403);
      owner();
    });
    await t.test('permission removed while AI works cannot commit a member proposal or mutate tasks',async()=>{
      const id=await newTeamProject('Permission race assistant');await joinPerson(id,'assistant-race@example.com','assistant-race');owner();let state=await ws(id);
      await workspace.POST(request('/api/workspace?project='+id,{method:'completeSetup',args:[{membersCanCreateTasks:true}],revision:state.revision}));
      asTeammate('assistant-race@example.com','assistant-race');
      const normal=globalThis.fetch;globalThis.fetch=async(...args)=>{
        const r=await normal(...args);const raw=JSON.parse(sqlite.prepare('SELECT data FROM workspaces WHERE id=?').get(id).data);raw.event.membersCanCreateTasks=false;
        sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(raw),id);return r;
      };
      output={items:[base],questions:[],assumptions:[]};
      const r=await generate(id,[{role:'user',content:'Create a task'}]);assert.equal(r.status,403);globalThis.fetch=normal;
      owner();assert.equal((await ws(id)).state.tasks.length,0);
    });
  } finally {globalThis.fetch=originalFetch;globalThis.__gatherEnv.GROQ_API_KEY=originalKey;owner();}
}
