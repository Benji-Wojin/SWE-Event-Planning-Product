(function (root) {
  'use strict';
  const views = new Set(['overview', 'tasks', 'inbox', 'updates', 'team', 'info', 'budget', 'timeline', 'memory', 'details']);
  const viewFrom = hash => views.has(hash.slice(1)) ? hash.slice(1) : '';
  const taskIdPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;
  function taskIdFrom(params) {
    const hints=params.getAll('task');
    return hints.length===1&&taskIdPattern.test(hints[0])?hints[0]:'';
  }
  function taskLinkFrom(params) {
    const id=taskIdFrom(params),hints=params.getAll('review');
    const review=id&&!params.getAll('demo').includes('1')&&hints.length===1&&['completion','amendment','owner','schedule'].includes(hints[0])?hints[0]:'';
    const from=params.getAll('from'),projects=params.getAll('project');
    const fromPlanReceipt=(review==='owner'||review==='schedule')&&from.length===1&&from[0]==='plan-receipt'&&
      projects.length===1&&!!projects[0]&&!['activity','message','day','welcome'].some(key=>params.has(key));
    return {id,review,...(fromPlanReceipt?{fromPlanReceipt:true}:{})};
  }
  function activityLinkFrom(params) {
    const hints=params.getAll('activity'),projects=params.getAll('project');
    return hints.length===1&&taskIdPattern.test(hints[0])&&projects.length===1&&projects[0]&&
      !params.getAll('demo').includes('1')&&!['task','review','message'].some(key=>params.has(key))?hints[0]:'';
  }
  function scheduleDate(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return '';
    const date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?value:'';
  }
  function scheduleDateFrom(searchParams) {
    const values=searchParams.getAll('day');
    return values.length===1?scheduleDate(values[0]):'';
  }
  function scheduleLink(origin,project,value) {
    const day=scheduleDate(value);
    if(!day)return '';
    const url=new URL('/project',origin);
    url.searchParams.set('project',project);
    url.searchParams.set('day',day);
    return url.href;
  }
  function create(frame) {
    // Evaluate conflicting one-shot hints together, before either consumer removes one.
    const linkHints=new URLSearchParams(frame.location.search);
    let host = frame;
    try {
      const parent = frame.parent;
      if (parent && parent !== frame && parent.location.origin === frame.location.origin &&
          ['/project', '/demo'].includes(parent.location.pathname)) host = parent;
    } catch { /* Unrelated or cross-origin embeds keep their own navigation. */ }
    const initialScheduleDate=()=>scheduleDateFrom(new URLSearchParams(frame.location.search));
    return {
      initial() {
        // The address-bar section wins; otherwise keep mailbox/demo defaults.
        return viewFrom(host.location.hash) || viewFrom(frame.location.hash) || (initialScheduleDate()?'timeline':'overview');
      },
      initialScheduleDate,
      takeInitialActivityLink() {
        if(!new URLSearchParams(frame.location.search).has('activity'))return '';
        for(const target of new Set([frame,host])){
          const url=new URL(target.location.href);
          if(!url.searchParams.has('activity'))continue;
          url.searchParams.delete('activity');
          target.history.replaceState(target.history.state,'',url.pathname+url.search+url.hash);
        }
        return activityLinkFrom(linkHints);
      },
      takeJoinWelcome() {
        const hints=new URLSearchParams(frame.location.search).getAll('welcome');
        if(!hints.length)return false;
        for(const target of new Set([frame,host])){
          const url=new URL(target.location.href);
          if(!url.searchParams.has('welcome'))continue;
          url.searchParams.delete('welcome');
          target.history.replaceState(target.history.state,'',url.pathname+url.search+url.hash);
        }
        return hints.length===1&&hints[0]==='1';
      },
      takeInitialTaskLink() {
        const search=new URLSearchParams(frame.location.search);
        const hasReceipt=params=>params.getAll('from').includes('plan-receipt');
        const result=search.has('task')||search.has('review')?taskLinkFrom(linkHints):{id:'',review:''};
        if(search.has('task')||search.has('review')||hasReceipt(search)){
          for(const target of new Set([frame,host])){
            const url=new URL(target.location.href);
            const receipt=hasReceipt(url.searchParams);
            if(!url.searchParams.has('task')&&!url.searchParams.has('review')&&!receipt)continue;
            url.searchParams.delete('task');
            url.searchParams.delete('review');
            if(receipt)url.searchParams.delete('from');
            target.history.replaceState(target.history.state,'',url.pathname+url.search+url.hash);
          }
        }
        return result;
      },
      replaceScheduleDate(value) {
        if(new URLSearchParams(frame.location.search).get('demo')==='1')return;
        const day=scheduleDate(value);
        if(value&&!day)return;
        for(const target of new Set([frame,host])){
          const url=new URL(target.location.href),previous=url.search;
          if(day)url.searchParams.set('day',day);
          else url.searchParams.delete('day');
          if(url.search!==previous)target.history.replaceState(target.history.state,'',url.pathname+url.search+url.hash);
        }
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
  root.GatherNavigation = { create, scheduleDateFrom, scheduleLink, taskLinkFrom, activityLinkFrom };
})(typeof window !== 'undefined' ? window : globalThis);
