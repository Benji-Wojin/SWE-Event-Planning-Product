import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const source=()=>readFileSync('legacy/workspace-tools.js','utf8');

function fixture({compact=true,allowed=true,innerHeight,visualViewport}={}) {
  const focused=[], opened=[], actions=[];
  function node(tag, attrs={}, parentNode=null) {
    const attributes={...attrs};
    const el={ tagName:tag.toUpperCase(),type:attrs.type,id:attrs.id??'', hidden:Object.hasOwn(attrs,'hidden'),disabled:false,
      dataset:Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-'))
        .map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),
      parentNode,parentElement:parentNode?.tagName==='#DOCUMENT'?null:parentNode,children:[],listeners:new Map(),isConnected:true,
      getAttribute(key){return attributes[key]??null;},
      hasAttribute(key){return key==='hidden'?this.hidden:Object.hasOwn(attributes,key);},
      setAttribute(key,value){attributes[key]=String(value);if(key==='hidden')this.hidden=true;},
      removeAttribute(key){delete attributes[key];if(key==='hidden')this.hidden=false;},
      toggleAttribute(key,value){if(value??!this.hasAttribute(key))this.setAttribute(key,'');else this.removeAttribute(key);},
      addEventListener(type,listener,options){const capture=options===true||!!options?.capture;
        const entries=this.listeners.get(type)??[];entries.push({listener,capture});this.listeners.set(type,entries);},
      removeEventListener(type,listener){this.listeners.set(type,(this.listeners.get(type)??[]).filter(entry=>entry.listener!==listener));},
      contains(other){return this===other||this.children.some(child=>child.contains(other));},
      matches(selector){return selector.split(',').some(part=>{
        const bare=part.trim();
        if(bare===':disabled')return this.disabled;
        const match=bare.match(/^(?:#([\w-]+)|([\w-]+))?((?:\[[^\]]+\])*)(?::not\(([^)]+)\))?$/);
        if(!match)return false;
        const [,id,name,attr,not]=match;
        return (!id||id===this.id)&&(!name||name.toUpperCase()===this.tagName)&&(!not||!this.matches(not))&&
          Array.from(attr.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)).every(([,key,value])=>
            this.hasAttribute(key)&&(value===undefined||this.getAttribute(key)===value));
      });},
      closest(selector){for(let child=this;child;child=child.parentElement)if(child.matches(selector))return child;return null;},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
      querySelector(selector){return this.querySelectorAll(selector)[0]??null;},
      getClientRects(){return this.isConnected&&!this.closest('[hidden],[inert]')?[{}]:[];},
      focus(){if(this.disabled||!this.getClientRects().length)return;
        document.activeElement=this;focused.push(this);dispatch(this,'focusin');},
    };
    if(parentNode)parentNode.children.push(el);
    return el;
  }
  const document=node('#document'), body=node('body',{},document);
  document.body=body;document.activeElement=body;document.defaultView={};
  const header=node('header',{},body);
  header.ownerDocument=document;
  let headerBottom=80;
  header.getBoundingClientRect=()=>({bottom:headerBottom});
  const menu=node('button',{id:'mobileMenu'},header), notifications=node('button',{id:'notificationButton'},header);
  const toggle=node('button',{id:'workspaceToolsToggle',type:'button','aria-expanded':'false','aria-controls':'workspaceTools',hidden:''},header);
  const panel=node('div',{id:'workspaceTools'},header);
  const style=new Map();
  panel.style={setProperty:(key,value)=>style.set(key,value),getPropertyValue:key=>style.get(key)??''};
  const hidden=node('button',{id:'hiddenTool',hidden:''},panel);
  const account=node('a',{href:'/account',target:'_top'},panel);
  const tour=node('button',{'data-action':'quick-tour'},panel), tourIcon=node('span',{},tour);
  const unrelated=node('input',{id:'workspace-search'},body);
  const media=node('media');media.matches=compact;
  media.addListener=listener=>media.addEventListener('change',listener);
  media.removeListener=listener=>media.removeEventListener('change',listener);

  function dispatch(target,type,values={}){
    const path=[];for(let el=target;el;el=el.parentNode)path.push(el);
    const event={type,target,defaultPrevented:false,stopped:false,...values,
      composedPath:()=>path,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},
      stopImmediatePropagation(){this.stopped=true;this.immediate=true;},
    };
    for(const [nodes,capture] of [[path.slice().reverse(),true],[path,false]]){
      for(const el of nodes){
        event.currentTarget=el;
        for(const entry of el.listeners.get(type)??[])if(entry.capture===capture){entry.listener(event);if(event.immediate)break;}
        if(event.stopped)return event;
      }
    }
    return event;
  }
  // The app's delegated handler runs on the document in bubble phase.
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-action],a[href]');
    if(action&&panel.contains(action))actions.push([action,panel.hidden,document.activeElement,event.defaultPrevented]);
  });
  const viewport=visualViewport&&Object.assign(node('visualViewport'),visualViewport);
  const window=Object.assign(node('window'),{document,innerHeight,visualViewport:viewport,matchMedia:()=>media});document.defaultView=window;
  vm.runInNewContext(source(),{window,document,requestAnimationFrame:fn=>fn(),queueMicrotask:fn=>fn()});
  const controller=window.GatherWorkspaceTools.create({header,media,canOpen:()=>allowed,onOpen:()=>opened.push(true)});
  return {controller,document,header,menu,notifications,toggle,panel,hidden,account,tour,tourIcon,unrelated,focused,opened,actions,
    active:()=>document.activeElement,
    open:()=>!panel.hidden&&toggle.getAttribute('aria-expanded')==='true',
    setAllowed(value){allowed=value;},
    click(target){return dispatch(target,'click');},
    key(target,key){return dispatch(target,'keydown',{key});},
    point(target){return dispatch(target,'pointerdown',{button:0});},
    resize(value){media.matches=value;dispatch(media,'change',{matches:value,media:'compact'});},
    scrollToHeaderBottom(value){headerBottom=value;dispatch(window,'scroll');},
    resizeWindow(value){window.innerHeight=value;dispatch(window,'resize');},
    resizeViewport(values){Object.assign(viewport,values);dispatch(viewport,'resize');},
  };
}

test('compact tools start collapsed; only allowed opens expand the panel without stealing focus',()=>{
  const f=fixture({allowed:false});
  assert.equal(f.toggle.hidden,false);
  assert.equal(f.toggle.getAttribute('aria-expanded'),'false');
  assert.equal(f.panel.hidden,true);
  assert.equal(f.notifications.hidden,false,'always-visible notifications stay out of the disclosure');
  f.toggle.focus();f.click(f.toggle);
  assert.equal(f.open(),false);
  assert.deepEqual(f.opened,[]);
  f.setAllowed(true);f.click(f.toggle);
  assert.equal(f.open(),true);
  assert.equal(f.active(),f.toggle);
  assert.deepEqual(f.opened,[true]);
  f.click(f.toggle);
  assert.equal(f.open(),false);
  assert.equal(f.panel.hidden,true);
  assert.equal(f.toggle.getAttribute('aria-expanded'),'false');
});

test('Escape and tool activation close to More before delegated actions run',()=>{
  const f=fixture();
  f.toggle.focus();f.click(f.toggle);f.tour.focus();
  f.key(f.tour,'Escape');
  assert.equal(f.open(),false);
  assert.equal(f.active(),f.toggle);
  assert.deepEqual(f.actions,[]);
  for(const [action,target] of [[f.tour,f.tourIcon],[f.account,f.account]]){
    f.click(f.toggle);action.focus();
    const event=f.click(target);
    assert.deepEqual(f.actions.at(-1),[action,true,f.toggle,false]);
    assert.equal(event.defaultPrevented,false,'the disclosure does not cancel the real action or navigation');
    assert.equal(f.open(),false);
  }
  assert.equal(f.actions.length,2);
});

test('Tab and outside pointer stay on the next intended control rather than jumping back to More',()=>{
  const f=fixture();
  f.toggle.focus();f.click(f.toggle);
  f.account.focus();f.tour.focus();
  assert.equal(f.open(),true,'moving through the tools does not dismiss them');
  f.key(f.tour,'Tab');
  f.unrelated.focus();
  assert.equal(f.open(),false);
  assert.equal(f.active(),f.unrelated);

  f.toggle.focus();f.click(f.toggle);f.account.focus();
  assert.equal(f.point(f.tour).defaultPrevented,false);
  assert.equal(f.open(),true);
  const count=f.focused.length;
  const event=f.point(f.unrelated);
  assert.equal(f.open(),false);
  assert.equal(event.defaultPrevented,false);
  assert.equal(f.focused.length,count,'outside pointer dismissal does not call focus');
  f.unrelated.focus();
  assert.equal(f.active(),f.unrelated);
});

test('responsive changes never leave focus on a newly hidden control or close desktop tools',()=>{
  const f=fixture({compact:false});
  assert.equal(f.toggle.hidden,true);
  assert.equal(f.panel.hidden,false);
  f.tour.focus();f.resize(true);
  assert.equal(f.toggle.hidden,false);
  assert.equal(f.panel.hidden,true);
  assert.equal(f.active(),f.toggle);
  f.resize(false);
  assert.equal(f.toggle.hidden,true);
  assert.equal(f.panel.hidden,false);
  assert.ok(f.panel.contains(f.active())||f.active()===f.notifications||f.active()===f.menu);
  assert.notEqual(f.active(),f.hidden,'desktop focus skips hidden controls');

  f.unrelated.focus();f.resize(true);f.resize(false);
  assert.equal(f.active(),f.unrelated,'unrelated existing focus is not moved on resize');
  f.click(f.account);
  assert.equal(f.panel.hidden,false,'desktop links need no disclosure handling');
  assert.equal(f.opened.length,0);
});

test('opening More measures available room and updates while scrolling or resizing an open disclosure',()=>{
  const room=f=>f.panel.style.getPropertyValue('--workspace-tools-room');
  const f=fixture({innerHeight:700,visualViewport:{height:300,offsetTop:20}});
  assert.equal(f.panel.hasAttribute('data-tools-ready'),true,'the controller takes over from the no-script compact layout');
  assert.equal(room(f),'');
  f.click(f.toggle);
  assert.equal(room(f),'222px','fit the visual viewport rather than the larger layout viewport');
  f.scrollToHeaderBottom(79.5);
  assert.equal(room(f),'222px','partial pixels are rounded down');
  f.scrollToHeaderBottom(125);
  assert.equal(room(f),'177px');
  f.resizeViewport({height:110,offsetTop:10});
  assert.equal(room(f),'0px','the panel cannot get negative room');
  f.click(f.toggle);
  f.resizeViewport({height:350,offsetTop:5});
  assert.equal(room(f),'0px','closed tools do not run layout measures');
  f.click(f.toggle);
  assert.equal(room(f),'212px','reopening recalculates from the latest viewport');

  const fallback=fixture({innerHeight:400});
  fallback.click(fallback.toggle);
  assert.equal(room(fallback),'302px');
  fallback.resizeWindow(250);
  assert.equal(room(fallback),'152px','window height is used when Visual Viewport is unavailable');
});

test('the real and prepared shells expose one More disclosure without duplicating their existing actions',()=>{
  execFileSync(process.execPath,['scripts/prepare.mjs']);
  for(const path of ['legacy/index.html','public/workspace.html']){
    const html=readFileSync(path,'utf8');
    const header=html.match(/<header\b[^>]*class="topbar"[^>]*>[\s\S]*?<\/header>/)?.[0];
    assert.ok(header,path);
    assert.equal([...header.matchAll(/id="workspaceToolsToggle"/g)].length,1,path);
    assert.equal([...header.matchAll(/id="workspaceTools"/g)].length,1,path);
    const toggle=header.match(/<button\b[^>]*id="workspaceToolsToggle"[^>]*>More<\/button>/)?.[0];
    assert.match(toggle,/aria-controls="workspaceTools"/);
    assert.match(toggle,/aria-expanded="false"/);
    assert.match(toggle,/aria-label="More workspace actions"/);
    assert.doesNotMatch(toggle,/aria-haspopup|role="menu"/,'More opens a normal group of links and buttons');
    const panel=header.match(/<div\b[^>]*id="workspaceTools"[^>]*>[\s\S]*?<\/div>/)?.[0];
    assert.ok(panel,path);
    for(const id of ['mobileMenu','breadcrumbCurrent','notificationButton']){
      assert.ok(header.includes(`id="${id}"`));
      assert.ok(!panel.includes(`id="${id}"`),`${id} stays directly available`);
    }
    for(const action of ['quick-tour','demo-info','invite']){
      assert.equal([...panel.matchAll(new RegExp(`data-action="${action}"`,'g'))].length,1);
    }
    assert.match(panel,/<button\b[^>]*id="askWeftButton"[^>]*\bdisabled\b[^>]*\bhidden\b/);
    if(path==='legacy/index.html'){
      assert.match(panel,/Local demo/);
      assert.ok(html.indexOf('src="workspace-tools.js"')>=0);
      assert.ok(html.indexOf('src="workspace-tools.js"')<html.indexOf('src="app.js?'));
      assert.doesNotMatch(panel,/href="\/(?:feedback|demo|account)"/);
    }else{
      assert.match(panel,/Workspace info/);
      for(const href of ['/feedback','/demo','/account']){
        assert.equal([...panel.matchAll(new RegExp(`<a\\b[^>]*href="${href}"[^>]*target="_top"`,'g'))].length,1);
      }
      const toolbar=html.match(/<script\b[^>]*src="(\/gather-assets\/versioned\/[a-f0-9]+-workspace-tools\.js)"[^>]*>/)?.[0];
      assert.ok(toolbar,path);
      assert.ok(html.indexOf(toolbar)<html.search(/<script\b[^>]*src="[^" ]*-hosted-store\.js"/));
    }
  }
});
