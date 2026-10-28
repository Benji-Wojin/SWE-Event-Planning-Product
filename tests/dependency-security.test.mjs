import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync('package.json','utf8'));
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
test('patched Next release is pinned consistently in manifest and lockfile',()=>{
  assert.equal(manifest.dependencies.next,'16.4.3');
  assert.equal(lock.packages[''].dependencies.next,manifest.dependencies.next);
  assert.equal(lock.packages['node_modules/next'].version,manifest.dependencies.next);
  assert.equal(lock.packages['node_modules/@next/env'].version,manifest.dependencies.next);
});
test('every locked Undici uses the reviewed patched version',()=>{
  assert.equal(manifest.overrides.undici,'7.30.1');
  const copies=Object.entries(lock.packages).filter(([path])=>path.endsWith('/undici'));
  assert.ok(copies.length>0);
  for(const [path,pkg] of copies)assert.equal(pkg.version,'7.30.1',path);
});
test('the old CLI-config Zod pin cannot reintroduce vulnerable copies',()=>{
  assert.equal(manifest.overrides['@vercel/cli-config'].zod,'4.6.7');
  const copies=Object.entries(lock.packages).filter(([path])=>path.endsWith('/zod'));
  assert.ok(copies.length>0);
  for(const [path,pkg] of copies)assert.equal(pkg.version,'4.6.7',path);
});
test('dependency patches do not re-enable Ask Weft or mailbox access',()=>{
  const policy=readFileSync('lib/release-policy.ts','utf8');
  assert.match(policy,/export const ASK_WEFT_ENABLED = false;/);
  assert.match(policy,/export const GMAIL_ENABLED = false;/);
});
