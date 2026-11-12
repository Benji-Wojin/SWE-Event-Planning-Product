import { createHash } from 'node:crypto';

// Project owner actors are all named "jack". Scope this device preference to
// the authenticated account as well, without exposing its sign-in identifier.
export function notificationScope(userId: string, projectId: string) {
  return createHash('sha256')
    .update(JSON.stringify(['weft-task-reminders-v1', userId, projectId]))
    .digest('hex');
}
