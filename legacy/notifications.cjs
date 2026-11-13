(function (root) {
  'use strict';
  const dayFormat = /^\d{4}-\d{2}-\d{2}$/;
  function preferenceKey(scope) {
    return typeof scope === 'string' && /^[0-9a-f]{64}$/.test(scope)
      ? 'weft-task-reminders:v1:' + scope : '';
  }
  function readReminderPreference(scope) {
    const key = preferenceKey(scope);
    if (!key) return false;
    try { return root.localStorage.getItem(key) === '1'; }
    catch (_) { return false; }
  }
  function writeReminderPreference(scope, enabled) {
    const key = preferenceKey(scope);
    if (!key) return false;
    try {
      if (enabled) root.localStorage.setItem(key, '1');
      else root.localStorage.removeItem(key);
      return true;
    } catch (_) { return false; }
  }
  function taskReminders(tasks, actor, today) {
    if (!actor) return [];
    const open = tasks.filter(task => task.owner === actor && task.status !== 'done' &&
      !task.archivedAt && !(task.reportedAt && task.requiresVerification && !task.verifiedAt));
    const byTitle = (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    const returned = open.filter(task => !task.reportedAt && task.completionReview);
    const returnedIds = new Set(returned.map(task => task.id));
    const revisions = returned.map(({ id, title }) => ({ id, title, kind: 'completion-changes' })).sort(byTitle);
    if (!dayFormat.test(today)) return revisions;
    const due = open.filter(task => !returnedIds.has(task.id) && dayFormat.test(task.dueDate) && task.dueDate <= today)
      .map(({ id, title, dueDate }) => ({ id, title, dueDate, overdue: dueDate < today }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || byTitle(a, b));
    return [...revisions, ...due];
  }
  const api = Object.freeze({ preferenceKey, readReminderPreference, writeReminderPreference, taskReminders });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeftNotifications = api;
})(typeof window !== 'undefined' ? window : globalThis);
