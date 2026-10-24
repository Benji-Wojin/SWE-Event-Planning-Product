import assert from 'node:assert/strict';
export async function dateAvailabilityTests({t,sqlite,owner,infoRead,infoWrite,env}) {
  function setup(){
    owner();const id='p_'+crypto.randomUUID();
    sqlite.prepare('INSERT INTO projects (id,owner_id,request_payload,created_at) VALUES (?,?,?,?)').run(id,'owner-1','{}',new Date().toISOString());
    sqlite.prepare('INSERT INTO workspaces (id,data,revision) VALUES (?,?,1)').run(id,sqlite.prepare("SELECT data FROM workspaces WHERE id='main'").get().data);
    return {id,query:'?project='+id};
  }
  const write=(query,state,fields)=>infoWrite({revision:state.revision,requestId:crypto.randomUUID(),...fields},query);
  async function create(query){const state=await (await infoRead(query)).json();const response=await write(query,state,{action:'createDatePoll',poll:{title:'Fictional school dance dates',dates:['2028-03-02','2028-03-04'],timeZone:'America/Los_Angeles'}});assert.equal(response.status,200,await response.clone().text());return response.json();}
  function join(id){
    const user='date-member-'+crypto.randomUUID(),actor='date-actor-'+crypto.randomUUID(),membership=crypto.randomUUID();
    sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)').run(user,actor,'date-member@example.com','Date teammate','member');
    sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)').run(membership,id,user,actor,'fixture-date-invite',new Date().toISOString());
    return {actor,membership,as(){globalThis.__gatherUser={userId:user,email:'date-member@example.com',displayName:'Date teammate'};}};
  }
  await t.test('date polls persist encrypted, attribute only the signed-in person and never change tasks, dates, guests or budget',async()=>{
    const {id,query}=setup(),workspace=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id);
    let state=await create(query);const poll=state.datePolls[0],otherInfo={guests:state.guests,files:state.files,budget:state.budget};
    assert.equal(poll.createdBy,'jack');assert.equal(poll.createdName,'Owner');assert.equal(poll.responses.length,0);assert.equal(poll.closedAt,'');
    const responseInput={action:'respondDatePoll',id:poll.id,answers:[{date:poll.dates[0],availability:'available'}],revision:state.revision,requestId:crypto.randomUUID()};
    state=await (await infoWrite(responseInput,query)).json();
    assert.deepEqual(await (await infoWrite(responseInput,query)).json(),state);
    const response=state.datePolls[0].responses[0];assert.equal(response.actor,'jack');assert.equal(response.name,'Owner');assert.ok(Number.isFinite(Date.parse(response.at)));
    const member=join(id);member.as();
    state=await (await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[{date:poll.dates[1],availability:'maybe'}]})).json();
    assert.equal(state.datePolls[0].responses.length,2);assert.deepEqual(state.datePolls[0].responses.find(row=>row.actor==='jack'),response);
    assert.equal(state.datePolls[0].responses.find(row=>row.actor===member.actor).name,'Date teammate');
    state=await (await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[]})).json();
    assert.equal(state.datePolls[0].responses.length,1);assert.equal(state.datePolls[0].responses[0].actor,'jack');
    assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),workspace);
    assert.deepEqual({guests:state.guests,files:state.files,budget:state.budget},otherInfo);
    assert.ok(!sqlite.prepare('SELECT payload FROM project_info WHERE scope=?').get(id).payload.includes('Fictional school dance'));
    owner();
  });
  await t.test('organizer closes and reopens without discarding responses; stale saves, forged identities and changed retries never overwrite',async()=>{
    const {id,query}=setup();let state=await create(query);const poll=state.datePolls[0],old=state;
    state=await (await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[{date:poll.dates[0],availability:'unavailable'}]})).json();
    assert.equal((await write(query,old,{action:'respondDatePoll',id:poll.id,answers:[]})).status,409);
    for(const extra of [{actor:'other'},{name:'Other'},{at:'fake'},{answers:[{date:poll.dates[0],availability:'available',actor:'other'}]},{answers:[{date:'2028-03-05',availability:'available'}]}])assert.equal((await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[],...extra})).status,400);
    const member=join(id);member.as();
    for(const fields of [{action:'createDatePoll',poll:{}},{action:'closeDatePoll',id:poll.id,closed:true}])assert.equal((await write(query,state,fields)).status,403);
    owner();const close={action:'closeDatePoll',id:poll.id,closed:true,revision:state.revision,requestId:crypto.randomUUID()};
    state=await (await infoWrite(close,query)).json();assert.ok(state.datePolls[0].closedAt);assert.equal(state.datePolls[0].responses.length,1);
    assert.equal((await infoWrite({...close,closed:false},query)).status,409);
    member.as();assert.equal((await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[]})).status,409);
    owner();state=await (await write(query,state,{action:'closeDatePoll',id:poll.id,closed:false})).json();assert.equal(state.datePolls[0].closedAt,'');assert.equal(state.datePolls[0].responses.length,1);
  });
  await t.test('foreign project IDs and revoked memberships cannot read, write or replay date-poll receipts',async()=>{
    const {id,query}=setup();let state=await create(query),poll=state.datePolls[0];const foreign=setup();let other=await (await infoRead(foreign.query)).json();
    assert.equal((await write(foreign.query,other,{action:'respondDatePoll',id:poll.id,answers:[]})).status,404);
    const member=join(id);member.as();assert.equal((await infoRead(foreign.query)).status,404);
    const input={action:'respondDatePoll',id:poll.id,answers:[{date:poll.dates[0],availability:'maybe'}],revision:state.revision,requestId:crypto.randomUUID()};
    state=await (await infoWrite(input,query)).json();const raw=sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id);
    const original=env.DB;let intercepted=false;
    env.DB={...original,prepare(sql){const stmt=original.prepare(sql);if(sql.startsWith('UPDATE project_info SET payload=')){const run=stmt.run;stmt.run=async()=>{intercepted=true;sqlite.prepare("UPDATE project_members SET revoked_at='race',revision=revision+1 WHERE id=?").run(member.membership);return run();};}return stmt;}};
    try {assert.equal((await write(query,state,{action:'respondDatePoll',id:poll.id,answers:[]})).status,409);assert.ok(intercepted);assert.deepEqual(sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id),raw);}finally{env.DB=original;}
    assert.equal((await infoRead(query)).status,404);assert.equal((await infoWrite(input,query)).status,404);owner();
  });
  await t.test('poll creation is bounded and organizer authority is checked again at commit',async()=>{
    const {id,query}=setup();let state;
    for(let i=0;i<8;i++)state=await create(query);
    const before=sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id);
    assert.equal((await write(query,state,{action:'createDatePoll',poll:{title:'One too many',dates:['2028-03-02','2028-03-04'],timeZone:'UTC'}})).status,400);
    assert.deepEqual(sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id),before);
    const next=setup();state=await (await infoRead(next.query)).json();
    sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),next.id,'owner-1','jack','fixture-owner-member',new Date().toISOString());
    const raw=sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(next.id),original=env.DB;let intercepted=false;
    env.DB={...original,prepare(sql){const stmt=original.prepare(sql);if(sql.startsWith('UPDATE project_info SET payload=')){const run=stmt.run;stmt.run=async()=>{intercepted=true;sqlite.prepare('UPDATE projects SET owner_id=? WHERE id=?').run('another-owner',next.id);return run();};}return stmt;}};
    try {assert.equal((await write(next.query,state,{action:'createDatePoll',poll:{title:'Lost authority',dates:['2028-03-02','2028-03-04'],timeZone:'UTC'}})).status,409);assert.ok(intercepted);assert.deepEqual(sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(next.id),raw);}finally{env.DB=original;owner();}
  });
}
