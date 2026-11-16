import { env } from '@/lib/runtime';
import {
  TUTORIAL_STEPS, TUTORIAL_VERSION, type TutorialCheckpoint,
} from './guided-tutorial';

type SaveCheckpoint = 'project_created' | 'task_created' | 'invite_created';
type Step = (typeof TUTORIAL_STEPS)[number];
type TutorialRow = {
  checkpoint: TutorialCheckpoint;
  occurred_at: string;
  project_id: string | null;
  task_id: string | null;
};

type SaveGuard = 'previous-write' | { taskId: string; revision: number };
function prepareCheckpoint(
  userId: string, step: Step, projectId: string | null, guard?: SaveGuard,
) {
  const predecessor = 'after' in step ? step.after : '';
  const closes = 'before' in step ? step.before : '';
  const binding = step.id === 'project_created' ? projectId : null;
  const taskId = step.id === 'task_created' && guard && guard !== 'previous-write' ? guard.taskId : null;
  // One guarded statement, not a read-then-write race. Clicks can be missing,
  // but a prerequisite milestone must already be durable for this same account.
  return env.DB.prepare(`INSERT INTO guided_tutorial_events (user_id,version,checkpoint,occurred_at,project_id,task_id)
    SELECT m.user_id,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,?
    FROM members m WHERE m.user_id=?
      ${guard === 'previous-write' ? 'AND changes()=1' : guard ? `AND EXISTS (
        SELECT 1 FROM workspaces w, json_each(w.data,'$.tasks') t
        WHERE w.id=? AND w.revision=? AND json_extract(t.value,'$.id')=?)` : ''}
      AND (?='' OR EXISTS (SELECT 1 FROM guided_tutorial_events e
        WHERE e.user_id=m.user_id AND e.version=? AND e.checkpoint=?))
      AND (?='' OR NOT EXISTS (SELECT 1 FROM guided_tutorial_events e
        WHERE e.user_id=m.user_id AND e.version=? AND e.checkpoint=?))
      ${projectId === null ? '' : `AND EXISTS (SELECT 1 FROM projects p WHERE p.id=? AND p.owner_id=m.user_id)
        ${step.id === 'project_created' ? '' : `AND EXISTS (SELECT 1 FROM guided_tutorial_events e
          WHERE e.user_id=m.user_id AND e.version=? AND e.checkpoint='project_created' AND e.project_id=?)`}`}
    ON CONFLICT(user_id,version,checkpoint) DO NOTHING`)
    .bind(TUTORIAL_VERSION, step.id, binding, taskId, userId,
      ...(guard && guard !== 'previous-write' ? [projectId, guard.revision, guard.taskId] : []),
      predecessor, TUTORIAL_VERSION, predecessor, closes, TUTORIAL_VERSION, closes,
      ...(projectId === null ? [] : step.id === 'project_created' ? [projectId] : [projectId, TUTORIAL_VERSION, projectId]));
}

/** Pass the server-resolved account. This never accepts completion events. */
export async function recordTutorialObservation(userId: string, id: unknown, projectId: string | null) {
  const step = TUTORIAL_STEPS.find(step => step.id === id);
  if (!step || (step.evidence !== 'interaction' && step.evidence !== 'view')) return false;
  const beforeProject = step.id === 'started' || step.id === 'create_project_clicked' || step.id === 'setup_viewed';
  if (beforeProject !== (projectId === null)) return false;
  const saved = await prepareCheckpoint(userId, step, projectId).run();
  return saved.meta.changes === 1;
}

/** Place immediately after the successful primary write in the same batch. */
export function tutorialCheckpointAfterCommit(userId: string, id: SaveCheckpoint, projectId: string) {
  const step = TUTORIAL_STEPS.find(step => step.id === id &&
    (step.evidence === 'project_commit' || step.evidence === 'task_commit' || step.evidence === 'invite_commit'));
  if (!step || !projectId) throw new Error('Tutorial completion requires committed project evidence.');
  return prepareCheckpoint(userId, step, projectId, 'previous-write');
}

/** Append after legacy usage counters; the exact new task and workspace CAS prove the save. */
export function tutorialCheckpointAfterTask(userId: string, projectId: string, taskId: string, revision: number) {
  const step = TUTORIAL_STEPS.find(step => step.id === 'task_created')!;
  return prepareCheckpoint(userId, step, projectId, { taskId, revision });
}
/** Used for resume; caller supplies only the authenticated account. */
export async function readTutorialProgress(userId: string) {
  // Keep historical funnel progress, but hide its task pointer if the account
  // no longer owns the bound project. The workspace checks that the task is active.
  const { results } = await env.DB.prepare(`SELECT e.checkpoint,e.occurred_at,e.project_id,
    CASE WHEN e.checkpoint='task_created' AND e.task_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM guided_tutorial_events bound
      JOIN projects p ON p.id=bound.project_id AND p.owner_id=bound.user_id
      WHERE bound.user_id=e.user_id AND bound.version=e.version AND bound.checkpoint='project_created'
    ) THEN e.task_id ELSE NULL END AS task_id
    FROM guided_tutorial_events e WHERE e.user_id=? AND e.version=?`)
    .bind(userId, TUTORIAL_VERSION).all<TutorialRow>();
  const events = new Map(results.map(row => [row.checkpoint, row]));
  return {
    version: TUTORIAL_VERSION,
    projectId: events.get('project_created')?.project_id ?? null,
    firstTaskId: events.get('task_created')?.task_id ?? null,
    events: TUTORIAL_STEPS.flatMap(step => {
      const row = events.get(step.id);
      return row ? [{ checkpoint: step.id, at: row.occurred_at }] : [];
    }),
  };
}
