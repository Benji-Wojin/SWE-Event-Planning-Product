// Real handlers, fictional identities, in-memory SQLite, no provider calls.
export async function starterChecklistTests({t,assert,sqlite,db,owner,request,planApi,workspace,newTeamProject,joinPerson,asTeammate}) {
  const originalFetch=globalThis.fetch,originalKey=globalThis.__gatherEnv.GROQ_API_KEY;
  const brief={kind:'school',description:'Fictional school dance',endDate:'',startTime:'',endTime:''};
  const read=async project=>{const response=await planApi.GET(new Request('https://gather.example/api/plan?project='+project));assert.equal(response.status,200);return response.json();};
  const post=(project,input)=>planApi.POST(request('/api/plan?project='+project,input));
  const input=(snap,extra={})=>({action:'starter',revision:snap.revision,workspaceRevision:snap.workspaceRevision,requestId:crypto.randomUUID(),brief,replace:!!snap.draft,...extra});
  const recheck=(snap,extra={})=>({action:'recheck-starter',revision:snap.revision,workspaceRevision:snap.workspaceRevision,
    generation:snap.draft.generation,brief:snap.brief,items:snap.draft.items,...extra});
  const ws=project=>sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(project);
  async function ready(project,extra={}){const result=await post(project,input(await read(project),extra));assert.equal(result.status,200,await result.clone().text());return result.json();}
  async function setup(){owner();globalThis.__gatherEnv.GROQ_API_KEY='';return newTeamProject('Fictional checklist event');}
  globalThis.fetch=async()=>{throw new Error('Starter checklists must not call a provider.');};
  try {
    await t.test('starter works without AI configuration or quota and changes only the private draft',async()=>{
      const project=await setup(),before=ws(project),usage=sqlite.prepare('SELECT * FROM resource_usage').all();
      const snap=await ready(project);
      assert.equal(snap.configured,false);assert.equal(snap.status,'ready');assert.equal(snap.draft.source,'starter');assert.equal(snap.draft.items.length,14);
      assert.ok(snap.draft.items.every(i=>i.owner===''&&i.included&&i.dueDate===''&&i.start===''));
      assert.deepEqual(ws(project),before);assert.deepEqual(sqlite.prepare('SELECT * FROM resource_usage').all(),usage);
      const row=sqlite.prepare('SELECT payload,started_at FROM plan_drafts WHERE workspace_id=?').get(project);
      assert.equal(row.started_at,0);assert.doesNotMatch(row.payload,/Fictional school dance|Confirm school approval/,'saved draft remains encrypted');
    });
    await t.test('explicit selection and assignment apply once through the existing atomic review flow',async()=>{
      const project=await setup(),snap=await ready(project),items=snap.draft.items.map((item,index)=>({...item,included:index===0,owner:index===0?'jack':''}));
      assert.ok(items.every(item=>item.scope));items[0].scope='The team records the agreed audience and useful event result.';
      const approval={action:'apply',revision:snap.revision,workspaceRevision:snap.workspaceRevision,generation:snap.draft.generation,items,confirm:true};
      const applied=await post(project,approval);assert.equal(applied.status,200,await applied.clone().text());
      const result=await applied.json(),state=JSON.parse(ws(project).data);
      assert.equal(result.receipt.taskIds.length,1);assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].owner,'jack');assert.equal(state.tasks[0].status,'todo');
      assert.equal(state.tasks[0].scope,items[0].scope);assert.equal(state.tasks[0].note,items[0].note);assert.equal(state.tasks[0].acceptedAt,'');
      const again=await post(project,approval);assert.equal(again.status,200);assert.equal(JSON.parse(ws(project).data).tasks.length,1);
      const next=await ready(project);assert.equal(next.draft.items[0].included,false,'exact existing work is not preselected');
      assert.equal(JSON.parse(ws(project).data).tasks.length,1);
    });
    await t.test('starter recheck keeps edits and generation, exposes fresh exact matches, and never adds shared tasks',async()=>{
      const project=await setup(),original=await ready(project);
      const title='Confirm fictional welcome desk';
      const add=await workspace.POST(request('/api/workspace?project='+project,{method:'addTask',args:[{title}],revision:ws(project).revision}));
      assert.equal(add.status,200,await add.clone().text());
      const existing=(await add.json()).state.tasks[0],latest=await read(project);
      assert.equal(latest.contextChanged,true);
      const privateBefore=sqlite.prepare('SELECT * FROM plan_drafts WHERE workspace_id=?').get(project);
      const sharedBefore=ws(project),usage=sqlite.prepare('SELECT * FROM resource_usage').all();
      const editedItems=original.draft.items.map((item,index)=>({...item,included:index<2}));
      Object.assign(editedItems[0],{title,note:'Fictional edit retained on the matching proposal.',owner:'jack'});
      Object.assign(editedItems[1],{title:'Brief the fictional welcome crew',scope:'The team has confirmed who opens and closes the welcome desk.',
        note:'Keep the existing desk task as a prerequisite.',dependsOn:[editedItems[0].id]});
      const editedBrief={...original.brief,description:'Fictional checklist with a specific welcome desk.'};
      const body=recheck(latest,{items:editedItems,brief:editedBrief}),rejected=[
        [{...body,revision:body.revision-1},409],
        [{...body,workspaceRevision:body.workspaceRevision-1},409],
        [{...body,generation:crypto.randomUUID()},409],
        [{...body,items:[{...editedItems[0],id:'different-fictional-item'},...editedItems.slice(1)]},400],
        [{...body,items:[{...editedItems[0],existingTaskIndex:0},...editedItems.slice(1)]},400],
        [{...body,items:[{...editedItems[0],duplicateChoice:'reuse'},...editedItems.slice(1)]},400],
        [{...body,action:'recheck-pasted'},409],
      ];
      for(const [payload,status] of rejected)assert.equal((await post(project,payload)).status,status);
      assert.equal((await post(project+'&mode=suggestions',body)).status,400);
      assert.deepEqual(sqlite.prepare('SELECT * FROM plan_drafts WHERE workspace_id=?').get(project),privateBefore);
      assert.deepEqual(ws(project),sharedBefore);
      const response=await post(project,body);assert.equal(response.status,200,await response.clone().text());
      const reviewed=await response.json();
      assert.equal(reviewed.revision,original.revision+1);assert.equal(reviewed.workspaceRevision,latest.workspaceRevision);
      assert.equal(reviewed.status,'ready');assert.equal(reviewed.contextChanged,false);assert.equal(reviewed.receipt,null);
      assert.equal(reviewed.draft.source,'starter');assert.equal(reviewed.draft.starterVersion,original.draft.starterVersion);
      assert.equal(reviewed.draft.generation,original.draft.generation);
      assert.deepEqual(reviewed.draft.items,editedItems);assert.deepEqual(reviewed.brief,editedBrief);
      assert.deepEqual(reviewed.existingTasks.map(task=>task.id),[existing.id]);
      assert.deepEqual(ws(project),sharedBefore);assert.deepEqual(sqlite.prepare('SELECT * FROM resource_usage').all(),usage);
      assert.equal((await post(project,body)).status,409,'the completed private revision cannot be replayed as a new save');
      const approval={action:'apply',revision:reviewed.revision,workspaceRevision:reviewed.workspaceRevision,
        generation:reviewed.draft.generation,items:reviewed.draft.items,confirm:true};
      assert.equal((await post(project,approval)).status,400,'recheck does not consent to creating a duplicate');
      assert.deepEqual(ws(project),sharedBefore);
      const applied=await post(project,{...approval,items:reviewed.draft.items.map((item,index)=>({...item,included:index===1}))});
      assert.equal(applied.status,200,await applied.clone().text());
      const handedOff=await applied.json(),tasks=JSON.parse(ws(project).data).tasks;
      assert.equal(tasks.length,2);assert.equal(handedOff.receipt.taskIds.length,1);
      assert.deepEqual(tasks.find(task=>task.id===handedOff.receipt.taskIds[0]).dependencies.map(link=>link.taskId),[existing.id]);
      assert.equal((await post(project,recheck(handedOff))).status,409,'an applied receipt can’t be reopened by recheck');
    });
    await t.test('opt-in event-day drafts add activities only after review and schedule only supplied times',async()=>{
      const project=await setup();
      const context=await workspace.GET(new Request('https://gather.example/api/workspace?project='+project));
      const updated=await workspace.POST(request('/api/workspace?project='+project,{method:'updateEvent',args:[{date:'2100-03-14',timeZone:'America/New_York'}],revision:(await context.json()).revision}));
      assert.equal(updated.status,200);
      const before=ws(project), initial=await read(project);
      assert.equal((await post(project,input(initial,{includeActivities:'yes'}))).status,400);
      const payload=input(initial,{includeActivities:true});
      const result=await post(project,payload);assert.equal(result.status,200,await result.clone().text());
      const snap=await result.json();
      assert.deepEqual(ws(project),before);
      assert.deepEqual((await (await post(project,payload)).json()).draft,snap.draft);
      assert.equal((await post(project,{...payload,includeActivities:false})).status,409);
      assert.equal(snap.draft.starterVersion,5);
      const days=snap.draft.items.filter(item=>item.kind==='activity');
      assert.equal(days.length,4);
      assert.ok(days.every(item=>!item.start&&!item.end&&!item.owner&&!item.dueDate));
      const items=snap.draft.items.map((item,index)=>({...item,included:index===0||['day_arrivals','day_programme'].includes(item.id)}));
      const arrival=items.find(item=>item.id==='day_arrivals');
      Object.assign(arrival,{start:'2100-03-14T17:30',end:'2100-03-14T18:00',location:'Fictional lobby',owner:'jack'});
      const applied=await post(project,{action:'apply',revision:snap.revision,workspaceRevision:snap.workspaceRevision,generation:snap.draft.generation,items,confirm:true});
      assert.equal(applied.status,200,await applied.clone().text());
      const tasks=JSON.parse(ws(project).data).tasks;
      assert.equal(tasks.length,3);
      const scheduled=tasks.find(task=>task.title===arrival.title);
      assert.equal(scheduled.schedule.start,arrival.start);
      assert.equal(scheduled.schedule.end,arrival.end);
      assert.equal(scheduled.schedule.location,arrival.location);
      assert.equal(scheduled.status,'todo');
      assert.equal(scheduled.eventActivity,true);
      const pending=tasks.find(task=>task.title===items.find(item=>item.id==='day_programme').title);
      assert.equal(pending.schedule,null);assert.equal(pending.eventActivity,true);
      assert.equal(tasks.find(task=>task.title===items[0].title).eventActivity,undefined);
      for(const next of [{start:'2100-03-14T18:15',end:'',location:''},null]){
        const res=await workspace.POST(request('/api/workspace?project='+project,{method:'setTaskSchedule',args:[pending.id,next],revision:ws(project).revision}));
        assert.equal(res.status,200,await res.clone().text());
        const current=(await res.json()).state.tasks.find(task=>task.id===pending.id);
        assert.deepEqual(current.schedule,next);assert.equal(current.eventActivity,true);assert.equal(current.status,'todo');
      }
    });
    await t.test('dated starter is opt-in, requires dated project context, and applies only reviewed deadlines',async()=>{
      const project=await setup(),blank=await read(project);
      assert.equal((await post(project,input(blank,{suggestDates:true}))).status,400);
      assert.equal((await post(project,input(blank,{suggestDates:'yes'}))).status,400);
      assert.equal((await post(project,input(blank,{suggestDates:true,today:'2100-01-01'}))).status,400);
      const context=await workspace.GET(new Request('https://gather.example/api/workspace?project='+project));
      const updated=await workspace.POST(request('/api/workspace?project='+project,{method:'updateEvent',args:[{date:'2100-03-14',timeZone:'America/New_York'}],revision:(await context.json()).revision}));
      assert.equal(updated.status,200);
      const start=await read(project),before=ws(project),body=input(start,{suggestDates:true,brief:{...brief,kind:'corporate',endDate:'2100-03-16'}});
      const response=await post(project,body);assert.equal(response.status,200,await response.clone().text());const snap=await response.json();
      assert.deepEqual(ws(project),before);assert.equal(snap.draft.starterVersion,4);
      assert.deepEqual(snap.draft.starterDates,{eventDate:'2100-03-14',endDate:'2100-03-16'});
      assert.equal(snap.draft.items.find(i=>i.id==='av').dueDate,'2100-03-12');
      assert.equal(snap.draft.items.find(i=>i.id==='followup').dueDate,'2100-03-17');
      assert.ok(snap.draft.items.every(i=>!i.owner && !i.start && !i.end));
      assert.deepEqual(await (await post(project,body)).json(),snap);
      assert.equal((await post(project,{...body,suggestDates:false})).status,409);
      const items=snap.draft.items.map(i=>({...i,included:i.id==='av',owner:i.id==='av'?'jack':''}));
      items.find(i=>i.id==='av').dueDate='2100-03-10';
      assert.equal((await post(project,{action:'apply',revision:snap.revision,workspaceRevision:snap.workspaceRevision,generation:snap.draft.generation,items,confirm:true})).status,200);
      const tasks=JSON.parse(ws(project).data).tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].dueDate,'2100-03-10');assert.equal(tasks[0].status,'todo');
      assert.equal(tasks[0].schedule,null);
    });
    await t.test('event date changes invalidate dated starter application without rescheduling shared tasks',async()=>{
      const project=await setup();let state=JSON.parse(ws(project).data);state.event.date='2100-03-14';state.event.timeZone='Pacific/Kiritimati';sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(state),project);
      const snap=await ready(project,{suggestDates:true});
      state=JSON.parse(ws(project).data);state.event.date='2100-03-15';sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(state),project);
      const latest=await read(project);assert.equal(latest.contextChanged,true);
      const response=await post(project,{action:'apply',revision:snap.revision,workspaceRevision:latest.workspaceRevision,generation:snap.draft.generation,items:snap.draft.items,confirm:true});
      assert.equal(response.status,409);assert.equal(JSON.parse(ws(project).data).tasks.length,0);
      const editedItems=latest.draft.items.map(item=>({...item,included:false}));
      assert.ok(editedItems.some(item=>item.dueDate),'unchecked items still have timing to review');
      const before=ws(project),openingDraft=sqlite.prepare('SELECT * FROM plan_drafts WHERE workspace_id=?').get(project);
      const noConfirmation=await post(project,recheck(latest,{items:editedItems}));
      assert.equal(noConfirmation.status,400);
      assert.match((await noConfirmation.json()).error,/review the proposed dates and times/i);
      assert.deepEqual(sqlite.prepare('SELECT * FROM plan_drafts WHERE workspace_id=?').get(project),openingDraft);
      const confirmed=await post(project,recheck(latest,{items:editedItems,reviewTiming:true}));
      assert.equal(confirmed.status,200,await confirmed.clone().text());
      const reviewed=await confirmed.json();
      assert.equal(reviewed.contextChanged,false);assert.deepEqual(reviewed.draft.items,editedItems);
      assert.equal(reviewed.draft.generation,latest.draft.generation);assert.deepEqual(ws(project),before);
    });
    await t.test('project-local midnight changes fresh short-notice proposals but never rewrites an idempotent replay',async()=>{
      const RealDate=Date;let instant=RealDate.parse('2028-03-12T04:59:00Z');
      globalThis.Date=class extends RealDate {
        constructor(...args){super(...(args.length?args:[instant]));}
        static now(){return instant;}
      };
      try {
        const project=await setup(),state=JSON.parse(ws(project).data);
        state.event.date='2028-03-12';state.event.timeZone='America/New_York';
        sqlite.prepare('UPDATE workspaces SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(state),project);
        const body=input(await read(project),{suggestDates:true});
        const first=await post(project,body);assert.equal(first.status,200);const saved=await first.json();
        assert.equal(saved.draft.items.find(i=>i.id==='purpose').dueDate,'2028-03-11');
        instant=RealDate.parse('2028-03-12T05:01:00Z');
        assert.deepEqual(await (await post(project,body)).json(),saved);
        const fresh=await ready(project,{suggestDates:true});
        assert.equal(fresh.draft.items.find(i=>i.id==='purpose').dueDate,'2028-03-12');
        assert.equal(JSON.parse(ws(project).data).tasks.length,0);
      } finally {globalThis.Date=RealDate;}
    });
    await t.test('creation retries are idempotent and request IDs cannot be reused with a different checklist',async()=>{
      const project=await setup(),start=await read(project),body=input(start);
      const responses=await Promise.all([post(project,body),post(project,body)]);assert.deepEqual(responses.map(r=>r.status),[200,200]);
      assert.equal(sqlite.prepare('SELECT revision FROM plan_drafts WHERE workspace_id=?').get(project).revision,1);
      assert.equal((await post(project,{...body,brief:{...brief,kind:'party'}})).status,409);
      assert.equal((await read(project)).draft.brief.kind,'school');
    });
    await t.test('replacement requires confirmation, rejects active leases, and preserves AI cooldown time',async()=>{
      const project=await setup(),first=await ready(project),before=ws(project);
      assert.equal((await post(project,input(first,{replace:false}))).status,409);
      const stamp=Date.now();sqlite.prepare('UPDATE plan_drafts SET started_at=?,lease_until=? WHERE workspace_id=?').run(stamp,stamp+60000,project);
      assert.equal((await post(project,input(first))).status,409);
      sqlite.prepare('UPDATE plan_drafts SET lease_until=0 WHERE workspace_id=?').run(project);
      const next=await ready(project,{brief:{...brief,kind:'party'}});assert.equal(next.draft.items.length,6);
      assert.equal(sqlite.prepare('SELECT started_at FROM plan_drafts WHERE workspace_id=?').get(project).started_at,stamp);
      assert.deepEqual(ws(project),before);
    });
    await t.test('stale revisions and competing replacements never overwrite a newer draft',async()=>{
      const project=await setup(),blank=await read(project);
      assert.equal((await post(project,input(blank,{workspaceRevision:blank.workspaceRevision+1}))).status,409);
      const bodies=[input(blank),input(blank,{brief:{...brief,kind:'corporate'}})];
      const results=await Promise.all(bodies.map(body=>post(project,body)));
      assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
      const current=await read(project);assert.equal(current.revision,1);
      assert.equal((await post(project,input(blank))).status,409);
      assert.equal((await read(project)).draft.generation,current.draft.generation);
    });
    await t.test('non-plan modes, extra fields, forged callers and teammates cannot create starters',async()=>{
      const project=await setup(),blank=await read(project);
      for(const extra of [{consent:true},{replace:'yes'},{brief:{...brief,kind:'__proto__'}}])assert.equal((await post(project,input(blank,extra))).status,400);
      for(const mode of ['suggestions','assistant'])assert.equal((await post(project+'&mode='+mode,input(blank))).status,400);
      const cross=await planApi.POST(request('/api/plan?project='+project,input(blank),'https://evil.example'));assert.equal(cross.status,403);
      await joinPerson(project);asTeammate();assert.equal((await post(project,input(blank))).status,403);
      owner();assert.equal((await read(project)).draft,null);
    });
    await t.test('workspace freshness and owner access are rechecked inside the starter write',async()=>{
      for(const revoke of [false,true]){
        const project=await setup(),blank=await read(project),prepare=db.prepare;let raced=false;
        db.prepare=function(sql){
          const statement=prepare.call(db,sql);
          if(!sql.startsWith('INSERT INTO plan_drafts'))return statement;
          const run=statement.run;
          statement.run=async()=>{
            if(!raced){raced=true;if(revoke)sqlite.prepare("UPDATE projects SET owner_id='revoked-fixture' WHERE id=?").run(project);else sqlite.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(project);}
            return run();
          };
          return statement;
        };
        try{assert.equal((await post(project,input(blank))).status,revoke?403:409);assert.equal(sqlite.prepare('SELECT count(*) AS n FROM plan_drafts WHERE workspace_id=?').get(project).n,0);}
        finally{db.prepare=prepare;}
      }
    });
    await t.test('late AI completion cannot overwrite a chosen starter after its lease expires',async()=>{
      const project=await setup();globalThis.__gatherEnv.GROQ_API_KEY='test-only-placeholder';
      sqlite.prepare("DELETE FROM resource_usage WHERE id LIKE 'plan-ai:%'").run();
      let release,started;const entered=new Promise(resolve=>{started=resolve;});
      globalThis.fetch=async()=>{started();return new Promise(resolve=>{release=resolve;});};
      const blank=await read(project),pending=post(project,{...input(blank),action:'generate',consent:true,consentVersion:'groq-plan-v1',replace:undefined});
      await entered;sqlite.prepare('UPDATE plan_drafts SET lease_until=0 WHERE workspace_id=?').run(project);
      const starter=await ready(project);
      release(Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({items:[{id:'old',kind:'preparation',title:'Old AI task',category:'Program',note:'Fictional old output',dueDate:'',start:'',end:'',location:'',dependsOn:[],existingTaskIndex:null}],questions:[],assumptions:[]})}}]}));
      assert.equal((await pending).status,409);const current=await read(project);
      assert.equal(current.draft.source,'starter');assert.equal(current.draft.generation,starter.draft.generation);assert.equal(current.status,'ready');
      assert.equal(JSON.parse(ws(project).data).tasks.length,0);
    });
  } finally {globalThis.fetch=originalFetch;globalThis.__gatherEnv.GROQ_API_KEY=originalKey;owner();}
}
