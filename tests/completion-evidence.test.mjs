import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/completion-ui.js';
const create = () => GatherStore.createStore({ storage: null });
const task = (store, id) => store.getState().tasks.find((t) => t.id === id);
test('completion evidence is optional, persists and amendments do not inherit verification', () => {
  const store = create(),
    t = store.addTask({
      title: 'Fictional hall check',
      owner: 'maya',
      requiresVerification: true,
    });
  store.reportCompletion(
    t.id,
    {
      note: 'Checked the hall.',
      links: ['https://www.nasa.gov/'],
      fileIds: ['file_123'],
    },
    'maya',
  );
  assert.equal(task(store, t.id).status, 'progress');
  assert.equal(task(store, t.id).completionEvidence.links.length, 1);
  store.verifyTask(t.id);
  const verified = task(store, t.id).verifiedAt;
  assert.equal(task(store, t.id).completionEvidenceReviewAt, verified);
  store.setCompletionEvidence(
    t.id,
    { note: 'Added a follow-up detail.' },
    'maya',
  );
  assert.equal(task(store, t.id).verifiedAt, verified);
  assert.equal(task(store, t.id).completionEvidenceReviewAt, '');
  assert.match(
    GatherCompletionUI.section(task(store, t.id), true),
    /amended after task verification/,
  );
  assert.equal(task(store, t.id).completionEvidenceHistory.length, 1);
  const raw = store.exportState(),
    restored = GatherStore.createStore({
      storage: {
        getItem: (key) => (key === GatherStore.STORAGE_KEY ? raw : null),
        setItem() {},
      },
    });
  assert.deepEqual(
    task(restored, t.id).completionEvidence,
    task(store, t.id).completionEvidence,
  );
  store.updateTask(t.id, { status: 'progress' });
  assert.equal(task(store, t.id).completionEvidence, null);
  assert.equal(task(store, t.id).completionEvidenceHistory.length, 2);
  store.reportCompletion(t.id, 'Checked again.', 'maya');
  assert.deepEqual(task(store, t.id).completionEvidence.fileIds, []);
});
test('evidence validation fails atomically, stays bounded and requires owner or organizer', () => {
  const store = create(),
    t = store.addTask({ title: 'Fictional completed task', owner: 'maya' });
  store.reportCompletion(t.id, 'Done.', 'maya');
  for (const input of [
    { note: 'x'.repeat(3001) },
    { links: ['javascript:alert(1)'] },
    { links: ['https://user:pass@nasa.gov/'] },
    { links: ['https://127.0.0.1/'] },
    { links: ['https://nasa.gov/?token=secret'] },
    { links: Array(6).fill('https://www.nasa.gov/') },
    { fileIds: ['../file'] },
    { secret: 'no' },
  ]) {
    const before = store.exportState();
    assert.throws(() => store.setCompletionEvidence(t.id, input, 'maya'));
    assert.equal(store.exportState(), before);
  }
  assert.throws(
    () => store.setCompletionEvidence(t.id, { note: 'No' }, 'dev'),
    /owner or organizer/,
  );
  for (let i = 0; i < 12; i++)
    store.setCompletionEvidence(t.id, { note: 'Revision ' + i }, 'maya');
  assert.equal(task(store, t.id).completionEvidenceHistory.length, 10);
});
test('evidence UI escapes untrusted content and does not fabricate live historical file links', () => {
  const html = GatherCompletionUI.section(
    {
      status: 'done',
      completionEvidence: {
        note: '<script>bad</script>',
        links: ['https://www.nasa.gov/'],
        fileIds: ['missing'],
        at: new Date().toISOString(),
      },
    },
    false,
  );
  assert.ok(!html.includes('<script>'));
  assert.match(html, /availability not checked/);
  assert.ok(!html.includes('file=missing'));
  assert.match(html, /not independent verification/);
  assert.match(GatherCompletionUI.fields(), /optional/);
});
