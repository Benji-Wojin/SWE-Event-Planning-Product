import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

const source = readFileSync('legacy/app.js', 'utf8');
const css = readFileSync('legacy/styles.css', 'utf8');
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const schedule = GatherScheduleUI.create({ h, options: () => '', statusBadge: () => '' });
const date = '2026-11-20';
const activity = (id, owner, start) => ({ id, owner, title: id, status: 'todo', schedule: { start, end: '', location: 'Fictional hall' } });
const other = activity('Other crew setup', 'dev', date + 'T15:00');
const tomorrow = activity('My next-day setup', 'maya', '2026-11-21T09:00');
const added = activity('My recovered shift', 'maya', date + 'T18:00');
const planned = { id: 'untimed', title: 'Untimed shift', owner: 'maya', eventActivity: true, status: 'todo' };

function fragment(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function fixture(tasks, scope = { mine: true, date }) {
  const opens = [], reads = [], marker = new Set();
  const state = { tasks, event: { name: 'Fictional workshop', timeZone: 'America/Los_Angeles' }, members: [{ id: 'maya', name: 'Maya Fiction' }, { id: 'dev', name: 'Dev Fiction' }] };
  const ui = { view: 'timeline', timelineMode: 'schedule', scheduleMine: scope.mine, scheduleDate: scope.date, actor: 'maya' };
  const stale = { hidden: true }, notice = { hidden: true }, status = { textContent: '' };
  const printMarker = { toggleAttribute(key, on) { if (on) marker.add(key); else marker.delete(key); } };
  const node = { setAttribute() {}, toggleAttribute() {}, focus() {} };
  let revision = 1, remote = 1, nextTasks = tasks, prints = 0, downloads = 0;
  const link = { click() { downloads++; }, remove() {} };
  const context = vm.createContext({ ui, Date, h, Blob, schedule,scheduleWorkspaceKey:()=> 'fictional-project:maya',
    window: { GatherMode: { projectId: 'fictional-project' }, print() { prints++; } },
    document: { hidden: false, createElement: () => link, body: { append() {} } },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} }, setTimeout: callback => callback(),
    store: {
      getState: () => state,
      getSnapshotRevision: () => revision,
      async confirmSnapshotRevision(expected, onNewer) {
        reads.push('check');
        if (remote > expected) onNewer(remote);
        return expected === remote;
      },
      async refresh(canApply, { requireFresh }) {
        reads.push('refresh');
        assert.equal(requireFresh, true);
        assert.equal(canApply(remote), true);
        state.tasks = nextTasks;
        revision = remote;
        return { changed: true, verified: true };
      },
    },
    $: selector => ({ '#eventRunSheet': node, '#dialogTitle': node, '#dialogBackdrop': { hidden: false },
      '#runSheetStale': stale, '#runSheetRefresh': node, '#runSheetRefreshStatus': status, '#runSheetPrintBlocked': printMarker,
      '#runSheetEmpty': node, '#runSheetTextFallback': node, '#workspaceSyncNotice': notice })[selector] ?? null,
    $$: () => [], toast() {}, render() {},
    openDialog(title, body, footer, wide, kind, focusHeading) { opens.push({ title, body, footer, wide, focusHeading }); ui.dialogKind = kind; },
  });
  vm.runInContext(fragment('  let staleScheduleRevision', '  function dependencyInfo('), context);
  const dispatch = fragment("      if(action==='run-sheet'", "      if(action==='task')");
  const run = action => { context.action = action; return vm.runInContext('(async()=>{' + dispatch + '})()', context); };
  return { opens, reads, marker, ui, run, stale,
    setRemote(tasks) { remote++; nextTasks = tasks; },
    get prints() { return prints; }, get downloads() { return downloads; },
  };
}

test('an empty personal date retains scope and cautions but never exports an empty team run sheet', async () => {
  const f = fixture([other, tomorrow, planned]);
  await f.run('run-sheet');
  const { title, body, footer, focusHeading } = f.opens[0];
  assert.equal(title, 'Event run sheet');
  assert.equal(focusHeading, true);
  assert.match(body, /My activities · Maya Fiction · .*Nov 20, 2026/);
  assert.match(body, /1 planned activity is not shown because it has no start time/);
  assert.match(body, /No scheduled activities in this scope on the selected date/);
  assert.match(body, /id="runSheetEmpty"[\s\S]*back to the schedule[\s\S]*date[\s\S]*All activities/i);
  assert.match(body, /id="runSheetPrintBlocked" data-blocked>No run sheet to print/);
  assert.doesNotMatch(body, /Other crew setup|My next-day setup|Untimed shift|Show text to copy/);
  assert.match(footer, /Back to schedule/);
  assert.match(footer, /Check for updates/);
  assert.doesNotMatch(footer, /Download text|Print \/ save PDF/);
  assert.equal(f.stale.hidden, true, 'empty is not itself stale');
  assert.equal(f.marker.has('data-blocked'), true);
  await f.run('print-run-sheet');
  await f.run('download-run-sheet');
  assert.equal(f.prints, 0);
  assert.equal(f.downloads, 0);
  assert.match(source, /window\.addEventListener\('beforeprint',[^\n]*currentRunSheet\(\)/);
  assert.match(css, /body:has\(#runSheetPrintBlocked\[data-blocked\]\) #eventRunSheet\{display:none!important\}/);
});

test('date-only and personal-only empty sheets explain which filter to change without changing it', async () => {
  for (const [tasks, scope, expected, excluded] of [
    [[tomorrow], { mine: false, date }, /choose another date|clear the date filter/, /switch to All activities/],
    [[other], { mine: true, date: '' }, /switch to All activities/, /clear the date filter/],
  ]) {
    const f = fixture(tasks, scope);
    await f.run('run-sheet');
    const body = f.opens[0].body;
    assert.match(body, expected);
    assert.doesNotMatch(body, excluded);
    assert.doesNotMatch(body, /My next-day setup|Other crew setup/);
    assert.equal(f.ui.scheduleMine, scope.mine);
    assert.equal(f.ui.scheduleDate, scope.date);
  }
});

test('the original empty scope can check and refresh, then only nonempty current scope can export', async () => {
  const f = fixture([other, tomorrow]);
  await f.run('run-sheet');
  await f.run('check-run-sheet');
  assert.deepEqual(f.reads, ['check']);
  assert.equal(f.stale.hidden, true);
  f.setRemote([other, tomorrow, added]);
  await f.run('check-run-sheet');
  assert.equal(f.stale.hidden, false);
  await f.run('refresh-run-sheet');
  assert.deepEqual(f.reads, ['check', 'check', 'refresh']);
  assert.equal(f.opens.length, 2);
  assert.match(f.opens[1].body, /My recovered shift/);
  assert.doesNotMatch(f.opens[1].body, /Other crew setup|My next-day setup|id="runSheetEmpty"/);
  assert.match(f.opens[1].footer, /Download text[\s\S]*Print \/ save PDF/);
  assert.equal(f.marker.has('data-blocked'), false);
  assert.equal(f.ui.runSheet.scope.mine, true);
  assert.equal(f.ui.runSheet.scope.date, date);
  await f.run('print-run-sheet');
  await f.run('download-run-sheet');
  assert.equal(f.prints, 1);
  assert.equal(f.downloads, 1);
});

test('refresh removes export options if the last in-scope activity was moved', async () => {
  const f = fixture([added, other, tomorrow]);
  await f.run('run-sheet');
  assert.equal(f.marker.has('data-blocked'), false);
  f.setRemote([other, tomorrow]);
  await f.run('check-run-sheet');
  assert.equal(f.marker.has('data-blocked'), true, 'known older rows are not printable');
  await f.run('refresh-run-sheet');
  assert.equal(f.stale.hidden, true);
  assert.equal(f.marker.has('data-blocked'), true, 'fresh but empty is still not printable');
  assert.match(f.opens.at(-1).body, /id="runSheetEmpty"/);
  assert.doesNotMatch(f.opens.at(-1).body, /My recovered shift|Other crew setup|My next-day setup/);
  assert.doesNotMatch(f.opens.at(-1).footer, /Download text|Print \/ save PDF/);
  await f.run('print-run-sheet');
  await f.run('download-run-sheet');
  assert.equal(f.prints, 0);
  assert.equal(f.downloads, 0);
});
