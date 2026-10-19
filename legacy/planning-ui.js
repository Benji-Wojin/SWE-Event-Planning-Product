/* Pure relationship model plus a small, local-only coachmark tour. */
(function(root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const resolved = task => Boolean(task && task.status==='done' && (!task.requiresVerification || task.verifiedAt));
  function readiness(task,tasks) {
    const index=new Map(tasks.map(t=>[t.id,t]));
    const links=task.dependencies || [],required=links.filter(l=>l.kind!=='related');
    const open=required.filter(l=>!resolved(index.get(l.taskId)));
    const dependents=tasks.filter(t=>(t.dependencies||[]).some(l=>l.taskId===task.id&&l.kind!=='related'));
    const label=resolved(task)?'Complete':task.reportedAt&&task.requiresVerification&&!task.verifiedAt?'Awaiting verification':open.length?`Waiting on ${open.length} prerequisite${open.length===1?'':'s'}`:task.status==='blocked'?required.length?'Ready to resume':'Blocked · review update':'No prerequisite blockers';
    return {open,required,related:links.filter(l=>l.kind==='related'),dependents,label, tone:resolved(task)?'complete':open.length||task.status==='blocked'?'waiting':'ready'};
  }
  function graph(tasks, visible=tasks, focusId='') {
    const index=new Map(tasks.map(t=>[t.id,t]));
    const selected=new Set((focusId?[index.get(focusId)].filter(Boolean):visible).slice(0,80).map(t=>t.id));
    const queue=[...selected];
    for(let i=0;i<queue.length&&selected.size<200;i++) {
      const id=queue[i];
      const neighbors=[...(index.get(id)?.dependencies||[]).map(l=>l.taskId),...tasks.filter(t=>(t.dependencies||[]).some(l=>l.taskId===id)).map(t=>t.id)];
      for(const next of neighbors)if(index.has(next)&&!selected.has(next)&&selected.size<200){selected.add(next);queue.push(next);}
    }
    const nodes=tasks.filter(t=>selected.has(t.id)),depth=new Map(),visiting=new Set(),cycles=new Set();
    function level(id) {
      if(depth.has(id))return depth.get(id);
      if(visiting.has(id)){cycles.add(id);return 0;}
      visiting.add(id);
      const required=(index.get(id)?.dependencies||[]).filter(l=>l.kind!=='related'&&selected.has(l.taskId));
      const value=Math.min(24,required.length?1+Math.max(...required.map(l=>level(l.taskId))):0);
      visiting.delete(id);depth.set(id,value);return value;
    }
    nodes.forEach(t=>level(t.id));
    const rows=new Map(),positions=new Map();
    for(const t of nodes){const col=depth.get(t.id),row=rows.get(col)||0;rows.set(col,row+1);positions.set(t.id,{x:24+col*312,y:62+row*166});}
    const edges=nodes.flatMap(t=>(t.dependencies||[]).filter(l=>selected.has(l.taskId)).map(l=>({from:l.taskId,to:t.id,kind:l.kind==='related'?'related':'dependency'})));
    return {nodes,edges,positions,width:Math.max(600,72+(Math.max(0,...depth.values())+1)*312),height:Math.max(260,80+Math.max(0,...rows.values())*166),truncated:visible.length>80||selected.size>=200,cycles:cycles.size>0};
  }
  function graphMarkup(tasks,visible,focusId='',members=[]) {
    const model=graph(tasks,visible,focusId),h=escape;
    if(!model.nodes.length)return '<p class="planning-empty">No tasks match. Clear search or filters to see the map.</p>';
    const lines=model.edges.map(edge=>{
      const a=model.positions.get(edge.from),b=model.positions.get(edge.to),related=edge.kind==='related';
      const ax=a.x+264,ay=a.y+66,bx=b.x,by=b.y+66;
      const path=related&&a.x===b.x?`M${ax},${ay} C${ax+35},${ay} ${ax+35},${by} ${ax},${by}`:`M${ax},${ay} C${ax+30},${ay} ${bx-30},${by} ${bx},${by}`;
      return `<path d="${path}" class="map-edge ${related?'map-edge-related':''}" ${related?'':'marker-end="url(#task-map-arrow)"'}/>`;
    }).join('');
    const cards=model.nodes.map(task=>{
      const p=model.positions.get(task.id),r=readiness(task,tasks),person=task.owner?(members.find(m=>m.id===task.owner)?.name||'Assigned'):'Unassigned';
      return `<button type="button" class="map-task map-task-${r.tone} ${task.id===focusId?'map-task-focused':''}" style="left:${p.x}px;top:${p.y}px" data-action="task" data-id="${h(task.id)}" aria-label="${h(task.title)}. ${h(r.label)}. ${h(person)}. ${r.related.length} related links. Open task"><span class="map-task-category">${h(task.category||'Task')}</span><strong>${h(task.title)}</strong><span class="map-task-readiness">${h(r.label)}</span><span class="map-task-foot">${h(person)}${r.dependents.length?` · Unblocks ${r.dependents.length}`:''}${r.related.length?` · ${r.related.length} related`:''}</span></button>`;
    }).join('');
    return `<div class="map-legend"><span><i></i>Required before completion →</span><span><i class="related"></i>Related · can run in parallel</span><span>Click a task to see why it’s linked.</span></div>${focusId?'<button class="text-button map-clear" data-action="map-clear">Show all tasks</button>':''}${model.truncated?'<p class="notice">Showing a bounded map. Search for a task to focus its connections.</p>':''}${model.cycles?'<p class="notice">Some saved required links form a loop. Review those relationships before completing tasks.</p>':''}<div class="task-map-scroll" role="region" aria-label="Task dependency map, scroll to explore" tabindex="0"><div class="task-map-canvas" style="width:${model.width}px;height:${model.height}px"><span class="map-direction">Prerequisite work <span aria-hidden="true">→</span> Work it unlocks</span><svg width="${model.width}" height="${model.height}" aria-hidden="true"><defs><marker id="task-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>${lines}</svg>${cards}</div></div>`;
  }
  function createTour({navigate,isOrganizer,storageKey}) {
    let box,step=0,previousFocus;
    const steps=()=>[
      {view:'overview',target:'.stat-grid',title:'Your event, at a glance',copy:'Overview brings attention items, progress, and recent updates together. You can keep working while this tip is open.'},
      {view:'tasks',target:'#taskSearch',title:'Find work you can take',copy:'Search task names, notes, categories, or people. Use My tasks or Unassigned to narrow the list.'},
      {view:'tasks',target:'.task-view-switch',title:'See how work connects',copy:'Open Link map. Solid arrows are prerequisites; dashed links are related work. Related tasks do not prevent completion. Click a task for the reason.'},
      ...(isOrganizer()?[{view:'overview',target:'#thoughtPartner',title:'AI proposes. You decide.',copy:'Enhance this plan reviews gaps right here in the sidebar. Review every suggestion and link before adding anything. Automatic checks are labeled separately.'}]:[]),
      {view:'inbox',target:'.page-heading',title:'Keep updates connected',copy:'Email briefing lets you review updates before they change a task. That’s it—reopen Quick tour any time.'},
    ];
    const remember=()=>{try{localStorage.setItem(storageKey,'seen');}catch{}};
    function position() {
      if(!box)return;
      const target=document.querySelector(steps()[step].target),rect=target?.getBoundingClientRect();
      document.querySelectorAll('.tour-highlight').forEach(el=>el.classList.remove('tour-highlight'));
      if(target&&!target.closest('[hidden]'))target.classList.add('tour-highlight');
      const width=Math.min(328,window.innerWidth-24),height=box.offsetHeight||220;
      const left=rect?Math.max(12,Math.min(window.innerWidth-width-12,rect.left)):Math.max(12,window.innerWidth-width-20);
      const below=rect&&rect.bottom+height+16<window.innerHeight;
      box.style.width=width+'px';box.style.left=left+'px';box.style.top=Math.max(12,Math.min(window.innerHeight-height-12,rect?(below?rect.bottom+12:rect.top-height-12):80))+'px';
    }
    function close() {
      remember();box?.remove();box=null;
      document.querySelectorAll('.tour-highlight').forEach(el=>el.classList.remove('tour-highlight'));
      if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    }
    function show(next=step) {
      const s=steps()[next];if(navigate(s.view)===false)return false;step=next;
      if(!box){box=document.createElement('section');box.className='quick-tour';box.setAttribute('role','dialog');box.setAttribute('aria-modal','false');box.setAttribute('aria-labelledby','quickTourTitle');document.body.append(box);}
      box.innerHTML=`<div class="quick-tour-top"><span>QUICK TOUR · ${step+1} / ${steps().length}</span><button type="button" data-tour="close" aria-label="Close quick tour">×</button></div><h2 id="quickTourTitle">${escape(s.title)}</h2><p>${escape(s.copy)}</p><div class="quick-tour-actions"><button type="button" data-tour="close" class="text-button">Skip tour</button><span>${step?'<button type="button" data-tour="back" class="btn btn-secondary btn-small">Back</button>':''}<button type="button" data-tour="next" class="btn btn-primary btn-small">${step===steps().length-1?'Done':'Next'}</button></span></div>`;
      box.onclick=event=>{const action=event.target.closest('[data-tour]')?.dataset.tour;if(action==='close')close();if(action==='back')show(step-1);if(action==='next'){if(step===steps().length-1)close();else show(step+1);}};
      position();box.querySelector('[data-tour="next"]').focus({preventScroll:true});
      return true;
    }
    function start(){previousFocus=document.activeElement;if(show(0))remember();}
    window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&box){event.preventDefault();event.stopImmediatePropagation();close();}},true);
    return {start,close,offer(){try{if(localStorage.getItem(storageKey))return;}catch{return;}start();}};
  }
  function sidebarMessage(event,frame,origin) {
    const data=event.data;
    if(!frame||event.origin!==origin||event.source!==frame.contentWindow||!data||data.type!=='weft-plan-sidebar')return null;
    if(data.event==='state'&&typeof data.dirty==='boolean'&&typeof data.busy==='boolean')return data;
    if(data.event==='height'&&Number.isFinite(data.height))return {event:'height',height:Math.max(240,Math.min(1600,data.height))};
    return data.event==='applied'?{event:'applied'}:null;
  }
  function createSidebar({getUrl,onApplied,notify}) {
    let dirty=false,busy=false;
    const frame=()=>document.getElementById('planningSidebarFrame');
    window.addEventListener('message',event=>{
      const current=frame(),message=sidebarMessage(event,current,location.origin);if(!message)return;
      if(message.event==='state'){dirty=message.dirty;busy=message.busy;}
      if(message.event==='height')current.style.height=message.height+'px';
      if(message.event==='applied')onApplied();
    });
    return {
      open(){
        const slot=document.getElementById('planningSidebarSlot');if(!slot)return;
        if(!frame()){const element=document.createElement('iframe');element.id='planningSidebarFrame';element.title='Enhance this plan with AI';element.src=getUrl();slot.append(element);}
        slot.hidden=false;document.getElementById('planningSidebarActions').hidden=true;
        slot.querySelector('button').focus({preventScroll:true});
      },
      hide(){const slot=document.getElementById('planningSidebarSlot');if(slot)slot.hidden=true;const actions=document.getElementById('planningSidebarActions');if(actions){actions.hidden=false;actions.querySelector('button').focus({preventScroll:true});}},
      active:()=>!!frame(),
      unsaved:()=>!!frame()&&(dirty||busy),
      canLeave(){if(!frame())return true;if(busy){notify('Please wait for the AI review request to finish.');return false;}return !dirty||window.confirm('Discard unsaved AI review edits and leave this view?');},
      reset(){dirty=false;busy=false;},
      preserve(container,markup){
        const next=document.createElement('template');next.innerHTML=markup;
        for(const id of ['overviewHeader','overviewMain','overviewEmail','overviewActivity','overviewSuggestions']){
          const before=container.querySelector('#'+id),after=next.content.querySelector('#'+id);if(before&&after)before.replaceWith(after);
        }
        // Keep the mounted review document in place; workspace refreshes must not destroy edits or restart requests.
      },
    };
  }
  root.GatherPlanningUI={readiness,graph,graphMarkup,createTour,sidebarMessage,createSidebar};
})(globalThis);
