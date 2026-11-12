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
    if (!actor || !dayFormat.test(today)) return [];
    return tasks.filter(task => task.owner === actor && task.status !== 'done' &&
      !task.archivedAt && !(task.reportedAt && task.requiresVerification && !task.verifiedAt) &&
      dayFormat.test(task.dueDate) && task.dueDate <= today)
      .map(({ id, title, dueDate }) => ({ id, title, dueDate, overdue: dueDate < today }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }
  const api = Object.freeze({ preferenceKey, readReminderPreference, writeReminderPreference, taskReminders });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeftNotifications = api;
})(typeof window !== 'undefined' ? window : globalThis);
