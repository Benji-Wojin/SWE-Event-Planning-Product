import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('embedded chat shares flow with reviewed proposals instead of taking another viewport',()=>{
  const css=readFileSync('app/globals.css','utf8'),page=readFileSync('app/plan/page.tsx','utf8');
  assert.match(page,/id="embeddedPlan" className="plan-sidebar-shell"/);
  assert.match(css,/\.plan-sidebar-review>\.ask-weft-panel\{height:auto;min-height:0;min-width:0\}/);
  assert.match(css,/\.plan-sidebar-review \.ask-weft-panel \.task-chat\{height:auto;gap:10px\}/);
  assert.match(css,/\.plan-sidebar-review \.task-chat-thread\{flex:none;min-height:160px;max-height:min\(300px,38dvh\)\}/);
  assert.match(css,/\[aria-label="Review draft"\]\{display:grid;gap:16px;margin-top:0;padding-top:20px;border-top:/);
  assert.match(css,/\.task-chat-message>p[^}]*white-space:pre-wrap/,'keep written step line breaks');
  assert.doesNotMatch(css,/\.plan-sidebar-review[^}]*position:fixed/,'no floating controls over proposal text');
});
