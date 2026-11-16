import { test } from 'node:test';
import assert from 'node:assert/strict';

export function guestArrivalTests({ sqlite, owner, infoRead, infoWrite, env }) {
  function setup() {
    owner();
    const id = 'p_' + crypto.randomUUID();
    const data = sqlite.prepare("SELECT data FROM workspaces WHERE id='main'").get()?.data
      ?? globalThis.GatherStore.createStore({storage:null}).exportState();
    sqlite.prepare('INSERT INTO projects (id,owner_id,request_payload,created_at) VALUES (?,?,?,?)')
      .run(id,'owner-1','{}',new Date().toISOString());
    sqlite.prepare('INSERT INTO workspaces (id,data,revision) VALUES (?,?,1)').run(id,data);
    return {id,query:'?project='+id};
  }
  const write = (query,state,fields) => infoWrite({revision:state.revision,requestId:crypto.randomUUID(),...fields},query);
  async function added(query,attendance='attending') {
    const state = await (await infoRead(query)).json();
    const result = await write(query,state,{action:'add',guest:{name:'Fictional arrival guest',attendance,notes:'Fictional event context'}});
    assert.equal(result.status,200);
    return result.json();
  }
  test('arrival is a server-attributed encrypted record, separate from RSVP, tasks and project membership',async()=>{
    const {id,query}=setup();
    for(const attendance of ['attending','unknown','tentative','not attending']) {
      let state=await added(query,attendance);
      const guest=state.guests.at(-1),before=structuredClone(guest);
      const workspace=sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id);
      const input={action:'arrival',id:guest.id,arrived:true,revision:state.revision,requestId:crypto.randomUUID()};
      const response=await infoWrite(input,query);assert.equal(response.status,200);
      state=await response.json();const record=state.guests.find(g=>g.id===guest.id);
      assert.equal(record.attendance,attendance);assert.equal(record.notes,before.notes);
      assert.equal(record.arrival.actor,'jack');assert.equal(record.arrival.name,'Owner');
      assert.ok(Number.isFinite(Date.parse(record.arrival.at)));
      assert.deepEqual(await (await infoWrite(input,query)).json(),state);
      assert.deepEqual(sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id),workspace);
      assert.ok(!sqlite.prepare('SELECT payload FROM project_info WHERE scope=?').get(id).payload.includes('Fictional arrival guest'));
      const same=await (await write(query,state,{action:'arrival',id:guest.id,arrived:true})).json();
      assert.deepEqual(same.guests.find(g=>g.id===guest.id),record);
      const cleared=await (await write(query,same,{action:'arrival',id:guest.id,arrived:false})).json();
      assert.equal(cleared.guests.find(g=>g.id===guest.id).arrival,null);
      assert.equal(cleared.guests.find(g=>g.id===guest.id).attendance,attendance);
    }
  });
  test('arrival rejects injected attribution, invalid desired states, foreign guests and stale undo without writing',async()=>{
    const {id,query}=setup();let state=await added(query);
    const guest=state.guests[0],raw=sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id);
    for(const extra of [{arrived:'yes'},{arrived:1},{actor:'maya'},{at:'tomorrow'},{name:'Other recorder'},{id:'foreign-guest'},{id:23}]) {
      const response=await write(query,state,{action:'arrival',id:guest.id,arrived:true,...extra});
      assert.equal(response.status,extra.id==='foreign-guest'?404:400);
      assert.deepEqual(sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id),raw);
    }
    const old=state;
    state=await (await write(query,state,{action:'arrival',id:guest.id,arrived:true})).json();
    assert.equal((await write(query,old,{action:'arrival',id:guest.id,arrived:false})).status,409);
    const edit={name:guest.name,attendance:'tentative',notes:'Updated event context'};
    state=await (await write(query,state,{action:'edit',id:guest.id,guest:edit})).json();
    assert.ok(state.guests[0].arrival.at);assert.equal(state.guests[0].attendance,'tentative');
    state=await (await write(query,state,{action:'archiveGuest',id:guest.id,archived:true})).json();
    assert.equal((await write(query,state,{action:'arrival',id:guest.id,arrived:false})).status,404);
    state=await (await write(query,state,{action:'archiveGuest',id:guest.id,archived:false})).json();
    assert.ok(state.guests[0].arrival.at);
    assert.equal((await write(query,state,{action:'add',guest:{name:'Injected',arrival:{at:'fake'}}})).status,400);
  });
  test('concurrent volunteers cannot replace or clear a newer arrival using a stale guest list',async()=>{
    const {id,query}=setup();
    const initial=await added(query,'tentative'),guest=initial.guests.at(-1);
    const volunteers=['A','B'].map(label=>({
      userId:'arrival-conflict-user-'+label,actorId:'arrival-conflict-actor-'+label,
      email:`arrival-conflict-${label.toLowerCase()}@example.com`,displayName:`Fictional volunteer ${label}`,
    }));
    const member=sqlite.prepare('INSERT OR IGNORE INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)');
    const membership=sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)');
    for(const {userId,actorId,email,displayName} of volunteers){
      member.run(userId,actorId,email,displayName,'member');
      membership.run(crypto.randomUUID(),id,userId,actorId,'fictional-arrival-conflict-invite',new Date().toISOString());
    }
    const signIn=({userId,email,displayName})=>{globalThis.__gatherUser={userId,email,displayName};};
    const read=async()=>{
      const response=await infoRead(query);assert.equal(response.status,200);return response.json();
    };
    const change=(snapshot,arrived)=>write(query,snapshot,{action:'arrival',id:guest.id,arrived});
    try{
      const [a,b]=volunteers;
      signIn(a);const beforeA=await read();assert.equal(beforeA.identity.actor,a.actorId);
      signIn(b);const beforeB=await read();assert.equal(beforeB.identity.actor,b.actorId);
      assert.equal(beforeA.revision,beforeB.revision);
      assert.equal(beforeB.guests.find(row=>row.id===guest.id).arrival??null,null);

      signIn(a);const recorded=await change(beforeA,true);assert.equal(recorded.status,200);
      const saved=await recorded.json(),original=saved.guests.find(row=>row.id===guest.id);
      assert.ok(saved.revision>beforeB.revision);
      assert.equal(original.arrival.actor,a.actorId);assert.equal(original.arrival.name,a.displayName);
      assert.ok(Number.isFinite(Date.parse(original.arrival.at)));
      assert.equal(original.attendance,'tentative');assert.equal(original.notes,guest.notes);

      signIn(b);
      assert.equal((await change(beforeB,true)).status,409,'a stale record must not replace the first volunteer’s attribution');
      assert.equal((await change(beforeB,false)).status,409,'a stale clear must not remove a newer arrival');
      const refreshed=await read();
      assert.equal(refreshed.revision,saved.revision,'both conflicts leave the saved revision untouched');
      assert.deepEqual(refreshed.guests.find(row=>row.id===guest.id),original);
    }finally{
      // The shared owner fixture has a finite project allowance.
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
      owner();
    }
  });
  test('exact arrival replays return the current opposite state without repeating the original write', async t=>{
    const {id,query}=setup();
    const initial=await added(query,'tentative'), guest=initial.guests.at(-1);
    const volunteers=['A','B'].map(label=>{
      const userId='arrival-replay-'+crypto.randomUUID();
      return { userId, actorId:'u_'+userId, email:userId+'@example.com', displayName:'Fictional recorder '+label };
    });
    t.after(()=>{
      owner();
      sqlite.prepare('DELETE FROM project_info WHERE scope=?').run(id);
      sqlite.prepare('DELETE FROM project_members WHERE project_id=?').run(id);
      sqlite.prepare('DELETE FROM workspaces WHERE id=?').run(id);
      sqlite.prepare('DELETE FROM projects WHERE id=?').run(id);
      for(const {userId} of volunteers)sqlite.prepare('DELETE FROM members WHERE user_id=?').run(userId);
    });
    for(const {userId,actorId,email,displayName} of volunteers){
      sqlite.prepare('INSERT INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)')
        .run(userId,actorId,email,displayName,'member');
      sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)')
        .run(crypto.randomUUID(),id,userId,actorId,'fictional-arrival-replay-invite',new Date().toISOString());
    }
    const workspace=()=>sqlite.prepare('SELECT data,revision FROM workspaces WHERE id=?').get(id);
    const storedInfo=()=>sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id);
    const initialWorkspace=workspace();
    const send=async(volunteer,input)=>{
      globalThis.__gatherUser={userId:volunteer.userId,email:volunteer.email,displayName:volunteer.displayName};
      const response=await infoWrite(input,query);
      assert.equal(response.status,200,await response.clone().text());
      const result=await response.json();
      assert.equal(result.identity.actor,volunteer.actorId);
      return result;
    };
    const input=(snapshot,arrived)=>({action:'arrival',id:guest.id,arrived,revision:snapshot.revision,requestId:crypto.randomUUID()});
    const row=state=>state.guests.find(candidate=>candidate.id===guest.id);
    const [a,b]=volunteers;
    const recordRequest=input(initial,true);
    const recorded=await send(a,recordRequest);
    assert.equal(row(recorded).arrival.actor,a.actorId);
    const clearedByB=await send(b,input(recorded,false));
    assert.equal(row(clearedByB).arrival,null);
    const clearRaw=storedInfo();
    const recordReplay=await send(a,recordRequest);
    assert.equal(recordReplay.revision,clearedByB.revision);
    assert.deepEqual(row(recordReplay),row(clearedByB));
    assert.deepEqual(storedInfo(),clearRaw,'retrying the earlier record request must not restore the cleared arrival or append a receipt');

    const recordedByB=await send(b,input(clearedByB,true));
    const clearRequest=input(recordedByB,false);
    const clearedByA=await send(a,clearRequest);
    assert.equal(row(clearedByA).arrival,null);
    const newer=await send(b,input(clearedByA,true));
    assert.equal(row(newer).arrival.actor,b.actorId);
    assert.equal(row(newer).arrival.name,b.displayName);
    assert.ok(Number.isFinite(Date.parse(row(newer).arrival.at)));
    const newerRaw=storedInfo();
    const clearReplay=await send(a,clearRequest);
    assert.equal(clearReplay.revision,newer.revision);
    assert.deepEqual(row(clearReplay),row(newer),'the replay returns the current recorder and time');
    assert.deepEqual(storedInfo(),newerRaw,'retrying the earlier clear request must not clear the newer record or append a receipt');
    assert.equal(row(clearReplay).attendance,guest.attendance);
    assert.deepEqual(workspace(),initialWorkspace);
  });
  test('project teammates record and undo arrivals with their identity, and revocation blocks writes and receipt replays',async()=>{
    const {id,query}=setup();let state=await added(query);
    sqlite.prepare('INSERT OR IGNORE INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)')
      .run('arrival-member','arrival-actor','arrival@example.com','Arrival teammate','member');
    const memberId=crypto.randomUUID();
    sqlite.prepare('INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at) VALUES (?,?,?,?,?,?)')
      .run(memberId,id,'arrival-member','arrival-actor','fictional-arrival-invite',new Date().toISOString());
    globalThis.__gatherUser={userId:'arrival-member',email:'arrival@example.com',displayName:'Arrival teammate'};
    const guest=state.guests[0];
    const input={action:'arrival',id:guest.id,arrived:true,revision:state.revision,requestId:crypto.randomUUID()};
    let response=await infoWrite(input,query);assert.equal(response.status,200);state=await response.json();
    assert.equal(state.guests[0].arrival.actor,'arrival-actor');assert.equal(state.guests[0].arrival.name,'Arrival teammate');
    assert.equal((await write(query,state,{action:'archiveGuest',id:guest.id,archived:true})).status,403);
    state=await (await write(query,state,{action:'arrival',id:guest.id,arrived:false})).json();
    const raw=sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id);
    const original=env.DB;let intercepted=false;
    env.DB={...original,prepare(sql){const statement=original.prepare(sql);if(sql.startsWith('UPDATE project_info SET payload=')){const run=statement.run;statement.run=async()=>{intercepted=true;sqlite.prepare("UPDATE project_members SET revoked_at='race',revision=revision+1 WHERE id=?").run(memberId);return run();};}return statement;}};
    try {
      response=await write(query,state,{action:'arrival',id:guest.id,arrived:true});
      assert.ok(intercepted);assert.equal(response.status,409);
      assert.deepEqual(sqlite.prepare('SELECT payload,revision FROM project_info WHERE scope=?').get(id),raw);
    } finally {env.DB=original;}
    assert.equal((await infoWrite(input,query)).status,404);
    owner();assert.equal((await (await infoRead(query)).json()).guests[0].arrival,null);
  });
}
