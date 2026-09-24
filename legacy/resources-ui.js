(function(root){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pending=new Map();
  function endpoint(taskId){
    const query=new URLSearchParams({taskId});
    if(root.GatherMode?.demo){query.set('demo','1');query.set('as',root.GatherMode.actor);}
    return '/api/resources?'+query;
  }
  async function request(taskId,input){
    const response=await fetch(endpoint(taskId),{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',
      headers:input?{'Content-Type':'application/json','X-Gather-Request':'1'}:{},body:input?JSON.stringify({taskId,...input}):undefined});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Helpful links could not be loaded.');
    return data;
  }
  function markup(){return '<section class="task-resources section-gap" aria-label="Helpful links"><h3>Helpful links</h3><div data-resource-results aria-live="polite"><p class="muted">Loading links…</p></div></section>';}
  function render(node,data){
    const disabled=data.status==='unconfigured',busy=data.status==='loading';
    const links=Array.isArray(data.links)?data.links:[];
    const message=disabled?'AI links aren’t connected yet.':busy?'Finding helpful links…':data.status==='cooldown'?'Please wait a minute before searching again.':data.status==='error'?'The last search couldn’t finish. Try again.':links.length?'':'No useful sources found. Try adding a city or region.';
    node.innerHTML=(links.length?'<ul class="resource-links">'+links.map(link=>'<li><a href="'+escape(link.url)+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'+escape(link.title)+'</a><span class="resource-host">'+escape(link.host)+'</span><p>'+escape(link.description)+'</p></li>').join('')+'</ul>':'<p class="muted">'+message+'</p>')+
      '<details class="resource-details"><summary>Search details</summary><p>AI searches using this task’s name, category and optional city. Emails, comments and private bookings are excluded.</p>'+
      (disabled?'':'<form id="resourceForm" class="resource-form"><label class="field">City or region (optional)<input name="location" maxlength="80" autocomplete="off" value="'+escape(data.location||'')+'" placeholder="e.g. Portland, Oregon"></label><button class="btn btn-secondary btn-small" type="submit" '+(busy?'disabled':'')+'>Find links</button></form>')+
      '<p class="muted">'+(data.generatedAt?'Searched '+escape(new Date(data.generatedAt).toLocaleDateString())+'. ':'')+'Suggestions, not endorsements. Confirm availability and suitability.</p></details>';
  }
  async function mount(taskId,container){
    if(!container)return;
    const node=container.querySelector('[data-resource-results]');
    if(!node)return;
    const started=Date.now();
    const draft=container.dataset.resourceDraft;
    delete container.dataset.resourceDraft;
    function paint(data){
      const form=node.querySelector('form'),input=form?.elements.location;
      const unsaved=input&&input.value!==input.defaultValue?input.value:draft;
      const expanded=node.querySelector('details')?.open;
      render(node,data);
      if(unsaved!==undefined&&node.querySelector('input'))node.querySelector('input').value=unsaved;
      if(expanded||unsaved!==undefined)node.querySelector('details').open=true;
      if(data.status==='loading'){
        if(Date.now()-started<65000)setTimeout(()=>{if(node.isConnected)show(undefined,true);},2000);
        else{render(node,{...data,status:'error'});}
      }
    }
    async function show(input,poll=false){
      const button=node.querySelector('button');if(button)button.disabled=true;
      let run=pending.get(taskId);
      const reused=Boolean(run);
      if(!run){run=(async()=>{let data=await request(taskId,input);if(!input&&!poll&&data.status==='empty')data=await request(taskId,{});return data;})();pending.set(taskId,run);}
      try{let data=await run;if(reused)data=await request(taskId);if(node.isConnected)paint(data);}
      catch(error){if(node.isConnected){if(!node.querySelector('form'))paint({status:'error',links:[],location:''});let message=node.querySelector('.resource-error');if(!message){message=document.createElement('p');message.className='resource-error warning-note';message.setAttribute('role','alert');node.append(message);}message.textContent=error.message;}}
      finally{if(pending.get(taskId)===run)pending.delete(taskId);if(button?.isConnected)button.disabled=false;}
    }
    node.addEventListener('submit',event=>{if(!event.target.matches('.resource-form'))return;event.preventDefault();event.stopPropagation();show({location:event.target.elements.location.value,refresh:true});});
    await show();
  }
  root.GatherResourcesUI={markup,mount};
})(window);
