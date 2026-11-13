/* Gather's local demo UI. All task data lives in the versioned workspace store. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = GatherStore.createStore();
  const navigation = GatherNavigation.create(window);
  const ui = { view:'overview', actor:'jack', tab:'all', taskView:'list', mapFocus:'', timelineMode:'schedule', scheduleMine:false, scheduleDate:'', wrapMine:false, owner:'', status:'', search:'', messageId:'', lastFocus:null, dialogKind:'', detailId:'', privateRecords:[],privateSession:null,privateState:'loading',privateConfigured:false };
  const labels = { overview:'Overview',tasks:'Shared tasks',inbox:'Email briefing',updates:'Team updates',team:'People',info:'Event info',budget:'Budget',timeline:'Timeline',memory:'Wrap up',details:'Private details' };
  const statuses = { todo:'To do', progress:'In progress', blocked:'Blocked', done:'Done' };
  const isOrganizer = () => window.GatherIdentity ? window.GatherIdentity.role === 'admin' : ui.actor === 'jack';
  const canCreateTasks = () => isOrganizer() || store.getState().event.membersCanCreateTasks === true;
  const guidedWorkspace = !!window.GatherMode && !window.GatherMode.demo &&
    new URLSearchParams(location.search).get('guide') === '1' && isOrganizer();
  let guideProgress = null, guideQueue = Promise.resolve(), guideError = false, guideViewReady = '';
  let guideTaskId = '', guideTaskNeedsReveal = false;
  let joinWelcome = false, renderedTeammateHandoff = '', taskLinkUnavailable = false;
  const unconfirmedRelatedSaves=new Map();
  const guideSteps = [
    ['task_created', 2, 'Add your first task', 'Name one real thing that needs doing. After saving, we’ll show you where it lives and how to work with it.', 'guide-add-task', 'Add a task', 'Try “Confirm the venue” or “Draft the event agenda.”'],
    ['budget_viewed', 3, 'Explore Budget', 'Get familiar with where your team can track estimates, committed costs, and payments already made.', 'guide-budget', 'Open Budget', 'Just open the page. No amounts are required and no money moves.'],
    ['event_details_viewed', 4, 'Review Event info', 'See where the team can find event details, guest information, and shared files.', 'guide-info', 'Open Event info', 'Take a look around. You don’t need to add guests or upload anything.'],
    ['invite_created', 5, 'Invite a teammate', 'Invite someone who can help plan or run the event. Use the email they’ll sign in with.', 'guide-invite', 'Open invitation form', 'Planning solo? Finish the guide and invite people whenever you’re ready.'],
  ];
  const guideLabels=['Project','Task','Budget','Event info','Invite'];
  function guideTrack(step,finished,skipped) {
    return `<ol class="workspace-guide-track" aria-label="Guide progress">${guideLabels.map((label,index)=>{
      const n=index+1, state=skipped&&n===5?'skipped':finished||n<step?'done':n===step?'current':'upcoming';
      return `<li data-guide-state="${state}"${state==='current'?' aria-current="step"':''}><span class="workspace-guide-marker" aria-hidden="true">${state==='done'?'✓':state==='skipped'?'–':n}</span><span>${label}</span><span class="sr-only"> — ${state==='done'?'complete':state}</span></li>`;
    }).join('')}</ol>`;
  }
  function paintGuide() {
    const host = $('#workspaceGuide');
    if (!guidedWorkspace || !host) return;
    const bound = guideProgress?.projectId === window.GatherMode.projectId;
    const reached = new Set(guideProgress?.events?.map(item => item.checkpoint));
    const next = bound ? guideSteps.find(([id]) => !reached.has(id) && (id!=='invite_created'||!reached.has('invite_skipped'))) : null;
    const finished=bound&&reached.has('event_details_viewed')&&(reached.has('invite_created')||reached.has('invite_skipped'));
    const showPlanTip=bound&&reached.has('task_created')&&!!next;
    host.hidden = !next && !guideError && !finished;
    if (host.hidden) return;
    const wasFocused=host.contains(document.activeElement);
    const waitingForTask=next?.[0]==='task_created'&&!!guideTaskId;
    const mode=guideError?'error':finished?(reached.has('invite_skipped')?'complete-solo':'complete-team'):waitingForTask?'task-saved-pending':next[0];
    if(host.dataset.guideState===mode)return;
    const projectHref=h(window.GatherMode.projectUrl('/project'));
    host.dataset.guideState=mode;
    host.innerHTML=guideError
      ? '<div class="workspace-guide-main"><p class="workspace-guide-kicker">Getting started</p><h2 id="workspaceGuideTitle" tabindex="-1">Guide progress unavailable</h2><p>Keep working, or retry loading the guide.</p><div class="workspace-guide-actions"><button type="button" class="btn btn-secondary" data-action="guide-retry">Retry guide</button><a href="/guide" target="_top">Back to guide</a></div></div>'
      : finished
        ? `<div class="workspace-guide-main"><p class="workspace-guide-kicker">Getting started · Complete</p><h2 id="workspaceGuideTitle" tabindex="-1">You’re ready to keep planning</h2><p>${reached.has('invite_skipped')?'You can invite a teammate later from People.':'Your invitation is ready. Your teammate still needs to accept it.'}</p><div class="workspace-guide-actions"><a class="btn btn-primary" href="${projectHref}" target="_top">Back to planning</a></div></div>${guideTrack(5,true,reached.has('invite_skipped'))}`
        : waitingForTask
          ? `<div class="workspace-guide-main"><p class="workspace-guide-kicker">Getting started <span>Step 2 of 5</span></p><h2 id="workspaceGuideTitle" tabindex="-1">Your first task is saved</h2><p role="status">Loading the next guide step…</p><div class="workspace-guide-actions"><a class="workspace-guide-pause" href="${projectHref}" target="_top">Finish later</a></div></div>${guideTrack(2,false,false)}`
          : `<div class="workspace-guide-main"><p class="workspace-guide-kicker">Getting started <span>Step ${next[1]} of 5</span></p><h2 id="workspaceGuideTitle" tabindex="-1">${next[2]}</h2><p>${next[3]}</p><p class="workspace-guide-tip">${next[6]}</p><div class="workspace-guide-actions"><button class="btn btn-primary" type="button" data-action="${next[4]}">${next[5]}</button>${next[0]==='invite_created'?'<button class="btn btn-secondary" type="button" data-action="guide-skip-invite">Finish without inviting</button>':''}<a class="workspace-guide-pause" href="${projectHref}" target="_top">Finish later</a></div>${showPlanTip?guidePlanTip():''}</div>${guideTrack(next[1],false,false)}`;
    if(wasFocused) $('#workspaceGuideTitle')?.focus({preventScroll:true});
  }
  function guidePlanTip() {
    const href=h(window.GatherMode.projectUrl('/plan')+'&guide=1');
    return `<section class="workspace-guide-plan" aria-labelledby="workspaceGuidePlanTitle">
      <div class="workspace-guide-plan-icon" aria-hidden="true">${icon('spark')}</div>
      <div class="workspace-guide-plan-content">
        <p class="workspace-guide-plan-kicker">Optional walkthrough</p>
        <h3 id="workspaceGuidePlanTitle">Draft the rest of your plan with AI</h3>
        <p>Turn a short event brief into a private draft of tasks and activities. Review it and add only what you want. Opening the planner won’t send anything to AI or change your project.</p>
        <a class="btn btn-secondary" href="${href}" target="_top">Try drafting a plan with AI</a>
        <p class="workspace-guide-plan-later">You can skip this and come back from <strong>Overview → Build a plan</strong>.</p>
      </div>
    </section>`;
  }
  function syncGuide(checkpoint) {
    if (!guidedWorkspace) return Promise.resolve();
    guideQueue = guideQueue.then(async () => {
      if (checkpoint && guideProgress?.events?.some(item => item.checkpoint === checkpoint)) return;
      try {
        const response = await fetch('/api/tutorial',{
          cache:'no-store', credentials:'same-origin', signal:AbortSignal.timeout(6000),
          ...(checkpoint ? {method:'POST',headers:{'Content-Type':'application/json','X-Gather-Request':'1'},
            body:JSON.stringify({checkpoint,project:window.GatherMode.projectId})} : {}),
        });
        if(!response.ok) throw new Error('Guide unavailable');
        guideProgress = await response.json();
        guideError = false;
      } catch {
        guideError = true;
      }
      paintGuide();
    });
    return guideQueue;
  }
  function recordGuideViewClick(view) {
    if(view==='budget'||view==='info')void syncGuide(view==='budget'?'budget_clicked':'event_details_clicked');
  }
  function recordLoadedGuideView(view) {
    if (!guidedWorkspace || ui.view !== view) return;
    guideViewReady = view;
    void syncGuide(view==='budget'?'budget_viewed':'event_details_viewed');
  }
  function guideExpectsTask() {
    return guidedWorkspace&&!guideTaskId&&guideProgress?.projectId===window.GatherMode.projectId&&
      guideProgress.events.some(event=>event.checkpoint==='project_created')&&
      !guideProgress.events.some(event=>event.checkpoint==='task_created');
  }
  const planSidebar=GatherPlanningUI.createSidebar({
    getUrl:(mode='suggestions')=>window.GatherMode.demo?'/plan?demo=1&as=jack&mode='+mode+'&embed=1':window.GatherMode.projectUrl('/plan')+'&mode='+mode+'&embed=1',
    notify:message=>toast(message),
    onApplied:async()=>{try{const result=await store.refresh(()=>!ui.pendingSave&&!unsavedDialog()&&!unsavedReview());if(result.pending)toast('Suggestions added. Finish your open edit before refreshing the workspace.');else{render();toast('Selected suggestions added to your plan.');}}catch(error){toast(error.message||'Suggestions added. Refresh the workspace to see the latest tasks.');}},
  });
  const agentPopup=GatherPlanningUI.createAgentPopup({
    getUrl:()=>window.GatherMode.demo?'/plan?demo=1&as=jack&mode=assistant&embed=1':window.GatherMode.projectUrl('/plan')+'&mode=assistant&embed=1',
    onApplied:async()=>{try{const result=await store.refresh(()=>!ui.pendingSave&&!unsavedDialog()&&!unsavedReview());if(!result.pending)render();toast(result.pending?'Tasks added. Finish your open edit before refreshing.':'Tasks added · still to do.');}catch{toast('Tasks added. Refresh your workspace to see them.');}},
  });
  const icons = {
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    check:'m4 6 2 2 4-4M13 6h7M4 16l2 2 4-4M13 16h7',
    mail:'M3 5h18v14H3zM3 6l9 7 9-7',
    activity:'M3 12h4l3-8 4 16 3-8h4',
    people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-4',
    calendar:'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2zM7 3v4M17 3v4M3 11h18',
    spark:'m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z',
    memory:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
    leaf:'M20 3C9 2 3 6 4 14s12 9 16-11ZM4 20l9-10',
    menu:'M4 6h16M4 12h16M4 18h16',plus:'M12 5v14M5 12h14',
    arrow:'M4 12h16m-6-6 6 6-6 6',close:'m6 6 12 12M6 18 18 6',
    clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
    done:'m5 12 4 4L19 6',alert:'m12 3 10 18H2L12 3ZM12 9v5M12 17h.01',
    copy:'M8 8h12v13H8zM16 8V3H3v13h5',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.grid}"/></svg>`;
  const fillIcons = root => $$('[data-icon]', root).forEach(el => el.innerHTML = icon(el.dataset.icon));
  function hiddenByClosedDisclosure(el) {
    // Closed details can retain layout rectangles in some browsers. Only its
    // first direct summary (and that summary's descendants) stays interactive.
    for(let parent=el.parentElement;parent;parent=parent.parentElement){
      if(parent.tagName==='DETAILS'&&!parent.open){
        const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');
        if(!summary?.contains(el))return true;
      }
    }
    return false;
  }
  const focusable = root => $$('a[href],button,input,select,textarea,summary,[tabindex]',root).filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length&&!el.closest('[hidden],[inert]')&&!hiddenByClosedDisclosure(el));
  function skipToContent() {
    const root=$('#viewRoot');
    if(ui.pendingSave||window.GatherAccessLost||!root||root.closest('[hidden],[inert]')||!$('#dialogBackdrop').hidden||$('#sidebar').classList.contains('open'))return false;
    const target=$$('h1',root).find(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length)||root;
    tour.close({restoreFocus:false});
    target.style.scrollMarginTop=`${Math.ceil($('.topbar')?.getBoundingClientRect().height||0)+16}px`;
    target.setAttribute('tabindex','-1');
    target.focus({preventScroll:true});
    target.scrollIntoView({block:'start',behavior:'instant'});
    return true;
  }
  function restoreFocus(previous,root=document) {
    if(!previous)return false;
    if(previous.dataset.nextUpOrigin)return restoreNextUpFocus(previous,root);
    // Row controls can share an action and task ID. Match the exact control
    // and intent, never another button for the same task.
    if(!previous.isConnected&&previous.dataset.taskFocus){
      const rows=$('#taskRows',root);
      const target=rows&&focusable(rows).find(el=>el.dataset.id===previous.dataset.id&&
        el.dataset.taskFocus===previous.dataset.taskFocus&&el.dataset.action===previous.dataset.action);
      if(!target)return false;
      target.focus({preventScroll:true});return true;
    }
    let target=previous.isConnected?previous:previous.id?document.getElementById(previous.id):focusable(root).find(el=>
      el.tagName===previous.tagName&&['action','id','view','filter','reviewKind','scheduleDay','overlapKind'].every(key=>el.dataset[key]===previous.dataset[key])&&
      (previous.dataset.id||el.textContent===previous.textContent));
    if(!target&&['task','review-organizer-item'].includes(previous.dataset.action)&&previous.classList?.contains('schedule-focus-task')){
      const rows=focusable(root).filter(el=>el.classList.contains('schedule-row')&&el.dataset.action==='task'&&el.dataset.id===previous.dataset.id);
      target=rows.find(row=>row.dataset.scheduleDay===previous.dataset.scheduleFocusDay)||rows[0];
    }
    if(!target||!root.contains(target)||target.closest('[hidden],[inert]')||hiddenByClosedDisclosure(target))return false;
    target.focus({preventScroll:true});return true;
  }
  function focusScheduleTarget(target) {
    if(!target)return false;
    target.focus({preventScroll:true});
    if(document.activeElement!==target)return false;
    const rect=target.getBoundingClientRect(),header=Math.max(0,$('.topbar')?.getBoundingClientRect().bottom||0);
    const bottom=window.innerHeight;
    if(bottom<=header)return true;
    if(rect.top>=header&&rect.bottom<=bottom)return true;
    const height=rect.bottom-rect.top;
    if(height>bottom-header){
      // An unusually long card can't fit. Keep its beginning below the
      // sticky header rather than centering an already clipped control.
      if(rect.top<header||rect.top>=bottom)window.scrollBy({top:rect.top-header-8,behavior:'instant'});
    }else window.scrollBy({top:(rect.top+rect.bottom-header-bottom)/2,behavior:'instant'});
    return true;
  }
  function isScheduleControl(element) {
    return !!(element?.classList?.contains('schedule-focus-task')||element?.classList?.contains('schedule-row'));
  }
  function restoreScheduleFocus(previous,root) {
    if(!previous||!root||ui.view!=='timeline'||ui.timelineMode==='deadlines'||window.GatherAccessLost||
      root.closest('[hidden],[inert]')||!previous.dataset.id)return false;
    const card=previous.classList.contains('schedule-focus-task'),row=previous.classList.contains('schedule-row');
    if(!card&&!row)return false;
    const panel=root.matches('.schedule-panel')?root:$('.schedule-panel',root);
    if(!panel||panel.closest('[hidden],[inert]'))return false;
    const controls=focusable(panel),id=previous.dataset.id;
    if(card){
      const exact=controls.find(el=>el.classList.contains('schedule-focus-task')&&el.dataset.id===id&&
        el.dataset.action===previous.dataset.action&&el.dataset.reviewKind===previous.dataset.reviewKind&&
        el.dataset.scheduleFocusKind===previous.dataset.scheduleFocusKind);
      if(exact&&focusScheduleTarget(exact))return true;
    }
    const rows=controls.filter(el=>el.classList.contains('schedule-row')&&el.dataset.action==='task'&&el.dataset.id===id);
    const day=previous.dataset.scheduleDay||previous.dataset.scheduleFocusDay;
    const scope=controls.find(el=>el.dataset.action==='schedule-scope'&&el.getAttribute('aria-pressed')==='true');
    for(const target of new Set([rows.find(el=>el.dataset.scheduleDay===day),...rows,scope]))
      if(focusScheduleTarget(target))return true;
    const heading=$('#schedulePanelHeading',panel);
    return !!heading&&heading.getClientRects().length>0&&!heading.closest('[hidden],[inert]')&&focusScheduleTarget(heading);
  }
  function sameNextUpPanel(oldPanel,newPanel) {
    return !!oldPanel&&!!newPanel&&oldPanel.dataset.nextUpPanel===newPanel.dataset.nextUpPanel&&
      oldPanel.dataset.nextUpActor===newPanel.dataset.nextUpActor;
  }
  function currentNextUpPanel(root) {
    return $$('[data-next-up-panel]',root).find(panel=>{
      // The dialog makes the whole shell inert, but a render beneath it
      // still needs to preserve the active panel's disclosure choice.
      for(let node=panel;node&&node!==root;node=node.parentElement)if(node.hidden||node.inert)return false;
      return true;
    });
  }
  function restoreNextUpFocus(previous,root) {
    const oldPanel=previous.closest('[data-next-up-panel]');
    const panel=currentNextUpPanel(root);
    if(!sameNextUpPanel(oldPanel,panel)||panel.closest('[hidden],[inert]'))return false;
    const suggestions=$('[data-next-up-suggestions]',panel);
    const exact=previous.dataset.id&&$$('[data-next-up-origin]',panel).find(el=>
      el.dataset.nextUpOrigin===previous.dataset.nextUpOrigin&&el.dataset.id===previous.dataset.id&&
      el.dataset.action===previous.dataset.action&&!el.matches(':disabled')&&!el.closest('[hidden],[inert]'));
    if(exact&&suggestions?.contains(exact))suggestions.open=true;
    const target=[exact,suggestions&&$('[data-next-up-origin="summary"]',suggestions),$('[data-next-up-heading]',panel)]
      .find(el=>el&&el.getClientRects().length&&!el.closest('[hidden],[inert]')&&!hiddenByClosedDisclosure(el));
    if(!target)return false;
    target.focus({preventScroll:true});
    const rect=target.getBoundingClientRect?.();
    if(rect&&(rect.top<($('.topbar')?.getBoundingClientRect().bottom||0)||rect.bottom>window.innerHeight))
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    return true;
  }
  function restoreNextUpDisclosure(oldPanel,open,root) {
    const panel=currentNextUpPanel(root);
    if(open===undefined||!sameNextUpPanel(oldPanel,panel))return;
    const suggestions=$('[data-next-up-suggestions]',panel);
    if(suggestions)suggestions.open=open;
  }
  function nextUpDisclosureOverride(panel) {
    const suggestions=panel&&$('[data-next-up-suggestions]',panel);
    if(suggestions&&suggestions.open!==(suggestions.dataset.nextUpDefault==='open'))return suggestions.open;
  }
  function sameWrapReview(oldPanel,newPanel) {
    return !!oldPanel&&!!newPanel&&oldPanel.dataset.wrapActor===newPanel.dataset.wrapActor&&
      oldPanel.dataset.wrapScope===newPanel.dataset.wrapScope;
  }
  function wrapReviewOverrides(panel) {
    return panel?$$('[data-wrap-group]',panel)
      .filter(group=>group.open!==(group.dataset.wrapDefault==='open'))
      .map(group=>[group.dataset.wrapGroup,group.open]):[];
  }
  function restoreWrapReviewDisclosures(oldPanel,overrides,root) {
    const panel=$('[data-wrap-review]',root);
    if(!sameWrapReview(oldPanel,panel))return;
    for(const group of $$('[data-wrap-group]',panel)){
      const choice=overrides.find(([key])=>key===group.dataset.wrapGroup);
      if(choice)group.open=choice[1];
    }
  }
  function restoreWrapReviewFocus(previous,root) {
    if(ui.view!=='memory'||window.GatherAccessLost||!root||root.closest('[hidden],[inert]')||
      previous?.dataset.action!=='wrap-review-task')return false;
    const panel=$('[data-wrap-review]',root);
    if(!panel||panel.closest('[hidden],[inert]')||!sameWrapReview(previous.closest('[data-wrap-review]'),panel))return false;
    const row=$$('[data-action="wrap-review-task"]',panel).find(button=>button.dataset.id===previous.dataset.id&&
      !button.matches(':disabled')&&!button.closest('[hidden],[inert]'));
    if(row){
      const group=row.closest('[data-wrap-group]');
      if(group)group.open=true;
      if(!hiddenByClosedDisclosure(row)&&focusScheduleTarget(row))return true;
    }
    const key=previous.closest('[data-wrap-group]')?.dataset.wrapGroup;
    const group=$$('[data-wrap-group]',panel).find(item=>item.dataset.wrapGroup===key);
    const scope=$('[data-action="wrap-up-scope"][aria-pressed="true"]',panel);
    for(const target of [group&&$('summary',group),scope,$('#wrapUpReviewHeading',panel)])
      if(target&&target.getClientRects().length&&!target.closest('[hidden],[inert]')&&focusScheduleTarget(target))return true;
    return false;
  }
  function restoreViewFocus(previous,root) {
    if(!previous||previous.isConnected||document.activeElement!==document.body)return false;
    if(isScheduleControl(previous))
      return restoreScheduleFocus(previous,root);
    if(previous.dataset.action==='wrap-review-task')
      return restoreWrapReviewFocus(previous,root);
    if(previous.dataset.wrapLesson||previous.id==='wrapUpLessons')
      return focusWrapLesson(previous.dataset.wrapLesson,root);
    if(!previous.dataset.taskFocus)return restoreFocus(previous,root);
    if(ui.view!=='tasks'||ui.taskView!=='list'||root.closest('[hidden],[inert]'))return false;
    if(restoreFocus(previous,root))return true;
    const rows=$('#taskRows',root);
    const title=rows&&focusable(rows).find(el=>el.dataset.id===previous.dataset.id&&el.dataset.taskFocus==='name');
    const filter=$('[data-action="task-filter"][aria-pressed="true"]',root);
    const target=title||(filter&&focusable(root).includes(filter)?filter:null);
    if(target){target.focus();return true;}
    const heading=$$('h1',root).find(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length);
    if(!heading)return false;
    heading.tabIndex=-1;heading.focus();return true;
  }
  function saveLock(root,submitter) {
    const previousFocus=document.activeElement;
    ui.pendingSave=true;
    root.dataset.saving='true';root.setAttribute('aria-busy','true');
    const controls=$$('button,input,select,textarea',root).map(el=>[el,el.disabled]);
    if(root.matches('button'))controls.push([root,root.disabled]);
    controls.forEach(([el])=>el.disabled=true);
    const label=submitter?.innerHTML;
    if(submitter)submitter.textContent='Saving…';
    return ()=>{
      ui.pendingSave=false;delete root.dataset.saving;root.removeAttribute('aria-busy');
      controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});
      if(submitter?.isConnected)submitter.innerHTML=label;
      if(previousFocus?.isConnected&&root.isConnected&&document.activeElement===document.body)restoreFocus(previousFocus,root);
    };
  }
  function formError(form,error) {
    if(!form?.isConnected)return;
    let message=$('.form-error',form);
    if(!message){message=document.createElement('p');message.className='form-error';message.setAttribute('role','alert');form.prepend(message);}
    message.textContent=error.message||'Please check the form and try again.';
  }
  function hasUnsavedFields(root,exclude=[]) {
    return !!root&&(root.dataset?.relatedDraft==='true'||!!root.querySelector?.('[data-related-draft="true"]')||$$('input,textarea,select',root).some(input=>{
      if(input.readOnly||input.type==='hidden'||exclude.includes(input.name))return false;
      if(input.type==='checkbox'&&input.name==='acceptTask'&&input.form?.id==='acceptTasksForm')return input.checked;
      if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
      if(input.tagName==='SELECT'&&input.multiple)return [...input.options].some(option=>option.selected!==option.defaultSelected);
      const original=input.tagName==='SELECT'?([...input.options].find(option=>option.defaultSelected)||input.options[0])?.value:input.defaultValue;
      return input.value!==(original??'');
    }));
  }
  function confirmDiscard(...roots) {
    return !roots.some(root=>hasUnsavedFields(root))||window.confirm('Discard your unsaved changes?');
  }
  function hasAcceptanceReturnDraft() {
    return !!(ui.acceptanceReturn?.selected.length&&ui.acceptanceReturn.actor===ui.actor);
  }
  function confirmCloseDialog() {
    if(hasAcceptanceReturnDraft())
      return window.confirm('Close the assignment review and discard your selections and any unsaved task edits?');
    return confirmDiscard($('#dialog'));
  }
  const unsavedDialog=()=>!!$('#dialogBackdrop')&&!$('#dialogBackdrop').hidden&&hasUnsavedFields($('#dialog'));
  const unsavedReview=()=>hasUnsavedFields($('#emailReviewForm'));
  const dateKey = (date = new Date()) => GatherCalendar.dayKey(date,store.getTimeZone());
  const dayLabel = value => !value ? 'No due date' : new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const timeLabel = value => !value ? 'No update yet' : new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const relative = value => {
    if (!value) return 'No update yet';
    const mins = Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));
    return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : `${Math.floor(mins/1440)}d ago`;
  };
  const member = id => store.getState().members.find(p=>p.id===id) || {id:'',name:'Unassigned',initials:'?',role:'Choose an owner',color:'#e5e8e2'};
  const avatar = (id, small=false) => {const p=member(id);const color=({peach:'#efc9b5',lavender:'#ded3ee',mint:'#c6dfd0',sand:'#f1dfb3'})[p.color]||'#e5e8e2';return `<span class="avatar ${small?'avatar-small':''}" style="--avatar-bg:${color};--avatar-ink:#233b2e" title="${h(p.name)}">${h(p.initials)}</span>`;};
  const person = (id,showFullNameOnPhone=false) => {
    const name=member(id).name;
    const short=h(name.split(' ')[0]);
    return `<span class="person-chip">${avatar(id,true)}${showFullNameOnPhone?`<span class="task-owner-short">${short}</span><span class="task-owner-full">${h(name)}</span>`:`<span>${short}</span>`}</span>`;
  };
  const statusBadge = status => `<span class="status-badge status-${h(status)}">${h(statuses[status])}</span>`;
  const due = task => `<span class="${task.status!=='done' && task.dueDate && task.dueDate<dateKey()?'due-overdue':''}">${task.dueDate===dateKey()?'Today':dayLabel(task.dueDate)}</span>`;
  const reason = (task,s=store.getState()) => GatherPriorities.analyze(task,s.tasks,new Date(),s.event.timeZone);
  const attention = s => GatherPriorities.rank(s.tasks,new Date(),false,s.event.timeZone);
  const pending = s => s.messages.filter(m=>!m.appliedTaskId&&!m.ignoredAt);
  const completed = s => s.tasks.filter(t=>t.status==='done').sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  const completionText = task => {
    const reporter=task.reportedBy||task.completionReportedBy;
    if(task.verifiedAt)return reporter?`${reporter} reported complete · verified by ${member(task.verifiedBy).name}`:`Verified by ${member(task.verifiedBy).name}`;
    if(task.completionReportedBy)return `${task.completionReportedBy} reported complete · recorded by ${member(task.completedBy).name}`;
    if(task.reportedAt&&reporter)return `${reporter} reported complete`;
    return `Marked done by ${member(task.completedBy).name}`;
  };
  const noteUpdate = task => ({text:task.note,actor:task.noteUpdatedBy||'',at:task.noteUpdatedAt||''});
  const updateAttribution = update => !update.text ? 'No update recorded.' : !update.actor||!update.at ? 'Author not recorded for this saved note.' : `Recorded by ${store.getState().members.find(person=>person.id===update.actor)?.name||'an unavailable member'} · ${relative(update.at)}`;
  const latestUpdateRecord = task => {
    const last=task.comments.at(-1),note=noteUpdate(task);
    const laterComment=last&&(note.at?Date.parse(last.at)>Date.parse(note.at)||last.at===note.at&&Number.isInteger(task.noteCommentCount)&&task.comments.length>task.noteCommentCount:last.at===task.updatedAt);
    return laterComment?{text:last.text,actor:last.actor,at:last.at}:note;
  };
  const commitment = task => task.verifiedAt ? `Verified by ${member(task.verifiedBy).name}` : task.reportedAt ? `Reported complete by ${task.reportedBy}${task.requiresVerification?' · needs verification':''}` : GatherPriorities.changesRequested(task) ? 'Changes requested · review and resubmit' : task.acceptedAt ? `${task.acceptedSourceId?'Acceptance reported by':'Accepted by'} ${member(task.acceptedBy).name.split(' ')[0]}` : task.status==='done' ? 'Completed record' : task.owner ? 'Waiting for owner acceptance' : 'No owner yet';
  const latestUpdate = task => latestUpdateRecord(task).text;
  const toast = message => {const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200);};
  const pageHeading = (eyebrow,title,subtitle,actions='') => `<div class="page-heading"><div>${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div><div class="header-actions">${actions}</div></div>`;
  const addButton = () => canCreateTasks()?`<button class="btn btn-primary" data-action="add-task">${icon('plus')} Add task</button>`:'';
  const sourceButton = task => {const group=GatherInbox.conversations(store.getState()).find(g=>g.taskId===task.id);return group?`<button class="text-button" data-action="task-conversation" data-id="${h(task.id)}">${icon('mail')} Email briefing (${group.messages.length})</button>`:'';};
  const completionNeedsReview = task => task.status!=='done'&&(task.requiresVerification||dependencyInfo(task).open.length>0);

  function taskRow(task) {
    const done=task.status==='done',organizer=isOrganizer(),inspect=!organizer||completionNeedsReview(task);
    const id=h(task.id),title=h(task.title),update=latestUpdateRecord(task);
    const ownerLabel=task.owner?member(task.owner).name:'Unassigned';
    const mobileLabel=label=>`<span class="task-card-label" aria-hidden="true">${label}</span>`;
    let decision=null;
    if(ui.tab==='attention'&&organizer) { const s=store.getState();decision=GatherPriorities.decision(task,s.tasks,new Date(),s.event.timeZone); }
    const reply=ui.tab==='mine'&&task.owner===ui.actor&&recovery.recoveryReply(task,false);
    return `<tr role="row"${task.id===guideTaskId?' class="guide-first-task-row"':''}>
      <td role="cell" class="task-cell-completion" headers="tasks-completion"><button type="button" class="${inspect?'icon-button task-inspect-button':done?'check-button checked':'check-button'}" data-action="${inspect?'task':'toggle-task'}" data-id="${id}" data-task-focus="${inspect?'inspect':done?'reopen':'complete'}" aria-label="${organizer?(done?'Reopen':inspect?'Review':'Complete'):'View'} ${title}">${inspect?icon('search'):done?icon('done'):''}</button></td>
      <td role="cell" class="task-cell-name" headers="tasks-name"><button type="button" class="task-name-button" data-action="task" data-id="${id}" data-task-focus="name">${title}</button><div class="category-label">${h(task.category)}${task.sourceMessageId?' · From email':''}</div>${done?`<div class="completion-note">${h(completionText(task))} · ${h(timeLabel(task.completedAt))}</div>`:''}</td>
      <td role="cell" class="task-cell-owner" headers="tasks-owner">${mobileLabel('Owner')}${!task.owner&&!done?`<button type="button" class="btn btn-secondary btn-small" data-action="claim" data-id="${id}" data-task-focus="owner">Claim task</button>`:`<button type="button" class="btn-ghost table-owner" data-action="task" data-id="${id}" data-task-focus="owner" aria-label="Owner: ${h(ownerLabel)} · Open task: ${title}">${person(task.owner,true)}</button>`}<div class="commitment-note">${h(commitment(task))}</div></td>
      <td role="cell" class="task-cell-status" headers="tasks-status">${mobileLabel('Status')}${statusBadge(task.status)}${(task.dependencies||[]).length?`<button type="button" class="task-link-summary" data-action="map-focus" data-id="${id}" data-task-focus="links">${h(GatherPlanningUI.readiness(task,store.getState().tasks).label)}${(task.dependencies||[]).some(l=>l.kind==='related')?' · related work':''}</button>`:''}</td>
      <td role="cell" class="task-cell-due" headers="tasks-due">${mobileLabel('Due')}${due(task)}</td>
      <td role="cell" class="task-cell-update" headers="tasks-update">${mobileLabel('Latest update')}<div class="task-meta">${h(updateAttribution(update))}</div><div class="task-note-preview" title="${h(update.text)}">${h(update.text || 'No progress note yet')}</div></td>
      <td role="cell" class="task-cell-details" headers="tasks-details"><button type="button" class="${decision||reply?'btn btn-secondary btn-small':'icon-button'}" data-action="task" data-id="${id}" data-task-focus="details"${reply?' data-open-recovery-reply':''} aria-label="${reply?'Review organizer response for':decision?'Review plan for':'Open task:'} ${title}">${reply?'Review organizer response':decision?'Review plan':icon('arrow')+'<span class="task-card-open" aria-hidden="true">Open task</span>'}</button></td></tr>`;
  }
  const empty = (title,copy,action='') => `<div class="empty-state">${icon('done')}<strong>${title}</strong>${copy?`<p>${copy}</p>`:''}${action}</div>`;
  function activityItem(item,taskIds,compact=false) {
    return `<article class="${compact?'feed-item':'activity-item'}">${avatar(item.actor,true)}<div class="${compact?'feed-copy':'activity-content'}"><p><strong>${h(member(item.actor).name)}</strong> ${h(item.text)}</p>${taskIds.has(item.taskId)?`<button class="text-button" data-action="task" data-id="${h(item.taskId)}">Open task ${icon('arrow')}</button>`:''}<time class="${compact?'feed-time':'activity-date'}" datetime="${h(item.at)}">${timeLabel(item.at)}</time></div></article>`;
  }
  function insightMarkup(item) {
    return `<article class="insight"><span class="insight-source">${h(item.source)}</span><h3>${h(item.title)}</h3><p>${h(item.body)}</p><div class="insight-actions"><button class="btn btn-small" data-action="accept-insight" data-id="${h(item.id)}">${icon('plus')} Add to plan</button><button class="icon-button" data-action="dismiss-insight" data-id="${h(item.id)}" aria-label="Dismiss ${h(item.title)}">${icon('close')}</button></div></article>`;
  }

  function overview(s,showGuideTask=false) {
    const needs=attention(s), done=completed(s), emails=pending(s);
    const taskIds=new Set(s.tasks.map(task=>task.id));
    const progress=Math.round(done.length/Math.max(s.tasks.length,1)*100);
    const today=dateKey();
    // Calendar keys are already event-local. UTC midnight avoids viewer DST
    // turning one calendar day into 23 or 25 elapsed hours.
    const days=s.event.date?Math.max(0,(Date.parse(s.event.date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
    const suggestions=store.getSuggestions();
    const setupNote=window.GatherMode&&!window.GatherMode.demo&&isOrganizer()&&!s.event.setupCompletedAt?'<div class="notice setup-notice"><span>Finish project setup. Existing work is kept.</span><a href="'+h(window.GatherMode.projectUrl('/setup'))+'" target="_top" class="btn btn-secondary btn-small">Project settings</a></div>':'';
    return '<div id="overviewHeader">'+pageHeading('', 'Overview', days===null?'Event date not set':`${dayLabel(s.event.date)}${s.event.date>=today?` · ${days} ${days===1?'day':'days'} until event`:''}`,`${s.tasks.length&&window.GatherMode&&isOrganizer()?'<button class="btn btn-secondary" data-action="draft-plan">Build a plan</button>':''}<button class="btn btn-secondary" data-action="digest">Summary</button>${s.tasks.length?addButton():''}`)+setupNote+(showGuideTask?guideTaskPanel(s,true):'')+`
      <section class="stat-grid" aria-label="Project status">
        <button class="stat-card" data-action="task-filter" data-filter="attention"><span class="stat-label">Needs attention</span><strong class="stat-number">${needs.length}<span class="metric-icon">${icon('alert')}</span></strong></button>
        <button class="stat-card" data-action="task-filter" data-filter="done"><span class="stat-label">Completed</span><strong class="stat-number">${done.length}<span class="muted"> / ${s.tasks.length}</span></strong><span class="progress-track"><span class="progress-fill" style="width:${progress}%"></span></span></button>
        <button class="stat-card" data-view="inbox"><span class="stat-label">Email to review</span><strong class="stat-number">${emails.length}<span class="metric-icon">${icon('mail')}</span></strong></button>
        <button class="stat-card" data-view="team"><span class="stat-label">People</span><strong class="stat-number">${s.members.length}<span class="metric-icon">${icon('people')}</span></strong></button>
      </section></div>
      <div class="workspace-grid"><div class="stack" id="overviewMain">
        ${s.tasks.length?`
        ${isOrganizer()?recovery.organizerReviewPanel(s,{expanded:ui.organizerReviewsExpanded}):''}
        ${recovery.nextUpPanel(s,{overview:true})}
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Needs attention</h2></div><button class="text-button" data-action="task-filter" data-filter="attention">View all ${icon('arrow')}</button></div>
          <div class="attention-list">${needs.slice(0,4).map(t=>{const r=reason(t);return `<article class="attention-item"><div class="attention-reason reason-${r.key}">${r.label}</div><div class="task-summary"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note||r.action)}</p><div class="task-meta">${person(t.owner)}<span>·</span>${due(t)}<span>· Updated ${relative(t.updatedAt)}</span></div></div><div class="attention-actions"><button class="btn btn-small btn-secondary" data-action="${!t.owner?'claim':'task'}" data-id="${h(t.id)}">${!t.owner?'Claim task':'Review'}</button></div></article>`;}).join('') || empty('No tasks need attention.','')}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Recently completed</h2></div><button class="text-button" data-action="task-filter" data-filter="done">All completed ${icon('arrow')}</button></div><div class="mini-feed">${done.slice(0,3).map(t=>`<article class="feed-item">${avatar(t.completedBy)}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(completionText(t))}</p><time class="feed-time">${timeLabel(t.completedAt)}</time></div><span class="status-badge status-done">${icon('done')} Done</span></article>`).join('') || empty('No completed tasks.','')}</div></section>
        `:GatherPlanningUI.emptyPlanMarkup({organizer:isOrganizer(),canCreate:canCreateTasks(),planBuilder:!!window.GatherMode})}
      </div><aside class="stack">
        <section class="ai-panel planning-assistant" id="thoughtPartner"><span class="eyebrow">SUGGESTIONS</span><h2>What’s next?</h2>${window.GatherMode&&isOrganizer()?'<div id="planningSidebarSlot"></div>':'<p class="muted">The organizer can enable automatic AI suggestions. Ask Weft is coming soon. You can still create tasks manually when teammate task creation is enabled.</p>'}<div class="planning-checks-heading"><h3>Automatic checks</h3><span>Rules · not AI</span></div><div id="overviewSuggestions">${suggestions.slice(0,2).map(insightMarkup).join('') || '<p class="muted">No automatic checks right now.</p>'}</div><button class="text-button" data-action="thought-partner">All checks (<span data-suggestion-count>${suggestions.length}</span>) ${icon('arrow')}</button></section>
        <section class="panel email-preview" id="overviewEmail"><div class="panel-heading"><div><h2 class="section-title">Email briefing</h2></div></div>${GatherInbox.conversations(s).filter(g=>g.pending.length).slice(0,2).map(g=>{const b=GatherInbox.briefing(g,s),m=b.message;return `<button class="email-item" data-action="source" data-id="${h(m.id)}"><span class="email-icon">${icon('mail')}</span><span class="email-copy"><strong>${h(g.title)}</strong><span class="briefing-summary-preview">${h(m.sender)}: ${h(b.summary)}</span></span>${icon('arrow')}</button>`;}).join('') || '<p class="notice">No emails to review.</p>'}<button class="text-button" data-view="inbox">Open email briefing ${icon('arrow')}</button></section>
      </aside></div>
      <section class="panel section-gap" id="overviewActivity"><div class="panel-heading"><div><h2 class="section-title">Recent activity</h2></div><button class="text-button" data-view="updates">All updates ${icon('arrow')}</button></div><div class="mini-feed">${s.activity.slice(0,3).map(a=>activityItem(a,taskIds,true)).join('')}</div></section>`;
  }

  function filteredTasks(s) {
    return (ui.tab==='attention'?attention(s):s.tasks).filter(t=>(ui.tab!=='mine'||t.owner===ui.actor)&&(ui.tab!=='available'||(!t.owner&&t.status!=='done'))&&(ui.tab!=='attention'||reason(t))&&(ui.tab!=='done'||t.status==='done')&&(!ui.owner||t.owner===ui.owner||(ui.owner==='unassigned'&&!t.owner))&&(!ui.status||t.status===ui.status)&&(!ui.search||`${t.title} ${t.note} ${member(t.owner).name} ${t.category}`.toLowerCase().includes(ui.search.toLowerCase())));
  }
  const options = (entries,value) => entries.map(([id,label])=>`<option value="${h(id)}" ${id===value?'selected':''}>${h(label)}</option>`).join('');
  const ownerOptions = (value,all=false) => options([...(all?[['','All owners'],['unassigned','Unassigned']]:[['','Unassigned']]),...store.getState().members.filter(p=>all||p.active!==false||p.id===value).map(p=>[p.id,p.name+(p.active===false?' · Former teammate':'')])],value);
  const statusOptions = value => options(Object.entries(statuses),value);
  const recovery = GatherRecoveryUI.create({store,ui,h,options,dayLabel,member});
  const schedule = GatherScheduleUI.create({h,options,statusBadge});
  const projectInfo=window.GatherInfoUI?.create({h,openDialog,closeDialog,toast,saveLock,isDialogOpen:kind=>!$('#dialogBackdrop').hidden&&(!kind||ui.dialogKind===kind),getWorkspace:()=>store.getState(),onLoaded:()=>recordLoadedGuideView('info')});
  const projectBudget=window.GatherBudgetUI?.create({h,openDialog,closeDialog,toast,saveLock,isDialogOpen:()=>!$('#dialogBackdrop').hidden,getWorkspace:()=>store.getState(),onLoaded:()=>recordLoadedGuideView('budget')});
  function confirmFixedDate(taskId,data) {
    const task=store.getState().tasks.find(t=>t.id===taskId);
    if(!task?.hardDeadline||data.dueDate===undefined||data.dueDate===task.dueDate)return true;
    if(!window.confirm('This task has a fixed external deadline. Has the vendor or external deadline also changed?'))return false;
    data.confirmHardDeadline=true;return true;
  }
  function taskLinkNotice() {
    return taskLinkUnavailable?`<section class="task-link-notice" id="taskLinkNotice" aria-labelledby="taskLinkUnavailableTitle">
      <div><h2 id="taskLinkUnavailableTitle" tabindex="-1" aria-describedby="taskLinkUnavailableHelp">This task is no longer available</h2><p id="taskLinkUnavailableHelp">The link doesn’t match a task in this project. You can search the current task list instead.</p></div>
      <button type="button" class="btn btn-secondary" data-action="continue-task-search">Go to task search</button>
    </section>`:'';
  }
  function continueFromTaskLinkNotice() {
    if(!taskLinkUnavailable||ui.view!=='tasks'||window.GatherAccessLost)return;
    taskLinkUnavailable=false;
    $('#taskLinkNotice')?.remove();
    $('#taskSearch')?.focus();
  }
  function tasksView(s) {
    const tasks=filteredTasks(s);
    return pageHeading('','Tasks','',`${isOrganizer()?'<button class="btn btn-secondary" data-action="review-assignments">Assign tasks</button>':''}${addButton()}`)+`
      ${taskLinkNotice()}
      ${guideTaskPanel(s)}
      ${ui.tab==='mine'?recovery.nextUpPanel(s)+`<div class="inline section-gap"><button class="btn btn-secondary" data-action="review-acceptance" ${acceptanceCandidates(tasks).length?'':'hidden'}>Review task acceptance (${acceptanceCandidates(tasks).length})</button></div>`:''}
      ${s.tasks.filter(t=>t.owner===ui.actor&&dependencyInfo(t,s).ready).map(t=>`<div class="dependency-prompt" role="status"><span><strong>Ready to resume:</strong> ${h(t.title)}</span><button class="btn btn-secondary btn-small" data-action="task" data-id="${h(t.id)}">Review results</button></div>`).join('')}
      <section class="panel"><div class="task-discovery"><label class="search-input task-search-prominent">${icon('search')}<input id="taskSearch" type="search" value="${h(ui.search)}" placeholder="Search tasks, people, notes…" aria-label="Search tasks"></label><div class="task-view-switch" role="group" aria-label="Task layout"><button class="btn btn-small ${ui.taskView==='list'?'btn-primary':'btn-secondary'}" data-action="task-layout" data-id="list" aria-pressed="${ui.taskView==='list'}">List</button><button class="btn btn-small ${ui.taskView==='map'?'btn-primary':'btn-secondary'}" data-action="task-layout" data-id="map" aria-pressed="${ui.taskView==='map'}">Link map</button></div></div><div class="toolbar"><div class="filter-tabs" role="group" aria-label="Task views">${[['all','All tasks'],['mine','My tasks'],['available','Unassigned · '+s.tasks.filter(t=>!t.owner&&t.status!=='done').length],['attention','Needs attention'],['done','Completed']].map(([id,label])=>`<button class="filter-tab ${ui.tab===id?'active':''}" data-action="task-filter" data-filter="${id}" aria-pressed="${ui.tab===id}">${label}</button>`).join('')}</div></div>
      <div class="toolbar task-filter-toolbar"><div class="inline"><select id="ownerFilter" class="select-input" aria-label="Filter by owner">${ownerOptions(ui.owner,true)}</select><select id="statusFilter" class="select-input" aria-label="Filter by status">${options([['','All statuses'],...Object.entries(statuses)],ui.status)}</select></div><span class="muted" id="taskResultCount">${tasks.length} ${tasks.length===1?'task':'tasks'}</span></div>
      <div id="taskMap" ${ui.taskView==='map'?'':'hidden'}>${ui.taskView==='map'?GatherPlanningUI.graphMarkup(s.tasks,tasks,ui.mapFocus,s.members):''}</div><div class="task-table-wrap" ${ui.taskView==='map'?'hidden':''}><table class="task-table" role="table" aria-label="Task list"><thead role="rowgroup"><tr role="row"><th id="tasks-completion" role="columnheader" scope="col"><span class="sr-only">Completion</span></th><th id="tasks-name" role="columnheader" scope="col">TASK</th><th id="tasks-owner" role="columnheader" scope="col">OWNER</th><th id="tasks-status" role="columnheader" scope="col">STATUS</th><th id="tasks-due" role="columnheader" scope="col">DUE</th><th id="tasks-update" role="columnheader" scope="col">LATEST UPDATE</th><th id="tasks-details" role="columnheader" scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody id="taskRows" role="rowgroup">${tasks.map(taskRow).join('')}</tbody></table><div id="taskEmpty" ${tasks.length?'hidden':''}>${empty('No tasks match this view.','Try another filter or search.')}</div></div></section>`;
  }
  function guideTaskPanel(s,away=false) {
    const task=guideTaskId&&s.tasks.find(item=>item.id===guideTaskId);
    if(!task||window.GatherAccessLost)return '';
    if(away)return `<section class="guide-task-result" aria-labelledby="guideTaskRevealHeading"><h2 id="guideTaskRevealHeading" tabindex="-1">Your task is saved</h2><p>Find ${h(task.title)} under Shared tasks → All tasks.</p><button class="btn btn-secondary" type="button" data-action="guide-task-reveal">Show in Shared tasks</button></section>`;
    const done=task.status==='done';
    return `<section class="guide-task-result" aria-labelledby="guideTaskSaved">
      <div class="guide-task-result-top"><div><p class="guide-task-eyebrow">${icon('done')} Task saved · Shared tasks → All tasks</p><h2 id="guideTaskSaved" tabindex="-1">${h(task.title)}</h2></div>${statusBadge(task.status)}</div>
      <p>Your team can find this task here. Open it to see the owner, due date, and what “done” means.</p>
      <button class="btn btn-secondary" type="button" data-action="task" data-id="${h(task.id)}">Open task details</button>
      <div class="guide-task-practice"><div><h3>Finish the work</h3><p>Use the checkbox next to the task when the work is actually done. Tasks that need verification or have unfinished prerequisites open for review instead.</p><button type="button" class="text-button" data-action="guide-task-completion">${done?'Find the reopen control':'Find the completion control'}</button></div>
      <div><h3>Connect related work</h3><p>Use Related for work that can happen in parallel, or Required if the other task must finish first.</p>${done?'<p>Completed tasks must be reopened before adding links.</p>':`<button type="button" class="text-button" data-action="guide-task-links" data-id="${h(task.id)}">Show task relationships</button>`}</div></div>
      <p class="guide-task-optional">These actions are optional. Pick up with the guide above whenever you’re ready.</p>
    </section>`;
  }
  function revealGuideTask(focusCompletion=false) {
    if(!guideTaskId||!store.getState().tasks.some(task=>task.id===guideTaskId)||window.GatherAccessLost)return;
    const prior={tab:ui.tab,taskView:ui.taskView,mapFocus:ui.mapFocus,owner:ui.owner,status:ui.status,search:ui.search};
    Object.assign(ui,{tab:'all',taskView:'list',mapFocus:'',owner:'',status:'',search:''});
    if(!navigate('tasks')){
      Object.assign(ui,prior);
      guideTaskNeedsReveal=true;
      render();
    }else guideTaskNeedsReveal=false;
    const control=focusCompletion&&ui.view==='tasks'&&$$('#taskRows .task-cell-completion button').find(button=>button.dataset.id===guideTaskId);
    const target=control||$(ui.view==='tasks'?'#guideTaskSaved':'#guideTaskRevealHeading');
    target?.focus({preventScroll:true});
    target?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  }
  function showGuideTaskLinks(id) {
    if(id!==guideTaskId||window.GatherAccessLost)return;
    taskDialog(id);
    requestAnimationFrame(()=>{
      if(ui.dialogKind!=='task'||ui.detailId!==id)return;
      const existing=$('#relationshipAddForm select[name="taskId"]');
      const disclosure=existing?.options.length>1?existing.closest('details'):$('#dialog .linked-task-create');
      const target=disclosure?.querySelector('summary')||$('#dialog .task-dependencies h3');
      if(disclosure)disclosure.open=true;
      if(target){if(!disclosure)target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});}
    });
  }
  function assignmentCandidates(tasks) {
    return tasks.filter(task=>task.status!=='done'&&!task.reportedAt&&!task.verifiedAt).slice(0,100);
  }
  function assignmentDialog(reviewGroup='') {
    if(!isOrganizer()||window.GatherAccessLost)return;
    const state=store.getState(),tasks=assignmentCandidates(reviewGroup
      ?schedule.reviewAssignmentTasks(state,eventReviewScope(),reviewGroup):filteredTasks(state));
    if(!tasks.length){toast('No open tasks in this view can be assigned together. Review completed or reported work separately.');return;}
    const people=state.members.filter(person=>person.active!==false&&(!window.GatherMode||window.GatherMode.demo||!person.role?.includes('· example')));
    const title=reviewGroup==='unassigned'?'Assign unowned tasks':reviewGroup==='owner-unavailable'?'Reassign tasks with unavailable owners':'Assign tasks to a teammate';
    const source=reviewGroup?'this event review section':'the current filtered view';
    const currentOwner=task=>{
      if(!task.owner)return 'Unassigned';
      const person=state.members.find(item=>item.id===task.owner);
      return person?person.name+(person.active===false?' · Inactive teammate':''):'Assigned owner unavailable';
    };
    openDialog(title,`<p>Choose tasks from ${source}, up to 100 at a time, then choose one owner. Nothing is selected for you. Repeat for another teammate.</p><p class="notice">Only open work without a completion report is included. Reassignment clears the previous owner’s acceptance, Next up commitment and pending plan requests; the new owner must accept responsibility. Task progress, instructions, dates, schedules and prerequisites stay unchanged. No messages are sent.</p><form id="assignTasksForm" data-actor="${h(ui.actor)}"${reviewGroup?' data-return-to="event-review"':''}><label class="field">New owner<select name="owner" required>${options([['','Choose a teammate'],...people.map(person=>[person.id,person.name])],'')}</select></label><div data-owner-load></div><div class="inline"><button type="button" class="btn btn-secondary btn-small" data-action="assignment-select" data-id="all">Select all shown</button><button type="button" class="btn btn-secondary btn-small" data-action="assignment-select" data-id="none">Select none</button></div><div class="acceptance-list">${tasks.map(task=>`<label class="acceptance-item"><input type="checkbox" name="assignTask" value="${h(task.id)}" data-revision="${task.revision}" data-owner="${h(task.owner)}"><span><strong>${h(task.title)}</strong><span>Current owner: ${h(currentOwner(task))} · ${h(statuses[task.status]||task.status)}</span><span>${task.dueDate?'Due '+h(dayLabel(task.dueDate)):'No preparation deadline'}${task.schedule?' · Activity '+h(task.schedule.start.replace('T',' '))+' · '+h(state.event.timeZone):''}</span><span>${h(task.note||'No instructions recorded.')}</span></span></label>`).join('')}</div><p id="assignmentCount" role="status">0 tasks selected; 0 owner changes.</p><label class="acceptance-item"><input type="checkbox" name="confirmed" required><span>I reviewed these owner changes and the need for renewed acceptance. Tasks already owned by this teammate will stay unchanged.</span></label><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="${reviewGroup?'before-event-review':'close-dialog'}">${reviewGroup?'Back to event review':'Cancel'}</button><button id="assignmentSubmit" class="btn btn-primary" type="submit" disabled>Assign selected tasks</button></div></form>`,'',true,'assignment');
  }
  function syncAssignmentSelection(form) {
    const selected=$$('input[name="assignTask"]:checked',form),owner=$('select[name="owner"]',form).value;
    const changes=owner?selected.filter(input=>input.dataset.owner!==owner).length:0;
    $('#assignmentCount',form).textContent=`${selected.length} ${selected.length===1?'task':'tasks'} selected; ${changes} owner ${changes===1?'change':'changes'}.`;
    $('#assignmentSubmit',form).disabled=!changes||!$('input[name="confirmed"]',form).checked;
  }
  function focusAfterAcceptance() {
    // The review button disappears when all visible assignments are accepted.
    // Wait for saveLock to release, and never steal focus from another control.
    queueMicrotask(()=>{if(ui.view==='tasks'&&document.activeElement===document.body)skipToContent();});
  }
  function acceptanceCandidates(tasks) {
    return tasks.filter(waitsForAcceptance).slice(0,100);
  }
  function waitsForAcceptance(task) {
    return task.owner===ui.actor&&!task.acceptedAt&&task.status!=='done'&&!task.reportedAt&&!task.verifiedAt&&!task.archivedAt;
  }
  function isLiveTeammate() {
    return !!(window.GatherMode&&!window.GatherMode.demo&&!window.GatherAccessLost&&window.GatherIdentity?.role==='member');
  }
  function teammateHandoff(s,welcome) {
    const pending=s.tasks.filter(waitsForAcceptance).length;
    if(!welcome&&!pending)return '';
    const mine=s.tasks.some(task=>task.owner===ui.actor&&task.status!=='done'&&!task.archivedAt);
    const claimable=s.tasks.some(task=>!task.owner&&task.status!=='done'&&!task.archivedAt);
    const heading=welcome?'Welcome to '+h(s.event.name):'Review your task assignments';
    const message=pending
      ? `<strong>${pending} ${pending===1?'assignment is':'assignments are'} ready for your review.</strong> Check what’s expected and accept only the work you can take on.`
      : mine?'Your assignments are in My tasks. Open a task to see what’s expected, check its due date, or share an update.'
      : claimable?'Nothing is assigned to you yet. You can browse unassigned tasks and claim one if you’re able to take it on.'
      :'Nothing is assigned to you yet. Start with the event details and schedule, or see who’s planning with you.';
    const primary=pending?['review','Review assignments']:mine?['mine','Open My tasks']:claimable?['available','Find unassigned tasks']:null;
    const work=`<p>${message}</p>${pending?'<p class="handoff-note">Accepting records responsibility. It doesn’t mark a task done.</p>':''}${primary?`<button type="button" class="btn btn-primary" data-action="handoff-tasks" data-id="${primary[0]}">${primary[1]}</button>`:''}`;
    return `<div class="handoff-main"><div class="handoff-header"><div><p class="handoff-kicker">${welcome?'Getting started as a teammate':'Your work'}</p><h2 id="workspaceHandoffTitle" tabindex="-1">${heading}</h2></div>${welcome?'<button type="button" class="text-button handoff-dismiss" data-action="dismiss-handoff">Dismiss welcome</button>':''}</div>${welcome?`
      <div class="handoff-grid">
        <div><h3>Find your work</h3>${work}</div>
        <div><h3>Get oriented</h3><p>Check the date and location, see the schedule, and find out who’s planning with you.</p><div class="handoff-actions"><button type="button" class="btn btn-secondary" data-action="event-info" aria-haspopup="dialog">Event details</button><button type="button" class="btn btn-secondary" data-view="timeline">Timeline</button><button type="button" class="btn btn-secondary" data-view="team">People</button></div></div>
      </div><p class="handoff-note">As you work, open the task to share progress, ask for help, or report completion. The team can follow along there.</p>
      `:`<div class="handoff-work">${work}</div>`}</div>`;
  }
  function paintTeammateHandoff(state=store.getState()) {
    const host=$('#workspaceHandoff');
    if(!host)return;
    const markup=isLiveTeammate()&&ui.view==='overview'?teammateHandoff(state,joinWelcome):'';
    const previous=host.contains(document.activeElement)?document.activeElement:null;
    host.hidden=!markup;
    if(renderedTeammateHandoff!==markup){
      renderedTeammateHandoff=markup;
      host.innerHTML=markup;
      if(previous&&(!markup||!restoreFocus(previous,host)))(markup?$('#workspaceHandoffTitle'):$('#viewRoot'))?.focus({preventScroll:true});
    }
  }
  function openHandoffTasks(action) {
    if(!isLiveTeammate()||ui.view!=='overview'||!['review','mine','available'].includes(action))return;
    Object.assign(ui,{tab:action==='available'?'available':'mine',taskView:'list',owner:'',status:'',search:'',mapFocus:''});
    if(!navigate('tasks'))return;
    skipToContent();
    if(action==='review'&&acceptanceCandidates(store.getState().tasks).length)acceptanceDialog();
  }
  function assignmentReadiness(task,tasks) {
    const waiting=GatherPriorities.unresolved(task,tasks).length;
    if(waiting)return `Waiting on ${waiting} required ${waiting===1?'task':'tasks'} before completion.`;
    if(GatherPriorities.pendingRequest(task)?.kind==='help')return 'Help requested · waiting for the organizer.';
    if(task.status==='blocked')return (task.dependencies||[]).some(link=>link.kind!=='related')
      ?'Review linked results before resuming.':'Blocked · review the latest update.';
    return '';
  }
  function acceptanceDialog(fromEventReview=false,resume=null) {
    if(window.GatherAccessLost)return;
    const state=store.getState();
    const tasks=acceptanceCandidates(fromEventReview?schedule.reviewAcceptanceTasks(state,eventReviewScope()):filteredTasks(state));
    if(!tasks.length){
      if(resume){if(fromEventReview)beforeEventReview();else closeDialog();}
      toast('No unaccepted open tasks in this view.');return;
    }
    const source=fromEventReview?'this event review':'the current view';
    const sync=resume?$('#workspaceSyncNotice'):null;
    const stale=Boolean(sync&&!sync.hidden);
    const previous=new Map(resume?.selected.map(task=>[task.id,task.revision]));
    const keep=task=>!stale&&previous.has(task.id)&&previous.get(task.id)===task.revision;
    const selectedCount=tasks.filter(keep).length;
    const changed=previous.size-selectedCount;
    const choices=tasks.map(task=>{
      const key=h(task.id);
      const when=task.schedule?`Activity: ${h(GatherScheduleUI.dateLabel(task.schedule.start))} · ${h(GatherScheduleUI.range(task.schedule))} · ${h(state.event.timeZone)}${task.schedule.end?'':' · No end time set'} · ${h(task.schedule.location||'No location entered')}`:task.eventActivity===true?'Planned activity · start time not set':'';
      const readiness=assignmentReadiness(task,state.tasks);
      return `<div class="acceptance-choice">
        <label class="acceptance-item"><input type="checkbox" name="acceptTask" value="${key}" data-revision="${task.revision}"${keep(task)?' checked':''} aria-labelledby="accept-title-${key}" aria-describedby="accept-date-${key}${when?' accept-activity-'+key:''}${readiness?' accept-readiness-'+key:''} accept-outcome-${key}">
        <span><strong id="accept-title-${key}">${h(task.title)}</strong><span id="accept-date-${key}">${h(statuses[task.status]||task.status)} · ${task.dueDate?'Due '+h(dayLabel(task.dueDate)):'No preparation deadline'}</span>
        ${when?`<span id="accept-activity-${key}">${when}</span>`:''}${readiness?`<span id="accept-readiness-${key}"><strong>${h(readiness)}</strong></span>`:''}<span id="accept-outcome-${key}"><strong>Done when:</strong> ${h(task.scope||'No separate outcome recorded.')}</span>
        ${task.note?`<span><strong>Latest update:</strong> ${h(task.note)}</span>`:''}</span></label>
        <button type="button" class="text-button" data-action="inspect-acceptance-task" data-id="${key}" aria-label="Open task details for ${h(task.title)}">Open task details</button>
      </div>`;
    }).join('');
    openDialog('Accept your task assignments',`<p>Review the tasks you can take responsibility for. Only your open, unaccepted tasks from ${source} are shown, up to 100 at a time. ${resume?'Only unchanged selections were kept.':'Nothing is selected for you.'}</p>${changed?`<p class="notice" role="status">${changed} ${changed===1?'selection was':'selections were'} cleared ${stale?'because newer project changes are available. Reload before accepting.':'because the task changed or is no longer in this review. Check the current tasks before accepting.'}</p>`:''}<p class="notice">You can accept responsibility even if work is waiting on something else. Acceptance does not mark work complete, change deadlines, or remove prerequisites.</p><form id="acceptTasksForm" data-actor="${h(ui.actor)}"${fromEventReview?' data-return-to="event-review"':''}><div class="inline"><button type="button" class="btn btn-secondary btn-small" data-action="acceptance-select" data-id="all">Select all shown</button><button type="button" class="btn btn-secondary btn-small" data-action="acceptance-select" data-id="none">Select none</button></div><div class="acceptance-list">${choices}</div><p id="acceptanceCount" role="status">${selectedCount} ${selectedCount===1?'task':'tasks'} selected.</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="${fromEventReview?'before-event-review':'close-dialog'}">${fromEventReview?'Back to event review':'Cancel'}</button><button id="acceptanceSubmit" class="btn btn-primary" type="submit"${selectedCount?'':' disabled'}>Accept selected tasks</button></div></form>`,'',false,'acceptance');
    if(stale)showPendingUpdate();
    if(resume&&!changed&&!stale){
      const dialog=$('#dialog'),title=$('#dialogTitle',dialog);
      requestAnimationFrame(()=>{
        if(window.GatherAccessLost||ui.dialogKind!=='acceptance'||!title||$('#dialogTitle',dialog)!==title)return;
        const opener=$$('[data-action="inspect-acceptance-task"]',dialog).find(button=>button.dataset.id===resume.openerId);
        if(opener){opener.focus({preventScroll:true});opener.scrollIntoView({block:'center',inline:'nearest'});}
      });
    }
  }
  function inspectAcceptanceTask(id,opener) {
    if(window.GatherAccessLost||ui.dialogKind!=='acceptance')return;
    const form=$('#acceptTasksForm');
    if(!form||form.dataset.actor!==ui.actor||!form.contains(opener))return;
    const state=store.getState(),fromEventReview=form.dataset.returnTo==='event-review';
    const tasks=acceptanceCandidates(fromEventReview?schedule.reviewAcceptanceTasks(state,eventReviewScope()):filteredTasks(state));
    if(!tasks.some(task=>task.id===id)){toast('This task is no longer in your assignment review.');return;}
    const selected=$$('input[name="acceptTask"]:checked',form).map(input=>({id:input.value,revision:Number(input.dataset.revision)}));
    ui.acceptanceReturn={actor:ui.actor,view:ui.view,fromEventReview,openerId:id,selected};
    taskDialog(id,'',false,true);
  }
  function returnToAcceptanceReview() {
    const resume=ui.acceptanceReturn;
    if(!resume||ui.dialogKind!=='task'||resume.actor!==ui.actor||resume.view!==ui.view||window.GatherAccessLost)return false;
    acceptanceDialog(resume.fromEventReview,resume);
    return true;
  }
  function syncAcceptanceSelection(form) {
    const count=$$('input[name="acceptTask"]:checked',form).length;
    $('#acceptanceCount',form).textContent=`${count} ${count===1?'task':'tasks'} selected.`;
    $('#acceptanceSubmit',form).disabled=count===0;
  }
  function inboxView(s) {
    const messages=s.messages.filter(m=>!m.ignoredAt);
    const selected=messages.find(m=>m.id===ui.messageId) || messages.find(m=>!m.appliedTaskId) || messages[0];
    ui.messageId=selected?.id || '';
    return pageHeading('','Email briefing','',`<button class="btn btn-primary" data-action="paste-email">${icon('plus')} Paste an email</button>`)+`
      <div class="notice">Local email review · no mailbox is connected. Do not paste private confirmation emails here. Put booking references in <button class="text-button" data-view="details">Private details</button>.</div>
      <div class="intake-demo"><span>Try a changing conversation:</span><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="pending">1. Buses awaiting deposit</button><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="confirmed">2. Booking confirmed</button><span class="muted">Sample replies · review each before applying</span></div>
      <div class="intake-layout section-gap"><section class="panel message-list" aria-label="Emails to review">${messages.map(m=>`<button class="message-button ${m.id===selected?.id?'selected':''}" data-action="select-message" data-id="${h(m.id)}"><span class="message-sender">${h(m.sender)}</span><strong class="message-subject">${h(m.subject)}</strong><span class="message-preview">${h(m.body.slice(0,95))}</span><span class="message-status ${m.appliedTaskId?'is-applied':''}">${m.appliedTaskId?'✓ Added to the plan':'Needs review'}</span></button>`).join('')}</section>
      ${selected?emailReader(selected,s):`<section class="panel">${empty('No emails.','')}</section>`}</div>`;
  }
  function emailReader(m,s) {
    const p=m.suggested || {};
    const current=s.tasks.find(t=>t.id===p.taskId);
    const stale=current&&p.baseRevision!==current.revision;
    const older=current&&s.messages.some(item=>item.appliedTaskId===current.id&&item.receivedAt>m.receivedAt);
    const conversation=s.messages.filter(item=>item.threadId===m.threadId&&item.id!==m.id);
    return `<section class="panel email-reader"><div class="email-reader-header"><span class="source-label">ORIGINAL MESSAGE</span><h2>${h(m.subject)}</h2><div class="message-meta"><strong>${h(m.sender)}</strong><span>${timeLabel(m.receivedAt)}</span></div></div><div class="email-body">${h(m.body)}</div>${m.appliedTaskId?`<div class="review-card"><span class="status-badge status-done">${icon('done')} Applied to plan</span><p>The original message is attached to the task. Its sender is kept separate from the person who applied the update.</p><button class="btn btn-primary" data-action="task" data-id="${h(m.appliedTaskId)}">Open linked task ${icon('arrow')}</button></div>`:`<form class="review-card" id="emailReviewForm" data-id="${h(m.id)}"><div class="panel-heading"><div><span class="eyebrow">REVIEW BEFORE APPLYING</span><h3>Proposed changes</h3><p class="section-subtitle">These are draft fields. You decide the task, owner, and status.</p></div></div><div class="form-grid">
      <div class="full-width"><p class="notice">${h(p.reason||'Review the sender’s claim against the current plan.')}</p>${current?`<div class="comparison"><div><small>CURRENT PLAN · REVISION ${current.revision}</small><strong>${h(statuses[current.status])}</strong><span>${h(member(current.owner).name)} · ${dayLabel(current.dueDate)}</span><p>${h(current.note)}</p></div><div><small>EMAIL PROPOSES</small><strong>${h(statuses[p.status])}</strong><span>${h(member(p.owner).name)} · ${dayLabel(p.dueDate)}</span><p>${h(p.note)}</p></div></div>`:''}${stale?'<p class="warning-note">The task changed after this proposal. Refresh it before making a decision.</p>':''}<button type="button" class="text-button" data-action="refresh-proposal" data-id="${h(m.id)}">Refresh against the current plan</button></div>
      <input type="hidden" name="expectedRevision" value="${h(p.baseRevision||0)}">
      <label class="field">Action<select name="mode" id="emailMode">${options([['update','Update an existing task'],['new','Create a new task']],p.mode||'new')}</select></label>
      <label class="field" id="existingTaskField" ${p.mode==='update'?'':'hidden'}>Linked task<select name="taskId" id="emailTask" ${p.mode==='update'?'required':''}>${options([['','Choose the task to update…'],...s.tasks.map(t=>[t.id,t.title])],p.taskId||'')}</select></label>
      <label class="field full-width">Task name<input name="title" required maxlength="180" value="${h(p.title||m.subject)}"></label>
      <label class="field">Owner<select name="owner">${ownerOptions(p.owner||'')}</select></label>
      <label class="field">Status<select name="status">${statusOptions(p.status||'todo')}</select></label>
      <label class="field">Due date<input type="date" name="dueDate" value="${h(p.dueDate||'')}"></label>
      <label class="field full-width">Progress note<textarea name="note" rows="3" maxlength="3000">${h(p.note||'')}</textarea></label>${older?'<label class="check-field full-width"><input name="confirmConflict" type="checkbox" required> I reviewed the newer update and intend to apply this older message.</label>':''}</div><div class="form-actions"><button type="button" class="text-button" data-action="ignore-message" data-id="${h(m.id)}">Set aside · no task change</button><button class="btn btn-primary" type="submit" ${stale?'disabled':''}>Apply reviewed change ${icon('arrow')}</button></div><p class="muted">Recorded by ${h(member(ui.actor).name)}. Completion reports do not imply independent verification.</p></form>`}${conversation.length?`<div class="thread-context"><h3>Same conversation</h3>${conversation.map(item=>`<button class="text-button" data-action="source" data-id="${h(item.id)}">${h(item.subject)} · ${item.appliedTaskId?'Applied':item.ignoredAt?'Set aside':'Needs review'} ${icon('arrow')}</button>`).join('')}</div>`:''}</section>`;
  }
  function teamView(s) {
    return pageHeading('','People','',isOrganizer()?`<button class="btn btn-secondary" data-action="invite">${icon('plus')} ${window.GatherMode&&!window.GatherMode.demo?'Team access':'Invitation draft'}</button>`:'')+`<div class="team-grid">${s.members.map(p=>{const tasks=s.tasks.filter(t=>t.owner===p.id),done=tasks.filter(t=>t.status==='done').length,blocked=tasks.filter(t=>t.status==='blocked').length;return `<article class="team-card"><div class="team-card-head">${avatar(p.id)}<div><h2>${h(p.name)}</h2><p>${h(p.role)}</p></div>${p.id===ui.actor?'<span class="chip">You</span>':''}</div><div class="team-stats"><div><strong>${tasks.filter(t=>t.status!=='done').length}</strong><span>Open</span></div><div><strong>${done}</strong><span>Done</span></div><div><strong>${blocked}</strong><span>Blocked</span></div></div><div class="workload-track"><div class="workload-fill" style="width:${Math.round(done/Math.max(tasks.length,1)*100)}%"></div></div><button class="btn btn-secondary" data-action="person-tasks" data-id="${h(p.id)}">View ${h(p.name.split(' ')[0])}’s tasks ${icon('arrow')}</button></article>`;}).join('')}</div><section class="panel section-gap"><div class="panel-heading"><div><h2 class="section-title">Unassigned tasks</h2></div></div><div class="mini-feed">${s.tasks.filter(t=>!t.owner&&t.status!=='done').map(t=>`<article class="feed-item">${avatar('')}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note)}</p></div><button class="btn btn-secondary btn-small" data-action="claim" data-id="${h(t.id)}">Claim task</button></article>`).join('')||empty('No unassigned tasks.','')}</div></section>`;
  }
  function timelineView(s) {
    const scheduled=ui.timelineMode!=='deadlines';
    const controls=(isOrganizer()?'<button class="btn btn-secondary" data-action="move-event-plan">Move event plan</button>':'')+(scheduled?((s.tasks.some(task=>task.schedule)?'<button class="btn btn-secondary" data-action="run-sheet">Run sheet</button>':'')+(isOrganizer()?(s.tasks.some(task=>task.schedule)?'<button class="btn btn-secondary" data-action="draft-guest-agenda">Draft guest agenda</button>':'')+'<button class="btn btn-secondary" data-action="schedule-task">Schedule existing task</button><button class="btn btn-primary" data-action="add-activity">Add activity</button>':'')):addButton());
    const heading=pageHeading('','Timeline','','<button class="btn btn-secondary" data-action="before-event-review">Before the event</button>'+controls)+`<div class="schedule-switch" role="group" aria-label="Timeline view"><button class="filter-tab ${scheduled?'active':''}" aria-pressed="${scheduled}" data-action="timeline-mode" data-id="schedule">Event schedule</button><button class="filter-tab ${!scheduled?'active':''}" aria-pressed="${!scheduled}" data-action="timeline-mode" data-id="deadlines">Preparation deadlines</button></div>`;
    if(scheduled)return heading+schedule.view(s,isOrganizer(),Date.now(),{mine:ui.scheduleMine,actor:ui.actor,date:ui.scheduleDate,shareDay:!!window.GatherMode&&!window.GatherMode.demo});
    const keys=[...new Set(s.tasks.filter(t=>t.status!=='done').map(t=>t.dueDate||''))].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));
    return heading+`<section class="panel"><div class="timeline-list">${keys.map(key=>`<div class="timeline-day"><div class="timeline-date"><strong>${key?dayLabel(key):'No deadline'}</strong><span>${key===dateKey()?'Today':key&&key<dateKey()?'Past due':''}</span></div><div class="timeline-tasks">${s.tasks.filter(t=>t.status!=='done'&&(t.dueDate||'')===key).map(t=>`<button class="timeline-task" data-action="task" data-id="${h(t.id)}"><strong>${h(t.title)}</strong><span class="inline">${person(t.owner)}${statusBadge(t.status)}</span></button>`).join('')}</div></div>`).join('')||empty('No open tasks.','')}</div></section>`;
  }
  function updatesView(s) {
    const taskIds=new Set(s.tasks.map(task=>task.id));
    return pageHeading('','Activity','',`<button class="btn btn-secondary" data-action="digest">${icon('copy')} Summary</button>`)+`<div class="workspace-grid"><section class="panel"><div class="panel-heading"><h2 class="section-title">Team activity</h2><span class="chip">${s.activity.length} updates</span></div><div class="activity-list">${s.activity.map(a=>activityItem(a,taskIds)).join('')||empty('No activity yet.','')}</div></section><aside class="panel"><div class="panel-heading"><div><h2 class="section-title">Follow-up drafts</h2></div></div>${s.drafts.length?s.drafts.map(d=>`<article class="source-card"><span class="source-label">DRAFT · ${timeLabel(d.at)}</span><p>${h(d.text)}</p><div class="inline"><button class="text-button" data-action="copy-draft" data-id="${h(d.id)}">${icon('copy')} Copy draft</button><button class="text-button" data-action="task" data-id="${h(d.taskId)}">Open task</button></div></article>`).join(''):empty('No drafts.','Create a draft from a task. Messages are not sent automatically.')}</aside></div>`;
  }
  function memoryView(s) {
    const reuse=isOrganizer()&&s.tasks.some(task=>!ui.wrapMine||task.owner===ui.actor)
      ?'<button class="btn btn-secondary" data-action="reuse-checklist">Reuse tasks for another event</button>':'';
    return pageHeading('','Wrap up','Review the task results and decide what comes next.',`${canCreateTasks()?'<button class="btn btn-secondary" data-action="add-task">Add follow-up task</button>':''}${reuse}<button class="btn btn-primary" data-action="feedback">${icon('plus')} Add lesson</button>`)+GatherWrapUp.markup(s,{h,scope:{mine:ui.wrapMine,actor:ui.actor}})+`<section class="wrap-up-lessons section-gap" aria-labelledby="wrapUpLessons"><h2 class="section-title" id="wrapUpLessons" tabindex="-1">Team lessons for next time</h2><p class="muted">Shared with this project team, regardless of the task filter above. Record what to repeat or improve and when it applies. Retired or unsuccessful lessons are not suggested again. Saving a lesson does not add tasks or send messages.</p><div class="memory-grid section-gap">${s.memories.map(m=>`<article class="memory-card"><span class="memory-category">${h(m.category||'Team learning')}</span><h3 class="wrap-up-lesson-title" data-wrap-lesson="${h(m.id)}" tabindex="-1">${h(m.change)}</h3>${m.wentWell?`<p><strong>Keep doing:</strong> ${h(m.wentWell)}</p>`:''}<p><strong>Applies:</strong> ${h(({always:'All events',outdoor:'Outdoor events only',transport:'When transport is needed','same-venue':'At the original venue'})[m.scope])}</p>${m.context?`<p>${h(m.context)}</p>`:''}<p class="chip">${!m.active?'Retired':m.outcome==='helped'?'Previously helped':m.outcome==='did-not-help'?'Did not help · not suggested':'Outcome not evaluated'}</p>${m.outcomeNote?`<p>${h(m.outcomeNote)}</p>`:''}<div class="task-meta">${m.rating?`${m.rating}/5 event rating · `:''}${timeLabel(m.at)}</div><button class="text-button" data-action="edit-memory" data-id="${h(m.id)}">Edit context & outcome ${icon('arrow')}</button></article>`).join('')||empty('No lessons saved yet.','')}</div></section>`;
  }

  function reminderScope() {
    return window.GatherMode&&!window.GatherMode.demo&&!window.GatherAccessLost?store.getReminderScope?.():'';
  }
  function paintNotifications(state=store.getState(),today=dateKey()) {
    const button=$('#notificationButton'), preferences=window.WeftNotifications, scope=reminderScope();
    if(!button||!preferences)return;
    button.hidden=!preferences.preferenceKey(scope);
    if(button.hidden)return;
    const enabled=preferences.readReminderPreference(scope);
    const reminders=enabled?preferences.taskReminders(state.tasks,ui.actor,today):[];
    const count=$('[data-notification-count]',button);
    count.hidden=!reminders.length;
    count.textContent=reminders.length>99?'99+':String(reminders.length);
    button.setAttribute('aria-label',reminders.length?`Notifications, ${reminders.length} task ${reminders.length===1?'reminder':'reminders'}`:'Notifications');
    if(ui.dialogKind!=='notifications')return;
    const list=$('[data-notification-items]'), toggle=$('[data-action="toggle-task-reminders"]');
    if(!list||!toggle)return;
    const markup=reminders.length
      ? `<ul class="notification-list" aria-label="Task reminders">${reminders.map(item=>{
        const returned=item.kind==='completion-changes';
        const label=returned?'Completion changes requested':item.overdue?'Overdue · '+h(dayLabel(item.dueDate)):'Due today';
        return `<li><button type="button" class="btn btn-secondary notification-task" data-notification-task data-action="${returned?'review-returned-completion':'task'}" data-id="${h(item.id)}"><strong class="notification-task-title">${h(item.title)}</strong><span class="notification-task-date">${label}</span></button></li>`;
      }).join('')}</ul>`
      : `<p class="notice section-gap">${enabled?'No returned completion reports or tasks due today or overdue for you.':'Task reminders are off in this browser.'}</p>`;
    const template=document.createElement('template');
    template.innerHTML=markup;
    if(list.innerHTML!==template.innerHTML){
      const active=list.contains(document.activeElement)?document.activeElement:null;
      list.replaceChildren(template.content);
      if(active){
        const replacement=focusable(list).find(item=>item.hasAttribute('data-notification-task')&&item.dataset.id===active.dataset.id);
        (replacement||toggle).focus({preventScroll:true});
      }
    }
    toggle.textContent=enabled?'Turn off reminders':'Turn on reminders';
  }
  function showNotifications() {
    if(!window.WeftNotifications?.preferenceKey(reminderScope()))return;
    openDialog('Notifications','<p class="muted">See your returned completion reports and tasks due today or overdue in the project’s time zone.</p><div data-notification-items></div><div class="notification-settings"><p class="muted">This project, this browser only. No email or push.</p><button type="button" class="btn btn-secondary" data-action="toggle-task-reminders"></button></div><p class="notification-status" role="status"></p>','',false,'notifications');
    paintNotifications();
  }
  function toggleTaskReminders() {
    if(ui.dialogKind!=='notifications'||window.GatherAccessLost)return;
    const scope=reminderScope(), preferences=window.WeftNotifications;
    const enabled=!preferences.readReminderPreference(scope);
    const saved=preferences.writeReminderPreference(scope,enabled);
    paintNotifications();
    $('.notification-status').textContent=saved?(enabled?'Task reminders are on.':'Task reminders are off.'):'This browser did not save your reminder preference.';
  }
  function captureScheduleDateDraft() {
    if(ui.view!=='timeline'||ui.timelineMode==='deadlines')return null;
    const input=$('#scheduleDate');
    // Keep a draft through a passive render, never through Apply, Clear, or a
    // shortcut that changed the committed filter before this render.
    return input&&input.defaultValue===ui.scheduleDate&&input.value!==input.defaultValue
      ? {base:input.defaultValue,value:input.value}:null;
  }
  function restoreScheduleDateDraft(draft) {
    if(!draft||ui.view!=='timeline'||ui.timelineMode==='deadlines'||ui.scheduleDate!==draft.base)return;
    const input=$('#scheduleDate');
    if(input?.defaultValue===draft.base)input.value=draft.value;
  }
  function render() {
    projectBudget?.unmount();
    const taskListScroll=ui.view==='tasks'&&ui.taskView==='list'?$('.task-table-wrap')?.scrollLeft:undefined;
    const scheduleDateDraft=captureScheduleDateDraft();
    const pendingReview=ui.reviewDirty&&ui.view==='inbox'?$('#emailReviewForm'):null;
    const reviewDraft=pendingReview?{id:pendingReview.dataset.id,expanded:$('.proposal-edit',pendingReview)?.open,fields:$$('input[name],textarea[name],select[name]',pendingReview).map(input=>({name:input.name,value:input.value,checked:input.checked}))}:null;
    ui.reviewDirty=false;
    const previousFocus=$('#viewRoot').contains(document.activeElement)?document.activeElement:null;
    const oldNextUp=currentNextUpPanel($('#viewRoot'));
    const nextUpOpen=nextUpDisclosureOverride(oldNextUp);
    const oldWrap=ui.view==='memory'?$('[data-wrap-review]',$('#viewRoot')):null;
    const wrapOverrides=oldWrap?wrapReviewOverrides(oldWrap):[];
    const s=store.getState();
    paintNotifications(s);
    paintTeammateHandoff(s);
    $('.event-switcher strong').textContent=s.event.name;
    $('.event-symbol').textContent=s.event.name.split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
    document.body.classList.toggle('participant',!isOrganizer());
    $$('.project-setup-link').forEach(link=>{link.hidden=!isOrganizer();});
    $('.breadcrumb > span').textContent=s.event.name;
    $('#taskNavCount').textContent=s.tasks.filter(t=>t.status!=='done').length;
    $('#inboxNavCount').textContent=pending(s).length;
    $('#aiNavCount').textContent=store.getSuggestions().length;
    $('#storageWarning').hidden=s.persistence!=='unavailable';
    $('#breadcrumbCurrent').textContent=labels[ui.view];
    $$('.nav-item[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===ui.view);button.setAttribute('aria-current',button.dataset.view===ui.view?'page':'false');});
    $('#profile').innerHTML=`${avatar(ui.actor)}<div class="profile-copy"><strong>${h(member(ui.actor).name)}</strong><span>${h(member(ui.actor).role)}</span></div>`;
    $('#actorSelect').innerHTML=options(s.members.map(p=>[p.id,`${p.name.split(' ')[0]} · demo`]),ui.actor);
    const markup=(guideTaskNeedsReveal&&!['tasks','overview'].includes(ui.view)?guideTaskPanel(s,true):'')+({overview:()=>overview(s,guideTaskNeedsReveal),tasks:tasksView,inbox:inboxView,team:teamView,info:()=>projectInfo?projectInfo.markup():'<h1>Event info</h1><p>Available in the hosted app.</p>',budget:()=>projectBudget?projectBudget.markup():'<h1>Budget</h1><p>Available in the hosted app.</p>',timeline:timelineView,updates:updatesView,memory:memoryView,details:privateView})[ui.view](s);
    $('#askWeftButton').hidden=!(window.GatherMode&&canCreateTasks());
    if(window.GatherMode&&isOrganizer())planSidebar.render($('#viewRoot'),markup,ui.view);
    else {$('#viewRoot').innerHTML=markup;planSidebar.reset();}
    restoreNextUpDisclosure(oldNextUp,nextUpOpen,$('#viewRoot'));
    if(oldWrap)restoreWrapReviewDisclosures(oldWrap,wrapOverrides,$('#viewRoot'));
    if(taskListScroll){const table=$('.task-table-wrap');if(table)table.scrollLeft=taskListScroll;}
    restoreScheduleDateDraft(scheduleDateDraft);
    if(ui.view==='overview'&&window.GatherMode&&isOrganizer()){planSidebar.open('suggestions',true);planSidebar.refresh();}
    $$('[data-suggestion-count]').forEach(node=>{node.textContent=store.getSuggestions().length;});
    if(ui.view==='info')projectInfo?.mount($('#eventInfo'));
    if(ui.view==='budget')projectBudget?.mount($('#eventBudget'));
    const currentReview=$('#emailReviewForm');
    if(reviewDraft&&currentReview?.dataset.id===reviewDraft.id){
      for(const field of reviewDraft.fields){const input=currentReview.elements.namedItem(field.name);if(input){input.value=field.value;if(input.type==='checkbox')input.checked=field.checked;}}
      const details=$('.proposal-edit',currentReview);if(details)details.open=reviewDraft.expanded;
      ui.reviewDirty=true;updateChangePreview();
    }
    const emailTask=$('#emailTask');if(emailTask)emailTask.dataset.previousValue=emailTask.value;
    fillIcons(document);
    restoreViewFocus(previousFocus,$('#viewRoot'));
  }
  function navigate(view) {
    if(ui.pendingSave){navigation.replace(ui.view);return false;}
    if(!Object.hasOwn(labels,view)) view='overview';
    if(view!==ui.view&&!planSidebar.canLeave()){navigation.replace(ui.view);return false;}
    if (ui.view!==view){guideViewReady='';ui.relatedBatch=null;}
    if(view!=='tasks')taskLinkUnavailable=false;
    ui.view=view;
    if(view!=='details'){privateEpoch++;ui.privateRecords=[];}
    navigation.replace(view);
    setDrawer(false);
    render();
    if(view==='details')loadPrivate();
    window.scrollTo({top:0,behavior:'instant'});
    return true;
  }
  function confirmTaskOwnerChange(task,data) {
    if(!task||data.owner===undefined||data.owner===task.owner||task.status==='done'||
      !task.requiresVerification||!task.reportedAt||task.verifiedAt)return true;
    const change=data.owner?'Change the owner':'Remove the owner';
    const history=task.completionEvidence?'Its evidence stays in the task’s history.':'Existing task history stays available.';
    if(!window.confirm(change+' and take the pending completion report out of review? '+history+' The task will remain incomplete.'))return false;
    data.confirmPendingReportReassignment=true;
    return true;
  }
  function setDrawer(open) {
    const mobile=matchMedia('(max-width:800px)').matches;
    if(open&&mobile)tour.close({restoreFocus:false});
    const wasOpen=$('#sidebar').classList.contains('open');
    const focusInDrawer=$('#sidebar').contains(document.activeElement)||document.activeElement===$('#mobileOverlay');
    $('#sidebar').classList.toggle('open',open);
    $('#mobileOverlay').classList.toggle('open',open&&mobile);
    $('#mobileMenu').setAttribute('aria-expanded',String(open));
    $('#sidebar').inert=mobile&&!open;
    $('#mainContent').inert=mobile&&open;
    $('#sidebar').toggleAttribute('aria-modal',mobile&&open);
    // Announce the drawer without presenting its brand link as the selected action.
    // Tab still reaches the first link and retains its normal visible focus ring.
    if(mobile&&open){$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');document.body.style.overflow='hidden';$('#sidebar').focus({preventScroll:true});}
    else{$('#sidebar').removeAttribute('role');if($('#dialogBackdrop').hidden)document.body.style.overflow='';if(mobile&&wasOpen&&focusInDrawer)$('#mobileMenu').focus();}
  }
  function openDialog(title,body,footer='',wide=false,kind='',focusHeading=false) {
    if(!['related-checklist','related-review'].includes(kind))ui.relatedChecklistDraft=null;
    if(!['task','delete-task','related-checklist','related-review'].includes(kind))ui.relatedBatch=null;
    if(kind!=='guest-agenda')ui.guestAgenda=null;
    if(kind!=='reuse-checklist')ui.reuseChecklist=null;
    if(kind!=='run-sheet')ui.runSheet=null;
    if(!['task','delete-task','related-checklist','related-review'].includes(kind)){
      ui.eventTaskReview=null;ui.acceptanceReturn=null;
    }
    if(!['task','delete-task'].includes(kind))ui.overlapComparison=null;
    if($('#sidebar').classList.contains('open'))setDrawer(false);
    if($('#dialogBackdrop').hidden)ui.lastFocus=document.activeElement;
    tour.close({restoreFocus:false});
    ui.dialogKind=kind;
    $('#dialogBackdrop').dataset.dialogKind=kind;
    $('#dialog').className=`dialog ${wide?'dialog-wide':''}`;
    const heading=`<h2 id="dialogTitle">${h(title)}</h2>`;
    const reviewBack=kind==='task'&&ui.eventTaskReview&&ui.eventTaskReview.actor===ui.actor&&!window.GatherAccessLost;
    const assignmentBack=kind==='task'&&ui.acceptanceReturn&&ui.acceptanceReturn.actor===ui.actor&&ui.acceptanceReturn.view===ui.view&&!window.GatherAccessLost;
    const back=assignmentBack?['return-to-acceptance-review','Back to assignment review']:reviewBack?['return-to-event-task-review','Back to event review']:null;
    const comparisonBack=kind==='task'&&ui.overlapComparison&&activeOverlapComparison();
    const backButtons=(comparisonBack?'<button type="button" class="text-button" data-action="return-to-overlap-review">← Back to overlap review</button>':'')+
      (back?`<button type="button" class="text-button" data-action="${back[0]}">← ${back[1]}</button>`:'');
    $('#dialog').innerHTML=`<div class="dialog-header">${backButtons?`<div class="event-review-task-heading">${heading}${backButtons}</div>`:heading}<button class="icon-button dialog-close" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
    $('#dialogBackdrop').hidden=false;
    $('#dialogBackdrop').classList.add('open');
    $('#appShell').inert=true;
    document.body.style.overflow='hidden';
    requestAnimationFrame(()=>{
      const dialog=$('#dialog');
      if((kind==='acceptance'||focusHeading)&&ui.dialogKind===kind&&!$('#dialogBackdrop').hidden){
        const heading=$('#dialogTitle',dialog);
        if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});dialog.scrollTop=0;return;}
      }
      const controls=focusable(dialog);
      (controls.find(el=>el.matches('input,select,textarea'))||controls[0]||dialog).focus();
    });
  }
  function closeDialog() {
    $('#dialogBackdrop').hidden=true;
    $('#dialogBackdrop').classList.remove('open');
    delete $('#dialogBackdrop').dataset.dialogKind;
    $('#appShell').inert=false;
    document.body.style.overflow='';
    $('#dialog').replaceChildren();
    ui.dialogKind='';
    ui.overlapReviewDay='';
    ui.overlapComparison=null;
    ui.eventTaskReview=null;
    ui.acceptanceReturn=null;
    ui.guestAgenda=null;
    ui.reuseChecklist=null;
    ui.runSheet=null;
    ui.relatedChecklistDraft=null;
    ui.relatedBatch=null;
    const view=$('#viewRoot');
    const scheduleOpener=isScheduleControl(ui.lastFocus),wrapOpener=ui.lastFocus?.dataset?.action==='wrap-review-task';
    if(!(scheduleOpener?restoreScheduleFocus(ui.lastFocus,view):wrapOpener?restoreWrapReviewFocus(ui.lastFocus,view):restoreFocus(ui.lastFocus)||restoreViewFocus(ui.lastFocus,view)))
      view.querySelector('button')?.focus();
    ui.lastFocus=null;
    if(store.refresh)queueMicrotask(()=>refreshInbox());
  }
  function openOrganizerReview(id,kind,eventGroup='',quietFallback=false) {
    if(!isOrganizer()||window.GatherAccessLost)return false;
    if(ui.dialogKind==='before-event-review'&&(kind==='help'||kind==='date')&&workspaceUpdatesPending()){
      const refresh=$('[data-action="refresh-event-review"]',$('#dialog'));
      if(refresh?.getAttribute('aria-disabled')==='true')refresh.focus();
      else beforeEventReview(eventGroup||'plan-requests');
      return false;
    }
    const review=GatherRecoveryUI.organizerReviews(store.getState().tasks).find(row=>row.task.id===id&&row.kind===kind);
    if(!review){
      if(!quietFallback){
        if(ui.dialogKind==='before-event-review')beforeEventReview(eventGroup);
        else render();
        toast('This review is no longer pending.');
      }
      return false;
    }
    taskDialog(id,'',false,quietFallback,eventGroup);
    requestAnimationFrame(()=>{
      if(window.GatherAccessLost||ui.dialogKind!=='task'||ui.detailId!==id)return;
      const selector=review.waitingOnRequiredWork?'.task-dependencies h3':kind==='help'||kind==='date'?'#recoveryRequestHeading':'.completion-evidence h3';
      $(selector,$('#dialog'))?.focus();
    });
    return true;
  }
  function openWrapReviewTask(id,opener) {
    if(ui.view!=='memory'||window.GatherAccessLost||!$('#dialogBackdrop').hidden||
      !opener?.isConnected||opener.dataset.action!=='wrap-review-task'||opener.dataset.id!==id||
      opener.closest('[hidden],[inert]')||hiddenByClosedDisclosure(opener))return false;
    const panel=$('[data-wrap-review]',$('#viewRoot'));
    if(!panel?.contains(opener)||panel.dataset.wrapActor!==ui.actor||panel.dataset.wrapScope!==(ui.wrapMine?'mine':'all'))return false;
    const task=store.getState().tasks.find(item=>item.id===id&&(!ui.wrapMine||item.owner===ui.actor));
    if(!task){render();toast('This task is no longer in this review.');return false;}
    const kind=opener.dataset.wrapReviewKind;
    const reviewed=isOrganizer()&&['completion','amendment'].includes(kind)&&openOrganizerReview(id,kind,'',true);
    if(!reviewed)taskDialog(id,'',false,true);
    if(ui.dialogKind==='task'&&ui.detailId===id){ui.lastFocus=opener;return true;}
    return false;
  }
  function focusTaskRecovery(id,selector='#recoveryRequestHeading') {
    const actor=ui.actor;
    requestAnimationFrame(()=>{
      if(window.GatherAccessLost||ui.actor!==actor||ui.dialogKind!=='task'||ui.detailId!==id||$('#dialogBackdrop').hidden)return;
      $(selector,$('#dialog'))?.focus();
    });
  }
  function focusTaskDialogControl(target,dialog) {
    if(!target)return;
    target.focus({preventScroll:true});
    if(document.activeElement!==target)return;
    const rect=target.getBoundingClientRect(),bounds=dialog.getBoundingClientRect();
    const top=Math.max(bounds.top,$('.dialog-header',dialog)?.getBoundingClientRect().bottom||0)+8;
    const bottom=bounds.bottom-8;
    if(bottom<=top)return;
    if(rect.top<top||rect.height>bottom-top)dialog.scrollTop+=rect.top-top;
    else if(rect.bottom>bottom)dialog.scrollTop+=rect.bottom-bottom;
  }
  function timelineOverlapIntent(el,id) {
    const requested=el.dataset.openScheduleOverlap;
    if(!['owner','location','both'].includes(requested)||!isScheduleControl(el)||!el.isConnected||
      ui.view!=='timeline'||ui.timelineMode==='deadlines'||window.GatherAccessLost||
      !$('#dialogBackdrop').hidden||el.dataset.scheduleFocusKind||el.hasAttribute('data-open-recovery')||el.hasAttribute('data-open-recovery-reply'))return '';
    const day=el.dataset.scheduleDay||el.dataset.scheduleFocusDay;
    const current=GatherScheduleUI.overlapKindForDay(store.getState(),id,day,{mine:ui.scheduleMine,actor:ui.actor,date:ui.scheduleDate});
    // An old card may now have fewer overlaps, but must not open an unrelated kind.
    return current==='both'?requested:requested==='both'||current===requested?current:'';
  }
  function focusTaskOverlap(id,kind) {
    const actor=ui.actor,project=window.GatherMode?.projectId,dialog=$('#dialog'),title=$('#dialogTitle',dialog);
    requestAnimationFrame(()=>{
      if(!title||$('#dialogTitle',dialog)!==title||window.GatherAccessLost||ui.actor!==actor||
        window.GatherMode?.projectId!==project||ui.dialogKind!=='task'||ui.detailId!==id||$('#dialogBackdrop').hidden)return;
      const disclosures=$$('[data-schedule-overlap-kind]',dialog).filter(el=>kind==='both'||el.dataset.scheduleOverlapKind===kind);
      for(const disclosure of disclosures)disclosure.open=true;
      if(disclosures.length)focusTaskDialogControl($('summary',disclosures[0]),dialog);
    });
  }
  function overlapComparisonInScope(comparison) {
    return !!comparison&&!window.GatherAccessLost&&comparison.actor===ui.actor&&comparison.view===ui.view&&
      comparison.project===(window.GatherMode?.projectId||'');
  }
  function activeOverlapComparison() {
    const comparison=ui.overlapComparison;
    return overlapComparisonInScope(comparison)&&comparison.peerId===ui.detailId?comparison:null;
  }
  function inspectOverlapPeer(id,opener) {
    const dialog=$('#dialog'),kind=opener.dataset.overlapKind;
    const disclosure=opener.closest('[data-schedule-overlap-kind]');
    if(window.GatherAccessLost||ui.dialogKind!=='task'||$('#dialogBackdrop').hidden||!opener.isConnected||
      !disclosure?.open||!dialog.contains(disclosure)||disclosure.dataset.scheduleOverlapKind!==kind||
      opener.dataset.id!==id||opener.dataset.action!=='inspect-overlap-peer')return false;
    const current=activeOverlapComparison();
    if(current?.originId===id)return returnToOverlapReview();
    if(workspaceUpdatesPending()){
      showPendingUpdate();toast('Refresh the project before comparing this overlap.');
      return false;
    }
    const state=store.getState(),originId=ui.detailId;
    if(!GatherScheduleUI.overlapPairIsCurrent(state,originId,id,kind)){
      toast('This overlap is no longer current.');
      return false;
    }
    ui.overlapComparison=current?{...current,peerId:id}:{
      actor:ui.actor,project:window.GatherMode?.projectId||'',view:ui.view,originId,peerId:id,returnPeerId:id,kind,
      relatedBatch:ui.relatedBatch&&{...ui.relatedBatch,ids:[...ui.relatedBatch.ids]},
      reviewDay:ui.overlapReviewDay||'',openedKinds:$$('[data-schedule-overlap-kind]',dialog)
        .filter(item=>item.open).map(item=>item.dataset.scheduleOverlapKind),
    };
    taskDialog(id,'',false,true);
    return true;
  }
  function returnToOverlapReview(readOnly=false) {
    const comparison=activeOverlapComparison();
    if(!comparison||!['task','delete-task'].includes(ui.dialogKind)||$('#dialogBackdrop').hidden)return false;
    const {originId,returnPeerId,reviewDay,kind,openedKinds,relatedBatch}=comparison;
    const state=store.getState();
    ui.overlapComparison=null;
    if(!state.tasks.some(task=>task.id===originId)){
      closeDialog();toast('The original activity is no longer available.');
      return true;
    }
    const stale=workspaceUpdatesPending();
    const pair=!stale&&GatherScheduleUI.overlapPairIsCurrent(state,originId,returnPeerId,kind);
    if(relatedBatch&&relatedBatchInScope(relatedBatch))ui.relatedBatch=relatedBatch;
    if(readOnly)taskDialog(originId,'',false,true,'',undefined,reviewDay,{readOnly:true});
    else taskDialog(originId,'',false,true,'',undefined,reviewDay);
    if(stale)showPendingUpdate();
    const dialog=$('#dialog'),title=$('#dialogTitle',dialog);
    requestAnimationFrame(()=>{
      if(!title||$('#dialogTitle',dialog)!==title||!overlapComparisonInScope(comparison)||
        ui.dialogKind!=='task'||ui.detailId!==originId||$('#dialogBackdrop').hidden)return;
      const disclosures=$$('[data-schedule-overlap-kind]',dialog);
      for(const item of disclosures)if(openedKinds.includes(item.dataset.scheduleOverlapKind))item.open=true;
      const origin=disclosures.find(item=>item.dataset.scheduleOverlapKind===kind);
      const opener=pair&&!workspaceUpdatesPending()&&origin?.open&&$$('[data-action="inspect-overlap-peer"]',origin)
        .find(item=>item.dataset.id===returnPeerId&&item.dataset.overlapKind===kind);
      focusTaskDialogControl(opener||(origin&&$('summary',origin))||title,dialog);
    });
    if(stale)toast('Refresh the project to check whether this overlap is still current.');
    else if(!pair)toast('That overlap is no longer current.');
    return true;
  }
  function openReturnedCompletion(id) {
    if(window.GatherAccessLost)return;
    const task=store.getState().tasks.find(item=>item.id===id&&item.owner===ui.actor);
    if(!task||!GatherPriorities.changesRequested(task)){
      render();toast('This completion no longer needs changes from you.');return;
    }
    taskDialog(id);
    requestAnimationFrame(()=>{
      if(ui.dialogKind!=='task'||ui.detailId!==id)return;
      $('[aria-label="Completion changes requested"] h4',$('#dialog'))?.focus();
    });
  }
  function prepareRevisedCompletion(id) {
    if(window.GatherAccessLost||ui.dialogKind!=='task'||ui.detailId!==id)return;
    const task=store.getState().tasks.find(item=>item.id===id&&item.owner===ui.actor);
    if(!task||!GatherPriorities.changesRequested(task)||dependencyInfo(task).open.length)return;
    const form=$('#responseForm',$('#dialog'));
    if(form?.dataset.id===id)recovery.prepareCompletion(form);
  }
  function eventReviewScope() {
    return {mine:ui.timelineMode!=='deadlines'&&ui.scheduleMine,actor:ui.actor};
  }
  function workspaceUpdatesPending() {
    const notice=$('#workspaceSyncNotice');
    return (!!notice&&!notice.hidden)||recoveryConflictPending();
  }
  function recoveryConflictPending(revision=store.getSnapshotRevision?.()) {
    return Number.isSafeInteger(ui.recoveryConflictRevision)&&Number.isSafeInteger(revision)&&revision<=ui.recoveryConflictRevision;
  }
  function eventReviewRefreshNotice(group) {
    const refresh=store.refresh
      ? '<button type="button" class="btn btn-secondary" data-action="refresh-event-review" data-id="'+h(group)+'">Refresh event review</button>'
      : '<button type="button" class="btn btn-secondary" data-action="reload-workspace">Reload project</button>';
    return '<p role="status" id="eventReviewRefreshStatus">Newer project changes are available. This review shows the last loaded plan. Refresh before responding to a request.</p>'+refresh;
  }
  function beforeEventReview(group='') {
    if(window.GatherAccessLost)return;
    const pending=workspaceUpdatesPending()?'<div id="dialogStaleNotice" class="notice">'+eventReviewRefreshNotice(group)+'</div>':'';
    openDialog('Before the event',pending+schedule.preparationReview(store.getState(),Date.now(),eventReviewScope(),isOrganizer()),'<button class="btn btn-secondary" data-action="close-dialog">Back to timeline</button>',true,'before-event-review',true);
    const title=$('#dialogTitle');
    requestAnimationFrame(()=>{
      if(!title||ui.dialogKind!=='before-event-review'||window.GatherAccessLost||$('#dialogTitle')!==title)return;
      if(pending&&store.refresh)$('[data-action="refresh-event-review"]',$('#dialog'))?.focus();
      if(group){
        const detail=$$('[data-event-review-group]',$('#dialog')).find(item=>item.dataset.eventReviewGroup===group);
        const summary=detail?.querySelector('summary');
        if(summary){
          detail.open=true;
          // Keep the warning in view when a newer plan is already known.
          if(!pending){summary.focus({preventScroll:true});summary.scrollIntoView({block:'center',inline:'nearest'});}
        }
      }
    });
  }
  async function refreshBeforeEventReview(group='') {
    const title=$('#dialogTitle'),scope=eventReviewScope(),mode=ui.timelineMode,date=ui.scheduleDate;
    const sameReview=()=>!!title&&!window.GatherAccessLost&&!ui.pendingSave&&ui.view==='timeline'&&
      ui.dialogKind==='before-event-review'&&$('#dialogTitle')===title&&ui.timelineMode===mode&&ui.scheduleDate===date&&
      ui.actor===scope.actor&&eventReviewScope().mine===scope.mine;
    const stillOpen=()=>!document.hidden&&sameReview();
    if(!store.refresh||ui.syncing||!stillOpen()||!workspaceUpdatesPending())return;
    const status=$('#eventReviewRefreshStatus');
    const button=$('[data-action="refresh-event-review"]',$('#dialog'));
    ui.syncing=true;
    if(button)button.setAttribute('aria-disabled','true');
    if(status)status.textContent='Refreshing event review…';
    try{
      const result=await store.refresh(stillOpen);
      if(!stillOpen()){
        if(sameReview()&&status)status.textContent='Refresh paused while this tab was hidden. Try again.';
        return;
      }
      if(result.pending)rememberNewerSchedule(null,result.newerRevision);
      if(result.pending||recoveryConflictPending()||scheduleRevisionIsStale(store.getSnapshotRevision?.()))
        throw new Error('A newer project snapshot is not ready.');
      const sync=$('#workspaceSyncNotice');if(sync)sync.hidden=true;
      ui.toolUpdatePending=false;
      render();beforeEventReview(group);
      toast('Event review refreshed.');
    }catch{
      if(sameReview()&&status)status.textContent='Could not refresh the event review. Your current view is unchanged. Try again.';
    }finally{
      ui.syncing=false;
      if(button?.isConnected)button.removeAttribute('aria-disabled');
    }
  }
  function returnToEventTaskReview() {
    const source=ui.eventTaskReview;
    if(!source||source.actor!==ui.actor||window.GatherAccessLost||ui.view!=='timeline'||
      !['task','delete-task'].includes(ui.dialogKind))return false;
    beforeEventReview(source.group);
    return true;
  }
  function canRefreshActivityReview(task) {
    return !!(store.refresh&&!window.GatherAccessLost&&ui.dialogKind==='task'&&
      (ui.view==='timeline'||ui.overlapComparison)&&
      (task?.schedule||task?.eventActivity||ui.overlapReviewDay||ui.overlapComparison));
  }
  function activityReviewRefreshNotice() {
    return '<p id="activityReviewRefreshStatus" role="status">Newer project changes are available. Refresh this activity to review the latest schedule. Refreshing does not save your edits.</p>'+
      '<button type="button" id="activityReviewRefresh" class="btn btn-secondary" data-action="refresh-activity-review" aria-describedby="activityReviewRefreshStatus">Refresh activity review</button>';
  }
  async function refreshActivityReview(button) {
    const dialog=$('#dialog'),title=$('#dialogTitle',dialog),status=$('#activityReviewRefreshStatus',dialog);
    const {actor,view,detailId:id,timelineMode,scheduleDate,scheduleMine,overlapReviewDay,overlapComparison}=ui;
    const project=window.GatherMode?.projectId;
    const sameReview=()=>!!title&&!!status&&!!button?.isConnected&&!window.GatherAccessLost&&
      ui.dialogKind==='task'&&ui.detailId===id&&ui.actor===actor&&ui.view===view&&ui.timelineMode===timelineMode&&
      ui.scheduleDate===scheduleDate&&ui.scheduleMine===scheduleMine&&ui.overlapReviewDay===overlapReviewDay&&
      ui.overlapComparison===overlapComparison&&window.GatherMode?.projectId===project&&!$('#dialogBackdrop').hidden&&
      $('#dialogTitle',dialog)===title&&$('#activityReviewRefresh',dialog)===button;
    const ready=()=>sameReview()&&!ui.pendingSave&&!document.hidden&&!hasUnsavedFields(dialog);
    const edits='Your unsaved edits are still here. Copy or clear them before refreshing this activity.';
    if(!sameReview()||!canRefreshActivityReview(store.getState().tasks.find(task=>task.id===id))||
      ui.syncing||ui.pendingSave||document.hidden||!workspaceUpdatesPending())return;
    if(hasUnsavedFields(dialog)){status.textContent=edits;return;}
    ui.syncing=true;
    button.setAttribute('aria-disabled','true');
    status.textContent='Refreshing activity review…';
    try{
      const result=await store.refresh(revision=>ready()&&!recoveryConflictPending(revision)&&!scheduleRevisionIsStale(revision),{requireFresh:true});
      if(!sameReview())return;
      if(result.pending)rememberNewerSchedule(null,result.newerRevision);
      if(!ready()){
        status.textContent=hasUnsavedFields(dialog)?edits:'Refresh paused. Your current view is unchanged. Try again.';
        return;
      }
      if(!result.verified||result.pending||recoveryConflictPending()||scheduleRevisionIsStale(store.getSnapshotRevision?.()))
        throw new Error('A newer project snapshot is not ready.');
      const sync=$('#workspaceSyncNotice');if(sync)sync.hidden=true;
      ui.toolUpdatePending=false;
      render();
      if(!store.getState().tasks.some(task=>task.id===id)){
        if(!returnToOverlapReview(true)&&!(ui.relatedBatch&&returnToRelatedBatch(true))&&
          !(ui.acceptanceReturn&&returnToAcceptanceReview())&&!returnToEventTaskReview())closeDialog();
        toast('This activity is no longer available.');
        return;
      }
      taskDialog(id,'',true,true,'',undefined,'',{readOnly:true});
      const updatedTitle=$('#dialogTitle',dialog);
      requestAnimationFrame(()=>{
        if(!updatedTitle||$('#dialogTitle',dialog)!==updatedTitle||window.GatherAccessLost||ui.actor!==actor||
          ui.detailId!==id||ui.dialogKind!=='task'||window.GatherMode?.projectId!==project||$('#dialogBackdrop').hidden)return;
        const overlap=$('[data-schedule-overlap-kind][open] summary',dialog);
        focusTaskDialogControl(overlap||updatedTitle,dialog);
      });
      toast('Activity review refreshed.');
    }catch{
      if(sameReview())status.textContent='Could not refresh this activity. Your current view is unchanged. Try again.';
    }finally{
      ui.syncing=false;
      if(button.isConnected)button.removeAttribute('aria-disabled');
    }
  }
  function showPendingUpdate(newerRevision) {
    if(Number.isSafeInteger(newerRevision))rememberNewerSchedule(ui.runSheet,newerRevision);
    const banner=$('#workspaceSyncNotice');if(banner)banner.hidden=false;
    if(ui.dialogKind==='guest-agenda'&&ui.guestAgenda){updateGuestAgendaWarning();return;}
    if(ui.dialogKind==='reuse-checklist'&&ui.reuseChecklist){ui.reuseChecklist.stale=true;updateReuseChecklistWarning();return;}
    if(ui.dialogKind==='run-sheet'&&ui.runSheet){currentRunSheet();return;}
    if($('#dialogBackdrop').hidden||ui.dialogKind==='notifications'||$('#dialogStaleNotice'))return;
    const note=document.createElement('div');note.id='dialogStaleNotice';note.className='notice';note.setAttribute('role','alert');
    const group=ui.dialogKind==='before-event-review'?document.activeElement?.closest('[data-event-review-group]')?.dataset.eventReviewGroup||'':'';
    note.innerHTML=ui.dialogKind==='before-event-review'?eventReviewRefreshNotice(group):
      ui.dialogKind==='task'&&canRefreshActivityReview(store.getState().tasks.find(task=>task.id===ui.detailId))?activityReviewRefreshNotice():
      '<p>The project changed in another tab. Your unsaved text is still here. Copy it before reloading.</p><button class="btn btn-secondary" data-action="reload-workspace">Reload &amp; discard edits</button>';
    $('.dialog-body').prepend(note);
  }
  function showRecoveryWriteConflict() {
    const current=store.getSnapshotRevision?.();
    if(Number.isSafeInteger(current)){
      ui.recoveryConflictRevision=current;
      rememberNewerSchedule(null,current+1);
    }
    showPendingUpdate();
  }
  let staleScheduleRevision=null;
  const busyRunSheetRevisions=new Set();
  function rememberNewerSchedule(snapshot,newerRevision) {
    if(!Number.isSafeInteger(newerRevision))return;
    if(snapshot&&snapshot.revision<newerRevision)snapshot.stale=true;
    staleScheduleRevision=Math.max(staleScheduleRevision??-1,newerRevision-1);
  }
  function scheduleRevisionIsStale(revision) {
    return staleScheduleRevision!==null&&Number.isSafeInteger(revision)&&revision<=staleScheduleRevision;
  }
  function openRunSheet(scope={mine:ui.scheduleMine,actor:ui.actor,date:ui.scheduleDate},focusHeading=false) {
    if(window.GatherAccessLost||ui.view!=='timeline'||ui.timelineMode==='deadlines')return;
    const model=schedule.runSheetModel(store.getState(),Date.now(),scope);
    const text=model.days.length?schedule.runSheetText(model):'';
    ui.runSheet={model,text,scope,revision:store.getSnapshotRevision?.(),stale:false};
    openDialog('Event run sheet','<div id="runSheetStale" class="notice" hidden><p role="status">This run sheet may be out of date. Refresh it before printing or downloading.</p>'+
      (store.refresh?'<button type="button" class="btn btn-secondary" id="runSheetRefresh" data-action="refresh-run-sheet">Refresh run sheet</button>':'')+
      '</div><p id="runSheetRefreshStatus" class="muted" role="status"></p><p id="runSheetPrintBlocked">Run sheet isn’t ready to print. Return to Weft to check or refresh it.</p>'+schedule.runSheetMarkup(model)+
      (text?'<details id="runSheetTextFallback" class="section-gap"><summary>Show text to copy</summary><label class="field section-gap">Team run sheet text<textarea rows="8" readonly>'+h(text)+'</textarea></label></details>':''),
      '<button class="btn btn-secondary" data-action="close-dialog">Back to schedule</button>'+
      (store.confirmSnapshotRevision?'<button class="btn btn-secondary" data-action="check-run-sheet">Check for updates</button>':'')+
      (text?'<button class="btn btn-secondary" data-action="download-run-sheet">Download text (.txt)</button>':'')+
      '<button class="btn btn-primary" data-action="print-run-sheet">Print / save PDF</button>',true,'run-sheet',focusHeading);
    currentRunSheet();
  }
  function currentRunSheet() {
    const snapshot=ui.runSheet;
    if(!snapshot||ui.dialogKind!=='run-sheet'||!$('#eventRunSheet')||window.GatherAccessLost)return null;
    const sync=$('#workspaceSyncNotice'),stale=snapshot.stale||scheduleRevisionIsStale(snapshot.revision)||
      (sync&&!sync.hidden)||store.getSnapshotRevision?.()!==snapshot.revision;
    const busy=busyRunSheetRevisions.has(snapshot.revision),blocked=!!(stale||busy);
    $('#runSheetStale').hidden=!stale;
    $('#runSheetPrintBlocked')?.toggleAttribute('data-blocked',blocked);
    $('#runSheetRefresh')?.setAttribute('aria-disabled',String(!!busy));
    const fallback=$('#runSheetTextFallback');if(fallback)fallback.hidden=blocked;
    for(const button of $$('#dialog [data-action="download-run-sheet"], #dialog [data-action="print-run-sheet"], #dialog [data-action="check-run-sheet"]'))
      button.setAttribute('aria-disabled',String(blocked));
    return blocked?null:snapshot;
  }
  async function checkRunSheet() {
    const snapshot=currentRunSheet();
    if(!snapshot||!store.confirmSnapshotRevision)return;
    busyRunSheetRevisions.add(snapshot.revision);currentRunSheet();
    try {
      const current=await store.confirmSnapshotRevision(snapshot.revision,newer=>rememberNewerSchedule(snapshot,newer));
      if(window.GatherAccessLost)return;
      if(!current){snapshot.stale=true;currentRunSheet();}
      else if(ui.runSheet===snapshot&&!snapshot.stale)toast('No newer plan found. This copy is still a snapshot.');
    } catch {
      if(ui.runSheet===snapshot&&!window.GatherAccessLost)toast('Could not check for updates. Confirm changes with your team before using this copy.');
    } finally {
      busyRunSheetRevisions.delete(snapshot.revision);
      currentRunSheet();
    }
  }
  async function refreshRunSheet() {
    const snapshot=ui.runSheet;
    const title=$('#dialogTitle'),project=window.GatherMode?.projectId,actor=ui.actor;
    const sameWorkspace=()=>!window.GatherAccessLost&&ui.actor===actor&&window.GatherMode?.projectId===project;
    const sameReview=()=>sameWorkspace()&&ui.runSheet===snapshot&&ui.dialogKind==='run-sheet'&&ui.view==='timeline'&&
      ui.timelineMode!=='deadlines'&&!$('#dialogBackdrop').hidden&&!!title&&$('#dialogTitle')===title;
    const stillOpen=()=>sameReview()&&!ui.pendingSave&&!document.hidden;
    if(!snapshot||!stillOpen()||busyRunSheetRevisions.has(snapshot.revision)||!store.refresh||!$('#eventRunSheet'))return;
    if(currentRunSheet())return;
    const status=$('#runSheetRefreshStatus');
    busyRunSheetRevisions.add(snapshot.revision);
    if(status)status.textContent='Refreshing run sheet…';
    currentRunSheet();
    try {
      const result=await store.refresh(revision=>stillOpen()&&Number.isSafeInteger(revision)&&
        !scheduleRevisionIsStale(revision),{requireFresh:true});
      if(result.pending&&sameWorkspace())rememberNewerSchedule(snapshot,result.newerRevision);
      if(!stillOpen()){
        if(sameReview()&&status)status.textContent='Refresh paused. Try again before exporting.';
        return;
      }
      const revision=store.getSnapshotRevision?.();
      if(!result.verified||result.pending||!Number.isSafeInteger(revision)||scheduleRevisionIsStale(revision))
        throw new Error('A newer snapshot is not ready.');
      const sync=$('#workspaceSyncNotice');if(sync)sync.hidden=true;
      ui.toolUpdatePending=false;
      render();
      openRunSheet(snapshot.scope,true);
      toast('Run sheet refreshed. This copy is still a snapshot.');
    } catch {
      if(sameReview()&&status)status.textContent=stillOpen()?'Could not refresh the run sheet. Try again before exporting.':'Refresh paused. Try again before exporting.';
    } finally {
      busyRunSheetRevisions.delete(snapshot.revision);
      currentRunSheet();
    }
  }
  function downloadRunSheet() {
    const snapshot=currentRunSheet();
    if(!snapshot?.text)return;
    // Download the exact projected preview. No request, mutation or share.
    const url=URL.createObjectURL(new Blob([snapshot.text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='weft-run-sheet'+(snapshot.model.mine?'-my-activities':'')+(snapshot.model.day?'-'+snapshot.model.day:'')+'.txt';
    try {
      document.body.append(link);link.click();
      toast('Text download requested. This is a team-only snapshot.');
    } finally {
      link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }
  function dependencyInfo(task, state=store.getState()) {
    const links=(task.dependencies||[]).map(link=>({...link,task:state.tasks.find(t=>t.id===link.taskId)}));
    const resolved=t=>Boolean(t&&t.status==='done'&&(!t.requiresVerification||t.verifiedAt));
    const required=links.filter(link=>link.kind!=='related');
    const open=required.filter(link=>!resolved(link.task));
    return {links,open,ready:task.status==='blocked'&&!(task.requiresVerification&&task.reportedAt&&!task.verifiedAt)&&required.length>0&&!open.length,resolved};
  }
  function linkedTaskForm(task,state,organizer) {
    if(task.status==='done'||window.GatherAccessLost||!organizer&&(task.owner!==ui.actor||state.event.membersCanCreateTasks!==true))return '';
    return `<details class="dependency-add linked-task-create"><summary>Create a linked task</summary><p class="muted">Break this work into a smaller, independently owned task. Use Related for parallel work; choose Required only when its result is needed before this task can be completed. Nothing is created until you save.</p><form id="linkedTaskForm" data-id="${h(task.id)}"><label class="field">New task name<input name="title" required maxlength="180" placeholder="What smaller result is needed?"></label><label class="field">Done when (optional)<textarea name="scope" rows="2" maxlength="3000" placeholder="What observable result will show this smaller task is finished?"></textarea><span class="muted">Shared with the team; keep private codes in Private details. This describes the result, not a progress update.</span></label><label class="field">Instructions (optional)<textarea name="note" rows="2" maxlength="3000"></textarea></label><label class="field">Owner<select name="owner">${organizer?ownerOptions(''):options([['','Unassigned'],[ui.actor,'Me · '+member(ui.actor).name]],'')}</select></label><label class="field">Relationship<select name="kind">${options([['related','Related · can run in parallel'],['dependency','Required before this task can be completed']],'related')}</select></label><label class="field">Why link this task?<textarea name="reason" rows="2" required maxlength="2000" placeholder="Describe the shared context or the exact result needed first."></textarea></label><p class="muted">The new task starts To do, without dates, activity times or recorded acceptance. Only the instructions and outcome entered here are shared; the current task’s notes and outcome are not copied. No message is sent.</p><button class="btn btn-secondary" type="submit">Create and link task</button></form></details>`;
  }
  function openRelatedBatch(id,draft=null) {
    const task=store.getState().tasks.find(task=>task.id===id);
    if(window.GatherAccessLost||!isOrganizer()||!task||task.status==='done'||task.reportedAt&&task.requiresVerification&&!task.verifiedAt)return;
    ui.relatedChecklistDraft=draft;
    const ai=window.GatherMode&&!window.GatherMode.demo?'<details class="breakdown-ai section-gap"><summary>Draft smaller steps with AI</summary><div><p>Generate sends exactly the title below to Groq. No notes, event details, files, or member records are attached. Anything written in the title is sent, so skip AI if it contains private details.</p><blockquote>'+h(task.title)+'</blockquote><p>You’ll review a private draft. Nothing is added to the project until you choose what to save.</p><div class="form-actions"><button type="button" class="btn btn-secondary" data-action="related-ai-review">Review saved AI draft</button><button type="button" class="btn btn-primary" data-action="related-ai-generate">Send title to Groq and generate</button></div><p id="relatedAiStatus" role="status" class="muted"></p></div></details>':'';
    openDialog('Break down '+task.title,'<p>Make this task easier to hand off. You can draft ideas with AI when available or write your own checklist.</p>'+ai+
      '<form id="relatedChecklistForm" class="related-review" data-id="'+h(id)+'" data-revision="'+task.revision+'" data-actor="'+h(ui.actor)+'" data-project="'+h(window.GatherMode?.projectId||'')+'"><label class="field section-gap">Write your own smaller steps<textarea name="checklist" required rows="5" maxlength="2000" aria-describedby="relatedChecklistHelp"></textarea></label><p id="relatedChecklistHelp" class="muted">Up to 8 steps, one per line. Don’t paste credentials, booking codes or private details.</p>'+
      (draft?'<p class="notice">Review edits and selections carry forward for unchanged steps. New or ambiguous steps are unselected.</p>':'')+
      '<div class="form-actions"><button type="button" class="btn btn-secondary" data-action="task" data-id="'+h(id)+'">Back to task</button><button class="btn btn-primary" type="submit">Review checklist</button></div></form>','',false,'related-checklist',!draft);
    const form=$('#relatedChecklistForm');
    if(draft){
      form.dataset.relatedDraft='true';
      form.elements.checklist.value=draft.raw;
    }
    requestAnimationFrame(()=>{
      if(ui.dialogKind!=='related-checklist'||$('#relatedChecklistForm')!==form||!relatedDraftScope(form))return;
      if(draft){form.elements.checklist.focus();return;}
      const heading=$('#dialogTitle');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});$('#dialog').scrollTop=0;}
    });
  }
  function relatedDraftScope(form) {
    return !!form?.isConnected&&ui.actor===form.dataset.actor&&(window.GatherMode?.projectId||'')===form.dataset.project&&isOrganizer()&&!window.GatherAccessLost;
  }
  function relatedDraftTask(form) {
    const task=store.getState().tasks.find(task=>task.id===form.dataset.id);
    if(!task||task.revision!==Number(form.dataset.revision)||task.status==='done'||task.reportedAt&&task.requiresVerification&&!task.verifiedAt)
      throw new Error('The original task changed. Reopen it before reviewing linked work.');
    return task;
  }
  function matchingRelatedDraft(form) {
    const draft=ui.relatedChecklistDraft;
    return draft&&draft.id===form.dataset.id&&draft.revision===Number(form.dataset.revision)&&draft.actor===ui.actor&&draft.project===(window.GatherMode?.projectId||'')?draft:null;
  }
  function captureRelatedRows(form,original) {
    return $$('[data-related-row]',form).map((row,index)=>({
      sourceTitle:original[index].sourceTitle,
      title:$('[data-related-title]',row).value,scope:$('[data-related-scope]',row).value,selected:$('[data-related-include]',row).checked,
    }));
  }
  function reviewRelatedBatch(form) {
    if(!relatedDraftScope(form)||ui.dialogKind!=='related-checklist'||$('#relatedChecklistForm')!==form)return;
    const task=relatedDraftTask(form),raw=form.elements.checklist.value,previous=matchingRelatedDraft(form);
    const {rows,discarded}=GatherPlanningUI.reconcileRelatedChecklist(GatherPlanningUI.relatedChecklistTitles(raw),previous?.rows,raw===previous?.raw);
    if(discarded&&!window.confirm('Some edited or selected steps can’t be matched to the new checklist. Discard those review changes and continue?'))return;
    showRelatedReview(task,rows,false,{id:task.id,revision:task.revision,actor:ui.actor,project:form.dataset.project,raw,rows});
  }
  function backToRelatedChecklist(form) {
    if(!activeRelatedReview(form)||form.dataset.saveUnconfirmed||unconfirmedRelatedSaves.has(relatedReviewKey(form)))return;
    const draft=matchingRelatedDraft(form);
    if(!draft)return;
    try{
      relatedDraftTask(form);
      openRelatedBatch(draft.id,{...draft,rows:captureRelatedRows(form,draft.rows)});
    }catch(error){$('.form-error',form)?.remove();formError(form,error);}
  }
  function showRelatedReview(task,items,ai,draft=null) {
    ui.relatedChecklistDraft=draft;
    openDialog('Review smaller steps for '+task.title,'<form id="relatedReviewForm" class="related-review" data-id="'+h(task.id)+'" data-revision="'+task.revision+'" data-actor="'+h(ui.actor)+'" data-project="'+h(window.GatherMode?.projectId||'')+'">'+
      '<section class="notice" data-related-check-panel hidden><p data-related-save-message tabindex="-1"></p><button type="button" class="btn btn-secondary" data-action="check-related-review" hidden>Check current linked tasks</button><a class="btn btn-secondary" data-related-projects href="/" target="_top" hidden>Return to Projects</a><p role="status" data-related-check-status></p><div data-related-current-links></div></section>'+
      (ai?'<p class="notice">Drafted by AI using only the task title. Check each step for accuracy and avoid private details. None are selected.</p>':'')+
      GatherPlanningUI.relatedChecklistReview(draft?items.map(row=>row.sourceTitle):items,h)+
      '<div class="form-actions">'+(draft?'<button type="button" class="btn btn-secondary" data-action="back-related-checklist">Back to checklist</button>':'')+
      '<button type="button" class="btn btn-secondary" data-action="task" data-id="'+h(task.id)+'">Back to task</button><button class="btn btn-primary" type="submit">Add selected related tasks</button></div></form>','',false,'related-review',true);
    const form=$('#relatedReviewForm'), previous=unconfirmedRelatedSaves.get(relatedReviewKey(form));
    if(draft){
      form.dataset.relatedDraft='true';
      $$('[data-related-row]',form).forEach((row,index)=>{
        const saved=draft.rows[index];
        $('[data-related-title]',row).value=saved.title;
        $('[data-related-scope]',row).value=saved.scope;
        $('[data-related-include]',row).checked=saved.selected;
      });
    }
    if(previous){
      form.dataset.saveUnconfirmed=previous.failure;
      const back=$('[data-action="back-related-checklist"]',form);if(back)back.hidden=true;
      requestAnimationFrame(()=>paintRelatedSaveState(form));
    }
  }
  function activeRelatedReview(form) {
    return !!form?.isConnected&&$('#relatedReviewForm')===form&&ui.dialogKind==='related-review'&&
      ui.actor===form.dataset.actor&&(window.GatherMode?.projectId||'')===form.dataset.project&&isOrganizer()&&!window.GatherAccessLost;
  }
  function relatedReviewKey(form) {
    return JSON.stringify([form.dataset.project,form.dataset.actor,form.dataset.id]);
  }
  function relatedTasksFor(task,state) {
    const related=new Set((task?.dependencies||[]).filter(link=>link.kind==='related').map(link=>link.taskId));
    return state.tasks.filter(item=>related.has(item.id));
  }
  function relatedReceiptMarkup(task,state,ids) {
    if(!ids?.length)return '';
    const related=new Map(relatedTasksFor(task,state).map(item=>[item.id,item]));
    const saved=ids.map(id=>related.get(id)).filter(Boolean);
    if(!saved.length)return '<section id="relatedReceipt" class="notice related-receipt section-gap" aria-labelledby="relatedReceiptHeading"><h3 id="relatedReceiptHeading" tabindex="-1">No steps from this batch are still linked</h3><p>See Task relationships for the current links.</p></section>';
    return `<section id="relatedReceipt" class="notice related-receipt section-gap" aria-labelledby="relatedReceiptHeading"><h3 id="relatedReceiptHeading" tabindex="-1">${saved.length===ids.length?(saved.length===1?'1 smaller task added':saved.length+' smaller tasks added'):'Smaller tasks still linked'}</h3><p>These related tasks don’t block completion of the original task. Open a step to assign an owner or set a due date.</p><ul>${saved.map(item=>{
      const owner=item.owner?state.members?.find(person=>person.id===item.owner&&person.active!==false)?.name||'Owner unavailable':'Unassigned';
      const due=item.dueDate?'Due '+dayLabel(item.dueDate):'No due date';
      return `<li><button type="button" class="text-button" data-action="open-related-batch-child" data-id="${h(item.id)}">${h(item.title)}</button><p class="muted related-receipt-meta">${h(owner)} · ${h(due)}</p></li>`;
    }).join('')}</ul></section>`;
  }
  function relatedBatchInScope(batch) {
    return !!batch&&!window.GatherAccessLost&&isOrganizer()&&batch.actor===ui.actor&&batch.view===ui.view&&
      batch.project===(window.GatherMode?.projectId||'');
  }
  function relatedBatchChildMarkup(batch,task) {
    if(!batch||batch.childId!==task.id)return '';
    return `<div class="related-batch-child-actions"><button type="button" class="text-button" data-action="return-to-related-batch">← Back to added tasks</button><button type="button" class="btn btn-secondary" data-action="review-task-owner" data-id="${h(task.id)}">Edit owner and due date</button></div>`;
  }
  function openRelatedBatchChild(id,opener) {
    const batch=ui.relatedBatch,receipt=$('#relatedReceipt',$('#dialog'));
    if(!relatedBatchInScope(batch)||ui.dialogKind!=='task'||ui.detailId!==batch.parentId||batch.childId||
      !receipt?.contains(opener)||opener.dataset.id!==id||!batch.ids.includes(id))return;
    const state=store.getState(),parent=state.tasks.find(task=>task.id===batch.parentId);
    if(!relatedTasksFor(parent,state).some(task=>task.id===id)){toast('That step is no longer linked to this task.');return;}
    batch.childId=id;
    taskDialog(id,'',false,true);
  }
  function returnToRelatedBatch(readOnly=false) {
    const batch=ui.relatedBatch;
    if(!relatedBatchInScope(batch)||!['task','delete-task'].includes(ui.dialogKind)||!batch.childId||ui.detailId!==batch.childId)return false;
    const childId=batch.childId, parentId=batch.parentId;
    if(!store.getState().tasks.some(task=>task.id===parentId)){
      closeDialog();toast('The original task is no longer available.');return true;
    }
    batch.childId='';
    if(readOnly)taskDialog(parentId,'',false,true,'',undefined,'',{readOnly:true});
    else taskDialog(parentId,'',false,true);
    const dialog=$('#dialog'),heading=$('#dialogTitle',dialog);
    requestAnimationFrame(()=>{
      if(!relatedBatchInScope(batch)||ui.relatedBatch!==batch||ui.dialogKind!=='task'||ui.detailId!==parentId||
        !heading||$('#dialogTitle',dialog)!==heading)return;
      const receipt=$('#relatedReceipt',dialog);
      const opener=receipt&&$$('[data-action="open-related-batch-child"]',receipt).find(el=>el.dataset.id===childId);
      const target=opener||(receipt&&$('#relatedReceiptHeading',receipt))||heading;
      target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    return true;
  }
  function paintRelatedSaveState(form) {
    const failure=form.dataset.saveUnconfirmed;
    if(!failure||!activeRelatedReview(form))return;
    const panel=$('[data-related-check-panel]',form);
    if(!panel)return;
    const first=panel.hidden;
    panel.hidden=false;
    const message=$('[data-related-save-message]',form);
    if(first&&message){
      message.textContent=failure==='stale'?'The project changed before these steps could be added. Check the current links and reopen the task before making another review.':
        failure==='access'?'Weft couldn’t save these steps with your current project access. Return to Projects if you need to sign in again.':
        'Weft couldn’t confirm whether the previous save added any tasks. Check the current links before making another review.';
      message.focus();
    }
    const check=$('[data-action="check-related-review"]',form);
    if(check)check.hidden=!store.refresh||failure==='access';
    const projects=$('[data-related-projects]',form);
    if(projects)projects.hidden=failure!=='access';
    const submit=$('button[type="submit"]',form);
    if(submit)submit.disabled=true;
    const back=$('[data-action="back-related-checklist"]',form);
    if(back)back.hidden=true;
    for(const row of $$('[data-related-row]',form))row.disabled=true;
  }
  async function saveRelatedReview(form,items) {
    if(!activeRelatedReview(form))throw new Error('Reopen the original task as the organizer.');
    if(form.dataset.saveUnconfirmed||unconfirmedRelatedSaves.has(relatedReviewKey(form)))return;
    if(!items.length)throw new Error('Select at least one step to add.');
    const id=form.dataset.id,actor=ui.actor;
    const attemptedRevision=store.getSnapshotRevision?.();
    const priorIds=new Set(store.getState().tasks.map(task=>task.id));
    let ids;
    try {
      const saved=await store.addRelatedTasks(id,{revision:Number(form.dataset.revision),items},actor);
      if(!activeRelatedReview(form))return;
      const state=store.getState(), parent=state.tasks.find(task=>task.id===id);
      const related=new Set(relatedTasksFor(parent,state).map(task=>task.id));
      ids=Array.isArray(saved)?saved.map(task=>task?.id):[];
      if(ids.length!==items.length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id||priorIds.has(id)||!related.has(id)))
        throw new Error('The saved tasks could not be confirmed.');
    } catch(error) {
      if(!activeRelatedReview(form))return;
      if(!store.refresh||[400,413,422,429].includes(error.status))throw error;
      form.dataset.saveUnconfirmed=error.status===409?'stale':[401,403,404].includes(error.status)?'access':'unknown';
      unconfirmedRelatedSaves.set(relatedReviewKey(form),{failure:form.dataset.saveUnconfirmed,revision:attemptedRevision});
      paintRelatedSaveState(form);
      return;
    }
    render();taskDialog(id,'',true,false,'',ids);
    const heading=$('#relatedReceiptHeading');
    requestAnimationFrame(()=>{
      if(heading&&$('#relatedReceiptHeading')===heading&&!window.GatherAccessLost&&ui.actor===actor&&ui.dialogKind==='task'&&ui.detailId===id)heading.focus();
    });
  }
  async function checkRelatedReview(form) {
    const active=()=>activeRelatedReview(form)&&!ui.pendingSave;
    const canApply=()=>active()&&!document.hidden&&!unsavedReview();
    if(!store.refresh||!canApply()||!form.dataset.saveUnconfirmed||form.dataset.saveUnconfirmed==='access')return;
    const status=$('[data-related-check-status]',form), current=$('[data-related-current-links]',form);
    const button=$('[data-action="check-related-review"]',form);
    const key=relatedReviewKey(form), previous=unconfirmedRelatedSaves.get(key);
    if(!status||!current)return;
    if(ui.syncing){
      if(button?.getAttribute('aria-disabled')!=='true')status.textContent='The project is already refreshing. Try checking again in a moment.';
      return;
    }
    ui.syncing=true;button?.setAttribute('aria-disabled','true');
    status.textContent='Checking current linked tasks…';current.replaceChildren();
    try {
      const result=await store.refresh(canApply,{requireFresh:true});
      if(!active())return;
      if(!canApply()||!result.verified)throw new Error('The latest links are not available.');
      const revision=store.getSnapshotRevision?.();
      if(form.dataset.saveUnconfirmed==='stale'&&(!Number.isSafeInteger(revision)||!Number.isSafeInteger(previous?.revision)||revision<=previous.revision))
        throw new Error('The conflicting project update is not available.');
      const state=store.getState(),parent=state.tasks.find(task=>task.id===form.dataset.id);
      const related=relatedTasksFor(parent,state),limit=20;
      current.innerHTML=parent
        ? '<h3>Current related tasks</h3><p>This list shows what’s linked now. It doesn’t verify which tasks came from your save attempt.</p>'+
          (related.length?'<ul>'+related.slice(0,limit).map(task=>'<li>'+h(task.title)+'</li>').join('')+'</ul>':'<p>No related tasks were linked at the time of this check.</p>')+
          (related.length>limit?'<p>Open the original task to see all '+related.length+' related tasks.</p>':'')
        : '<p>The original task isn’t in the current project. This doesn’t verify the result of your save attempt.</p>';
      status.textContent='Checked current linked tasks.';
      if(previous?.failure!=='stale'||revision>previous.revision)unconfirmedRelatedSaves.delete(key);
      if(result.changed&&ui.view!=='details')render();
    } catch {
      if(active())status.textContent='Could not check the latest links. Your review is unchanged. Try checking again.';
    } finally {
      ui.syncing=false;
      if(button?.isConnected)button.removeAttribute('aria-disabled');
    }
  }
  async function relatedAi(generate) {
    const form=$('#relatedChecklistForm'),status=$('#relatedAiStatus'), mode=window.GatherMode;
    if(!form||!status||form.dataset.aiBusy==='true'||!mode||mode.demo||!relatedDraftScope(form)||ui.dialogKind!=='related-checklist'||!confirmDiscard(form))return;
    const task=store.getState().tasks.find(task=>task.id===form.dataset.id),revision=Number(form.dataset.revision);
    if(!task||task.revision!==revision){status.textContent='The task changed. Reopen it before using AI.';return;}
    const active=()=>relatedDraftScope(form)&&ui.dialogKind==='related-checklist'&&$('#relatedChecklistForm')===form;
    const controls=$$('#dialog [data-action^="related-ai-"]'), initialText=form.elements.checklist.value;
    const url=mode.projectUrl('/api/plan')+'&mode=breakdown&task='+encodeURIComponent(task.id);
    async function request(data) {
      const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(data?50000:10000),
        ...(data?{method:'POST',headers:{'Content-Type':'application/json','X-Gather-Request':'1'},body:JSON.stringify(data)}:{})});
      const result=await response.json().catch(()=>null);
      if(!response.ok||!result)throw new Error(result?.error||'Could not load an AI draft. You can still use the checklist.');
      if(result.task?.id!==task.id||result.task.revision!==revision||result.task.title!==task.title)throw new Error('The task changed. Reopen it and review the title again.');
      return result;
    }
    form.dataset.aiBusy='true';controls.forEach(control=>control.disabled=true);
    status.textContent=generate?'Checking the task before sending its title…':'Checking for a saved draft…';
    try {
      let result=await request();
      if(!active())return;
      if(generate){
        if(!result.configured)throw new Error('AI is not configured. You can still use the checklist.');
        if(result.status==='generating')throw new Error('A draft is already generating. Check the saved draft in a moment.');
        if(form.elements.checklist.value!==initialText){status.textContent='Your checklist changed. No title was sent to Groq.';return;}
        status.textContent='Drafting smaller steps with Groq…';
        result=await request({action:'generate',revision:result.revision,workspaceRevision:result.workspaceRevision,
          taskRevision:revision,requestId:crypto.randomUUID(),consent:true,consentVersion:'groq-task-breakdown-v1'});
      }
      if(!active())return;
      if(result.status==='generating')throw new Error('A draft is still generating. Check again in a moment.');
      if(result.contextChanged)throw new Error('The saved AI draft is from an older version of this task. Generate a new one or use the checklist.');
      if(result.issue&&generate)throw new Error(result.issue);
      if(!Array.isArray(result.steps)||!result.steps.length)throw new Error(Array.isArray(result.steps)?'No smaller steps were suggested. Try the checklist instead.':'No current AI draft. Generate one or use the checklist.');
      if(form.elements.checklist.value!==initialText){status.textContent='A draft is saved. Your checklist is unchanged. Use Review saved AI draft to open it.';return;}
      showRelatedReview(task,result.steps,true);
    } catch(error) {
      if(active())status.textContent=error.name==='TimeoutError'?'The request timed out. Check for a saved draft before generating again.':error.message;
    } finally {
      if(active()){delete form.dataset.aiBusy;controls.forEach(control=>control.disabled=false);}
    }
  }
  function dependencyMarkup(task) {
    const state=store.getState(), info=dependencyInfo(task,state), manage=isOrganizer()||task.owner===ui.actor;
    const dependents=state.tasks.filter(t=>(t.dependencies||[]).some(link=>link.taskId===task.id));
    const owner=info.ready&&state.members.find(person=>person.id===task.owner&&person.active!==false);
    return `<section class="task-dependencies section-gap" aria-label="Linked tasks"><div class="linked-work-header"><h3 tabindex="-1">Task relationships</h3><button class="text-button" data-action="map-focus" data-id="${h(task.id)}">View link map ${icon('arrow')}</button></div><p class="relationship-readiness">${h(GatherPlanningUI.readiness(task,state.tasks).label)}</p><p class="muted">Required work gates completion, not every step of progress. Related tasks can run in parallel.</p>
      ${info.open.length&&task.status!=='done'?'<p class="notice">Finish required work before completing this task. Unlink anything no longer needed.</p>':''}
      ${info.ready?`<div class="dependency-prompt"><div><strong>Ready to resume</strong><p>Required linked work is complete. Review the results below and check for other blockers before resuming.</p></div>${manage?`<button class="btn btn-primary" data-action="resume-task" data-id="${h(task.id)}">Resume task</button>`:owner?`<span>${h(owner.name)} can resume this task.</span>`:'<span>Ask the organizer to assign an active owner.</span>'}</div>`:''}
      ${info.links.length?info.links.map(link=>relationshipCard(task,link,info,manage)).join(''):task.status==='blocked'?'<p>No follow-up task linked yet.</p>':''}
      ${manage&&task.status!=='done'?`<details class="dependency-add"><summary>Link an existing task</summary><form id="relationshipAddForm" data-id="${h(task.id)}"><label class="field">Task<select name="taskId" required>${options([['','Choose a task'],...state.tasks.filter(t=>t.id!==task.id&&!info.links.some(l=>l.taskId===t.id)).map(t=>[t.id,t.title])],'')}</select></label><label class="field">Relationship<select name="kind">${options([['related','Related · can run in parallel'],['dependency','Required before this task can be completed']],'related')}</select></label><label class="field">Why link these tasks?<textarea name="reason" rows="2" maxlength="2000" required placeholder="Describe the shared context, or the exact output needed first."></textarea></label><button type="submit" class="btn btn-secondary btn-small">Save link</button></form></details>`:''}
      ${linkedTaskForm(task,state,isOrganizer())}
      ${isOrganizer()&&!window.GatherAccessLost&&task.status!=='done'&&!(task.reportedAt&&task.requiresVerification&&!task.verifiedAt)?`<button class="btn btn-secondary section-gap" data-action="related-checklist" data-id="${h(task.id)}">Break down task</button>`:''}
      ${window.GatherMode&&canCreateTasks()&&!window.GatherAccessLost&&task.status!=='done'?`<div class="section-gap"><button class="btn btn-secondary btn-small" disabled aria-disabled="true" title="Ask Weft chat is coming soon">Ask Weft chat · Coming soon</button><p class="muted">You can still add and link smaller tasks manually.</p></div>`:''}
      ${task.status==='blocked'&&manage?`<details class="dependency-add"><summary>Name or link follow-up work</summary><form id="dependencyForm" data-id="${h(task.id)}"><label class="field">Existing task<select name="existingTask">${options([['','Name the follow-up'],...state.tasks.filter(t=>t.id!==task.id&&!info.links.some(link=>link.taskId===t.id)).map(t=>[t.id,t.title])],'')}</select></label><label class="field">Follow-up task name<input name="newTitle" maxlength="180" placeholder="What needs to happen first?"></label><label class="check-field"><input name="additional" type="checkbox"> Add a separate blocker instead</label><p class="muted">An unused generic follow-up will be updated, not duplicated.</p><div class="form-actions"><button class="btn btn-secondary" type="submit">Save follow-up</button></div></form></details>`:''}
      ${dependents.length?`<h3>Linked from</h3><div class="dependency-targets">${dependents.map(t=>`<button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)} · ${h(member(t.owner).name)}</button>`).join('')}</div>${task.status!=='done'?'<p class="muted">Your completion note will be shared with these tasks.</p>':''}`:''}
    </section>`;
  }
  function relationshipCard(task,link,info,manage) {
    const t=link.task;if(!t)return `<article class="dependency-card"><p>Linked task unavailable.</p>${manage&&task.status!=='done'?`<button class="text-button dependency-unlink" data-action="unlink-dependency" data-id="${h(task.id)}" data-prerequisite="${h(link.taskId)}">Remove unavailable link</button>`:''}</article>`;
    const done=info.resolved(t),related=link.kind==='related';
    return `<article class="dependency-card"><span class="relationship-type ${related?'is-related':''}">${related?'RELATED · NOT A BLOCKER':'REQUIRED BEFORE COMPLETION'}</span><div class="dependency-card-heading"><button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><span class="status-badge ${done?'status-done':related?'':'status-blocked'}">${done?'Complete':t.reportedAt&&t.requiresVerification&&!t.verifiedAt?'Awaiting verification':statuses[t.status]}</span></div><p class="muted">${h(member(t.owner).name)}${link.automatic?' · Automatically linked; review the reason':''}</p><p class="relationship-reason"><strong>Why linked:</strong> ${h(link.reason||'No reason was recorded. Review whether this is really required.')}</p>${done?`<p class="dependency-result">${h(t.completionResult?.text||t.note||'No result provided.')}</p><p class="muted">${h(completionText(t))}</p>`:''}${manage&&task.status!=='done'?`<details class="relationship-edit"><summary>Change relationship</summary><form id="relationship-${h(t.id)}" class="relationship-form" data-id="${h(task.id)}" data-prerequisite="${h(t.id)}"><label class="field">Relationship<select name="kind">${options([['related','Related · does not block completion'],['dependency','Required before this task can be completed']],related?'related':'dependency')}</select></label><label class="field">Why is this link useful or required?<textarea name="reason" rows="2" maxlength="2000" required>${h(link.reason||'')}</textarea></label><button class="btn btn-secondary btn-small" type="submit">Save relationship</button></form></details><button class="text-button dependency-unlink" data-action="unlink-dependency" data-id="${h(task.id)}" data-prerequisite="${h(t.id)}" aria-label="Unlink ${h(t.title)}">Unlink · keep task</button>`:''}</article>`;
  }
  function handoffMarkup(task) {
    const pending=(task.handoffs||[]).filter(item=>item.status==='pending');
    if(!pending.length||task.status==='done')return '';
    const organizer=isOrganizer(),manage=organizer||task.owner===ui.actor,state=store.getState();
    const available=state.tasks.filter(other=>other.id!==task.id&&other.status!=='done');
    return `<section class="task-handoffs section-gap" aria-label="Suggested follow-ups"><h3>Suggested follow-ups</h3>${pending.map(item=>{
      const matching=available.find(other=>other.id===item.taskId),associationOnly=item.key?.startsWith('related:'),mode=matching||(item.matchIds||[]).some(id=>available.some(other=>other.id===id))||associationOnly?'link':'create';
      return `<article class="handoff-card"><h4>${h(item.title)}</h4><p class="muted">${item.kind==='related'?'Related work · not a completion gate':'Required work · review the blocking reason'}${item.owner?' · Suggested owner: '+h(member(item.owner).name):''}</p><blockquote>${h(item.sourceText)}</blockquote><p class="muted">${h(member(item.actor).name)} · ${item.sourceKind==='comment'?'Comment':'Progress update'}</p>${manage?`<form id="handoffForm-${h(item.id)}" class="handoff-form" data-id="${h(task.id)}" data-suggestion="${h(item.id)}"><label class="field">Action<select name="mode">${options([...(associationOnly?[]:[['create','Create task']]),['link','Link existing task']],mode)}</select></label><div data-handoff-create ${mode==='link'?'hidden':''}><label class="field">Task name<input name="title" maxlength="180" value="${h(item.title)}" ${mode==='create'?'required':''}></label><label class="field">Assign to<select name="owner">${organizer?ownerOptions(item.owner):options([['','Unassigned'],[ui.actor,'Me · '+member(ui.actor).name]],item.owner===ui.actor?ui.actor:'')}</select></label>${!organizer&&item.owner&&item.owner!==ui.actor?'<p class="muted">An organizer can assign the suggested teammate.</p>':''}</div><label class="field" data-handoff-link ${mode==='create'?'hidden':''}>Existing task<select name="taskId" ${mode==='link'?'required':''}>${options([['','Choose a task'],...available.map(other=>[other.id,other.title+' · '+member(other.owner).name])],matching?.id||'')}</select></label><p class="muted">${item.kind==='related'?'Adds a related link; both tasks can be worked on in parallel.':'Adds a required prerequisite; review the relationship if it does not truly gate completion.'} The current status stays unchanged.</p><div class="form-actions"><button class="btn btn-primary btn-small" type="submit" name="handoffAction" value="save">${mode==='link'?'Link task':'Create task'}</button><button class="text-button" type="submit" name="handoffAction" value="dismiss" formnovalidate>Dismiss</button></div></form>`:`<p class="muted">The task owner or organizer can review this suggestion.</p>`}</article>`;
    }).join('')}</section>`;
  }
  function syncHandoffForm(form) {
    const create=form.elements.mode.value==='create';
    $('[data-handoff-create]',form).hidden=!create;$('[data-handoff-link]',form).hidden=create;
    form.elements.title.required=create;form.elements.taskId.required=!create;
    $('button[value="save"]',form).textContent=create?'Create task':'Link task';
  }
  function taskDrafts(exclude='') {
    if(ui.dialogKind!=='task')return [];
    return $$('#dialog form').filter(form=>form.id!==exclude).flatMap(form=>
      $$('input[name],textarea[name],select[name]',form).filter(input=>{
        if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
        if(input.tagName==='SELECT'&&input.multiple)return [...input.options].some(option=>option.selected!==option.defaultSelected);
        const initial=input.tagName==='SELECT'?([...input.options].find(option=>option.defaultSelected)?.value??input.options[0]?.value??''):input.defaultValue;
        return input.value!==initial;
      }).map(input=>({form:form.id,name:input.name,value:input.value,checked:input.checked,...(input.type==='file'?{files:[...input.files]}:{}),...(input.multiple?{selected:[...input.selectedOptions].map(option=>({value:option.value,text:option.textContent}))}:{})})));
  }
  function priorityMarkup(task,organizer) { return recovery.priorityMarkup(task,organizer); }
  function taskOutcomeMarkup(task,organizer) {
    const historical=task.status==='done'||!!task.reportedAt;
    return `<section class="agreed-scope section-gap" aria-label="Task outcome"><h3>Done when</h3><p>${h(task.scope||'No separate outcome recorded.')}</p><p class="muted">This agreed result stays separate from progress updates. It is not proof of completion.</p>${organizer&&!window.GatherAccessLost&&!historical?`<details class="task-outcome-edit"><summary>Clarify outcome</summary><form id="taskOutcomeForm" data-id="${h(task.id)}" class="section-gap"><label class="field">Required outcome (optional)<textarea name="scope" rows="3" maxlength="3000" placeholder="What result should the owner produce or confirm?">${h(task.scope||'')}</textarea></label><p class="muted">Saving a different outcome clears acceptance and Next up so the owner can reconfirm. Status, latest update, dates, schedule and links stay unchanged. The old and new outcomes are kept in the task conversation. No email is sent.</p><button class="btn btn-secondary btn-small" type="submit">Save outcome</button></form></details>`:historical?'<p class="muted">Review the completion report or reopen the task before changing its required outcome.</p>':'<p class="muted">The organizer can clarify the agreed outcome.</p>'}</section>`;
  }
  function taskOwnerPresentation(task,state,organizer) {
    const owner=state.members.find(person=>person.id===task.owner);
    const unavailable=!!task.owner&&(!owner||owner.active===false);
    const name=!task.owner?'Unassigned':!owner?'Assigned owner unavailable':owner.name+(owner.active===false?' · Inactive teammate':'');
    const unresolved=task.status!=='done'||task.requiresVerification&&!task.verifiedAt;
    if(!unavailable||!unresolved)return {name,notice:''};
    const canReview=organizer&&!window.GatherAccessLost;
    return {name,notice:`<section class="notice section-gap" aria-label="Task ownership"><h3>Review task ownership</h3><p>The assigned owner is missing or inactive in this project. Confirm who can take responsibility; assignment alone does not record acceptance.</p>${canReview?`<p>Choose an active teammate in Edit task details. Changing the owner resets acceptance and Next up commitments. No message is sent.${task.reportedAt&&task.status!=='done'?' Saving a different owner also clears this pending completion report; review it first.':''}</p><button class="btn btn-secondary btn-small" data-action="review-task-owner" data-id="${h(task.id)}">Review owner</button>`:'<p>Ask the organizer to review the owner. You can add context in the conversation below.</p>'}</section>`};
  }
  function taskDialog(id,submittedForm='',discardDrafts=false,focusHeading=false,eventGroup='',relatedReceiptIds,overlapDay='',{readOnly=false}={}) {
    const taskState=store.getState(),task=taskState.tasks.find(t=>t.id===id);
    if(!task){toast('That task is no longer available.');return;}
    if(ui.dialogKind==='before-event-review'&&eventGroup&&!window.GatherAccessLost)ui.eventTaskReview={actor:ui.actor,group:eventGroup};
    const sameTask=ui.dialogKind==='task'&&ui.detailId===id;
    if(ui.overlapComparison&&(!overlapComparisonInScope(ui.overlapComparison)||ui.overlapComparison.peerId!==id))ui.overlapComparison=null;
    ui.overlapReviewDay=overlapDay||(sameTask?ui.overlapReviewDay:'');
    const drafts=sameTask&&!discardDrafts?taskDrafts(submittedForm):[];
    const expanded=sameTask?$$('#dialog details[open]').map(el=>el.className):[];
    const previousFocus=sameTask?document.activeElement:null;
    const scroll=sameTask?$('#dialog').scrollTop:0;
    ui.detailId=id;
    const organizer=isOrganizer(), own=task.owner===ui.actor,ownerInfo=taskOwnerPresentation(task,taskState,organizer);
    if(relatedReceiptIds&&organizer&&!window.GatherAccessLost)ui.relatedBatch={actor:ui.actor,view:ui.view,
      project:window.GatherMode?.projectId||'',parentId:id,ids:[...relatedReceiptIds],childId:''};
    let batch=ui.relatedBatch;
    if(!relatedBatchInScope(batch)||(id!==batch.parentId&&id!==batch.childId)){ui.relatedBatch=null;batch=null;}
    if(batch?.parentId===id)batch.childId='';
    const awaiting=task.requiresVerification&&task.reportedAt&&!task.verifiedAt, completionBlocked=dependencyInfo(task).open.length>0;
    openDialog(task.title,`<div class="inline">${awaiting?'<span class="status-badge status-blocked">Awaiting organizer verification</span>':statusBadge(task.status)}<span class="category-label">${h(task.category)}</span>${sourceButton(task)}</div>
      ${relatedBatchChildMarkup(batch,task)}
      ${batch?.parentId===id?relatedReceiptMarkup(task,taskState,batch.ids):''}
      <dl class="task-facts"><div><dt>Assigned to</dt><dd>${h(ownerInfo.name)}</dd></div><div><dt>Due</dt><dd>${dayLabel(task.dueDate)}</dd></div></dl>
      ${ownerInfo.notice}
      ${schedule.details(task,organizer,taskState.event,taskState.tasks,ui.overlapReviewDay)}
      ${!task.owner&&task.status!=='done'?`<div class="claim-panel"><p>No owner yet.</p><button class="btn btn-primary" data-action="claim" data-id="${h(id)}">Claim task</button></div>`:''}
      ${taskOutcomeMarkup(task,organizer)}
      <section class="task-context"><h3>Latest update</h3><p>${h(task.note||'No update yet.')}</p><span class="muted">${h(updateAttribution(noteUpdate(task)))}</span></section>
      ${task.completedAt?`<p class="completion-note">${h(completionText(task))} · ${timeLabel(task.completedAt)}</p>`:''}
      ${window.GatherCompletionUI?.section(task,own||organizer,organizer,{canPrepareRevision:own&&!window.GatherAccessLost,completionBlocked})||''}
      ${awaiting?`<div class="notice section-gap">${h(task.reportedBy)} reported this complete. The organizer needs to confirm it.
        ${completionBlocked?`<p id="verificationRequiredWork">Verification is waiting on required work. See Task relationships below.${organizer?' You can still request changes to this report.':''}</p>`:''}
        ${organizer?`<button class="btn btn-primary btn-small" data-action="verify-task" data-id="${h(id)}" ${completionBlocked?'disabled aria-describedby="verificationRequiredWork"':''}>Verify completion</button><details class="completion-return"><summary>Request changes</summary><form id="returnCompletionForm" data-id="${h(id)}" class="section-gap"><label class="field">What needs changing?<textarea name="note" required rows="3" maxlength="3000" placeholder="Explain which agreed result is missing or what needs another check."></textarea></label><p class="muted">Shared with the team. Returning the report keeps the task incomplete and retains its earlier note and attachments. The owner can revise and resubmit. No email is sent.</p><button class="btn btn-secondary btn-small" type="submit">Return completion for changes</button></form></details>`:''}</div>`:''}
      ${recovery.recoveryMarkup(task,organizer)}
      ${dependencyMarkup(task)}
      ${handoffMarkup(task)}
      ${own&&task.status!=='done'?recovery.responseMarkup(task,awaiting,completionBlocked):!own&&!organizer&&task.owner?`<p class="notice section-gap">${h(member(task.owner).name)} reports progress on this task. You can join the conversation below.</p>`:''}
      ${window.GatherResourcesUI?.markup()||''}
      <section class="comments section-gap"><h3>Comments</h3>${task.comments.map(c=>`<article class="comment">${avatar(c.actor,true)}<div><strong>${h(member(c.actor).name)}</strong><time>${timeLabel(c.at)}</time><p>${h(c.text)}</p></div></article>`).join('')||'<p class="muted">No comments yet.</p>'}<form id="commentForm" class="comment-form" data-id="${h(id)}"><label class="field"><span class="sr-only">Add a comment</span><textarea name="text" required rows="2" maxlength="3000" placeholder="Add a comment…"></textarea></label><button class="btn btn-secondary btn-small" type="submit">Post as ${h(member(ui.actor).name.split(' ')[0])}</button></form></section>
      ${priorityMarkup(task,organizer)}
      ${organizer?`<details class="task-organizer section-gap"><summary>Edit task details <span>Organizer only</span></summary><form id="taskDetailForm" data-id="${h(id)}" class="section-gap"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" value="${h(task.title)}"></label><label class="field">Owner<select name="owner">${ownerOptions(task.owner)}</select></label><div data-owner-load class="full-width">${recovery.ownerLoad(task.owner)}</div><label class="field">Status<select name="status">${options(Object.entries(statuses).filter(([key])=>key!=='done'||!completionBlocked||task.status==='done'),task.status)}</select></label><label class="field">Due date<input name="dueDate" type="date" value="${h(task.dueDate)}"></label><label class="field">Category<select name="category">${options([...new Set(['Transport','Food & drink','Venue','Program','Guest care',task.category])].map(x=>[x,x]),task.category)}</select></label><label class="field full-width">Latest update<textarea name="note" rows="3" maxlength="3000">${h(task.note)}</textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save task details</button></div></form><p class="muted">${h(commitment(task))}</p><div class="inline"><button class="text-button" data-action="verification-toggle" data-id="${h(id)}">${task.requiresVerification?'Turn off':'Require'} organizer verification</button><button class="text-button" data-action="followup" data-id="${h(id)}">Draft follow-up</button></div>${task.followupAfter?`<p class="muted">Next planned follow-up: ${dayLabel(task.followupAfter)}</p>`:''}</details><div class="task-delete-action"><button type="button" class="text-button danger-button" data-action="delete-task" data-id="${h(id)}">Delete task…</button></div>`:''}`, '',false,'task',focusHeading);
    if(sameTask){
      for(const draft of drafts){const input=document.getElementById(draft.form)?.elements.namedItem(draft.name);if(input){if(draft.files){const transfer=new DataTransfer();for(const file of draft.files)transfer.items.add(file);input.files=transfer.files;}else if(draft.selected){for(const item of draft.selected)if(![...input.options].some(option=>option.value===item.value)){const option=document.createElement('option');option.value=item.value;option.textContent=item.text;input.append(option);}for(const option of input.options)option.selected=draft.selected.some(item=>item.value===option.value);}else input.value=draft.value;if(input.type==='checkbox'||input.type==='radio')input.checked=draft.checked;}}
      for(const form of $$('.handoff-form',$('#dialog')))syncHandoffForm(form);
      for(const detail of $$('#dialog details'))if(expanded.includes(detail.className))detail.open=true;
      requestAnimationFrame(()=>{restoreFocus(previousFocus,$('#dialog'));$('#dialog').scrollTop=scroll;});
    }
    syncRecoveryForms();
    window.GatherCompletionUI?.mount($('#dialog'));
    const resourceDraft=drafts.find(draft=>draft.form==='resourceForm'&&draft.name==='location');
    if(sameTask&&resourceDraft)$('#dialog').dataset.resourceDraft=resourceDraft.value;
    window.GatherResourcesUI?.mount(id,$('#dialog'),{readOnly});
    if((batch||ui.overlapComparison||(store.refresh&&canRefreshActivityReview(task)))&&workspaceUpdatesPending())showPendingUpdate();
  }
  function syncRecoveryForms() {
    const response=$('#responseForm'),decision=$('#recoveryDecisionForm');
    if(response)recovery.syncResponse(response);
    if(decision)recovery.syncDecision(decision);
  }
  function newTaskDialog(firstTask=false) {
    if(!canCreateTasks())throw new Error('Only the organizer can add tasks.');
    if(firstTask&&guidedWorkspace){
      openDialog('Add your first task',`<p class="workspace-first-task-copy">Start with one action. We’ll save it as <strong>To do</strong> and show it under <strong>Shared tasks → All tasks</strong>.</p>
        <form id="newTaskForm" data-guide-task="true">
          <label class="field">Task name <small>Required</small><input name="title" required maxlength="180" placeholder="e.g. Confirm the venue" aria-describedby="guideTaskNameHelp"></label>
          <p class="guide-task-help" id="guideTaskNameHelp">Start with a verb so it’s clear what needs to happen.</p>
          <details class="guide-task-fields"><summary>Add optional details</summary><p class="guide-task-help">Give it an owner, a due date, a category, or a clear outcome. You can fill these in later.</p>
            <div class="form-grid">
              <label class="field">Owner<select name="owner">${ownerOptions('')}</select><small>Who will take this on? Leave it unassigned if you’re not sure.</small></label>
              <label class="field">Due date<input name="dueDate" type="date"><small>When does this work need to be done?</small></label>
              <div data-owner-load class="full-width"></div>
              <label class="field full-width">Category<select name="category">${options(['Guest care','Food & drink','Transport','Venue','Program'].map(value=>[value,value]),'Guest care')}</select><small>Group it with similar work in the project.</small></label>
              <label class="field full-width">Done when<textarea name="scope" rows="2" maxlength="3000" placeholder="e.g. The venue confirms the date in writing."></textarea><small>Describe the result, so anyone can tell when it’s finished.</small></label>
              <label class="field full-width">Context<textarea name="note" rows="2" maxlength="3000" placeholder="What should the owner know before starting?"></textarea><small>Shared with the team. Don’t include private codes or credentials.</small></label>
            </div>
          </details>
          <div class="form-actions"><button type="button" class="btn btn-secondary" data-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Save first task</button></div>
        </form>`);
      return;
    }
    const organizer=isOrganizer();
    openDialog('Add task',`${organizer?'':'<p class="notice">Add a task for yourself or leave it unassigned for someone to claim. New tasks start as To do.</p>'}<form id="newTaskForm"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" placeholder="What needs to happen?"></label><label class="field">Owner<select name="owner">${organizer?ownerOptions(''):options([['','Unassigned'],[ui.actor,'Me · '+member(ui.actor).name]],'')}</select></label><div data-owner-load class="full-width"></div><label class="field">Due date<input name="dueDate" type="date"></label><label class="field">Category<select name="category">${options(['Guest care','Food & drink','Transport','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label>${organizer?`<label class="field">Status<select name="status">${statusOptions('todo')}</select></label>`:''}<label class="field full-width">Done when (optional)<textarea name="scope" rows="2" maxlength="3000" placeholder="Describe the result that means this task is finished."></textarea><small>Shared with the team and kept separately from progress updates. Do not include private booking codes or credentials.</small></label><label class="field full-width">Context<textarea name="note" rows="3" maxlength="3000" placeholder="What does the owner need to know?"></textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Add task</button></div></form>`);
  }
  function followupDialog(id) {
    const task=store.getState().tasks.find(t=>t.id===id);
    if(!task)return;
    const r=reason(task);
    const saved=store.getState().drafts.find(d=>d.taskId===id);
    const draft=saved?.text || `Hi ${task.owner?member(task.owner).name.split(' ')[0]:'team'}, quick check-in on “${task.title}”.\n\n${latestUpdate(task)?`The last update was: “${latestUpdate(task)}”\n\n`:''}${task.status==='blocked'?'What decision or help would unblock this, and who do you need it from?':!task.owner?'Who can take ownership, and what is a realistic next checkpoint?':'What is done so far, and what is the next concrete step?'}${task.dueDate?` We had ${dayLabel(task.dueDate)} as the target—does that still work?`:''}\n\nThanks,\n${member(ui.actor).name.split(' ')[0]}`;
    openDialog('Follow-up draft',`<div class="followup-context"><div><strong>${h(task.title)}</strong><p>${r?h(r.label):'Check-in'} · Last updated ${relative(task.updatedAt)}</p></div></div><form id="followupForm" data-id="${h(id)}"><label class="field section-gap">Your message<textarea name="text" required rows="10" maxlength="5000">${h(draft)}</textarea></label><p class="notice">Draft only. Saving or copying does not send it.</p><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('copy')} Save & copy draft</button><button type="button" class="text-button" data-action="record-followup" data-id="${h(id)}">Record as sent</button></div></form>`, '',false,'followup');
  }
  function digestText(s) {
    return `${s.event.name} — ${new Date().toLocaleDateString()}\n\nCOMPLETED\n${completed(s).map(t=>`• ${t.title} — ${completionText(t)} (${timeLabel(t.completedAt)})`).join('\n')||'No completed tasks yet.'}\n\nNEEDS ATTENTION\n${attention(s).map(t=>`• ${t.title} — ${member(t.owner).name}; ${reason(t).label}. ${t.note||''}`).join('\n')||'No outstanding attention items.'}\n\nEMAIL TO REVIEW\n${pending(s).map(m=>`• ${m.subject} — ${m.sender}`).join('\n')||'All messages reviewed.'}`;
  }
  function updateReuseChecklistWarning() {
    const draft=ui.reuseChecklist;
    if(!draft||ui.dialogKind!=='reuse-checklist')return false;
    const sync=$('#workspaceSyncNotice');
    const changed=draft.stale||(sync&&!sync.hidden)||(store.getSnapshotRevision&&store.getSnapshotRevision()!==draft.revision);
    const offline=window.navigator?.onLine===false;
    const message=window.GatherAccessLost||!isOrganizer()?'Project access changed. This checklist cannot be copied.':
      changed?'The shared plan changed. Close this checklist and reopen it from Wrap up after checking for updates.':
      offline?'Couldn’t check the shared plan. Reconnect before copying this checklist.':'';
    const warning=$('#reuseChecklistWarning'),preview=$('#reuseChecklistPreview');
    if(warning){if(warning.textContent!==message)warning.textContent=message;warning.hidden=!message;}
    const visible=message?'':draft.text;
    if(preview&&preview.value!==visible)preview.value=visible;
    $('[data-action="copy-reuse-checklist"]')?.setAttribute('aria-disabled',String(!!message||!visible||draft.copying));
    return !!message;
  }
  function reuseChecklistDialog() {
    if(ui.view!=='memory'||!isOrganizer()||window.GatherAccessLost)return;
    const rows=GatherWrapUp.reusableTitles(store.getState(),{mine:ui.wrapMine,actor:ui.actor});
    if(!rows.length){toast('There are no reusable task titles in this view.');return;}
    ui.reuseChecklist={rows,revision:store.getSnapshotRevision?.(),text:'',copying:false,stale:false};
    openDialog('Reuse tasks for another event',GatherWrapUp.reusablePicker(rows,{mine:ui.wrapMine,h}),
      '<button class="btn btn-secondary" data-action="close-dialog">Back to Wrap up</button><button class="btn btn-primary" data-action="copy-reuse-checklist" aria-disabled="true">Copy checklist</button>',true,'reuse-checklist');
    updateReuseChecklistWarning();
  }
  function filterReuseChecklist() {
    const draft=ui.reuseChecklist;
    if(!draft||ui.dialogKind!=='reuse-checklist')return;
    const query=($('#reuseChecklistSearch')?.value||'').trim().toLocaleLowerCase();
    let matches=0;
    $$('[data-reuse-row]').forEach((row,index)=>{
      row.hidden=!draft.rows[index]?.title.toLocaleLowerCase().includes(query);
      if(!row.hidden)matches++;
    });
    const empty=$('#reuseChecklistNoMatches');
    if(empty)empty.hidden=matches>0;
  }
  function syncReuseChecklist() {
    const draft=ui.reuseChecklist;
    if(!draft||ui.dialogKind!=='reuse-checklist')return;
    const controls=$$('[data-reuse-choice]'),picked=controls.filter(control=>control.checked);
    const edits=$$('[data-reuse-edit]'),titles=$$('[data-reuse-title]');
    controls.forEach((control,index)=>{if(edits[index])edits[index].hidden=!control.checked;});
    draft.text=GatherWrapUp.reusableChecklist(draft.rows,picked.map(control=>({index:Number(control.value),title:titles[Number(control.value)]?.value})));
    controls.forEach(control=>{control.disabled=!control.checked&&picked.length>=GatherWrapUp.reuseLimit;});
    const count=$('#reuseChecklistCount');
    const text=picked.length+' of '+GatherWrapUp.reuseLimit+' selected.'+(picked.length&&!draft.text?' Each selected title needs 1 to 180 characters. Clear the search to see all selected titles.':
      picked.length>=GatherWrapUp.reuseLimit?' Clear a selection to choose another.':'');
    if(count&&count.textContent!==text)count.textContent=text;
    updateReuseChecklistWarning();
  }
  async function copyReuseChecklist() {
    const draft=ui.reuseChecklist,preview=$('#reuseChecklistPreview');
    if(!draft||!preview||draft.copying||ui.dialogKind!=='reuse-checklist'||!isOrganizer()||window.GatherAccessLost)return;
    const shown=preview.value;
    syncReuseChecklist();
    if(updateReuseChecklistWarning()||!draft.text)return;
    if(shown!==draft.text){toast('The preview changed. Review it before copying again.');return;}
    const text=draft.text;
    draft.copying=true;updateReuseChecklistWarning();
    try {
      if(store.confirmSnapshotRevision){
        let current;
        try{current=await store.confirmSnapshotRevision(draft.revision);}
        catch{
          if(ui.reuseChecklist===draft&&!window.GatherAccessLost)toast('Could not confirm the latest plan. Try again before copying.');
          return;
        }
        if(ui.reuseChecklist!==draft||!preview.isConnected||window.GatherAccessLost||!isOrganizer())return;
        if(!current)draft.stale=true;
        if(updateReuseChecklistWarning())return;
        if(draft.text!==text){toast('The preview changed. Review it before copying again.');return;}
      }
      const copied=await copyText(text);
      if(ui.reuseChecklist!==draft||!preview.isConnected||window.GatherAccessLost||!isOrganizer())return;
      if(updateReuseChecklistWarning()||draft.text!==text){
        if(copied)toast('The checklist changed while copying. Don’t paste the old copy; review the current plan first.');
      }else if(copied)toast('Checklist copied. Paste it in the next event’s private plan.');
      else {preview.focus();preview.select();toast('Copy the selected preview manually. Nothing was sent.');}
    } finally {
      draft.copying=false;
      if(ui.reuseChecklist===draft)updateReuseChecklistWarning();
    }
  }
  function updateGuestAgendaWarning() {
    if(ui.dialogKind!=='guest-agenda'||!ui.guestAgenda)return false;
    const draft=ui.guestAgenda, sync=$('#workspaceSyncNotice');
    const stale=draft.stale||scheduleRevisionIsStale(draft.revision)||(sync&&!sync.hidden)||(store.getSnapshotRevision&&store.getSnapshotRevision()!==draft.revision);
    const offline=window.navigator?.onLine===false;
    const message=window.GatherAccessLost||!isOrganizer()?'Project access changed. This agenda cannot be copied.':
      stale?'The shared plan changed. Close this draft and open a new agenda from the current schedule.':
      offline?'Couldn’t check the shared plan. Reconnect before copying the agenda.':'';
    const notice=$('#guestAgendaWarning');
    if(notice){if(notice.textContent!==message)notice.textContent=message;notice.hidden=!message;}
    const preview=$('#guestAgendaText');
    const text=message?'':draft.text;
    if(message)draft.manualCopy=null;
    if(preview&&preview.value!==text)preview.value=text;
    const help=$('#guestAgendaCopyHelp');
    if(help){
      const hint=draft.manualCopy?'Automatic copying was unavailable. Copy the selected text now; if you edit the draft, use Copy guest agenda again.':
        'Use Copy guest agenda to check the schedule before copying. Nothing is sent.';
      if(help.textContent!==hint)help.textContent=hint;
    }
    $('[data-action="copy-guest-agenda"]')?.setAttribute('aria-disabled',String(!!message||!draft.text||draft.copying));
    $('[data-action="all-guest-agenda-activities"]')?.setAttribute('aria-disabled',String(!!message||draft.copying));
    return !!message;
  }
  function guestAgendaDialog(allActivitiesFrom=null) {
    if(!isOrganizer()||window.GatherAccessLost||ui.view!=='timeline'||ui.timelineMode==='deadlines')return;
    const state=store.getState(), scope={mine:allActivitiesFrom?false:ui.scheduleMine,actor:ui.actor,date:allActivitiesFrom?allActivitiesFrom.date:ui.scheduleDate};
    const snapshot=GatherScheduleUI.guestAgendaSnapshot(state,scope);
    const {activities,timeZone}=snapshot;
    if(!activities.length){toast(snapshot.invalidTimes?'Correct the saved activity times in Timeline before drafting this agenda.':'No scheduled activities in this view. Choose a different day or activity filter.');return;}
    if(activities.length>80){toast(allActivitiesFrom?'All activities has more than 80 entries in this date range. Your draft is unchanged. Choose a narrower date on Timeline to include the whole team.':'Choose a day or My activities to review at most 80 activities at a time.');return;}
    if(!GatherScheduleUI.momentKey(Date.now(),timeZone)){toast('Set the event time zone in Project settings before drafting an agenda.');return;}
    if(allActivitiesFrom&&!confirmDiscard(allActivitiesFrom.form))return;
    ui.guestAgenda={snapshot,revision:store.getSnapshotRevision?.(),text:'',copying:false,stale:false,manualCopy:null,copyEpoch:0};
    openDialog('Draft guest agenda',schedule.guestAgendaForm(snapshot,state.event.name),
      '<button class="btn btn-secondary" data-action="close-dialog">Back to schedule</button><button class="btn btn-primary" data-action="copy-guest-agenda" aria-disabled="true">Copy guest agenda</button>',true,'guest-agenda',!!allActivitiesFrom);
    updateGuestAgendaWarning();
  }
  function useAllGuestActivities() {
    const draft=ui.guestAgenda,form=$('#guestAgendaForm');
    if(ui.dialogKind!=='guest-agenda'||!draft?.snapshot.mine||!form||draft.copying||
      !isOrganizer()||window.GatherAccessLost||updateGuestAgendaWarning())return;
    guestAgendaDialog({date:draft.snapshot.date,form});
  }
  function syncGuestAgenda(form) {
    const draft=ui.guestAgenda;
    if(!draft||ui.dialogKind!=='guest-agenda')return;
    const field=name=>form.elements.namedItem(name);
    const choices=draft.snapshot.activities.map((_,index)=>{
      const included=field('include-'+index)?.checked===true;
      const fields=form.querySelector('[data-agenda-fields="'+index+'"]');
      if(fields)fields.hidden=!included;
      return {included,title:field('title-'+index)?.value,location:field('location-'+index)?.value};
    });
    const text=GatherScheduleUI.guestAgenda(draft.snapshot,field('agendaTitle')?.value,choices);
    if(draft.text!==text){draft.manualCopy=null;draft.copyEpoch++;}
    draft.text=text;
    const status=$('#guestAgendaSelectionStatus'), count=choices.filter(choice=>choice.included).length;
    if(status){
      const text=!count?'Select at least one activity.':draft.text?count+' '+(count===1?'activity':'activities')+' in the preview.':'Enter an agenda title and a guest-facing title for each selected activity.';
      if(status.textContent!==text)status.textContent=text;
    }
    updateGuestAgendaWarning();
  }
  function guardGuestAgendaPreviewCopy(event) {
    const preview=$('#guestAgendaText');
    if(!preview||event.target!==preview||ui.dialogKind!=='guest-agenda')return;
    const draft=ui.guestAgenda;
    const form=$('#guestAgendaForm');
    if(draft&&form)syncGuestAgenda(form);
    const approved=draft?.manualCopy;
    const ready=draft&&!updateGuestAgendaWarning()&&!draft.copying&&approved&&
      approved===draft.manualCopy&&approved.expiresAt>Date.now()&&
      approved.text===preview.value&&approved.text===draft.text&&
      preview.selectionStart===0&&preview.selectionEnd===approved.text.length;
    if(draft)draft.manualCopy=null;
    if(!ready){
      event.preventDefault();
      toast('Use Copy guest agenda to check the schedule before copying.');
    }
    updateGuestAgendaWarning();
  }
  function resetGuestAgendaManualCopy() {
    if(!ui.guestAgenda||ui.dialogKind!=='guest-agenda')return;
    ui.guestAgenda.manualCopy=null;
    ui.guestAgenda.copyEpoch++;
    updateGuestAgendaWarning();
  }
  async function copyGuestAgenda() {
    const draft=ui.guestAgenda, form=$('#guestAgendaForm'), preview=$('#guestAgendaText');
    if(!draft||!form||!preview||draft.copying||ui.dialogKind!=='guest-agenda'||!isOrganizer()||window.GatherAccessLost)return;
    const shown=preview.value;
    syncGuestAgenda(form);
    if(updateGuestAgendaWarning()){toast('This agenda is not current. Check the warning before copying.');return;}
    if(!draft.text){toast('Select an activity and review the agenda preview before copying.');return;}
    if(shown!==draft.text){toast('The preview changed. Review it before copying again.');return;}
    const text=draft.text;
    const epoch=draft.copyEpoch;
    draft.manualCopy=null;draft.copying=true;updateGuestAgendaWarning();
    try {
      // Confirm against an authenticated workspace read, without applying a newer snapshot over this form.
      if(store.confirmSnapshotRevision){
        let current;
        try{current=await store.confirmSnapshotRevision(draft.revision,newer=>{
          rememberNewerSchedule(draft,newer);
          if(ui.guestAgenda)updateGuestAgendaWarning();
        });}
        catch{
          if(ui.guestAgenda===draft&&!window.GatherAccessLost)toast('Could not confirm the latest schedule. Reconnect or try again before copying.');
          return;
        }
        if(ui.guestAgenda!==draft||!preview.isConnected||window.GatherAccessLost||!isOrganizer())return;
        if(updateGuestAgendaWarning()){toast('This agenda is not current. Check the warning before copying.');return;}
        if(!current){toast('Could not confirm the latest schedule. Try again before copying.');return;}
        if(draft.copyEpoch!==epoch||draft.text!==text){toast('Review the current preview and try copying again.');return;}
      }
      const copied=await copyText(text);
      if(ui.guestAgenda!==draft||!preview.isConnected||window.GatherAccessLost||!isOrganizer())return;
      const stale=updateGuestAgendaWarning();
      if(stale||draft.copyEpoch!==epoch||draft.text!==text){
        if(copied)toast(stale?'An older agenda was copied. Don’t share it; open a new draft from the current schedule.':
          'An older agenda was copied. Review the current preview and copy it again before sharing.');
        else toast(stale?'The agenda is no longer current. Open a new draft before copying.':'The preview changed. Review it before copying again.');
      }else if(copied)toast('Guest agenda copied. Nothing was sent.');
      else {
        const approved={text,expiresAt:Date.now()+30000};
        draft.manualCopy=approved;
        setTimeout(()=>{
          if(ui.guestAgenda===draft&&draft.manualCopy===approved)resetGuestAgendaManualCopy();
        },30000);
        preview.focus();preview.select();toast('Copy the selected preview manually. Nothing was sent.');
      }
    } finally {
      draft.copying=false;
      if(ui.guestAgenda===draft)updateGuestAgendaWarning();
    }
  }
  function digestDialog() {
    const s=store.getState();
    const section=(title,items)=>`<section class="digest-section"><h3>${title}</h3>${items||'<p class="muted">Nothing here right now.</p>'}</section>`;
    openDialog('Event summary',`<p class="muted">Updated ${timeLabel(Date.now())}</p>${section('Completed',completed(s).slice(0,5).map(t=>`<p><button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(completionText(t))} · ${timeLabel(t.completedAt)}</p>`).join(''))}${section('Decisions & follow-ups',attention(s).map(t=>`<p><strong>${h(reason(t).label)}:</strong> <button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(member(t.owner).name)} · ${h(t.note)}</p>`).join(''))}${section(`${pending(s).length} emails still need a review`,pending(s).map(m=>`<p>${h(m.subject)}<br><span class="muted">${h(m.sender)}</span></p>`).join(''))}`,`<button class="btn btn-primary" data-action="copy-digest">${icon('copy')} Copy summary</button>`,true,'digest');
  }
  function feedbackDialog() {
    openDialog('Add lesson for next time',`<form id="feedbackForm"><div class="form-grid"><label class="field full-width">What worked well?<textarea name="wentWell" rows="2" maxlength="2000" placeholder="Keep the staggered bus departures…"></textarea></label><label class="field full-width">What should we repeat or do differently?<textarea name="change" required rows="3" maxlength="2000" placeholder="Keep a quiet space ready before guests arrive…"></textarea></label><label class="field">Area<select name="category">${options(['Guest care','Transport','Food & drink','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label><label class="field">Event rating (optional)<select name="rating">${options([['','Not rated'],['5','5 — Great'],['4','4 — Good'],['3','3 — Mixed'],['2','2 — Difficult'],['1','1 — Needs work']],'')}</select></label></div>${memoryFields()}<p class="notice">Suggestions use the selected event context. Written exceptions require manual review.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Save lesson</button></div></form>`);
  }
  function finishWrapUpLesson(id) {
    const onWrapUp=ui.view==='memory';
    closeDialog();
    render();
    if(!onWrapUp||window.GatherAccessLost||ui.view!=='memory')return false;
    focusWrapLesson(id,$('#viewRoot'));
    return true;
  }
  function focusWrapLesson(id,root) {
    if(ui.view!=='memory'||window.GatherAccessLost||!root||root.closest('[hidden],[inert]'))return false;
    const lesson=id&&$$('[data-wrap-lesson]',root).find(item=>item.dataset.wrapLesson===id);
    const target=lesson||$('#wrapUpLessons',root);
    return !!target&&!target.closest('[hidden],[inert]')&&focusScheduleTarget(target);
  }
  function thoughtDialog() {
    const suggestions=store.getSuggestions();
    openDialog('Automatic checks',`<h3 class="planning-checks-title">Rules, not AI</h3><details class="suggestion-details"><summary>How checks update</summary><p>These rule-based checks refresh as tasks, deadlines, event details, and feedback change. Optional AI suggestions live in the Overview sidebar. Ask Weft is coming soon.</p></details><button class="btn btn-secondary section-gap" data-action="event-context">${isOrganizer()?'Update event context':'Event details'}</button><div class="ai-panel section-gap" id="suggestionList">${suggestions.map(insightMarkup).join('')||empty('No automatic checks.','')}</div><button class="text-button section-gap" data-action="feedback">${icon('plus')} Add event feedback</button>`, '',true,'thought');
    if(store.refresh)queueMicrotask(()=>refreshInbox());
  }
  function refreshSuggestionSurfaces() {
    const suggestions=store.getSuggestions();
    $('#aiNavCount').textContent=suggestions.length;
    $$('[data-suggestion-count]').forEach(node=>{node.textContent=suggestions.length;});
    const active=document.activeElement,scroll=$('#dialog').scrollTop;
    let replacedFocus=false;
    for(const [selector,items,emptyMarkup] of [['#overviewSuggestions',suggestions.slice(0,2),'<p>No suggestions.</p>'],['#suggestionList',suggestions,empty('No suggestions.','')]]){
      const target=$(selector);if(!target)continue;
      const markup=items.map(insightMarkup).join('')||emptyMarkup;
      const content=document.createElement('template');content.innerHTML=markup;
      // Unchanged checks retain their DOM, keyboard focus and scroll position.
      if(target.innerHTML===content.innerHTML)continue;
      replacedFocus ||= target.contains(active);
      target.replaceChildren(content.content);
    }
    if(replacedFocus&&!restoreFocus(active,ui.dialogKind==='thought'?$('#dialog'):$('#viewRoot'))){
      const fallback=ui.dialogKind==='thought'?$('#dialog [data-action="event-context"]'):$('#thoughtPartner [data-action="thought-partner"]');
      fallback?.focus({preventScroll:true});
    }
    if(ui.dialogKind==='thought')$('#dialog').scrollTop=scroll;
  }
  function pasteDialog() {
    const threads=[...new Map(store.getState().messages.map(m=>[m.threadId,[m.threadId,m.subject]])).values()];
    const group=GatherInbox.conversations(store.getState()).find(g=>g.key===ui.conversationKey);
    openDialog('Add an email to a task',`<p class="warning-note">This text becomes shared planning data. Remove booking references, private links, and personal details first.</p><form id="pasteForm"><label class="field">Task<select name="taskId">${options([['','Let Weft suggest a task'],...store.getState().tasks.map(t=>[t.id,t.title])],group?.taskId||'')}</select></label><label class="field section-gap">Sender<input name="sender" required maxlength="200" placeholder="Maya Singh"></label><details class="section-gap"><summary>Link an existing email thread (optional)</summary><label class="field">Email thread<select name="threadId">${options([['','New email thread'],...threads],'')}</select></label></details><label class="field section-gap">Subject<input name="subject" required maxlength="180" placeholder="Catering numbers confirmed"></label><label class="field section-gap">Email text<textarea name="body" required rows="6" maxlength="12000" placeholder="Paste the new reply. Remove private details first."></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">Add to conversation</button></div></form>`);
  }
  async function copyText(text) {
    try {await navigator.clipboard.writeText(text);return true;}catch{return false;}
  }
  function copyFallback(text,title='Copy this text') {
    openDialog(title,`<p class="notice">Automatic copying is unavailable here. Select and copy the text below.</p><label class="field"><span class="sr-only">Text to copy</span><textarea rows="12" readonly>${h(text)}</textarea></label>`);
    setTimeout(()=>$('#dialog textarea')?.select(),0);
  }

  let privateEpoch=0, privateTimer;
  async function privateApi(path,body,session=ui.privateSession) {
    if(window.GatherMode?.demo&&path==='records'&&body)body={...body,revision:ui.privateRevision};
    const url=window.GatherMode?window.GatherMode.privateUrl(path):`/api/private/${path}`;
    const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Gather-CSRF':session?.csrf||''}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Could not load private details. Reload or sign in again.');
    const result=await response.json();
    if(!response.ok){if(response.status===401){ui.privateSession=null;ui.privateRecords=[];ui.privateState='locked';}const error=new Error(result.error||'Private details are unavailable.');error.status=response.status;throw error;}
    return result;
  }
  function clearPrivate() {
    privateEpoch++;clearTimeout(privateTimer);ui.privateSession=null;ui.privateRecords=[];ui.privateState='locked';
    if(ui.dialogKind==='private')closeDialog();
    if(ui.view==='details')render();
  }
  async function lockPrivate() {
    const request=ui.privateSession?privateApi('lock',{}).catch(()=>{}):Promise.resolve();clearPrivate();await request;
  }
  async function loadPrivate() {
    if(document.hidden){clearPrivate();return;}
    if(!isOrganizer()){ui.privateState='locked';render();return;}
    const ticket=++privateEpoch;
    clearTimeout(privateTimer);ui.privateState='loading';ui.privateRecords=[];render();
    try{
      const config=await privateApi('config');if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateConfigured=config.configured;
      if(ui.actor!=='jack'){ui.privateState='locked';render();return;}
      let session;try {session=await privateApi('session');}catch{session=null;}
      if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateSession=session;
      if(ui.privateSession){const result=await privateApi('records');if(ticket!==privateEpoch||ui.view!=='details')return;ui.privateRecords=result.records;ui.privateRevision=result.revision;ui.privateState='unlocked';privateTimer=setTimeout(()=>{lockPrivate();toast('Private details locked after the administrator session ended.');},Math.max(0,ui.privateSession.expiresAt-Date.now()));}
      else ui.privateState='locked';render();
    }catch(error){if(ticket!==privateEpoch)return;ui.privateRecords=[];ui.privateState='unavailable';ui.privateError=error.message;render();}
  }
  function privateView(s) {
    const heading=pageHeading('','Private bookings',window.GatherMode?.demo?'Sample bookings · fictional details only':'Organizer only',ui.privateState==='unlocked'?`<button class="btn btn-secondary" data-action="lock-private">Lock</button><button class="btn btn-primary" data-action="new-booking">${icon('plus')} Add booking</button>`:'');
    if(!isOrganizer())return heading+'<section class="panel private-panel"><h2>Organizer access required</h2><p>Booking codes are not shared with participants.</p></section>';
    if(ui.privateState==='loading')return heading+'<section class="panel private-panel"><p role="status">Checking the local private-details service…</p></section>';
    if(ui.privateState==='unavailable')return heading+`<section class="panel private-panel"><h2>Private details are not available on this preview server.</h2><p>${h(ui.privateError)}</p><p class="notice">No booking information has been loaded or saved in browser storage.</p><button class="btn btn-secondary" data-action="reload-private">Try again</button></section>`;
    if(ui.privateState!=='unlocked')return heading+`<section class="panel private-panel"><span class="eyebrow">LOCAL ADMINISTRATOR · ENCRYPTED STORAGE</span><h2>${ui.privateConfigured?'Unlock private event details':'Set up private event details'}</h2><p>A separate administrator passphrase protects this local store. Choosing Jack in the demo does not unlock it.</p>${ui.actor==='jack'?`<form id="privateLoginForm"><label class="field">${ui.privateConfigured?'Administrator passphrase':'Create a passphrase (12+ characters)'}<input type="password" name="passphrase" required minlength="12" autocomplete="${ui.privateConfigured?'current-password':'new-password'}"></label>${ui.privateConfigured?'':'<label class="field section-gap">Confirm passphrase<input type="password" name="confirm" required minlength="12" autocomplete="new-password"></label>'}<p class="warning-note">${ui.privateConfigured?'Private details are never included in shared task exports.':'Keep your passphrase somewhere safe. There is no password reset or recovery. Data is encrypted on this computer—not synced to a team account.'}</p><button class="btn btn-primary" type="submit">${ui.privateConfigured?'Unlock private details':'Create encrypted private store'}</button></form>`:'<p class="notice">Switch to Jack’s administrator preview, then sign in with the separate private-details passphrase.</p>'}</section>`;
    return heading+`<div class="notice">Signed in as the local administrator · encrypted on this computer · session expires in 15 minutes. Team login and cloud sharing are not connected. Do not store payment-card or passport details here.</div><div class="booking-grid section-gap">${ui.privateRecords.map(record=>`<article class="panel booking-card"><div class="inline"><span class="chip">${h(record.type)}</span><span class="muted">Private</span></div><h2>${h(record.title)}</h2><p>${h(record.provider)}</p><p>${h(record.traveler)}${record.date?` · ${dayLabel(record.date)}`:''}</p><div class="reference-mask">•••••••• <span>Confirmation reference</span></div><button class="btn btn-secondary" data-action="booking" data-id="${h(record.id)}">View private details ${icon('arrow')}</button></article>`).join('')||`<section class="panel private-panel">${empty('No bookings.','',`<button class="btn btn-primary" data-action="new-booking">Add first booking</button>`)}</section>`}</div>`;
  }
  function bookingDialog(id) {
    if(!ui.privateSession||ui.actor!=='jack')return toast('Unlock private details as the local administrator first.');
    const record=ui.privateRecords.find(item=>item.id===id)||{};
    openDialog(record.title||'Add a private booking',`<p class="notice">Only the authenticated local administrator can retrieve these details. They do not enter task notes, activity, email review, or workspace exports.</p><form id="bookingForm" data-id="${h(record.id||'')}"><div class="form-grid"><label class="field">Booking type<select name="type">${options(['Flight','Hotel','Transport','Venue','Other'].map(x=>[x,x]),record.type||'Flight')}</select></label><label class="field">Booking date<input type="date" name="date" value="${h(record.date||'')}"></label><label class="field full-width">Title<input name="title" required maxlength="160" placeholder="Guest speaker arrival" value="${h(record.title||'')}"></label><label class="field">Airline / hotel / provider<input name="provider" maxlength="160" value="${h(record.provider||'')}"></label><label class="field">Traveler / booked for<input name="traveler" maxlength="160" value="${h(record.traveler||'')}"></label><label class="field full-width">Confirmation reference<input id="privateReference" type="password" name="reference" required maxlength="160" autocomplete="off" value="${h(record.reference||'')}"></label><div class="inline full-width"><button type="button" class="text-button" data-action="reveal-reference">Show / hide reference</button><button type="button" class="text-button" data-action="copy-reference">Copy reference</button></div><label class="field full-width">Itinerary / private logistics notes<textarea name="details" rows="4" maxlength="2000">${h(record.details||'')}</textarea></label><label class="field full-width">Related task (optional)<select name="taskId">${options([['','Not linked'],...store.getState().tasks.map(task=>[task.id,task.title])],record.taskId||'')}</select></label></div><div class="form-actions"><button type="submit" class="btn btn-primary">Save encrypted details</button></div></form>`,'',true,'private');
    $('#bookingForm').dataset.version=record.version||'';
  }
  function responseDialog(id,preview=false) {
    const task=store.getState().tasks.find(item=>item.id===id);if(!task)return;
    openDialog(preview?'A simple participant response':'Report what is complete',`<p class="notice">${preview?'Local response preview only. This is not a shareable guest link; real guest access needs the hosted sign-in setup.':'This report records what the owner says. Tasks requiring verification stay open until Jack confirms.'}</p><h3>${h(task.title)}</h3><p>Assigned to ${h(member(task.owner).name)}</p><form id="responseForm" data-id="${h(id)}"><label class="field">Update<select name="response">${options(preview?[['accepted','I accept this task'],['blocked','I need help'],['completed','I have completed it']]:[['completed','I have completed it']],'completed')}</select></label><label class="field section-gap">What happened / what do you need?<textarea name="note" required rows="4" maxlength="3000"></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit" ${task.owner!==ui.actor?'disabled':''}>Submit as ${h(member(ui.actor).name.split(' ')[0])}</button></div>${task.owner!==ui.actor?'<p class="warning-note">Switch the demo member to this task’s owner to try their response.</p>':''}</form>`);
  }
  function contextDialog() {
    if(window.GatherAccessLost)return;
    if(window.GatherMode&&!window.GatherMode.demo&&isOrganizer()){window.top.location.href=window.GatherMode.projectUrl('/setup');return;}
    if(!isOrganizer()){
      const e=store.getState().event;
      const date=e.date?new Date(e.date+'T00:00:00Z'):null;
      const day=date&&Number.isFinite(date.getTime())?new Intl.DateTimeFormat(undefined,{dateStyle:'long',timeZone:'UTC'}).format(date):'Not set yet';
      openDialog('Event details',`<h3>${h(e.name)}</h3><dl class="task-facts"><div><dt>Event date</dt><dd>${h(day)}</dd></div><div><dt>Location</dt><dd>${h(e.location?.trim()||'Not set yet')}</dd></div></dl><p>${h(e.guestCount)} guests · ${e.outdoor?'Outdoors':'Indoors'} · ${e.transportNeeded?'Transport provided':'No organized transport'}</p>`);return;
    }
    const e=store.getState().event;
    openDialog('Event details',`<form id="contextForm"><div class="form-grid">
      <label class="field full-width">Event time zone<input name="timeZone" list="context-time-zones" required maxlength="100" placeholder="America/Los_Angeles" value="${h(e.timeZone)}"><datalist id="context-time-zones">${['UTC',...Intl.supportedValuesOf('timeZone')].map(zone=>`<option value="${h(zone)}"></option>`).join('')}</datalist></label>
      <label class="field">Venue setting<select name="outdoor">${options([['true','Outdoors'],['false','Indoors']],String(e.outdoor))}</select></label><label class="field">Organized transport<select name="transportNeeded">${options([['true','Transport needed'],['false','No organized transport']],String(e.transportNeeded))}</select></label><label class="field">Expected guests<input type="number" name="guestCount" min="0" max="100000" required value="${e.guestCount}"></label><label class="field">Dietary responses outstanding<input type="number" name="dietaryOutstanding" min="0" max="100000" required value="${e.dietaryOutstanding}"></label><label class="field">Catering cutoff<input type="date" name="cateringDeadline" value="${h(e.cateringDeadline)}"></label></div><p class="notice">Manually entered data. No RSVP sync.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Update event context</button></div></form>`);
  }
  function memoryEditDialog(id) {
    const m=store.getState().memories.find(item=>item.id===id);if(!m)return;
    openDialog('Edit lesson',`<form id="memoryEditForm" data-id="${h(id)}"><label class="field">What should we repeat or do differently?<textarea name="change" required rows="3" maxlength="3000">${h(m.change)}</textarea></label>${memoryFields(m)}<label class="field section-gap">Did the change help?<select name="outcome">${options([['untested','Not evaluated yet'],['helped','It helped'],['did-not-help','It did not help — stop suggesting']],m.outcome)}</select></label><label class="field section-gap">Outcome notes<textarea name="outcomeNote" rows="3" maxlength="2000">${h(m.outcomeNote)}</textarea></label><label class="field section-gap">Suggest in future planning<select name="active">${options([['true','Yes, when the context matches'],['false','Retire this lesson']],String(m.active))}</select></label><div class="form-actions"><button class="btn btn-primary" type="submit">Save lesson & outcome</button></div></form>`);
  }
  function memoryFields(m={}) {return `<label class="field section-gap">When does this apply?<select name="scope">${options([['always','All events'],['outdoor','Outdoor events only'],['transport','When organized transport is needed'],['same-venue','At this venue only']],m.scope||'always')}</select></label><label class="field section-gap">Context / exceptions<textarea name="context" rows="2" maxlength="2000" placeholder="Useful for arrivals above 100 people; reconsider for smaller events…">${h(m.context||'')}</textarea></label>`;}

  function rescheduleDialog() {
    if(!isOrganizer()||window.GatherAccessLost)return;
    const state=store.getState();
    if(!GatherReschedule.validDay(state.event.date))throw new Error('Set the current event date in Project settings before moving the plan.');
    openDialog('Move event plan',`<p>Current event date: <strong>${h(state.event.date)}</strong>. Choose the new date, then review which preparation deadlines and activities to move. Nothing changes until you save the review.</p><form id="rescheduleDateForm"><label class="field">New event date<input type="date" name="toDate" required></label><div class="form-actions"><button type="submit" class="btn btn-primary">Review proposed dates</button></div></form>`,'',false,'reschedule');
  }
  function navigateFromViewControl(el) {
    const view=el.dataset.view;
    if(view===ui.view&&$('#dialogBackdrop').hidden){setDrawer(false);return;}
    if(!confirmCloseDialog()||!confirmDiscard(view!==ui.view?$('#emailReviewForm'):null))return;
    if(!$('#dialogBackdrop').hidden)closeDialog();
    const fromHandoff=el.closest('#workspaceHandoff')!==null;
    recordGuideViewClick(view);
    if(navigate(view)&&fromHandoff)skipToContent();
  }
  document.addEventListener('click',async event=>{
    if(ui.pendingSave){event.preventDefault();return;}
    const el=event.target.closest('[data-action], [data-view]');
    if(!el)return;
    if(el.dataset.action==='skip-content'){event.preventDefault();skipToContent();return;}
    if(el.dataset.view){event.preventDefault();navigateFromViewControl(el);return;}
    const {action,id}=el.dataset;
    if((action==='source'||action==='select-message')&&ui.view==='inbox'&&id===ui.messageId)return;
    if(action==='task'&&ui.dialogKind==='task'&&id===ui.detailId)return;
    const replacesDialog=['close-dialog','review-completion-evidence','review-organizer-item','review-returned-completion','move-event-plan','task','delete-task','review-acceptance','review-event-acceptance','review-assignments','review-event-assignments','add-task','add-activity','schedule-task','schedule-review-activity','run-sheet','draft-guest-agenda','reuse-checklist','before-event-review','copy-schedule-day','followup','digest','demo-email','demo-reset','paste-email','report-task','participant-preview','event-context','draft-plan','edit-memory','new-booking','booking','feedback','thought-partner','event-info','invite','guide-invite','demo-info','source','select-message','task-conversation'];
    replacesDialog.push('related-checklist','notifications','return-to-event-task-review','return-to-acceptance-review','open-related-batch-child','return-to-related-batch','inspect-overlap-peer','return-to-overlap-review');
    const replacesReview=['source','select-message','select-conversation','close-briefing','task-conversation','sample-reply','ignore-message','task-filter','person-tasks','paste-email'];
    const exitsAssignment=hasAcceptanceReturnDraft()&&['task-conversation','notifications','event-context','event-info','followup','source','select-message','before-event-review','review-acceptance'].includes(action);
    const reviewForm=replacesReview.includes(action)?$('#emailReviewForm'):null;
    if(action==='close-dialog'||exitsAssignment){
      if(!confirmCloseDialog()||!confirmDiscard(reviewForm))return;
    }else if(!confirmDiscard(replacesDialog.includes(action)?$('#dialog'):null,reviewForm))return;
    const eventReviewGroup=(action==='task'||action==='review-organizer-item')&&ui.dialogKind==='before-event-review'
      ? el.closest('[data-event-review-group]')?.dataset.eventReviewGroup||'':'';
    const writes=['toggle-task','claim','confirm-delete-task','confirm-demo-reset','sample-reply','refresh-proposal','ignore-message','accept-task','resume-task','unlink-dependency','verify-task','review-completion-evidence','verification-toggle','accept-insight','dismiss-insight','record-followup'];
    const saveRoot=el.closest('#dialog')||el.closest('form')||el;
    const release=writes.includes(action)?saveLock(saveRoot):()=>{};
    try {
      if(action==='close-dialog')closeDialog();
      if(action==='return-to-event-task-review')returnToEventTaskReview();
      if(action==='return-to-acceptance-review')returnToAcceptanceReview();
      if(action==='open-related-batch-child')openRelatedBatchChild(id,el);
      if(action==='return-to-related-batch')returnToRelatedBatch();
      if(action==='inspect-overlap-peer')inspectOverlapPeer(id,el);
      if(action==='return-to-overlap-review')returnToOverlapReview();
      if(action==='wrap-review-task')openWrapReviewTask(id,el);
      if(action==='continue-task-search')continueFromTaskLinkNotice();
      if(action==='notifications')showNotifications();
      if(action==='toggle-task-reminders')toggleTaskReminders();
      if(action==='handoff-tasks')openHandoffTasks(id);
      if(action==='dismiss-handoff'&&isLiveTeammate()&&joinWelcome){
        joinWelcome=false;paintTeammateHandoff();
      }
      if(action==='review-organizer-item')openOrganizerReview(id,el.dataset.reviewKind,eventReviewGroup);
      if(action==='review-returned-completion'){
        const fromNextUp=el.dataset.nextUpOrigin==='returned'&&$('#dialogBackdrop').hidden;
        openReturnedCompletion(id);
        if(fromNextUp&&ui.dialogKind==='task'&&ui.detailId===id)ui.lastFocus=el;
      }
      if(action==='related-checklist')openRelatedBatch(id);
      if(action==='back-related-checklist')backToRelatedChecklist(el.closest('#relatedReviewForm'));
      if(action==='check-related-review')await checkRelatedReview(el.closest('#relatedReviewForm'));
      if(action==='related-ai-generate'||action==='related-ai-review')await relatedAi(action==='related-ai-generate');
      if(action==='expand-organizer-reviews'&&isOrganizer()&&!window.GatherAccessLost){
        ui.organizerReviewsExpanded=!ui.organizerReviewsExpanded;render();
      }
      if(action==='move-event-plan')rescheduleDialog();
      if(action==='add-task'||action==='guide-add-task'){newTaskDialog(guideExpectsTask());void syncGuide('add_task_clicked');}
      if(action==='guide-task-reveal'||action==='guide-task-completion')revealGuideTask(action==='guide-task-completion');
      if(action==='guide-task-links')showGuideTaskLinks(id);
      if(action==='guide-retry'){await syncGuide();if(guideViewReady===ui.view)recordLoadedGuideView(ui.view);}
      if(action==='guide-budget'||action==='guide-info'){
        if(!confirmDiscard($('#dialog'),$('#emailReviewForm')))return;
        if(!$('#dialogBackdrop').hidden)closeDialog();
        const view=action==='guide-budget'?'budget':'info';
        recordGuideViewClick(view);
        navigate(view);
      }
      if(action==='add-activity'&&isOrganizer())openDialog('Add activity',schedule.newActivity(store.getState()));
      if(action==='schedule-task'&&isOrganizer())openDialog('Schedule existing task',schedule.picker(store.getState(),id));
      if(action==='wrap-up-scope'){ui.wrapMine=id==='mine';render();}
      if(action==='reuse-checklist')reuseChecklistDialog();
      if(action==='copy-reuse-checklist')await copyReuseChecklist();
      if(action==='timeline-mode'){ui.timelineMode=id==='deadlines'?'deadlines':'schedule';render();}
      if(action==='schedule-scope'){ui.scheduleMine=id==='mine';render();}
      if(action==='jump-schedule-date'&&!window.GatherAccessLost){
        const days=schedule.activityDays(store.getState(),Date.now(),{mine:ui.scheduleMine,actor:ui.actor,date:ui.scheduleDate});
        if(Object.hasOwn(days,id)&&days[id]&&days[id]!==ui.scheduleDate){
          ui.scheduleDate=days[id];navigation.replaceScheduleDate(ui.scheduleDate);render();
          (document.getElementById(el.id)||$('#scheduleDate'))?.focus({preventScroll:true});
        }
      }
      if(action==='clear-schedule-date'&&!window.GatherAccessLost){ui.scheduleDate='';navigation.replaceScheduleDate('');render();($('#scheduleDate')||$('[data-action="timeline-mode"][data-id="schedule"]'))?.focus();}
      if(action==='draft-guest-agenda')guestAgendaDialog();
      if(action==='all-guest-agenda-activities')useAllGuestActivities();
      if(action==='copy-guest-agenda')await copyGuestAgenda();
      if(action==='copy-schedule-day'&&!window.GatherAccessLost&&window.GatherMode&&!window.GatherMode.demo){
        const link=GatherNavigation.scheduleLink(location.origin,window.GatherMode.projectId,ui.scheduleDate);
        if(link){
          const copied=await copyText(link);
          if(!window.GatherAccessLost){
            if(copied)toast('Day link copied. Recipients still need project access.');
            else if(el.isConnected&&$('#dialogBackdrop').hidden)copyFallback(link,'Copy the schedule day link');
          }
        }
      }
      if(action==='run-sheet')openRunSheet();
      if(action==='before-event-review')beforeEventReview();
      if(action==='refresh-event-review')await refreshBeforeEventReview(id);
      if(action==='refresh-activity-review')await refreshActivityReview(el);
      if(action==='schedule-review-activity'&&ui.dialogKind==='before-event-review'&&isOrganizer()&&!window.GatherAccessLost)openDialog('Review activity schedule',schedule.activityReviewForm(store.getState(),id),'<button class="btn btn-secondary" data-action="before-event-review">Back to event review</button>',false,'schedule-from-review');
      if(action==='print-run-sheet'&&currentRunSheet())window.print();
      if(action==='check-run-sheet')await checkRunSheet();
      if(action==='refresh-run-sheet')await refreshRunSheet();
      if(action==='download-run-sheet')downloadRunSheet();
      if(action==='task'){
        const requestLink=el.hasAttribute('data-open-recovery'),replyLink=el.hasAttribute('data-open-recovery-reply');
        const overlap=timelineOverlapIntent(el,id);
        const captureOrigin=(el.dataset.nextUpOrigin==='task'||requestLink||replyLink||isScheduleControl(el))&&$('#dialogBackdrop').hidden;
        const current=(requestLink||replyLink)&&store.getState().tasks.find(task=>task.id===id);
        const toRecovery=current&&current.status!=='done'&&!(current.requiresVerification&&current.reportedAt&&!current.verifiedAt)&&
          requestLink&&['date','help'].includes(GatherPriorities.pendingRequest(current)?.kind);
        const toReply=current&&replyLink&&ui.view==='tasks'&&ui.tab==='mine'&&current.owner===ui.actor&&recovery.recoveryReply(current,false);
        if(overlap)taskDialog(id,'',false,true,eventReviewGroup,undefined,el.dataset.scheduleDay||el.dataset.scheduleFocusDay);
        else taskDialog(id,'',false,captureOrigin||requestLink||replyLink,eventReviewGroup);
        if(captureOrigin&&ui.dialogKind==='task'&&ui.detailId===id)ui.lastFocus=el;
        if(toReply)focusTaskRecovery(id,'#recoveryReplyHeading');
        else if(toRecovery)focusTaskRecovery(id);
        else if(overlap)focusTaskOverlap(id,overlap);
      }
      if(action==='inspect-acceptance-task')inspectAcceptanceTask(id,el);
      if(action==='delete-task'&&isOrganizer()&&!window.GatherAccessLost&&ui.dialogKind==='task'&&ui.detailId===id){
        const task=store.getState().tasks.find(task=>task.id===id);
        if(!task)throw new Error('That task is no longer available.');
        openDialog('Delete this task?',`<p><strong>${h(task.title)}</strong> will be removed from the project and schedule along with its comments and task links. Other tasks and costs won’t be deleted.</p><p class="muted section-gap">This can’t be undone.</p>`,`<button type="button" class="btn btn-secondary" data-action="task" data-id="${h(id)}">Keep task</button><button type="button" class="btn btn-secondary danger-button" data-action="confirm-delete-task" data-id="${h(id)}" data-revision="${task.revision}">Delete task</button>`,false,'delete-task');
      }
      if(action==='confirm-delete-task'&&isOrganizer()&&!window.GatherAccessLost&&ui.dialogKind==='delete-task'&&ui.detailId===id){
        await store.deleteTask(id,Number(el.dataset.revision),ui.actor);
        if(ui.mapFocus===id)ui.mapFocus='';
        render();if(!returnToOverlapReview()&&!returnToRelatedBatch()){if(!returnToEventTaskReview())closeDialog();ui.detailId='';}
        toast('Task deleted.');
      }
      if(action==='review-task-owner'&&!window.GatherAccessLost&&isOrganizer()&&ui.dialogKind==='task'&&ui.detailId===id){
        const dialog=$('#dialog'),form=$('#taskDetailForm',dialog),owner=form?.dataset.id===id?$('select[name="owner"]',form):null,details=owner?form.closest('details'):null;
        if(details){details.open=true;focusTaskDialogControl(owner,dialog);}
      }
      if(action==='review-overlap-schedule'&&!window.GatherAccessLost&&isOrganizer()&&ui.dialogKind==='task'&&ui.detailId===id){
        const dialog=$('#dialog'),form=$('#scheduleForm',dialog),start=form?.dataset.id===id?$('input[name="start"]',form):null,details=start?form.closest('details'):null;
        if(details){details.open=true;focusTaskDialogControl(start,dialog);}
      }
      if(action==='quick-tour'){if(confirmCloseDialog()&&confirmDiscard($('#emailReviewForm'))){if(!$('#dialogBackdrop').hidden)closeDialog();tour.start();}return;}
      if(action==='task-layout'){ui.taskView=id==='map'?'map':'list';ui.mapFocus='';render();return;}
      if(action==='map-clear'){ui.mapFocus='';renderTaskRows();return;}
      if(action==='map-focus'){if(!confirmCloseDialog()||!confirmDiscard($('#emailReviewForm')))return;if(!$('#dialogBackdrop').hidden)closeDialog();ui.taskView='map';ui.mapFocus=id;ui.search='';ui.owner='';ui.status='';ui.tab='all';navigate('tasks');return;}
      if(action==='toggle-task'){const t=store.getState().tasks.find(t=>t.id===id);if(!t||!isOrganizer()||completionNeedsReview(t)){taskDialog(id);return;}store.updateTask(id,{status:t.status==='done'?'todo':'done'},ui.actor);render();if(t.status==='done')toast('Task reopened. Its history is preserved.');else window.GatherCompletionUI?.celebrate(store.getState().tasks.find(task=>task.id===id),store.getState());}
      if(action==='task-filter'){ui.tab=el.dataset.filter;ui.owner='';ui.status='';ui.search='';navigate('tasks');}
      if(action==='person-tasks'){ui.owner=id;ui.tab='all';ui.status='';ui.search='';navigate('tasks');}
      if(action==='claim'){store.claimTask(id,ui.actor);render();if(ui.dialogKind==='task')taskDialog(id);toast(`Task claimed by ${member(ui.actor).name}.`);}
      if(action==='reload-workspace')location.reload();
      if(action==='demo-email')openDialog('Demo email', '<p>This demo uses sample email updates. It does not connect to Gmail or read your mailbox.</p><p>Open Email briefing to review suggested changes.</p>', '<button class="btn btn-primary" data-view="inbox">Open email briefing</button>');
      if(action==='demo-reset'&&window.GatherMode?.demo&&isOrganizer())openDialog('Restart demo?', '<p>Reset sample tasks, email decisions, comments, feedback, and sample bookings for all four profiles. Your real project is unchanged.</p>', '<button class="btn btn-secondary" data-action="close-dialog">Cancel</button><button class="btn btn-primary" data-action="confirm-demo-reset">Restart demo</button>');
      if(action==='confirm-demo-reset'&&window.GatherMode?.demo&&isOrganizer()){el.disabled=true;try{store.resetDemo(true);clearPrivate();closeDialog();render();toast('Demo restarted. Your real project is unchanged.');}finally{if(el.isConnected)el.disabled=false;}}
      if(action==='followup')followupDialog(id);
      if(action==='digest')digestDialog();
      if(action==='copy-digest'){const text=digestText(store.getState());if(await copyText(text))toast('Current summary copied.');else copyFallback(text);}
      if(action==='copy-draft'){const text=store.getState().drafts.find(d=>d.id===id).text;if(await copyText(text))toast('Draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='source'||action==='select-message'){ui.messageId=id;if(!$('#dialogBackdrop').hidden)closeDialog();if(ui.view==='inbox')render();else navigate('inbox');}
      if(action==='select-conversation'){ui.messageId='';ui.conversationKey=id;render();}
      if(action==='close-briefing'){ui.messageId='';ui.conversationKey='';render();}
      if(action==='task-conversation'){ui.messageId='';ui.conversationKey='task:'+id;closeDialog();navigate('inbox');}
      if(action==='refresh-inbox')await refreshInbox(true);
      if(action==='paste-email')pasteDialog();
      if(action==='sample-reply'){const confirmed=el.dataset.step==='confirmed';const m=store.addMessage({sender:'Jules Miller',subject:'Re: Northstar buses for Field Day',threadId:'thread-bus',externalId:`gather-sample-bus-${confirmed?'confirmed':'deposit'}`,body:confirmed?'Payment received. Booking confirmed. Both buses are booked for Field Day. — Jules':'The buses are reserved, but we still need the deposit. I cannot confirm the booking until Jack approves payment. — Jules'},ui.actor);ui.messageId=m.id;render();toast('Sample reply added. No task changed until you review.');}
      if(action==='refresh-proposal'){
        if(ui.savingProposal)return;
        const taskId=$('#emailTask')?.value;ui.savingProposal=true;
        try{if(store.refresh)await store.refresh(()=>true);const latest=store.getState().messages.find(message=>message.id===id);if(!latest||latest.appliedTaskId||latest.ignoredAt){render();toast('Showing the latest saved decision.');}else{store.refreshProposal(id,taskId);ui.reviewDirty=false;render();toast('Comparison refreshed. Review the current values before applying.');}}
        catch(error){render();throw error;}
        finally{ui.savingProposal=false;}
      }
      if(action==='ignore-message'){store.ignoreMessage(id,ui.actor);ui.messageId='';render();toast('Set aside. The plan was not changed.');}
      if(action==='accept-task'){store.acceptTask(id,ui.actor);render();taskDialog(id);toast('Responsibility accepted.');}
      if(action==='review-acceptance'&&!window.GatherAccessLost)acceptanceDialog();
      if(action==='review-event-acceptance'&&ui.dialogKind==='before-event-review')acceptanceDialog(true);
      if(action==='review-assignments')assignmentDialog();
      if(action==='review-event-assignments'&&ui.dialogKind==='before-event-review'&&['unassigned','owner-unavailable'].includes(id))assignmentDialog(id);
      if(action==='assignment-select'){
        const form=$('#assignTasksForm');
        if(form){$$('input[name="assignTask"]',form).forEach(input=>input.checked=id==='all');syncAssignmentSelection(form);}
      }
      if(action==='acceptance-select'){
        const form=$('#acceptTasksForm');
        if(form){$$('input[name="acceptTask"]',form).forEach(input=>input.checked=id==='all');syncAcceptanceSelection(form);}
      }
      if(action==='report-task')responseDialog(id);
      if(action==='prepare-completion')recovery.prepareCompletion(el.closest('#responseForm'));
      if(action==='prepare-revised-completion')prepareRevisedCompletion(id);
      if(action==='resume-task'){el.disabled=true;try{store.resumeTask(id,ui.actor);render();taskDialog(id);toast('Task resumed.');}finally{if(el.isConnected)el.disabled=false;}}
      if(action==='unlink-dependency'){store.removeDependency(id,el.dataset.prerequisite,ui.actor);render();taskDialog(id);toast('Link removed. The follow-up task is unchanged.');}
      if(action==='participant-preview')responseDialog(id,true);
      if(action==='verify-task'){store.verifyTask(id,ui.actor);render();taskDialog(id);window.GatherCompletionUI?.celebrate(store.getState().tasks.find(task=>task.id===id),store.getState());}
      if(action==='review-completion-evidence'){if(!isOrganizer()||window.GatherAccessLost)return;store.reviewCompletionEvidence(id,Number(el.dataset.revision),ui.actor);render();taskDialog(id,'',true);toast('Amendment review recorded. Original task verification is unchanged.');}
      if(action==='verification-toggle'){const task=store.getState().tasks.find(t=>t.id===id);store.updateTask(id,{requiresVerification:!task.requiresVerification},ui.actor);render();taskDialog(id);}
      if(action==='event-context')contextDialog();
      if(action==='draft-plan'&&isOrganizer()&&window.GatherMode){window.top.location.href=window.GatherMode.demo?'/plan?demo=1&as=jack':window.GatherMode.projectUrl('/plan');return;}
      if(action==='ai-suggestions'&&isOrganizer()&&window.GatherMode){if(ui.view!=='overview'&&navigate('overview')===false)return;if(!$('#dialogBackdrop').hidden)closeDialog();planSidebar.open();return;}
      if(action==='ai-task-assistant'){toast('Ask Weft is coming soon.');return;}
      if(action==='task-breakdown'){
        toast('Ask Weft is coming soon.');return;
      }
      if(action==='hide-ai-review'){planSidebar.hide();return;}
      if(action==='edit-memory')memoryEditDialog(id);
      if(action==='reload-private')loadPrivate();
      if(action==='lock-private'){await lockPrivate();toast('Private details locked.');}
      if(action==='new-booking')bookingDialog();
      if(action==='booking')bookingDialog(id);
      if(action==='reveal-reference'){const input=$('#privateReference');if(input)input.type=input.type==='password'?'text':'password';}
      if(action==='copy-reference'){const input=$('#privateReference');if(input){if(await copyText(input.value))toast('Reference copied. Clear your clipboard after use.');else {input.type='text';input.select();toast('Select and copy the reference manually.');}}}
      if(action==='record-followup'){
        const draft=$('#followupForm');
        if(draft){const text=draft.elements.text.value.trim();if(!text)throw new Error('Add your follow-up text before recording it.');store.saveDraft(id,text,ui.actor);render();}
        openDialog('Record your follow-up',`<p class="notice">Your draft is saved. Confirm only after you have sent it yourself. Weft does not send it.</p><form id="recordFollowupForm" data-id="${h(id)}"><label class="field">Check again on<input name="afterDate" type="date" required min="${dateKey()}"></label><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="followup" data-id="${h(id)}">Back to draft</button><button class="btn btn-primary" type="submit">I sent it · record checkpoint</button></div></form>`);
      }
      if(action==='feedback')feedbackDialog();
      if(action==='thought-partner')thoughtDialog();
      if(action==='accept-insight'){const task=store.acceptSuggestion(id,ui.actor);render();if(ui.dialogKind==='thought')thoughtDialog();toast(task?`Added to plan: ${task.title}`:'This check is already covered by the plan.');}
      if(action==='dismiss-insight'){store.dismissSuggestion(id);render();if(ui.dialogKind==='thought')thoughtDialog();toast('Suggestion dismissed for this plan.');}
      if(action==='event-info')contextDialog();
      if(action==='guide-invite'&&guidedWorkspace){
        await syncGuide('invite_clicked');
        window.top.location.href=window.GatherMode.projectUrl('/team?guide=1');return;
      }
      if(action==='guide-skip-invite'&&guidedWorkspace){
        if(!confirmDiscard($('#dialog'),$('#emailReviewForm')))return;
        await syncGuide('invite_skipped');
        return;
      }
      if(action==='invite'){if(window.GatherMode&&!window.GatherMode.demo){window.top.location.href=window.GatherMode.projectUrl('/team');return;}const text=`Event plan: ${store.getState().event.name}.\n\nHere is the plan: [add your shared workspace link]`;openDialog('Invitation draft',`<p class="notice">Demo invitation only. No invite or email will be sent.</p><label class="field">Invitation message<textarea id="inviteDraft" rows="7">${h(text)}</textarea></label>`,`<button class="btn btn-primary" data-action="copy-invite">${icon('copy')} Copy invitation draft</button>`);}
      if(action==='copy-invite'){const text=$('#inviteDraft').value;if(await copyText(text))toast('Invitation draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='demo-info')openDialog('Your local Weft workspace',`<p>Try the full journey: review an email, assign the work, post an update, and mark it complete.</p><p>Switch the demo member in the top bar to try a teammate’s perspective. Every update records who made it.</p><div class="notice">Tasks, comments, messages, and feedback are saved in this browser. This prototype does not connect to live email, send messages, sync between people, or call an AI service.</div>`,`<button class="btn btn-secondary" data-action="export">Export workspace backup</button>`);
      if(action==='export'){const blob=new Blob([store.exportState()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='weft-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Workspace backup downloaded.');}
    }catch(error){if(error.status===409)showPendingUpdate();const errorForm=saveRoot.matches('form')?saveRoot:el.closest('form');if(errorForm)formError(errorForm,error);toast(error.message||'Please try again.');}
    finally{release();}
  });

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form.id)return;
    event.preventDefault();
    if(form.id==='guestAgendaForm')return;
    if(ui.pendingSave||form.dataset.saving==='true')return;
    if(form.id==='relatedReviewForm'&&form.dataset.saveUnconfirmed)return;
    if(form.id==='relatedChecklistForm'){
      $('.form-error',form)?.remove();
      try{reviewRelatedBatch(form);}catch(error){formError(form,error);}
      return;
    }
    if(form.id==='scheduleDateForm'){
      const input=form.elements.namedItem('scheduleDate');
      if(!window.GatherAccessLost&&input.validity.valid&&input.value&&input.value!==ui.scheduleDate){
        ui.scheduleDate=input.value;navigation.replaceScheduleDate(ui.scheduleDate);render();
        $('#scheduleDate')?.focus();
      }
      return;
    }
    const data=Object.fromEntries(new FormData(form));
    const isSubmission=form.id==='completionEvidenceForm'||form.id==='responseForm'&&(event.submitter?.value||data.response)==='completed';
    // Snapshot before saveLock disables fields. Choosing a file never uploads it.
    const submission=isSubmission?window.GatherCompletionUI.collect(form,form.id==='responseForm'?data.note:undefined):null;
    const submissionFile=isSubmission?form.elements.completionUpload?.files?.[0]:null;
    if(form.id==='rescheduleReviewForm')data.tasks=$$('[data-reschedule-row]',form).map(row=>({id:row.dataset.rescheduleRow,revision:Number(row.dataset.revision),moveDue:!!$('[data-move-due]',row)?.checked,moveSchedule:!!$('[data-move-schedule]',row)?.checked})).filter(row=>row.moveDue||row.moveSchedule);
    if(form.id==='acceptTasksForm')data.selections=$$('input[name="acceptTask"]:checked',form).map(input=>({id:input.value,revision:Number(input.dataset.revision)}));
    if(form.id==='assignTasksForm')data.tasks=$$('input[name="assignTask"]:checked',form).map(input=>({id:input.value,revision:Number(input.dataset.revision)}));
    if(form.id==='relatedReviewForm')data.items=$$('[data-related-row]',form).filter(row=>$('[data-related-include]',row).checked)
      .map(row=>({title:$('[data-related-title]',row).value,scope:$('[data-related-scope]',row).value}));
    $('.form-error',form)?.remove();
    const release=saveLock(form.closest('#dialog')||form,event.submitter);
    try {
      if(form.id==='rescheduleDateForm'){
        const state=store.getState(),plan=GatherReschedule.preview(state,data.toDate);
        openDialog('Review event date changes',GatherReschedule.reviewMarkup(state,plan,h),'',true,'reschedule');
        $('#rescheduleReviewForm').dataset.zone=state.event.timeZone;
      }
      if(form.id==='rescheduleReviewForm'){
        if(!isOrganizer()||window.GatherAccessLost||form.dataset.actor!==ui.actor)throw new Error('Your account changed. Reopen the date review.');
        if(data.confirmed!=='on')throw new Error('Confirm that you reviewed the selected changes.');
        const result=store.rescheduleEvent({fromDate:form.dataset.from,toDate:form.dataset.to,timeZone:form.dataset.zone,tasks:data.tasks},ui.actor);
        closeDialog();render();toast(`Event date moved. ${result.changedTaskCount} tasks have reviewed date changes; progress is unchanged.`);
      }
      if(form.id==='assignTasksForm'){
        if(!isOrganizer()||window.GatherAccessLost||form.dataset.actor!==ui.actor)throw new Error('Your account changed. Reopen task assignment.');
        if(data.confirmed!=='on')throw new Error('Confirm that you reviewed the owner changes.');
        const result=store.assignTasks({owner:data.owner,tasks:data.tasks},ui.actor);
        if(form.dataset.returnTo==='event-review'){render();beforeEventReview();}
        else{closeDialog();render();}
        toast(`${result.changedTaskCount} ${result.changedTaskCount===1?'task assigned':'tasks assigned'}. New owners still need to accept; progress is unchanged.`);
      }
      if(form.id==='acceptTasksForm'){
        if(window.GatherAccessLost||form.dataset.actor!==ui.actor)throw new Error('Your account changed. Reopen task acceptance.');
        store.acceptTasks(data.selections,ui.actor);
        if(form.dataset.returnTo==='event-review'){render();beforeEventReview();}
        else{closeDialog();render();focusAfterAcceptance();}
        toast(`Responsibility accepted for ${data.selections.length} ${data.selections.length===1?'task':'tasks'}. Completion is unchanged.`);
      }
      if(form.id==='newTaskForm'){
        const activity=form.dataset.scheduled==='true';
        const firstTask=form.dataset.guideTask==='true'&&guidedWorkspace;
        const taskData=activity?GatherScheduleUI.newActivityTask(data):data;
        const task=store.addTask(taskData,ui.actor);closeDialog();
        if(firstTask){guideTaskId=task.id;paintGuide();release();revealGuideTask();}
        else render();
        if(activity&&task.schedule)taskDialog(task.id);
        toast(activity?(task.schedule?'Activity added.':'Activity added. Set its start time in Timeline.'): 'Task added.');
        void syncGuide();
      }
      if(form.id==='scheduleForm'||form.id==='schedulePickerForm'){
        const taskId=form.dataset.id||data.taskId;
        const before=store.getState().tasks.find(task=>task.id===taskId),remove=event.submitter?.value==='remove';
        const saved=store.setTaskSchedule(taskId,remove?null:{start:data.start,end:data.end,location:data.location},ui.actor);
        const reconfirm=(before?.acceptedAt||before?.nextUpAt)&&saved&&!saved.acceptedAt&&!saved.nextUpAt;
        render();taskDialog(taskId,form.id);toast((remove?'Removed from schedule. The task was kept.':'Schedule saved.')+(reconfirm?' The owner needs to accept again.':''));
      }
      if(form.id==='reviewScheduleForm'){
        if(ui.dialogKind!=='schedule-from-review'||!isOrganizer()||window.GatherAccessLost)throw new Error('Reopen the event review as the organizer.');
        const task=store.getState().tasks.find(item=>item.id===form.dataset.id);
        if(!task||task.revision!==Number(form.dataset.revision))throw new Error('This activity changed. Reopen the event review before saving.');
        const saved=store.setTaskSchedule(task.id,{start:data.start,end:data.end,location:data.location},ui.actor);
        const reconfirm=(task.acceptedAt||task.nextUpAt)&&saved&&!saved.acceptedAt&&!saved.nextUpAt;
        render();beforeEventReview();toast('Schedule saved. Event review updated.'+(reconfirm?' The owner needs to accept again.':''));
      }
      if(form.id==='taskDetailForm'){
        const before=store.getState().tasks.find(task=>task.id===form.dataset.id);
        if(!confirmFixedDate(form.dataset.id,data)||!confirmTaskOwnerChange(before,data))return;
        store.updateTask(form.dataset.id,data,ui.actor);
        const after=store.getState().tasks.find(task=>task.id===form.dataset.id),keepDrafts=taskDrafts(form.id).length>0;
        render();if(keepDrafts||(ui.overlapComparison&&activeOverlapComparison()))taskDialog(form.dataset.id,form.id);else if(!returnToRelatedBatch()&&!returnToEventTaskReview())closeDialog();
        if(before.status!=='done'&&after.status==='done')window.GatherCompletionUI?.celebrate(after,store.getState());
        else toast(`Update recorded by ${member(ui.actor).name}.`);
      }
      if(form.id==='completionEvidenceForm'){const details=await window.GatherCompletionUI.prepare(form,submission,submissionFile);store.setCompletionEvidence(form.dataset.id,details,ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Submission saved. Task status and verification are unchanged.');}
      if(form.id==='returnCompletionForm'){store.returnCompletion(form.dataset.id,data.note,ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Changes requested. The task is still incomplete.');}
      if(form.id==='priorityForm'){store.setTaskPriority(form.dataset.id,{priority:data.priority,essential:data.essential==='on',hardDeadline:data.hardDeadline==='on'},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Priority saved.');}
      if(form.id==='taskOutcomeForm'){store.setTaskOutcome(form.dataset.id,data.scope,ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Outcome saved. Changed outcomes require the owner to reconfirm.');}
      if(form.id==='nextUpForm'){
        const id=form.dataset.id,enabled=data.enabled==='true',actor=ui.actor;
        const before=store.getState().tasks.find(task=>task.id===id);
        store.setNextUp(id,{enabled,replaceTaskId:data.replaceTaskId||''},actor);
        render();taskDialog(id,form.id);
        requestAnimationFrame(()=>{
          if(window.GatherAccessLost||ui.actor!==actor||ui.dialogKind!=='task'||ui.detailId!==id||$('#dialogBackdrop').hidden)return;
          $('#nextUpTaskState',$('#dialog'))?.focus();
        });
        toast(enabled?(data.replaceTaskId?'Task swapped into Next up.':'Task added to Next up.')+
          (before&&!before.acceptedAt?' Responsibility accepted.':''):'Removed from Next up. You still own this task.');
      }
      if(form.id==='recoveryDecisionForm'){
        const id=form.dataset.id;
        if(workspaceUpdatesPending()){
          showPendingUpdate();
          throw new Error('Refresh the project before confirming this decision. Your draft is unchanged.');
        }
        store.resolveRecovery(id,{...data,confirmHardDeadline:data.confirmHardDeadline==='on'},ui.actor);
        render();taskDialog(id,form.id);
        if(data.requestId)focusTaskRecovery(id,'#recoveryReplyHeading');
        toast(data.requestId?'Organizer response saved to the task.':'Plan agreed. The owner can see your decision.');
      }
      if(form.id==='commentForm'){store.addComment(form.dataset.id,data.text,ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Comment posted.');}
      if(form.id.startsWith('handoffForm-')){const action=event.submitter?.value==='dismiss'?'dismiss':data.mode;const request=action==='dismiss'?{action}:action==='link'?{action,taskId:data.taskId}:{action,title:data.title,owner:data.owner};store.resolveHandoff(form.dataset.id,form.dataset.suggestion,request,ui.actor);render();taskDialog(form.dataset.id,form.id);toast(action==='dismiss'?'Suggestion dismissed.':action==='link'?'Task linked.':'Follow-up created and linked.');}
      if(form.id==='emailReviewForm'){
        if(ui.savingProposal)return;
        if(data.mode==='update'){
          const task=store.getState().tasks.find(item=>item.id===data.taskId);
          if(!confirmFixedDate(data.taskId,data)||!confirmTaskOwnerChange(task,data))return;
        }
        ui.savingProposal=true;const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Saving…';
        try{const task=store.applyMessage(form.dataset.id,data,ui.actor);render();toast(`Applied to “${task.title}”. Original email preserved.`);}
        finally{ui.savingProposal=false;}
      }
      if(form.id==='pasteForm'){const m=store.addMessage(data,ui.actor);ui.messageId=m.id;closeDialog();release();navigate('inbox');toast('Message saved. Review its next step before applying.');}
      if(form.id==='feedbackForm'){const lesson=store.addMemory({...data,rating:Number(data.rating)},ui.actor);if(!finishWrapUpLesson(lesson?.id)&&!window.GatherAccessLost)thoughtDialog();toast('Lesson saved.');}
      if(form.id==='followupForm'){const text=data.text.trim();store.saveDraft(form.dataset.id,text,ui.actor);const copied=await copyText(text);closeDialog();render();if(copied)toast('Draft saved and copied. Nothing sent.');else {toast('Draft saved in Team updates.');copyFallback(text,'Your saved follow-up draft');}}
      if(form.id==='dependencyForm'){store.addDependency(form.dataset.id,{...(data.existingTask?{taskId:data.existingTask}:{title:data.newTitle}),additional:data.additional==='on'},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Follow-up saved.');}
      if(form.classList.contains('relationship-form')){store.setDependencyKind(form.dataset.id,{taskId:form.dataset.prerequisite,kind:data.kind,reason:data.reason},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Relationship updated. Task status is unchanged.');}
      if(form.id==='relationshipAddForm'){store.addDependency(form.dataset.id,{taskId:data.taskId,kind:data.kind,reason:data.reason},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Tasks linked. Task status is unchanged.');}
      if(form.id==='linkedTaskForm'){store.addLinkedTask(form.dataset.id,{title:data.title,note:data.note,scope:data.scope,owner:data.owner,kind:data.kind,reason:data.reason},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('New task created and linked. Review its owner and dates before starting.');}
      if(form.id==='relatedReviewForm')await saveRelatedReview(form,data.items);
      if(form.id==='responseForm'){
        const id=form.dataset.id,response=event.submitter?.value||data.response,isRequest=response==='date'||response==='help';
        if(!String(data.note||'').trim())throw new Error('Add a short note so the team knows what happened.');
        if(response==='accepted'){store.acceptTask(id,ui.actor);store.addComment(id,data.note,ui.actor);}
        else if(response==='blocked'||response==='progress')store.updateTask(id,{status:response,note:data.note},ui.actor);
        else if(response==='completed'){const details=await window.GatherCompletionUI.prepare(form,submission,submissionFile);store.reportCompletion(id,details,ui.actor);}
        else if(isRequest)store.requestRecovery(id,{kind:response,note:data.note,proposedDate:data.proposedDate||''},ui.actor);
        else throw new Error('Choose Report complete, Report blocked, or Share progress.');
        render();taskDialog(id,form.id);
        const task=store.getState().tasks.find(task=>task.id===id),hasSuggestions=(task?.handoffs||[]).some(item=>item.status==='pending');
        if(response==='completed')window.GatherCompletionUI?.celebrate(task,store.getState());
        else if(isRequest){focusTaskRecovery(id);toast('Request saved for organizer review.');}
        else toast(hasSuggestions?'Update saved. Review the suggested follow-ups.':response==='blocked'?'Blocker saved. Review the linked work.':response==='progress'?'Progress saved.':'Report saved.');
      }
      if(form.id==='contextForm'){
        const state=store.getState();
        if(data.timeZone!==state.event.timeZone&&state.tasks.some(task=>task.schedule)){
          if(!window.confirm('Change the event time zone? Existing activity dates and clock times will stay the same in the new zone.'))return;
          data.confirmScheduleTimeZone=true;
        }
        store.updateEvent(data,ui.actor);closeDialog();render();toast('Event details saved.');
      }
      if(form.id==='memoryEditForm'){store.updateMemory(form.dataset.id,data,ui.actor);finishWrapUpLesson(form.dataset.id);toast('Lesson updated.');}
      if(form.id==='recordFollowupForm'){store.recordFollowup(form.dataset.id,data.afterDate,ui.actor);closeDialog();render();toast('Follow-up recorded.');}
      if(form.id==='privateLoginForm'){
        if(!ui.privateConfigured&&data.passphrase!==data.confirm)throw new Error('The passphrases do not match.');
        const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Unlocking…';
        const ticket=privateEpoch;
        try{const session=await privateApi(ui.privateConfigured?'unlock':'setup',{passphrase:data.passphrase});form.reset();if(ticket!==privateEpoch||ui.actor!=='jack'||document.hidden||ui.view!=='details'){await privateApi('lock',{},session).catch(()=>{});clearPrivate();return;}ui.privateSession=session;await loadPrivate();toast('Private details unlocked for the local administrator.');}finally{if(button.isConnected){button.disabled=false;button.textContent='Unlock private details';}}
      }
      if(form.id==='bookingForm'){
        const button=$('button[type="submit"]',form);button.disabled=true;
        const ticket=privateEpoch;
        try{await privateApi('records',{...data,id:form.dataset.id,version:form.dataset.version});if(ticket!==privateEpoch||document.hidden||ui.view!=='details')return;form.reset();closeDialog();await loadPrivate();toast('Encrypted booking saved. Shared tasks and exports are unchanged.');}finally{if(button.isConnected)button.disabled=false;}
      }
    }catch(error){if(error.status===409){if(form.id==='recoveryDecisionForm'||((form.id==='scheduleForm'||form.id==='taskDetailForm')&&ui.dialogKind==='task'&&ui.detailId===form.dataset.id))showRecoveryWriteConflict();else showPendingUpdate();}if(isSubmission&&form.dataset.completionUploaded==='true')error.message+=' Your file is saved in Event info, but this submission was not confirmed. Retry with the same file to avoid uploading it twice.';formError(form,error);toast(error.message||'Please check the form and try again.');}
    finally{release();if(form.id==='relatedReviewForm')paintRelatedSaveState(form);if(form.id==='emailReviewForm'&&form.isConnected)updateChangePreview();}
  });

  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.name==='mode'&&el.closest('.handoff-form'))syncHandoffForm(el.closest('form'));
    if(ui.pendingSave)return;
    if(el.closest('#guestAgendaForm'))syncGuestAgenda(el.closest('#guestAgendaForm'));
    if(el.matches('[data-reuse-choice]'))syncReuseChecklist();
    if(el.closest('#acceptTasksForm'))syncAcceptanceSelection(el.closest('form'));
    if(el.closest('#assignTasksForm'))syncAssignmentSelection(el.closest('form'));
    if(el.closest('#responseForm')?.querySelector('[data-proposed-date]'))recovery.syncResponse(el.closest('form'));
    if(el.closest('#recoveryDecisionForm'))recovery.syncDecision(el.closest('form'));
    if(el.name==='owner'&&el.closest('form')?.querySelector('[data-owner-load]'))el.closest('form').querySelector('[data-owner-load]').innerHTML=recovery.ownerLoad(el.value);
    if(el.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(el.id==='actorSelect'){if(window.GatherMode?.demo){window.top.location.href='/demo?as='+encodeURIComponent(el.value);return;}lockPrivate();ui.actor=el.value;render();toast(`Now trying ${member(ui.actor).name.split(' ')[0]}’s perspective. Private details locked.`);}
    if(el.id==='ownerFilter'){ui.owner=el.value;renderTaskRows();}
    if(el.id==='statusFilter'){ui.status=el.value;renderTaskRows();}
    if(el.id==='emailMode'){
      const update=el.value==='update';
      $('#existingTaskField').hidden=!update;
      $('#emailTask').required=update;
      if(update)$('#emailTask').value='';
      $('#emailTask').dataset.previousValue=$('#emailTask').value;
      updateChangePreview();
    }
    if(el.id==='emailTask'){
      const form=$('#emailReviewForm');if(el.value&&form){if(hasUnsavedFields(form,['taskId','mode'])&&!window.confirm('Changing the task replaces your proposed edits. Continue?')){el.value=el.dataset.previousValue||'';updateChangePreview();return;}const target=el.value;const release=saveLock(form);ui.savingProposal=true;try{store.refreshProposal(form.dataset.id,target);if(form.isConnected){ui.reviewDirty=false;render();}}catch(error){formError(form,error);toast(error.message);}finally{ui.savingProposal=false;release();if(form.isConnected)updateChangePreview();}}if(el.isConnected)el.dataset.previousValue=el.value;
    }
  });
  function renderTaskRows() {
    const s=store.getState(),tasks=filteredTasks(s);
    const acceptance=$('[data-action="review-acceptance"]');
    if(acceptance){const count=acceptanceCandidates(tasks).length;acceptance.hidden=!count;acceptance.textContent=`Review task acceptance (${count})`;}
    $('#taskRows').innerHTML=tasks.map(taskRow).join('');
    $('#taskEmpty').hidden=!!tasks.length;
    $('#taskResultCount').textContent=`${tasks.length} ${tasks.length===1?'task':'tasks'}`;
    if(ui.taskView==='map')$('#taskMap').innerHTML=GatherPlanningUI.graphMarkup(s.tasks,tasks,ui.mapFocus,s.members);
  }
  document.addEventListener('input',event=>{
    if(event.target.id==='reuseChecklistSearch')filterReuseChecklist();
    if(event.target.matches('[data-reuse-title]'))syncReuseChecklist();
    if(event.target.closest('#guestAgendaForm'))syncGuestAgenda(event.target.closest('#guestAgendaForm'));
    if(event.target.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(event.target.id==='taskSearch'){
      ui.search=event.target.value;
      ui.mapFocus='';
      renderTaskRows();
    }
  });
  $('#dialogBackdrop').addEventListener('click',event=>{if(!ui.pendingSave&&event.target===$('#dialogBackdrop')&&confirmCloseDialog())closeDialog();});
  document.addEventListener('copy',guardGuestAgendaPreviewCopy);
  window.addEventListener('offline',resetGuestAgendaManualCopy);
  window.addEventListener('online',resetGuestAgendaManualCopy);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)resetGuestAgendaManualCopy();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!ui.pendingSave){if(!$('#dialogBackdrop').hidden){if(confirmCloseDialog())closeDialog();}else setDrawer(false);}
    const scope=!$('#dialogBackdrop').hidden?$('#dialog'):matchMedia('(max-width:800px)').matches&&$('#sidebar').classList.contains('open')?$('#sidebar'):null;
    if(event.key==='Tab'&&scope){
      const controls=focusable(scope);
      const first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();scope.focus();return;}
      const atDialogHeading=scope.id==='dialog'&&document.activeElement===$('#dialogTitle',scope);
      if(atDialogHeading||document.activeElement===scope||!scope.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('#mobileMenu').addEventListener('click',()=>setDrawer(!$('#sidebar').classList.contains('open')));
  $('#mobileOverlay').addEventListener('click',()=>setDrawer(false));
  matchMedia('(max-width:800px)').addEventListener('change',()=>setDrawer(false));
  const routeChanged=view=>{
    if(ui.pendingSave){navigation.replace(ui.view);return;}
    if(view===ui.view)return;
    if(!confirmCloseDialog()||!confirmDiscard($('#emailReviewForm'))){navigation.replace(ui.view);return;}
    if(!$('#dialogBackdrop').hidden)closeDialog();
    navigate(view);
  };
  let unsubscribeNavigation=navigation.subscribe(routeChanged);
  window.addEventListener('pagehide',()=>{unsubscribeNavigation();});
  window.addEventListener('pageshow',event=>{if(event.persisted){unsubscribeNavigation=navigation.subscribe(routeChanged);routeChanged(navigation.initial());}});
  window.addEventListener('beforeunload',event=>{if(window.GatherAccessLost)return;if(ui.pendingSave||hasAcceptanceReturnDraft()||unsavedDialog()||unsavedReview()||planSidebar.unsaved()||agentPopup.unsaved()){event.preventDefault();event.returnValue='';}});
  let attentionDay=dateKey();
  function refreshScheduleClock() {
    if(window.GatherAccessLost||document.hidden||ui.pendingSave||ui.view!=='timeline'||ui.timelineMode==='deadlines'||!$('#dialogBackdrop').hidden)return;
    const target=$('[data-schedule-clock]');if(!target)return;
    const live=schedule.clock(store.getState(),Date.now(),{mine:ui.scheduleMine,actor:ui.actor,date:ui.scheduleDate},isOrganizer());
    // The timetable stays put; follow keyboard focus to the same activity when
    // it moves from Next to Now, or from the focus strip into the full timetable.
    const active=target.contains(document.activeElement)?document.activeElement:null;
    const template=document.createElement('template');template.innerHTML=live.markup;
    if(target.innerHTML!==template.innerHTML){
      target.replaceChildren(template.content);
      if(active&&document.activeElement===document.body)restoreScheduleFocus(active,$('.schedule-panel'));
    }
    $$('[data-schedule-phase]').forEach(node=>{
      const id=node.dataset.schedulePhase;
      const label=live.rowDays.get(id)===node.dataset.schedulePhaseDay?live.labels.get(id)||'':'';
      if(node.textContent!==label)node.textContent=label;
      node.hidden=!label;
    });
  }
  function refreshAttentionDate() {
    refreshScheduleClock();
    if(window.GatherAccessLost||document.hidden||ui.pendingSave)return;
    const today=dateKey();
    if(attentionDay===today)return;
    if(ui.dialogKind==='notifications')paintNotifications(store.getState(),today);
    if(!$('#dialogBackdrop').hidden||unsavedReview())return;
    attentionDay=today;render();
  }
  window.addEventListener('storage',event=>{
    const key=window.WeftNotifications?.preferenceKey(reminderScope());
    if(key&&(event.key===key||event.key===null))paintNotifications();
  });
  setInterval(refreshAttentionDate,60000);
  window.addEventListener('focus',refreshAttentionDate);
  window.addEventListener('beforeprint',()=>{if(ui.dialogKind==='run-sheet')currentRunSheet();});
  window.addEventListener('pageshow',refreshAttentionDate);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lockPrivate();else refreshAttentionDate();});
  if(window.GatherMode&&!isOrganizer())ui.tab='mine';
  const tour=GatherPlanningUI.createTour({navigate:view=>{if(ui.pendingSave||!confirmDiscard($('#dialog'),$('#emailReviewForm')))return false;if(!$('#dialogBackdrop').hidden)closeDialog();return ui.view===view||navigate(view)!==false;},isOrganizer,storageKey:'weft-quick-tour-v1:'+(window.GatherMode?.projectId||'local')+':'+ui.actor});
  setDrawer(false);
  ui.scheduleDate=navigation.initialScheduleDate();
  const {id:initialTask,review:initialTaskReview}=navigation.takeInitialTaskLink();
  const welcomeHint=navigation.takeJoinWelcome();
  if(initialTask){
    ui.tab='all';
    taskLinkUnavailable=!store.getState().tasks.some(task=>task.id===initialTask);
  }
  joinWelcome=welcomeHint&&!initialTask&&navigation.initial()==='overview'&&isLiveTeammate();
  navigate(initialTask?'tasks':navigation.initial());
  if(joinWelcome)$('#workspaceHandoffTitle')?.focus({preventScroll:true});
  void syncGuide();
  window.dispatchEvent(new Event('gather-workspace-ready'));
  if(window.GatherMode&&store.refresh)bindWorkspaceRefresh();
  if(initialTask&&!window.GatherAccessLost){
    if(taskLinkUnavailable){
      const title=$('#taskLinkUnavailableTitle');
      title?.focus({preventScroll:true});
      title?.scrollIntoView({block:'center',behavior:'instant'});
    }else{
      const opener=$('#viewRoot').querySelector(`.task-name-button[data-id="${initialTask}"]`);
      // Closing the dialog restores focus without scrolling. Reveal the row
      // first so keyboard users can see where focus will return.
      opener?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      opener?.focus({preventScroll:true});
      if(!(initialTaskReview&&window.GatherMode&&!window.GatherMode.demo&&isOrganizer()&&openOrganizerReview(initialTask,initialTaskReview,'',true)))
        taskDialog(initialTask,'',false,true);
    }
  }
  if((!window.GatherMode||window.GatherMode.demo)&&ui.view==='overview'&&$('#dialogBackdrop').hidden)tour.offer();
})();
