(function (root) {
  'use strict';
  const labels = { auto: 'Automatic', high: 'High', low: 'Low' };
  const resolved = task => Boolean(task && task.status === 'done' && (!task.requiresVerification || task.verifiedAt));
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  // Calendar days avoid daylight-saving changes affecting deadline urgency.
  const dayNumber = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value + 'T00:00:00Z') / 86400000 : NaN;
  function analyze(task, tasks = [], now = new Date()) {
    if (resolved(task)) return null;
    const today = dayNumber(dayKey(new Date(now))), days = dayNumber(task.dueDate) - today;
    const priority = Object.hasOwn(labels, task.priority) ? task.priority : 'auto';
    const factors = [];
    const add = (key, label, action, weight) => factors.push({ key, label, action, weight });
    if (days < 0) add('overdue', `${-days} ${days === -1 ? 'day' : 'days'} overdue`, 'Past its due date', 100 + Math.min(-days, 30) * 5);
    const dependents = tasks.filter(other => other.id !== task.id && !resolved(other) &&
      (other.dependencies || []).some(link => link.kind !== 'related' && link.taskId === task.id));
    if (dependents.length) add('dependency', `Needed by ${dependents.length} ${dependents.length === 1 ? 'task' : 'tasks'}`, 'Finish this to move linked work forward', Math.min(180, dependents.reduce((sum, item) => sum + (item.status === 'blocked' ? 80 : 25), 0)));
    if (days === 0) add('due', 'Due today', 'Due today', 70);
    else if (days > 0 && days <= 3) add('due', `Due in ${days} ${days === 1 ? 'day' : 'days'}`, 'Deadline approaching', 50 - days * 5);
    if (task.reportedAt && task.requiresVerification && !task.verifiedAt) add('verification', 'Verify completion', 'The owner reports this is finished', 60);
    const required = (task.dependencies || []).filter(link => link.kind !== 'related');
    const ready = task.status === 'blocked' && required.length > 0 && required.every(link => resolved(tasks.find(other => other.id === link.taskId)));
    if (ready) add('ready', 'Ready to resume', 'Review the results from linked tasks', 55);
    else if (task.status === 'blocked') add('blocked', 'Blocked', 'Needs a decision', 50);
    if (!task.owner) add('unassigned', 'No owner', 'Assign an owner', 30);
    if ((task.handoffs || []).some(item => item.status === 'pending')) add('handoff', 'Suggested follow-up', 'Review linked work', 20);
    const followup = dayNumber(task.followupAfter);
    if (followup <= today) add('followup', 'Follow-up due', 'Check in with the owner', 20);
    if (!(followup > today)) {
      if (!task.acceptedAt) add('acceptance', 'Acceptance pending', 'Ask the owner to accept', 10);
      if (!task.updatedAt || new Date(now).getTime() - new Date(task.updatedAt).getTime() >= 3 * 86400000) add('stale', 'No recent update', 'Request an update', 15);
    }
    if (!factors.length && priority !== 'high') return null;
    const primary = factors[0] || { key: 'priority', label: 'High priority', action: 'Prioritized by the organizer' };
    const summary = [priority !== 'auto' ? `${labels[priority]} priority` : '', ...factors.slice(0, 3).map(item => item.label)].filter(Boolean).join(' · ');
    return { ...primary, priority, summary, factors, overdue: days < 0, score: factors.reduce((sum, item) => sum + item.weight, 0) };
  }
  function rank(tasks, now = new Date()) {
    const order = { high: 0, auto: 1, low: 2 };
    return tasks.map(task => ({ task, info: analyze(task, tasks, now) })).filter(item => item.info).sort((a, b) =>
      Number(b.info.overdue) - Number(a.info.overdue) || order[a.info.priority] - order[b.info.priority] || b.info.score - a.info.score ||
      (a.task.dueDate || '9999').localeCompare(b.task.dueDate || '9999') || String(a.task.id).localeCompare(String(b.task.id))).map(item => item.task);
  }
  root.GatherPriorities = { analyze, rank, labels };
})(typeof window !== 'undefined' ? window : globalThis);
