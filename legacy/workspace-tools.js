(function (root) {
  'use strict';
  function create({header,media,canOpen=()=>true,onOpen=()=>{}}) {
    const toggle=header?.querySelector('#workspaceToolsToggle');
    const panel=header?.querySelector('#workspaceTools');
    if(!toggle||!panel)return;
    const document=header.ownerDocument;
    let open=false;
    const contains=node=>toggle.contains(node)||panel.contains(node);
    const focusToggle=()=>toggle.focus({preventScroll:true});
    function fit() {
      if(!open)return;
      const viewport=root.visualViewport, height=viewport?.height??root.innerHeight;
      if(Number.isFinite(height)) {
        const room=height+(viewport?.offsetTop??0)-header.getBoundingClientRect().bottom-18;
        panel.style.setProperty('--workspace-tools-room',Math.max(0,Math.floor(room))+'px');
      }
    }
    function paint() {
      toggle.hidden=!media.matches;
      panel.hidden=media.matches&&!open;
      toggle.setAttribute('aria-expanded',String(media.matches&&open));
      panel.toggleAttribute('data-tools-open',media.matches&&open);
    }
    function close(restore=false) {
      if(!open)return;
      // Move focus before hiding the originating action. The normal dialog
      // and tour handlers can then capture this visible return target.
      if(restore&&media.matches)focusToggle();
      open=false;
      paint();
    }
    toggle.addEventListener('click',()=>{
      if(open){close(true);return;}
      if(!media.matches||!canOpen())return;
      onOpen();
      open=true;
      paint();
      fit();
      focusToggle();
    });
    panel.addEventListener('click',event=>{
      if(!open)return;
      const action=event.target.closest('button,a[href]');
      if(action&&panel.contains(action)&&!action.matches(':disabled')&&!action.closest('[hidden],[inert]'))close(true);
    });
    function dismissFromOutside(event) {
      if(open&&!contains(event.target))close();
    }
    document.addEventListener('pointerdown',dismissFromOutside,true);
    document.addEventListener('focusin',dismissFromOutside);
    root.addEventListener?.('scroll',fit,{passive:true});
    root.addEventListener?.('resize',fit,{passive:true});
    root.visualViewport?.addEventListener('resize',fit);
    document.addEventListener('keydown',event=>{
      if(!open||event.key!=='Escape')return;
      if(!canOpen()){close();return;}
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    },true);
    media.addEventListener('change',()=>{
      const active=document.activeElement;
      open=false;
      if(media.matches) {
        toggle.hidden=false;
        if(panel.contains(active))focusToggle();
        paint();
        return;
      }
      panel.hidden=false;
      if(active===toggle) {
        [...panel.querySelectorAll('a[href],button,select')].find(control=>
          !control.matches(':disabled')&&!control.closest('[hidden],[inert]')&&control.getClientRects().length)?.focus({preventScroll:true});
      }
      paint();
    });
    panel.setAttribute('data-tools-ready','');
    paint();
  }
  root.GatherWorkspaceTools={create};
})(window);
