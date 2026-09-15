(function(root) {
  'use strict';
  const taskFor = (message, tasks) => {
    const id=message.appliedTaskId || message.linkedTaskId || (message.suggested?.mode==='update' ? message.suggested.taskId : '');
    return tasks.find(task=>task.id===id) || null;
  };
  function conversations(state) {
    const groups=new Map();
    for(const message of state.messages) {
      const task=taskFor(message,state.tasks);
      const key=task?'task:'+task.id:'thread:'+(message.threadId||message.id);
      if(!groups.has(key))groups.set(key,{key,taskId:task?.id||'',task,title:task?.title||message.subject,messages:[]});
      groups.get(key).messages.push(message);
    }
    return [...groups.values()].map(group=>{
      group.messages.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||b.id.localeCompare(a.id));
      group.pending=group.messages.filter(m=>!m.appliedTaskId&&!m.ignoredAt);
      group.latest=group.messages[0];
      return group;
    }).sort((a,b)=>Number(!!b.pending.length)-Number(!!a.pending.length)||b.latest.receivedAt.localeCompare(a.latest.receivedAt));
  }
  function changes(message, state, values=message.suggested) {
    const p={...message.suggested,...values};
    const current=p.mode==='update'?state.tasks.find(t=>t.id===p.taskId):null;
    const normalize=(v,max)=>String(v??'').trim().slice(0,max);
    const after={title:normalize(p.title??current?.title,200),owner:normalize(p.owner??current?.owner,80),status:p.status??current?.status??'todo',dueDate:normalize(p.dueDate??current?.dueDate,20),note:normalize(p.note??current?.note,5000),category:normalize(p.category??current?.category,80)||'Guest care'};
    const waitsForVerification=!!(current?.requiresVerification&&current.status!=='done'&&after.status==='done');
    if(waitsForVerification)after.status='progress';
    const keys=['title','owner','status','dueDate','note','category'];
    const fields=keys.map(key=>({key,before:current?.[key]??'',after:after[key],changed:!current||String(current[key]??'')!==String(after[key])}));
    const reportsCompletion=message.suggested?.signal==='completion-report'||(!message.suggested?.signal&&message.suggested?.status==='done')||(p.status==='done'&&message.suggested?.status!=='done');
    return {current,after,fields,changed:fields.filter(f=>f.changed),unchanged:fields.filter(f=>!f.changed),waitsForVerification,reportsCompletion,isNew:p.mode==='new'};
  }
  function shortUpdate(message) {
    // Extract only new text. Keep caveats verbatim rather than paraphrasing claims.
    const fresh=String(message.body||'').split(/(?:^|\n)[ \t]*(?:On .+wrote:|From:|>)/i)[0]
      .replace(/^(?:hi|hello|hey|dear)\b[^,\n]{0,60}[,\n]\s*/i,'')
      .split(/\n(?:thanks|thank you|best regards|regards|cheers)[,!]?\s*(?:\n|$)/i)[0].trim();
    const sentences=fresh.split(/(?<=[.!?])\s+|\n+/).map(text=>text.trim()).filter(Boolean);
    if(!sentences.length)return 'No new message text. Open the source to review it.';
    const caveats=sentences.map((text,index)=>/\b(?:not|never|except|unless|until|however|but|still|remaining|blocked|waiting|pending|cannot|nobody|no one|cancelled|canceled|unconfirmed)\b|n['’]t\b/i.test(text)?index:-1).filter(index=>index>=0);
    const indexes=[...new Set([0,1,...caveats])].filter(index=>index<sentences.length).sort((a,b)=>a-b);
    const summary=indexes.map((index,i)=>`${i&&index>indexes[i-1]+1?'… ':''}${sentences[index]}`).join(' ');
    return summary.length<=600?summary:'Long update. Open the source email for the full context.';
  }
  const analysisOutdated=message=>!message.appliedTaskId&&!message.ignoredAt&&message.suggested?.analysisVersion!==2;
  function briefing(group,state,message=group.pending[0]||group.latest) {
    const diff=changes(message,state),pending=!message.appliedTaskId&&!message.ignoredAt;
    const outdated=analysisOutdated(message);
    const stale=outdated||!!(pending&&diff.current&&message.suggested?.baseRevision!==diff.current.revision);
    const historical=group.messages.some(item=>item.receivedAt>message.receivedAt);
    const signal=message.suggested?.signal;
    let label='Review update',next='Review the proposed changes before updating the task.';
    if(message.ignoredAt){label='Set aside';next='No changes applied from this email.';}
    else if(message.appliedTaskId){label='Accepted';next='This update is saved. Open the task for its current status.';}
    else if(outdated){label='Refresh needed';next='Refresh the suggestion to use the updated email checks before reviewing changes.';}
    else if(historical){label='Older update';next='A newer email exists. Check the source history before applying this update.';}
    else if(stale){label='Task changed';next='Refresh the comparison before deciding what to apply.';}
    else if(diff.isNew){label='Needs a task';next='Choose an existing task or review the proposed new task.';}
    else if(signal==='blocker'){label='Possible blocker';next='Check what is needed to unblock this, then review the proposed changes.';}
    else if(signal==='completion-report'){label='Completion reported';next=diff.waitsForVerification?'Review the completion report. The task stays in progress until the organizer verifies it.':'Check the completion report before accepting it. This is not independent verification.';}
    else if(signal==='acceptance'){label='Owner response';next='Review the response and proposed task update.';}
    else if(!diff.changed.length){next='Attach this email to the task; no task fields need to change.';}
    return {message,summary:shortUpdate(message),label,next,stale,historical,pending};
  }
  root.GatherInbox={conversations,taskFor,changes,shortUpdate,briefing,analysisOutdated};
})(typeof window!=='undefined'?window:globalThis);
