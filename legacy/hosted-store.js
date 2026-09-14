(async function () {
  let snapshot;
  const listeners = new Set();
  let queue = Promise.resolve();
  let mutationGeneration = 0;
  async function request(body) {
    const response = await fetch('/api/workspace', {
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
        window.top.location.href = '/signin-with-chatgpt?return_to=%2F';
      throw new Error(result.error || 'Unable to save. Reload and try again.');
    }
    return result;
  }
  function publish(next) {
    snapshot = next;
    listeners.forEach((fn) => fn(snapshot.state));
  }
  const methods = [
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
    if (document.modelContext?.registerTool) {
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
    a.href = '/signin-with-chatgpt?return_to=%2F';
    a.target = '_top';
    a.textContent = 'Sign in again';
    root.replaceChildren(heading, p, a);
  }
})();
