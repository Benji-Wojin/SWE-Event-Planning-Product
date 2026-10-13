import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production schedules the authenticated Gmail runner every five minutes', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons, [
    { path: '/api/gmail/automatic-run', schedule: '*/5 * * * *' },
  ]);
  const route = readFileSync(new URL('../app/api/gmail/automatic-run/route.ts', import.meta.url), 'utf8');
  assert.match(route, /export const maxDuration = 110/);
  assert.match(route, /authorize\(request\)/);
});
