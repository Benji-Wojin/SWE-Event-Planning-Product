// Fictional projects, mocked provider. No live calls or credentials.
export async function taskAssistantTests({t,assert,sqlite,owner,request,planApi,workspace,newTeamProject,joinPerson,asTeammate}) {
  const originalFetch=globalThis.fetch,originalKey=globalThis.__gatherEnv.GROQ_API_KEY;
  globalThis.__gatherEnv.GROQ_API_KEY='fictional-assistant-key';
  const base={id:'welcome',kind:'preparation',title:'Prepare welcome signs',category:'Venue',note:'Prepare signs for the check-in desk.',scope:'The reviewed welcome signs show the agreed check-in route.',dueDate:'',start:'',end:'',location:'',dependsOn:[],existingTaskIndex:null};
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
    await t.test('written work stays private and incomplete; external execution uses fixed truthful limits',async()=>{
      const id=await newTeamProject('Written work fixture');
      output={items:[],questions:[],assumptions:[],work:{kind:'written_draft',title:'Welcome announcement',content:'Welcome to our event. Please arrive at [time to confirm].'}};
      let r=await generate(id,[{role:'user',content:'Complete the writing task: draft a welcome announcement.'}]);
      assert.equal(r.status,200);let s=await r.json();assert.equal(s.draft.work.kind,'written_draft');assert.match(s.draft.work.content,/time to confirm/);
      assert.equal((await ws(id)).state.tasks.length,0);
      assert.equal((await apply(id,s)).status,400);
      assert.doesNotMatch(sqlite.prepare('SELECT payload FROM plan_drafts WHERE workspace_id=?').get(id).payload,/Welcome announcement/);
      cool(id);output={items:[],questions:[],assumptions:[],work:{kind:'cannot_execute',title:'Done',content:'I booked the venue and sent the invitations.'}};
      r=await generate(id,[{role:'user',content:'Book the venue and send the invitations.'}]);s=await r.json();assert.equal(s.draft.work.kind,'cannot_execute');assert.match(s.draft.work.content,/cannot browse/);assert.doesNotMatch(s.draft.work.content,/I booked/);assert.equal((await ws(id)).state.tasks.length,0);
      cool(id);output={items:[base],questions:[],assumptions:[],work:{kind:'written_draft',title:'Mixed action',content:'Invalid mixed work.'}};
      s=await (await generate(id,[{role:'user',content:'Draft an announcement.'}])).json();assert.equal(s.status,'error');
      cool(id);output={items:[],questions:[],assumptions:[],work:{kind:'executed',title:'Done',content:'Invalid execution claim.'}};
      s=await (await generate(id,[{role:'user',content:'Do the work.'}])).json();assert.equal(s.status,'error');
    });
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
      assert.equal((await ws(id)).state.tasks[0].status,'todo');assert.equal((await ws(id)).state.tasks[0].scope,base.scope);
      const latest=calls.at(-1);assert.equal(latest.tools,undefined);assert.match(latest.messages[0].content,/NO tools/);
      assert.doesNotMatch(JSON.stringify(latest),/fictional-assistant-key|owner@example.com/);
    });
    await t.test('reviewed assistant prerequisites stay private, reject missing or cyclic choices and apply once in reviewed order',async()=>{
      const id=await newTeamProject('Connected school preparation');
      try{
        output={items:[{...base,id:'briefing',title:'Prepare final volunteer briefing',note:'Needs the reviewed welcome plan.',dependsOn:['review']},{...base,id:'review',title:'Review the welcome plan'}],questions:[],assumptions:[]};
        const response=await generate(id,[{role:'user',content:'Break welcome preparation into a review and then a final briefing.'}]);assert.equal(response.status,200);
        const s=await response.json();assert.equal(s.status,'ready');assert.equal((await ws(id)).state.tasks.length,0);
        const row=()=>sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),before=row();
        assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,owner:'jack',included:item.id!=='review'})))).status,400);assert.deepEqual(row(),before);
        assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,owner:'jack',dependsOn:item.id==='review'?['briefing']:item.dependsOn})))).status,400);assert.deepEqual(row(),before);
        assert.equal((await apply(id,s,s.draft.items.map(item=>({...item,owner:'jack',dependsOn:item.id==='briefing'?['missing']:[]})))).status,400);assert.deepEqual(row(),before);
        const reviewed=s.draft.items.map(item=>({...item,owner:'jack'}));
        const saved=await apply(id,s,reviewed);assert.equal(saved.status,200);const result=await saved.json(),state=(await ws(id)).state;
        assert.equal(state.tasks.length,2);const dependent=state.tasks.find(task=>task.title==='Prepare final volunteer briefing'),prerequisite=state.tasks.find(task=>task.title==='Review the welcome plan');
        assert.deepEqual(result.receipt.taskIds,[dependent.id,prerequisite.id],'receipt follows reviewed order, not topological creation order');
        assert.equal(dependent.dependencies[0].taskId,prerequisite.id);assert.equal(dependent.dependencies[0].kind,'dependency');
        for(const task of state.tasks){assert.equal(task.status,'todo');assert.equal(task.acceptedAt,'');assert.equal(task.schedule,null);}
        const stable=row();assert.equal((await apply(id,s,reviewed)).status,200);assert.deepEqual(row(),stable);
        assert.match(calls.at(-1).messages[0].content,/specific output is required/);assert.equal(calls.at(-1).tools,undefined);
      }finally{sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);owner();}
    });
    await t.test('prepared task-title request stays private until apply and never edits the original task or its notes',async()=>{
      const id=await newTeamProject('School task breakdown handoff');
      try{
        const {build}=await import('esbuild'),bundle=await build({entryPoints:['lib/task-breakdown.ts'],bundle:true,platform:'node',format:'esm',write:false});
        const {taskBreakdownRequest}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
        let state=await ws(id);const created=await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'Plan the fictional school welcome',owner:'jack',note:'PRIVATE-ORIGINAL-TASK-NOTE',scope:'SHARED-OUTCOME-NOT-AUTO-SENT'}],revision:state.revision}));assert.equal(created.status,200);
        const original=(await created.json()).result,before=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),callsBefore=calls.length;
        const prepared=taskBreakdownRequest(original.title);assert.equal(calls.length,callsBefore);assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),before);
        output={items:[{...base,id:'briefing',title:'Write a fictional welcome briefing',dependsOn:['review']},{...base,id:'review',title:'Review the fictional welcome flow'}],questions:[],assumptions:[]};
        const response=await generate(id,[{role:'user',content:prepared}]);assert.equal(response.status,200);const s=await response.json();assert.equal(s.status,'ready');assert.equal(calls.length,callsBefore+1);
        assert.doesNotMatch(JSON.stringify(calls.at(-1)),/PRIVATE-ORIGINAL-TASK-NOTE|SHARED-OUTCOME-NOT-AUTO-SENT/);assert.ok(calls.at(-1).messages.some(message=>message.content.includes(original.title)));
        assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),before,'generation does not edit shared work');
        const result=await apply(id,s);assert.equal(result.status,200);state=(await ws(id)).state;assert.equal(state.tasks.length,3);assert.deepEqual(state.tasks.find(task=>task.id===original.id),original);
        for(const task of state.tasks.filter(task=>task.id!==original.id)){assert.equal(task.status,'todo');assert.equal(task.acceptedAt,'');assert.equal(task.schedule,null);assert.doesNotMatch(JSON.stringify(task),/PRIVATE-ORIGINAL-TASK-NOTE/);}
      }finally{sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);owner();}
    });
    await t.test('enabled teammate can review a linked unassigned proposal using existing work without changing that work',async()=>{
      const id=await newTeamProject('Connected teammate preparation');
      try{
        await joinPerson(id,'linked-assistant@example.com','linked-assistant');owner();let state=await ws(id);
        let r=await workspace.POST(request('/api/workspace?project='+id,{method:'completeSetup',args:[{membersCanCreateTasks:true}],revision:state.revision}));assert.equal(r.status,200);state=await r.json();
        r=await workspace.POST(request('/api/workspace?project='+id,{method:'addTask',args:[{title:'Review the school welcome plan',owner:'jack',status:'progress',note:'PRIVATE-EXISTING-NOTE'}],revision:state.revision}));assert.equal(r.status,200);
        const existing=(await r.json()).result;asTeammate('linked-assistant@example.com','linked-assistant');const me=(await ws(id)).identity.actorId;
        output={items:[{...base,id:'briefing',title:'Prepare a shared welcome briefing',dependsOn:['review'],note:'Use the reviewed welcome plan.'},{...base,id:'review',title:existing.title}],questions:[],assumptions:[]};
        r=await generate(id,[{role:'user',content:'Use the existing plan review as the prerequisite for a new shared briefing task.'}]);assert.equal(r.status,200);const s=await r.json();assert.equal(s.status,'ready');
        const before=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id);
        const reviewed=s.draft.items.map(item=>({...item,owner:'',included:item.id!=='review'}));
        assert.equal((await apply(id,s,reviewed.map(item=>({...item,owner:'jack'})))).status,400);assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),before);
        r=await apply(id,s,reviewed);assert.equal(r.status,200);state=(await ws(id)).state;
        assert.equal(state.tasks.length,2);const created=state.tasks.find(task=>task.id!==existing.id);
        assert.equal(created.owner,'');assert.equal(created.updatedBy,me);assert.equal(created.comments[0].actor,me);assert.equal(created.status,'todo');
        assert.equal(created.dependencies[0].taskId,existing.id);assert.deepEqual(state.tasks.find(task=>task.id===existing.id),existing);
        assert.doesNotMatch(JSON.stringify(created),/PRIVATE-EXISTING-NOTE/);
      }finally{sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);owner();}
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
      state=await ws(id);assert.equal(state.state.tasks[0].owner,me);assert.equal(state.state.tasks[0].updatedBy,me);assert.equal(state.state.tasks[0].scope,base.scope);
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
