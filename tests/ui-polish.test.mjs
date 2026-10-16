import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workspace=readFileSync('legacy/lovable-ui.css','utf8');
const shell=readFileSync('app/globals.css','utf8');
const token=(css,name)=>css.match(new RegExp('--'+name+':\\s*(#[a-f0-9]{6})','i'))?.[1];
const luminance=hex=>{
  const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('workspace light foundations match React and theme metadata',()=>{
  for(const [legacy,react] of [['paper','background'],['ink','foreground'],['muted','muted-foreground'],['line','border'],['green','primary'],['green-soft','accent']])
    assert.equal(token(workspace,legacy),token(shell,react));
  assert.match(readFileSync('legacy/theme.js','utf8'),/'#111820' : '#f7f8f2'/);
  for(const bg of ['paper','warm','rail'])assert.ok(contrast(token(workspace,'muted'),token(workspace,bg))>=4.5,bg+' muted text contrast');
  assert.ok(contrast('#ffffff',token(workspace,'green'))>=4.5);
});
test('briefing, counts and loading states use live theme tokens rather than light islands',()=>{
  assert.match(workspace,/\.briefing-banner \{ background: var\(--green-soft\); border-color: var\(--line\)/);
  assert.match(workspace,/\.briefing-copy p \{ color: var\(--muted\)/);
  assert.match(workspace,/\.nav-count, \.active \.nav-count \{ background: var\(--white\); color: var\(--green-deep\)/);
  assert.match(workspace,/#workspaceBoot \{[^}]+width: min\(560px, calc\(100% - 32px\)\)[^}]+background: var\(--white\)/);
  assert.match(workspace,/:root\[data-theme="dark"\] \.avatar \{ --avatar-bg: var\(--warm\); --avatar-ink: var\(--ink\); \}/);
  assert.doesNotMatch(workspace,/--avatar-(?:bg|ink):[^;]+!important/);
  for(const [fg,bg] of [['#a7b5c5','#243e34'],['#a9e4c4','#213b30'],['#edf2f7','#25323e']])assert.ok(contrast(fg,bg)>=4.5);
});
test('invitation warning and failure badges keep readable text in both themes',()=>{
  for(const [fg,bg] of [['#77510b','#fff4dc'],['#96382c','#fff0ed'],['#f0c36c','#3d3321'],['#ffa99b','#422b2c']])assert.ok(contrast(fg,bg)>=4.5);
  assert.match(shell,/\.invitation-status[^}]+max-width: 100%/);
  assert.match(shell,/\.invitation-status[^}]+overflow-wrap: anywhere/);
});
