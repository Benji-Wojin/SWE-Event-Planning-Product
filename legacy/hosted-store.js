(async function () {
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const actor = params.get('as') || 'jack';
  const endpoint = demo ? '/api/demo?as=' + encodeURIComponent(actor) : '/api/workspace';
  const signIn = '/signin-with-chatgpt?return_to=' + encodeURIComponent(demo ? '/demo?as=' + actor : '/');
  window.GatherMode = Object.freeze({ demo, actor, privateUrl: path => demo
    ? endpoint + '&resource=private&action=' + encodeURIComponent(path)
    : '/api/private/' + path });
  let snapshot;
  const listeners = new Set();
  let queue = Promise.resolve();
  let mutationGeneration = 0;
  async function request(body) {
    const response = await fetch(endpoint, {
      method: body ? 'POST' : 'GET',
      headers: body
        ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
        : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401)
        window.top.location.href = signIn;
      const error = new Error(result.error || 'Unable to save. Reload and try again.');
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function publish(next) {
    if (Boolean(next.demo) !== demo || (demo && next.identity.actorId !== actor))
      throw new Error('The workspace identity changed. Reload to continue.');
    snapshot = next;
    listeners.forEach((fn) => fn(snapshot.state));
  }
  const methods = [
    'claimTask',
    ...(demo ? ['resetDemo'] : []),
    'addTask',
    'updateTask',
    'addComment',
    'saveDraft',
    'addMessage',
    'applyMessage',
    'refreshProposal',
    'ignoreMessage',
    'acceptTask',
    'reportCompletion',
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
    window.GatherIdentity = snapshot.identity;
    document.body.classList.toggle('participant', snapshot.identity.role !== 'admin');
    if (demo) {
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
      getSuggestions: () => structuredClone(snapshot.suggestions),
      exportState: () => JSON.stringify(snapshot.exportState, null, 2),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      refresh: async (canApply) => {
        await queue;
        const base=snapshot.revision, generation=mutationGeneration;
        const latest=await request();
        if(latest.revision===snapshot.revision)return {changed:false};
        if(snapshot.revision!==base||mutationGeneration!==generation||!canApply())return {pending:true};
        publish(latest);return {changed:true};
      },
    };
    const count = {
      claimTask: 1,
      resetDemo: 1,
      addTask: 1,
      updateTask: 2,
      addComment: 2,
      saveDraft: 2,
      addMessage: 1,
      applyMessage: 2,
      refreshProposal: 2,
      ignoreMessage: 1,
      acceptTask: 1,
      reportCompletion: 2,
      verifyTask: 1,
      recordFollowup: 2,
      updateEvent: 1,
      addMemory: 1,
      updateMemory: 2,
      acceptSuggestion: 1,
      dismissSuggestion: 1,
    };
    methods.forEach(
      (method) =>
        (store[method] = (...args) => {
          mutationGeneration++;
          args = args.slice(0, count[method]);
          while (args.length < count[method]) args.push(null);
          const revision = snapshot.revision;
          const next = queue.then(async () => {
            const response = await request({ method, args, revision });
            publish(response);
            return response.result;
          });
          queue = next.catch(() => {});
          return next;
        }),
    );
    window.GatherStore = { createStore: () => store };
    const script = document.createElement('script');
    script.src = '/gather-assets/app.js';
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
    const root = document.getElementById('viewRoot');
    const heading = document.createElement('h1');
    heading.textContent = 'Your plan could not be loaded';
    const p = document.createElement('p');
    p.textContent = error.message;
    const a = document.createElement('a');
    a.href = signIn;
    a.target = '_top';
    a.textContent = 'Sign in again';
    root.replaceChildren(heading, p, a);
  }
})();
