(function (root) {
  'use strict';
  const views = new Set(['overview', 'tasks', 'inbox', 'updates', 'team', 'info', 'timeline', 'memory', 'details']);
  const viewFrom = hash => views.has(hash.slice(1)) ? hash.slice(1) : '';
  function create(frame) {
    let host = frame;
    try {
      const parent = frame.parent;
      if (parent && parent !== frame && parent.location.origin === frame.location.origin &&
          ['/project', '/demo'].includes(parent.location.pathname)) host = parent;
    } catch { /* Unrelated or cross-origin embeds keep their own navigation. */ }
    return {
      initial() {
        // The address-bar section wins; otherwise keep mailbox/demo defaults.
        return viewFrom(host.location.hash) || viewFrom(frame.location.hash) || 'overview';
      },
      replace(view) {
        const hash = '#' + (views.has(view) ? view : 'overview');
        for (const target of new Set([frame, host])) {
          if (target.location.hash !== hash)
            target.history.replaceState(target.history.state, '', hash);
        }
      },
      subscribe(listener) {
        const subscriptions = [...new Set([frame, host])].map(target => {
          const changed = () => listener(viewFrom(target.location.hash) || 'overview');
          target.addEventListener('hashchange', changed);
          return [target, changed];
        });
        return () => subscriptions.forEach(([target, changed]) => target.removeEventListener('hashchange', changed));
      },
    };
  }
  root.GatherNavigation = { create };
})(typeof window !== 'undefined' ? window : globalThis);
