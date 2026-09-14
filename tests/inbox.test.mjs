import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/store.js';
import '../legacy/inbox.js';

const create = () => GatherStore.createStore({ storage: null });
const add = (store, taskId, extra = {}) => store.addMessage({ sender: 'Jules Miller', subject: 'Event update', body: 'Waiting for approval.', taskId, ...extra });

test('different threads for one task collect together, with all accepted and set-aside history', () => {
  const store = create();
  const a = add(store, 'bus', { threadId: 'a' });
  store.applyMessage(a.id);
  const b = add(store, 'bus', { threadId: 'b' });
  store.ignoreMessage(b.id);
  const c = add(store, 'bus', { threadId: 'c' });
  const group = GatherInbox.conversations(store.getState()).find(g => g.taskId === 'bus');
  for (const m of [a,b,c]) assert.ok(group.messages.some(item => item.id === m.id));
  assert.ok(!group.pending.some(item => item.id === a.id || item.id === b.id));
  assert.ok(group.pending.some(item => item.id === c.id));
});

test('explicit task links win over subject matching; one email thread never merges two tasks', () => {
  const store = create();
  const a = add(store, 'bus', { threadId: 'mixed' });
  const b = add(store, 'dietary', { threadId: 'mixed', subject: 'Buses and transport' });
  assert.equal(b.suggested.taskId, 'dietary');
  const groups = GatherInbox.conversations(store.getState());
  assert.notEqual(groups.find(g => g.messages.some(m => m.id === a.id)).key, groups.find(g => g.messages.some(m => m.id === b.id)).key);
  const ambiguous = store.addMessage({ sender: 'Jack', subject: 'Re: event update', body: 'More details', threadId: 'mixed' });
  assert.equal(ambiguous.suggested.mode, 'new');
});

test('a confirmed task link automatically groups later replies despite changed subjects', () => {
  const store = create();
  add(store, 'bus', { threadId: 'reply-chain' });
  const reply = store.addMessage({ sender: 'Unknown vendor', subject: 'New details', body: 'Payment received.', threadId: 'reply-chain' });
  assert.equal(reply.suggested.taskId, 'bus');
  assert.equal(GatherInbox.taskFor(reply, store.getState().tasks).id, 'bus');
});

test('preview and accepted audit exactly match normalized saved task values', () => {
  for (const mode of ['new','update']) for (const status of ['todo','progress','blocked','done']) for (const verify of [false,true]) for (const category of [undefined,'','   ','Transport']) {
    const store = create();
    store.updateTask('bus', { status: 'todo', requiresVerification: verify });
    const message = add(store, 'bus', { body: 'Booking confirmed.' });
    const values = { mode, taskId: 'bus', title: '  Book buses  ', owner: 'jack', status, dueDate: '2027-05-20', note: '  Latest update  ', ...(category === undefined ? {} : { category }) };
    const diff = GatherInbox.changes(message, store.getState(), values);
    const saved = store.applyMessage(message.id, values);
    const accepted = store.getState().messages.find(m => m.id === message.id).approved;
    for (const field of diff.fields) {
      assert.equal(saved[field.key], field.after, `${mode}/${status}/${verify}/${category}/${field.key}`);
      assert.equal(accepted[field.key], field.after);
    }
    if (mode === 'new') assert.equal(diff.current, null);
  }
});

test('stale and older emails cannot silently overwrite a newer task update', () => {
  const store = create();
  const old = add(store, 'bus', { receivedAt: '2025-01-01', body: 'Old note' });
  const fresh = add(store, 'bus', { receivedAt: '2026-01-01', body: 'New note' });
  store.applyMessage(fresh.id);
  assert.throws(() => store.applyMessage(old.id), /task changed/);
  store.refreshProposal(old.id);
  assert.throws(() => store.applyMessage(old.id), /newer email/);
  store.applyMessage(old.id, { confirmConflict: true });
});

test('reader exposes field comparison, preserves selected history, and escapes email text', () => {
  const store = create();
  const message = add(store, 'bus', { body: '<img src=x onerror=alert(1)> Waiting for approval.' });
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const context = vm.createContext({ GatherInbox, store, ui: { messageId: message.id }, h: escape, icon: () => '', pageHeading: () => '', pending: s => s.messages.filter(m => !m.appliedTaskId && !m.ignoredAt), empty: () => '', statusBadge: v => v, member: id => ({ name: id || 'Unassigned' }), dayLabel: x => x || 'No due date', timeLabel: x => x, statuses: { blocked: 'Blocked', progress: 'In progress', done: 'Done', todo: 'To do' }, options: () => '', ownerOptions: () => '', statusOptions: () => '' });
  vm.runInContext(readFileSync('legacy/inbox-view.js','utf8'),context);
  let html = context.inboxView(store.getState());
  assert.match(html, /BEFORE YOU ACCEPT/);
  assert.match(html, /After accepting/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  store.applyMessage(message.id);
  html = context.inboxView(store.getState());
  assert.match(html, /ACCEPTED UPDATE/);
  assert.doesNotMatch(html, /id="emailReviewForm"/);
  assert.equal(context.ui.messageId, message.id);
});
