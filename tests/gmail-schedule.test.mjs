import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public launch has no scheduled Gmail runner', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.crons, undefined);
  const route = readFileSync(new URL('../app/api/gmail/automatic-run/route.ts', import.meta.url), 'utf8');
  assert.match(route, /export const maxDuration = 110/);
  assert.match(route, /authorize\(request\)/);
  assert.match(route, /requireGmailEnabled\(\)/);
});
