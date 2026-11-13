(async function () {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const actor = params.get('as') || 'jack';
  const projectId = params.get('project') ?? 'main';
  const projectUrl = path => { const url=new URL(path,location.origin);url.searchParams.set('project',projectId);return url.pathname+url.search+url.hash; };
  const endpoint = demo ? '/api/demo?as=' + encodeURIComponent(actor) : projectUrl('/api/workspace');
  const signIn = () => {
    const source=new URLSearchParams(location.search);
    const query=new URLSearchParams(demo?{as:actor}:{});
    const day=window.GatherNavigation?.scheduleDateFrom?.(source);
    const task=window.GatherNavigation?.taskLinkFrom?.(source);
    const activity=window.GatherNavigation?.activityLinkFrom?.(source);
    if(!demo&&day)query.set('day',day);
    if(!demo&&source.get('guide')==='1')query.set('guide','1');
    if(task?.id)query.set('task',task.id);
    if(!demo&&task?.review)query.set('review',task.review);
    if(!demo&&task?.fromPlanReceipt)query.set('from','plan-receipt');
    if(!demo&&activity)query.set('activity',activity);
    const path=(demo?'/demo':'/project')+'?'+query;
    return '/sign-in?return_to=' + encodeURIComponent(demo?path:projectUrl(path));
  };
  let boot = document.getElementById('workspaceBoot');
  const shell = document.getElementById('appShell');
  // An already-open document may load the newer script during a release.
  if (!boot) {
    boot = document.createElement('main');boot.id = 'workspaceBoot';
    boot.setAttribute('aria-busy', 'true');
    const brand = document.createElement('span');brand.className = 'workspace-boot-brand';brand.textContent = 'weft';brand.setAttribute('aria-hidden', 'true');
    const status = document.createElement('p');status.setAttribute('role', 'status');status.textContent = 'Loading project…';
    const back = document.createElement('a');back.href = '/';back.target = '_top';back.textContent = 'All projects';
    boot.append(brand, status, back);
    document.body.insertBefore(boot, shell);
  }
  shell.hidden = true;
  let workspaceReady = false;
  function loadFailure(message) {
    if (accessLost) return;
    shell.hidden = true;
    boot.hidden = false;
    boot.setAttribute('aria-busy', 'false');
    const heading = document.createElement('h1');
    heading.textContent = 'Your plan could not be loaded';
    const detail = document.createElement('p');
    detail.setAttribute('role', 'alert');
    detail.textContent = message;
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary';retry.textContent = 'Try again';retry.type = 'button';
    retry.addEventListener('click', () => location.reload());
    const back = document.createElement('a');
    back.href = '/';back.target = '_top';back.textContent = 'All projects';
    const login = document.createElement('a');
    login.href = signIn();login.target = '_top';login.textContent = 'Sign in again';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:16px;align-items:center';
    actions.append(retry, back, login);
    boot.replaceChildren(heading, detail, actions);
  }
  window.GatherMode = Object.freeze({ demo, actor, projectId, projectUrl, gmailEnabled: false, privateUrl: path => demo
    ? endpoint + '&resource=private&action=' + encodeURIComponent(path)
    : projectUrl('/api/private/' + path) });
  let snapshot;
  const listeners = new Set();
  let queue = Promise.resolve();
  let mutationGeneration = 0;
  let refreshGeneration = 0;
  let accessLost = false;
  const snapshotReadDeadline = 10000;
  function stopAccess() {
    accessLost = true;
    if (snapshot) { snapshot.state = { tasks:[],members:[],messages:[],activity:[],memories:[],event:{} }; snapshot.exportState = {}; snapshot.suggestions = []; }
    window.GatherIdentity = null;
    document.body.replaceChildren();
    const box=document.createElement('main');box.style.cssText='max-width:640px;margin:64px auto;padding:24px';
    box.innerHTML='<h1>Project access changed</h1><p>Return to Projects or sign in again.</p><a href="/" target="_top">Projects</a> · <a href="/account" target="_top">Account</a>';
    document.body.append(box);
    window.GatherAccessLost = true;
    window.top.location.replace('/');
  }
  async function request(body, signal) {
    if(accessLost)throw new Error('Project access changed. Return to Projects.');
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET',
      headers: body
        ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
        : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (response.status === 401) window.top.location.href = signIn();
    if(snapshot && [401,403,404].includes(response.status) && !body) stopAccess();
    const result = await response.json().catch(() => {
      const error = new Error('Weft could not complete the request. Reload or sign in again.');
      if(!response.ok)error.status=response.status;
      throw error;
    });
    if (!response.ok) {
      const error = new Error(result?.error || 'Unable to save. Reload and try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  async function waitForSnapshotQueue(signal) {
    let abort;
    try {
      await Promise.race([queue, new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once:true });
      })]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
    signal.throwIfAborted();
  }
  function validateIdentity(next) {
    if (snapshot && (next.identity.actorId !== snapshot.identity.actorId || next.identity.role !== snapshot.identity.role ||
        (snapshot.reminderScope && next.reminderScope && snapshot.reminderScope !== next.reminderScope))) {
      stopAccess();throw new Error('Your account changed. Return to Projects.');
    }
    if (Boolean(next.demo) !== demo || (demo && next.identity.actorId !== actor) || (!demo && next.projectId !== projectId))
      throw new Error('The workspace identity changed. Reload to continue.');
  }
  function publish(next) {
    validateIdentity(next);
    snapshot = next;
    listeners.forEach((fn) => fn(snapshot.state));
  }
  const methods = [
    'rescheduleEvent',
    'setNextUp', 'requestRecovery', 'resolveRecovery',
    'setTaskPriority',
    'setTaskSchedule',
    'setTaskOutcome',
    'resolveHandoff',
    'addDependency', 'addLinkedTask', 'addRelatedTasks', 'setDependencyKind', 'removeDependency', 'resumeTask',
    'claimTask',
    ...(demo ? ['resetDemo'] : []),
    'addTask',
    'deleteTask',
    'updateTask',
    'addComment',
    'saveDraft',
    'addMessage',
    'applyMessage',
    'refreshProposal',
    'ignoreMessage',
    'acceptTask',
    'acceptTasks',
    'assignTasks',
    'reportCompletion',
    'returnCompletion',
    'setCompletionEvidence',
    'reviewCompletionEvidence',
    'verifyTask',
    'recordFollowup',
    'updateEvent',
    'addMemory',
    'updateMemory',
    'acceptSuggestion',
    'dismissSuggestion',
  ];
  try {
    publish(await request());
    if(!demo&&snapshot.setupRequired){window.top.location.replace(projectUrl('/setup'));return;}
    if(!demo)document.querySelectorAll('a[href="/setup"],a[href="/settings"],a[href="/mail"]').forEach(link=>link.href=projectUrl(link.getAttribute('href')));
    window.GatherIdentity = snapshot.identity;
    const inviteLabel = document.querySelector('[data-invite-label]');
    if (inviteLabel) inviteLabel.textContent = demo ? 'Invitation draft' : 'Invite people';
    document.body.classList.toggle('participant', snapshot.identity.role !== 'admin');
    if (!demo && snapshot.identity.role !== 'admin') document.querySelector('.top-actions a[href="/demo"]')?.remove();
    if (demo) {
      document.querySelectorAll('.project-setup-link').forEach(link=>link.remove());
      document.body.classList.add('demo-mode');
      const bar = document.createElement('section');
      bar.className = 'demo-toolbar';
      bar.setAttribute('aria-label', 'Demo profiles');
      const profiles = [['jack','Jack'],['maya','Maya'],['jules','Jules'],['dev','Dev']];
      bar.innerHTML = '<div><strong>Demo</strong><span>Sample data · simulated profiles</span></div><nav aria-label="Switch demo profile">' + profiles.map(([id,name]) =>
        '<span class="demo-profile-link ' + (actor === id ? 'active' : '') + '"><a href="/demo?as=' + id + '" target="_top" ' + (actor === id ? 'aria-current="page"' : '') + '>' + name + '</a><a href="/demo?as=' + id + '" target="_blank" rel="noopener noreferrer" aria-label="Open ' + name + ' in a new tab">↗</a></span>'
      ).join('') + '</nav><a class="text-button" href="/" target="_top">Exit demo</a>' + (actor === 'jack' ? '<button class="text-button" data-action="demo-reset">Restart demo</button>' : '');
      document.querySelector('.topbar').before(bar);
      document.querySelector('.top-actions a[href="/demo"]')?.remove();
      const settings = document.querySelector('.top-actions a[href="/settings"]');
      if (settings) settings.outerHTML = '<button class="btn btn-secondary btn-small" data-action="demo-email">Email setup</button>';
    }
    const store = {
      getState: () => structuredClone(snapshot.state),
      getTimeZone: () => snapshot.state.event.timeZone || 'UTC',
      getSuggestions: () => structuredClone(snapshot.suggestions),
      getReminderScope: () => demo || accessLost ? '' : snapshot.reminderScope,
      exportState: () => JSON.stringify(snapshot.exportState, null, 2),
      getSnapshotRevision: () => snapshot.revision,
      confirmSnapshotRevision: async (expected,onNewer) => {
        const signal=AbortSignal.timeout(snapshotReadDeadline);
        const report=revision=>{if(Number.isSafeInteger(revision)&&revision>expected)onNewer?.(revision);};
        try {
          await waitForSnapshotQueue(signal);
        } catch (error) {
          if(!signal.aborted)throw error;
          // An unsettled local write is not the same as an offline read.
          report(snapshot.revision);
          return false;
        }
        if(snapshot.revision!==expected){report(snapshot.revision);return false;}
        const generation=mutationGeneration;
        let latest;
        try {
          latest=await request(undefined,signal);
        } catch (error) {
          if(generation===mutationGeneration&&snapshot.revision===expected)throw error;
          report(snapshot.revision);
          return false;
        }
        validateIdentity(latest);
        if(!Number.isSafeInteger(latest.revision))throw new Error('Weft could not confirm the current plan.');
        report(Math.max(latest.revision,snapshot.revision));
        return latest.revision===expected&&snapshot.revision===expected&&generation===mutationGeneration;
      },
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      refresh: async (canApply, {requireFresh=false}={}) => {
        const signal=AbortSignal.timeout(snapshotReadDeadline);
        await waitForSnapshotQueue(signal);
        const base=snapshot.revision, generation=mutationGeneration, refreshId=++refreshGeneration;
        const latest=await request(undefined,signal);
        validateIdentity(latest);
        if(requireFresh&&(!Number.isSafeInteger(latest.revision)||!Array.isArray(latest.state?.tasks)))return {changed:false};
        if(refreshId!==refreshGeneration)return {changed:false};
        if(latest.revision<snapshot.revision)return {changed:false};
        if(snapshot.revision!==base||mutationGeneration!==generation)return latest.revision>snapshot.revision
          ? {pending:true,newerRevision:latest.revision} : {pending:false};
        const suggestionsChanged=JSON.stringify(latest.suggestions)!==JSON.stringify(snapshot.suggestions);
        // Clock-driven checks can change without a persisted workspace edit.
        // Updating only derived suggestions cannot overwrite an in-progress form.
        // Shared task links are revisioned; a matching authorized GET confirms
        // those links without replacing local views with another state object.
        if(latest.revision===snapshot.revision){
          if(requireFresh&&!canApply(latest.revision,latest.state))return {changed:false};
          if(suggestionsChanged)snapshot={...snapshot,suggestions:latest.suggestions};
          return {changed:false,suggestionsChanged, ...(requireFresh?{verified:true}:{})};
        }
        if(!canApply(latest.revision,latest.state))return {pending:true,newerRevision:latest.revision};
        publish(latest);return {changed:true,suggestionsChanged, ...(requireFresh?{verified:true}:{})};
      },
    };
    const count = {
      setNextUp: 2, requestRecovery: 2, resolveRecovery: 2,
      setTaskPriority: 2,
      setTaskSchedule: 2,
      setTaskOutcome: 2,
      resolveHandoff: 3,
      addDependency: 2,
      addLinkedTask: 2,
      addRelatedTasks: 2,
      setDependencyKind: 2,
      removeDependency: 2,
      resumeTask: 1,
      claimTask: 1,
      resetDemo: 1,
      addTask: 1,
      deleteTask: 2,
      updateTask: 2,
      addComment: 2,
      saveDraft: 2,
      addMessage: 1,
      applyMessage: 2,
      refreshProposal: 2,
      ignoreMessage: 1,
      acceptTask: 1,
      acceptTasks: 1,
      assignTasks: 1,
      reportCompletion: 2,
      returnCompletion: 2,
      setCompletionEvidence: 2,
      reviewCompletionEvidence: 2,
      verifyTask: 1,
      recordFollowup: 2,
      updateEvent: 1,
      rescheduleEvent: 1,
      addMemory: 1,
      updateMemory: 2,
      acceptSuggestion: 1,
      dismissSuggestion: 1,
    };
    methods.forEach(
      (method) =>
        (store[method] = (...args) => {
          mutationGeneration++;
          // The optional reviewed revision follows the local-only actor argument.
          const reviewedRevision=method==='verifyTask'?args[2]:
            ['returnCompletion','reportCompletion','setCompletionEvidence'].includes(method)?args[3]:undefined;
          args = args.slice(0, count[method]);
          while (args.length < count[method]) args.push(null);
          if(reviewedRevision!==undefined)args.push(reviewedRevision);
          const revision = snapshot.revision;
          const next = queue.then(async () => {
            const response = await request({ method, args, revision },method==='addRelatedTasks'?AbortSignal.timeout(15000):undefined);
            if(method==='addRelatedTasks'&&(!Number.isSafeInteger(response?.revision)||response.revision<=revision||!Array.isArray(response.state?.tasks)))
              throw new Error('Weft could not confirm the saved project.');
            publish(response);
            return response.result;
          });
          queue = next.catch(() => {});
          return next;
        }),
    );
    window.GatherStore = { createStore: () => store };
    window.addEventListener('gather-workspace-ready', () => {
      if (accessLost) return;
      workspaceReady = true;
      boot.hidden = true;
      boot.setAttribute('aria-busy', 'false');
      shell.hidden = false;
    }, { once: true });
    const script = document.createElement('script');
    script.src = '/gather-assets/app.js';
    script.onerror = () => loadFailure('Check your connection, then try again.');
    script.onload = () => {
      if (!workspaceReady) loadFailure('The workspace could not be opened. Please try again.');
    };
    document.body.append(script);
    if (!demo && document.modelContext?.registerTool) {
      const lifecycle = new AbortController();
      window.addEventListener('pagehide', () => lifecycle.abort(), {
        once: true,
      });
      const register = (tool) => {
        try {
          Promise.resolve(
            document.modelContext.registerTool(tool, {
              signal: lifecycle.signal,
            }),
          ).catch(() => {});
        } catch {}
      };
      register({
        name: 'read_shared_plan',
        description:
          'Read shared event tasks and planning checks. Excludes private bookings and Gmail originals.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== 'object' || Object.keys(input).length)
            throw new Error('Provide an empty object.');
          return {
            event: snapshot.state.event,
            tasks: snapshot.state.tasks.map(
              ({ id, title, owner, status, dueDate }) => ({
                id,
                title,
                owner,
                status,
                dueDate,
              }),
            ),
            checks: snapshot.suggestions,
          };
        },
      });
      register({
        name: 'add_shared_task',
        description:
          'Create and save a shared event task assigned to the signed-in organizer.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
          },
          required: ['title'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        async execute(input) {
          if (
            !input ||
            typeof input.title !== 'string' ||
            !input.title.trim() ||
            input.title.length > 200 ||
            Object.keys(input).some((k) => k !== 'title')
          )
            throw new Error('Provide only a task title of 1–200 characters.');
          const task = await store.addTask({
            title: input.title,
            owner: snapshot.identity.actorId,
            status: 'todo',
          });
          window.dispatchEvent(new Event('gather-tool-updated'));
          return { id: task.id, title: task.title, status: task.status };
        },
      });
    }
    // Refresh only while idle; edited proposals are never silently rebased.
  } catch (error) {
    loadFailure(error.message);
  }
})();
