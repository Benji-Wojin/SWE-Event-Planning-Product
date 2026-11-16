(function (root) {
  'use strict';
  const labels = { auto: 'Automatic', high: 'High', low: 'Low' };
  const priorityWeight = priority => priority === 'high' ? 120 : priority === 'low' ? -100 : 0;
  const personalFactors = new Set(['deadline','essential','dependency','overdue','due','handoff']);
  const resolved = task => Boolean(task && task.status === 'done' && (!task.requiresVerification || task.verifiedAt));
  const awaiting = task => Boolean(task.reportedAt && task.requiresVerification && !task.verifiedAt);
  const changesRequested = task => task.status!=='done'&&!task.reportedAt&&Boolean(task.completionReview);
  const dayKey = (date,zone) => root.GatherCalendar.dayKey(date,zone);
  const dayNumber = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value+'T00:00:00Z')/86400000 : NaN;
  const daysLeft = (task,now,zone) => dayNumber(task.dueDate)-dayNumber(dayKey(now,zone));
  const pendingRequest = task => (task.recoveryRequests || []).find(r=>r.status==='pending');
  const responseTime = task => Math.max(...[task.ownerRespondedAt,task.acceptedAt,task.nextUpAt].map(value=>new Date(value||0).getTime()||0));
  const unavailableOwner = (task,assignableOwnerIds) => !!(task.owner&&assignableOwnerIds&&!assignableOwnerIds.has(task.owner));
  const unresolved = (task,tasks) => (task.dependencies || []).filter(link=>link.kind!=='related'&&!resolved(tasks.find(t=>t.id===link.taskId&&!t.archivedAt)));
  const actionable = (task,tasks) => !task.archivedAt&&!resolved(task)&&task.status!=='done'&&task.status!=='blocked'&&!awaiting(task)&&pendingRequest(task)?.kind!=='help'&&!unresolved(task,tasks).length;
  function downstream(task,tasks) {
    const seen=new Set([task.id]),queue=[task.id],result=[];
    while(queue.length) {
      const id=queue.shift();
      for(const other of tasks) if(!other.archivedAt&&!seen.has(other.id)&&!resolved(other)&&(other.dependencies||[]).some(link=>link.kind!=='related'&&link.taskId===id)) {
        seen.add(other.id);result.push(other);queue.push(other.id);
      }
    }
    return result;
  }
  function decision(task,tasks,now=new Date(),zone='UTC',assignableOwnerIds) {
    if(task.archivedAt||resolved(task)||awaiting(task))return null;
    const request=pendingRequest(task);
    if(request)return {key:'request',label:request.kind==='date'?'Date proposal':'Help requested',request};
    const today=dayNumber(dayKey(now,zone));
    if(dayNumber(task.planReviewAfter)>today)return null;
    const waiting=unresolved(task,tasks);
    if(waiting.some(link=>!tasks.some(t=>t.id===link.taskId&&!t.archivedAt)))return {key:'missing',label:'Review unavailable required work'};
    // A blocked parent is not another reminder: route attention to its prerequisites.
    if(waiting.length)return null;
    if(task.status==='blocked')return {key:'blocked',label:'Unblocking decision'};
    if(!task.owner)return {key:'owner',label:'Choose an owner'};
    if(unavailableOwner(task,assignableOwnerIds))return {key:'owner-unavailable',label:'Reassign unavailable owner'};
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
  function analyze(task,tasks=[],now=new Date(),zone='UTC',assignableOwnerIds) {
    if(task.archivedAt||resolved(task))return null;
    const today=dayNumber(dayKey(now,zone)),days=daysLeft(task,now,zone),priority=Object.hasOwn(labels,task.priority)?task.priority:'auto';
    const factors=[];
    const add=(key,label,action,weight)=>factors.push({key,label,action,weight});
    if(changesRequested(task))add('changes','Changes requested','Review the organizer’s request, then revise and resubmit',65);
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
    const unavailable=waiting.some(link=>!tasks.some(item=>item.id===link.taskId&&!item.archivedAt));
    if(unavailable)add('required-unavailable','Required work unavailable','Review the unavailable task link',45);
    else if(task.status==='blocked'&&required.length&&!waiting.length&&!awaiting(task)&&!task.archivedAt)add('ready','Ready to resume','Review linked results',55);
    else if(task.status==='blocked')add('blocked',waiting.length?'Waiting on linked work':'Blocked','Review the blocker',waiting.length?0:45);
    const ownerGap=unavailableOwner(task,assignableOwnerIds);
    if(ownerGap&&!task.reportedAt&&task.status!=='done')add('owner-unavailable','Owner unavailable','Choose an active assignee',35);
    const review=decision(task,tasks,now,zone,assignableOwnerIds);
    if(review)add('decision',review.label,'Review the next step',35);
    if(!task.owner)add('unassigned','No owner','Assign an owner',25);
    if((task.handoffs||[]).some(item=>item.status==='pending'))add('handoff','Suggested follow-up','Review linked work',20);
    const followup=dayNumber(task.followupAfter);
    const answered=task.followupSentAt&&responseTime(task)>=new Date(task.followupSentAt).getTime();
    const canFollowOwner=!assignableOwnerIds||!!task.owner&&!ownerGap&&!awaiting(task);
    if(canFollowOwner&&followup<=today&&!answered)add('followup','Follow-up due','Check in with the owner',20);
    if(canFollowOwner&&!(followup>today)&&!(dayNumber(task.planReviewAfter)>today)) {
      if(!task.acceptedAt)add('acceptance','Acceptance pending','Ask the owner to accept',8);
      if(new Date(now).getTime()-Math.max(new Date(task.updatedAt||0).getTime()||0,responseTime(task))>=3*86400000)add('stale','No recent update','Request an update',15);
    }
    if(!factors.length&&priority!=='high')return null;
    const primary=factors[0]||{key:'priority',label:'High priority',action:'Prioritized by the organizer'};
    return {...primary,priority,factors,overdue:days<0,waiting:waiting.length>0,decision:review,
      score:factors.reduce((sum,f)=>sum+f.weight,0)+priorityWeight(priority),
      summary:[priority!=='auto'?labels[priority]+' priority':'',...factors.slice(0,3).map(f=>f.label)].filter(Boolean).join(' · ')};
  }
  const rankRow=(task,tasks,now,zone,assignableOwnerIds)=>({task,info:analyze(task,tasks,now,zone,assignableOwnerIds)});
  const compareDatesAndIds=(a,b)=>(a.task.dueDate||'9999').localeCompare(b.task.dueDate||'9999')||String(a.task.id).localeCompare(String(b.task.id));
  const compareAttention=(a,b)=>(b.info?.score||0)-(a.info?.score||0)||compareDatesAndIds(a,b);
  function rank(tasks,now=new Date(),all=false,zone='UTC',assignableOwnerIds) {
    return tasks.filter(task=>!task.archivedAt&&!resolved(task)).map(task=>rankRow(task,tasks,now,zone,assignableOwnerIds)).filter(({task,info})=>all||info&&(!info.waiting||info.decision||awaiting(task)||changesRequested(task))).sort(compareAttention).map(item=>item.task);
  }
  const nextUp=(tasks,actor,now=new Date(),zone='UTC')=>rank(tasks,now,true,zone).filter(t=>t.owner===actor&&t.nextUpAt&&actionable(t,tasks));
  function personalNextUp(tasks,actor,now=new Date(),zone='UTC',separateReviews) {
    const owned=tasks.filter(task=>!task.archivedAt&&task.owner===actor&&!resolved(task)).map(task=>rankRow(task,tasks,now,zone)).sort(compareAttention);
    const active=[],returned=[],candidates=[];
    for(const row of owned){
      const {task}=row;
      const needsRevision=changesRequested(task);
      if(needsRevision)returned.push(task);
      if(!actionable(task,tasks))continue;
      if(task.nextUpAt)active.push(task);
      else if(!needsRevision&&!separateReviews?.has(task.id)&&pendingRequest(task)?.createdBy!==actor){
        // Rank the work itself, not organizer-only prompts to follow up.
        const urgency=row.info?.factors.reduce((weight,factor)=>personalFactors.has(factor.key)?weight+factor.weight:weight,0)||0;
        candidates.push({...row,score:priorityWeight(task.priority)+urgency});
      }
    }
    const suggested=candidates.sort((a,b)=>b.score-a.score||Number(!!b.task.acceptedAt)-Number(!!a.task.acceptedAt)||compareDatesAndIds(a,b))
      .slice(0,Math.max(0,3-active.length)).map(row=>row.task);
    return {active,returned,suggested,hasOwned:owned.length>0};
  }
  function suggestion(task,state,assignable=member=>member.active!==false) {
    const links=unresolved(task,state.tasks);
    const waits=links.map(link=>state.tasks.find(t=>t.id===link.taskId&&!t.archivedAt)).filter(Boolean);
    if(waits.length<links.length)return {text:'Review the unavailable required task links before completing this work.',targets:waits};
    if(waits.length)return {text:'Follow up on the linked work before asking this owner to finish.',targets:waits};
    const request=pendingRequest(task);
    if(request?.kind==='date')return {text:task.hardDeadline?'Check the vendor or external deadline before approving a new date.':'Check linked work before agreeing to the proposed date.',targets:downstream(task,state.tasks)};
    if(request?.kind==='help') {
      const others=state.members.filter(m=>m.id!==task.owner&&assignable(m)).sort((a,b)=>nextUp(state.tasks,a.id).length-nextUp(state.tasks,b.id).length||a.id.localeCompare(b.id));
      const member=others[0];
      if(member)return {text:'Consider '+member.name.split(' ')[0]+' ('+nextUp(state.tasks,member.id).length+'/3 next tasks). Confirm their availability first.',targets:[]};
    }
    return {text:task.scope?'Check whether the agreed outcome is still achievable.':'Agree on the smallest useful outcome, then a realistic next check-in.',targets:[]};
  }
  root.GatherPriorities={analyze,rank,labels,decision,pendingRequest,actionable,unresolved,nextUp,personalNextUp,suggestion,downstream,changesRequested};
})(typeof window!=='undefined'?window:globalThis);
