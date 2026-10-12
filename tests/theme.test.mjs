import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = () => ({dataset:{},style:{},classList:{toggle(name,value){this[name]=value;}}});
function theme({saved='dark',systemDark=false,storageDenied=false}={}) {
  const listeners=new Map(), mediaListeners=new Map(), writes=[];
  const document={documentElement:root(),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  const system={matches:systemDark,addEventListener:(name,fn)=>mediaListeners.set(name,fn)};
  const storage={getItem(){if(storageDenied)throw Error('denied');return saved;},
    setItem(key,value){if(storageDenied)throw Error('denied');saved=value;writes.push(value);},
    removeItem(){if(storageDenied)throw Error('denied');saved=null;writes.push(null);}};
  const window={matchMedia:()=>system,addEventListener:(name,fn)=>listeners.set(name,fn),
    dispatchEvent:event=>listeners.get(event.type)?.(event)};
  vm.runInNewContext(readFileSync('legacy/theme.js','utf8'),{window,document,localStorage:storage,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},Element:class{}});
  return{api:window.GatherTheme,document,system,listeners,mediaListeners,writes};
}
test('theme toggles target the current document after React replaces the original root',()=>{
  const t=theme(),original=t.document.documentElement;
  t.document.documentElement=root();
  t.api.toggle();
  assert.equal(t.document.documentElement.dataset.theme,'light');
  assert.equal(original.dataset.theme,'dark');
  t.api.toggle();
  assert.equal(t.document.documentElement.dataset.theme,'dark');
  assert.equal(t.document.documentElement.classList.dark,true);
  assert.equal(t.document.documentElement.style.colorScheme,'dark');
});
test('hydration recovery reapplies the preference without persisting or changing it',()=>{
  const t=theme();t.document.documentElement=root();
  let notification;t.listeners.set('gather-theme-change',event=>{notification=event.detail;});
  t.api.refresh();
  assert.equal(t.document.documentElement.dataset.theme,'dark');
  assert.equal(notification,'dark');assert.deepEqual(t.writes,[]);
  t.api.refresh();assert.deepEqual(t.writes,[]);
});
test('system and cross-tab changes use the live root while unavailable storage remains usable',()=>{
  const t=theme({saved:null,systemDark:true,storageDenied:true});
  assert.equal(t.api.current(),'dark');t.document.documentElement=root();
  t.system.matches=false;t.mediaListeners.get('change')();
  assert.equal(t.document.documentElement.dataset.theme,'light');
  t.api.set('dark');assert.equal(t.document.documentElement.dataset.theme,'dark');
  t.system.matches=false;t.mediaListeners.get('change')();
  assert.equal(t.document.documentElement.dataset.theme,'dark');
  t.listeners.get('storage')({key:'gather-theme',newValue:'light'});
  assert.equal(t.document.documentElement.dataset.theme,'light');
  t.system.matches=true;t.listeners.get('storage')({key:null,newValue:null});
  assert.equal(t.document.documentElement.dataset.theme,'dark');
});
test('the root recovery component reapplies theme on mount without rendering markup or writing preferences',async()=>{
  const built=await build({entryPoints:['components/theme-recovery.tsx'],bundle:true,platform:'node',format:'esm',write:false,
    plugins:[{name:'theme-effect',setup(b){
      b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'test'}));
      b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useLayoutEffect=(fn,deps)=>globalThis.__themeEffect(fn,deps);'}));
    }}]});
  const {ThemeRecovery}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  const previous={window:globalThis.window,effect:globalThis.__themeEffect};
  try {
    const t=theme();t.document.documentElement=root();
    globalThis.window={GatherTheme:t.api};
    let effect;globalThis.__themeEffect=(fn,deps)=>{effect=fn;assert.deepEqual(deps,[]);};
    assert.equal(ThemeRecovery(),null);assert.equal(t.document.documentElement.dataset.theme,undefined);
    effect();assert.equal(t.document.documentElement.dataset.theme,'dark');assert.deepEqual(t.writes,[]);
    globalThis.window={};assert.doesNotThrow(effect);
    globalThis.window={GatherTheme:{current:()=> 'dark'}};assert.doesNotThrow(effect);
    const layout=readFileSync('app/layout.tsx','utf8');
    assert.match(layout,/import \{ ThemeRecovery \} from '@\/components\/theme-recovery'/);
    assert.match(layout,/<ThemeRecovery \/>/);
  } finally {globalThis.window=previous.window;globalThis.__themeEffect=previous.effect;}
});
