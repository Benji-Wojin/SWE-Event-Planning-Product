(function (root) {
  'use strict';
  const labels = { auto: 'Automatic', high: 'High', low: 'Low' };
  const resolved = task => Boolean(task && task.status === 'done' && (!task.requiresVerification || task.verifiedAt));
  const awaiting = task => Boolean(task.reportedAt && task.requiresVerification && !task.verifiedAt);
  const dayKey = (date,zone) => root.GatherCalendar.dayKey(date,zone);
  const dayNumber = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value+'T00:00:00Z')/86400000 : NaN;
  const daysLeft = (task,now,zone) => dayNumber(task.dueDate)-dayNumber(dayKey(now,zone));
  const pendingRequest = task => (task.recoveryRequests || []).find(r=>r.status==='pending');
  const responseTime = task => Math.max(...[task.ownerRespondedAt,task.acceptedAt,task.nextUpAt].map(value=>new Date(value||0).getTime()||0));
  const unresolved = (task,tasks) => (task.dependencies || []).filter(link=>link.kind!=='related'&&!resolved(tasks.find(t=>t.id===link.taskId)));
  const actionable = (task,tasks) => !resolved(task)&&task.status!=='done'&&task.status!=='blocked'&&!awaiting(task)&&pendingRequest(task)?.kind!=='help'&&!unresolved(task,tasks).length;
  function downstream(task,tasks) {
    const seen=new Set([task.id]),queue=[task.id],result=[];
    while(queue.length) {
      const id=queue.shift();
      for(const other of tasks) if(!seen.has(other.id)&&!resolved(other)&&(other.dependencies||[]).some(link=>link.kind!=='related'&&link.taskId===id)) {
        seen.add(other.id);result.push(other);queue.push(other.id);
      }
    }
    return result;
  }
  function decision(task,tasks,now=new Date(),zone='UTC') {
    if(resolved(task)||awaiting(task))return null;
    const request=pendingRequest(task);
    if(request)return {key:'request',label:request.kind==='date'?'Date proposal':'Help requested',request};
    const today=dayNumber(dayKey(now,zone));
    if(dayNumber(task.planReviewAfter)>today)return null;
    const waiting=unresolved(task,tasks);
    if(waiting.some(link=>!tasks.some(t=>t.id===link.taskId)))return {key:'missing',label:'Review missing linked task'};
    // A blocked parent is not another reminder: route attention to its prerequisites.
    if(waiting.length)return null;
    if(task.status==='blocked')return {key:'blocked',label:'Unblocking decision'};
    if(!task.owner)return {key:'owner',label:'Choose an owner'};
    const responded=responseTime(task);
    const sent=new Date(task.followupSentAt||0).getTime();
    const check=task.planReviewAfter||task.followupAfter;
    if(sent&&dayNumber(check)<=today&&responded<sent)return {key:'unanswered',label:'No response to check-in'};
    const missed=(task.deadlineHistory||[]).filter(item=>item.from&&item.from<dayKey(item.at,zone)&&item.to>item.from).length;
    if(daysLeft(task,now,zone)<0&&missed>=2)return {key:'repeated',label:'Repeatedly moved deadline'};
    if(daysLeft(task,now,zone)<=-2&&new Date(now).getTime()-responded>=2*86400000)return {key:'stalled',label:'Overdue · needs a new plan'};
    return null;
  }
  function deadlineRisk(task,now,zone) {
    const days=daysLeft(task,now,zone);
    return (task.hardDeadline?(days<=3?400:days<=7?160:0):0)+(task.essential?100:0);
  }
  function analyze(task,tasks=[],now=new Date(),zone='UTC') {
    if(resolved(task))return null;
    const today=dayNumber(dayKey(now,zone)),days=daysLeft(task,now,zone),priority=Object.hasOwn(labels,task.priority)?task.priority:'auto';
    const factors=[];
    const add=(key,label,action,weight)=>factors.push({key,label,action,weight});
    const risk=deadlineRisk(task,now,zone);
    if(task.hardDeadline&&days<=7)add('deadline','Fixed deadline'+(days<0?' missed':days===0?' today':' in '+days+' days'),'Review the event risk',risk-(task.essential?100:0));
    if(task.essential)add('essential','Essential for the event','Protect essential work',100);
    const dependents=downstream(task,tasks);
    if(dependents.length) {
      const inherited=Math.max(...dependents.map(t=>deadlineRisk(t,now,zone)+(daysLeft(t,now,zone)<=3?55:0)));
      add('dependency','Needed by '+dependents.length+' '+(dependents.length===1?'task':'tasks'),'Complete the prerequisite first',Math.min(80,dependents.length*25)+inherited);
    }
    if(days<0)add('overdue',(-days)+' '+(days===-1?'day':'days')+' overdue','Choose a next step',55+Math.min(-days,7)*5);
    else if(days===0)add('due','Due today','Due today',60);
    else if(days<=3)add('due','Due in '+days+' '+(days===1?'day':'days'),'Deadline approaching',55-days*5);
    if(awaiting(task))add('verification','Verify completion','The owner reports this is finished',60);
    const required=(task.dependencies||[]).filter(link=>link.kind!=='related'),waiting=unresolved(task,tasks);
    if(task.status==='blocked'&&required.length&&!waiting.length)add('ready','Ready to resume','Review linked results',55);
    else if(task.status==='blocked')add('blocked',waiting.length?'Waiting on linked work':'Blocked','Review the blocker',waiting.length?0:45);
    const review=decision(task,tasks,now,zone);
    if(review)add('decision',review.label,'Review the next step',35);
    if(!task.owner)add('unassigned','No owner','Assign an owner',25);
    if((task.handoffs||[]).some(item=>item.status==='pending'))add('handoff','Suggested follow-up','Review linked work',20);
    const followup=dayNumber(task.followupAfter);
    const answered=task.followupSentAt&&responseTime(task)>=new Date(task.followupSentAt).getTime();
    if(followup<=today&&!answered)add('followup','Follow-up due','Check in with the owner',20);
    if(!(followup>today)&&!(dayNumber(task.planReviewAfter)>today)) {
      if(!task.acceptedAt)add('acceptance','Acceptance pending','Ask the owner to accept',8);
      if(new Date(now).getTime()-Math.max(new Date(task.updatedAt||0).getTime()||0,responseTime(task))>=3*86400000)add('stale','No recent update','Request an update',15);
    }
    if(!factors.length&&priority!=='high')return null;
    const primary=factors[0]||{key:'priority',label:'High priority',action:'Prioritized by the organizer'};
    return {...primary,priority,factors,overdue:days<0,waiting:waiting.length>0,decision:review,
      score:factors.reduce((sum,f)=>sum+f.weight,0)+(priority==='high'?120:priority==='low'?-100:0),
      summary:[priority!=='auto'?labels[priority]+' priority':'',...factors.slice(0,3).map(f=>f.label)].filter(Boolean).join(' · ')};
  }
  function rank(tasks,now=new Date(),all=false,zone='UTC') {
    return tasks.map(task=>({task,info:analyze(task,tasks,now,zone)})).filter(({task,info})=>!resolved(task)&&(all||info&&(!info.waiting||info.decision||awaiting(task)))).sort((a,b)=>
      (b.info?.score||0)-(a.info?.score||0)||(a.task.dueDate||'9999').localeCompare(b.task.dueDate||'9999')||String(a.task.id).localeCompare(String(b.task.id))).map(item=>item.task);
  }
  const nextUp=(tasks,actor,now=new Date(),zone='UTC')=>rank(tasks,now,true,zone).filter(t=>t.owner===actor&&t.nextUpAt&&actionable(t,tasks));
  function suggestion(task,state) {
    const waits=unresolved(task,state.tasks).map(link=>state.tasks.find(t=>t.id===link.taskId)).filter(Boolean);
    if(waits.length)return {text:'Follow up on the linked work before asking this owner to finish.',targets:waits};
    const request=pendingRequest(task);
    if(request?.kind==='date')return {text:task.hardDeadline?'Check the vendor or external deadline before approving a new date.':'Check linked work before agreeing to the proposed date.',targets:downstream(task,state.tasks)};
    if(request?.kind==='help') {
      const others=state.members.filter(m=>m.id!==task.owner&&m.active!==false).sort((a,b)=>nextUp(state.tasks,a.id).length-nextUp(state.tasks,b.id).length||a.id.localeCompare(b.id));
      const member=others[0];
      if(member)return {text:'Consider '+member.name.split(' ')[0]+' ('+nextUp(state.tasks,member.id).length+'/3 next tasks). Confirm their availability first.',targets:[]};
    }
    return {text:task.scope?'Check whether the agreed outcome is still achievable.':'Agree on the smallest useful outcome, then a realistic next check-in.',targets:[]};
  }
  root.GatherPriorities={analyze,rank,labels,decision,pendingRequest,actionable,unresolved,nextUp,suggestion,downstream};
})(typeof window!=='undefined'?window:globalThis);
