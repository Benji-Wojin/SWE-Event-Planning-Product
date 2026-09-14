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
  root.GatherInbox={conversations,taskFor,changes};
})(typeof window!=='undefined'?window:globalThis);
