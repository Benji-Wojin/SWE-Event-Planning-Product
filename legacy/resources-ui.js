(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pending=new Map();
  const needsRead=new Set();
  function endpoint(taskId){
    const query=new URLSearchParams({taskId});
    if(root.GatherMode?.demo){query.set('demo','1');query.set('as',root.GatherMode.actor);}
    else query.set('project',root.GatherMode?.projectId || 'main');
    return '/api/resources?'+query;
  }
  async function request(url,taskId,input){
    const controller=new AbortController();
    let timer;
    try{
      return await Promise.race([
        (async()=>{
          const response=await fetch(url,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal,
            headers:input?{'Content-Type':'application/json','X-Gather-Request':'1'}:{},body:input?JSON.stringify({taskId,...input}):undefined});
          const data=await response.json();
          if(!response.ok)throw new Error(data.error||'Helpful links could not be loaded.');
          return data;
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('Loading helpful links took too long.'));controller.abort();},30000);})
      ]);
    }catch(error){
      if(input){needsRead.add(url);throw new Error((error.message||'The search could not be confirmed.')+' The search may still complete. Reload links before searching again.');}
      throw error;
    }finally{clearTimeout(timer);}
  }
  function markup(){return '<section class="task-resources section-gap" aria-label="Helpful links"><h3>Helpful links</h3><div data-resource-results aria-live="polite"><p class="muted">Loading links…</p></div></section>';}
  function render(node,data){
    const disabled=data.status==='unconfigured',busy=data.status==='loading'||data.recovering;
    const links=Array.isArray(data.links)?data.links:[];
    const message=disabled?'New link searches are unavailable while the Groq connection is being verified.':busy?'Finding helpful links…':data.status==='cooldown'?'Please wait a minute before searching again.':data.status==='error'?'The last search couldn’t finish. Try again.':links.length?'':'No useful sources found. Try adding a city or region.';
    node.innerHTML=(links.length?'<ul class="resource-links">'+links.map(link=>'<li><a href="'+escape(link.url)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'+escape(link.title)+'</a><span class="resource-host">'+escape(link.host)+'</span><p>'+escape(link.description)+'</p></li>').join('')+'</ul>':'<p class="muted">'+message+'</p>')+
      (disabled&&links.length?'<p class="muted">'+message+'</p>':'')+'<details class="resource-details"><summary>Search details</summary><p>Groq searches using this task’s name, category and optional city. Emails, comments and private bookings are excluded.</p>'+
      (disabled?'':'<form id="resourceForm" class="resource-form"><label class="field">City or region (optional)<input name="location" maxlength="80" autocomplete="off" value="'+escape(data.location||'')+'" placeholder="e.g. Portland, Oregon"></label><button class="btn btn-secondary btn-small" type="submit" '+(busy?'disabled':'')+'>Find links</button></form>')+
      '<p class="muted">'+(data.generatedAt?'Searched '+escape(new Date(data.generatedAt).toLocaleDateString())+'. ':'')+'Suggestions, not endorsements. Confirm availability and suitability.</p></details>'+
      (data.recoveryError?'<p class="resource-error warning-note" role="alert">'+escape(data.recoveryError)+'</p><button type="button" class="btn btn-secondary btn-small" data-resource-retry>Reload links</button>':'');
  }
  async function mount(taskId,container){
    if(!container)return;
    const node=container.querySelector('[data-resource-results]');
    if(!node)return;
    const url=endpoint(taskId);
    let started=Date.now(),pollTimer,lastData={status:'error',links:[],location:''},showing=false;
    let draft=container.dataset.resourceDraft;
    delete container.dataset.resourceDraft;
    function paint(data){
      clearTimeout(pollTimer);
      if(data.status==='loading'&&Date.now()-started>=65000){
        needsRead.add(url);
        data={...data,status:'error',recovering:true,recoveryError:'The search may still be running. Reload links to check its result.'};
      }
      lastData=data;
      const form=node.querySelector('form'),input=form?.elements.location;
      const unsaved=input&&input.value!==input.defaultValue?input.value:draft;
      draft=undefined;
      const focused=node.contains(document.activeElement)?document.activeElement:null;
      const focusKind=focused?.tagName==='INPUT'?'input':focused?.tagName==='BUTTON'?'button':focused?.tagName==='SUMMARY'?'summary':null;
      const expanded=node.querySelector('details')?.open;
      render(node,data);
      if(unsaved!==undefined&&node.querySelector('input'))node.querySelector('input').value=unsaved;
      if(expanded||unsaved!==undefined)node.querySelector('details').open=true;
      if(focusKind)node.querySelector(focusKind)?.focus({preventScroll:true});
      if(data.status==='loading')pollTimer=setTimeout(()=>{if(node.isConnected)show(undefined,true,true);},2000);
    }
    async function show(input,readOnly=false,poll=false){
      if(showing)return;
      showing=true;
      clearTimeout(pollTimer);
      if(!poll)started=Date.now();
      const previousFocus=document.activeElement,hadFocus=node.contains(previousFocus);
      const button=node.querySelector('button');if(button)button.disabled=true;
      let run=pending.get(url);
      const reused=Boolean(run);
      if(!run){run=(async()=>{
        const uncertain=needsRead.has(url);
        // A read must reconcile an uncertain search before another mutation is allowed.
        const effectiveInput=uncertain?undefined:input;
        let data=await request(url,taskId,effectiveInput);
        if(!effectiveInput)needsRead.delete(url);
        if(!effectiveInput&&!uncertain&&!readOnly&&data.status==='empty')data=await request(url,taskId,{});
        return data;
      })();pending.set(url,run);}
      try{
        let data=await run;
        // A remount may follow a task rename/category change while this run was pending.
        // Reconcile from the server without starting another search.
        if(reused&&node.isConnected){data=await request(url,taskId);needsRead.delete(url);}
        if(node.isConnected)paint(data);
      }
      catch(error){if(node.isConnected)paint({...lastData,status:lastData.status==='unconfigured'?'unconfigured':'error',recovering:true,recoveryError:error.message||'Helpful links could not be loaded. Reload links to try again.'});}
      finally{if(pending.get(url)===run)pending.delete(url);showing=false;if(hadFocus&&node.isConnected&&document.activeElement===document.body){node.querySelector(previousFocus.tagName.toLowerCase())?.focus({preventScroll:true});}}
    }
    node.addEventListener('submit',event=>{if(!event.target.matches('.resource-form'))return;event.preventDefault();event.stopPropagation();show({location:event.target.elements.location.value,refresh:true});});
    node.addEventListener('click',event=>{if(!event.target.closest('[data-resource-retry]'))return;event.preventDefault();show(undefined,true);});
    await show();
  }
  root.GatherResourcesUI={markup,mount};
})(window);
