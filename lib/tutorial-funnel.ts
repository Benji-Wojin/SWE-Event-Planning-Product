import { env } from '@/lib/runtime';
import { HttpError, isAppOwner, principal } from './security';
import { nextTutorialMilestone, TUTORIAL_STEPS, TUTORIAL_VERSION, type TutorialCheckpoint } from './guided-tutorial';

const PAGE_SIZE = 30;
type Count = { checkpoint: string; accounts: number };
type Event = { code: string; checkpoint: TutorialCheckpoint; at: string };

export async function readTutorialFunnel(after?: string) {
  const viewer = await principal();
  if (!isAppOwner(viewer)) throw new HttpError(403, 'Not found.');
  const cursor = typeof after === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(after) ? after : '';
  const [counts, events] = await Promise.all([
    env.DB.prepare(`SELECT e.checkpoint,COUNT(*) AS accounts
      FROM guided_tutorial_events e JOIN members m ON m.user_id=e.user_id
      WHERE e.version=? AND m.user_id<>? GROUP BY e.checkpoint`)
      .bind(TUTORIAL_VERSION, viewer.userId).all<Count>(),
    env.DB.prepare(`WITH accounts AS (
      SELECT m.user_id,m.actor_id FROM guided_tutorial_events e JOIN members m ON m.user_id=e.user_id
      WHERE e.version=? AND e.checkpoint='started' AND m.actor_id>? AND m.user_id<>?
      ORDER BY m.actor_id LIMIT ?
    )
    SELECT a.actor_id AS code,e.checkpoint,e.occurred_at AS at
    FROM accounts a JOIN guided_tutorial_events e ON a.user_id=e.user_id AND e.version=?
    ORDER BY a.actor_id,e.occurred_at,e.checkpoint`)
      .bind(TUTORIAL_VERSION, cursor, viewer.userId, PAGE_SIZE+1, TUTORIAL_VERSION).all<Event>(),
  ]);
  const groups = new Map<string, Event[]>();
  for (const event of events.results) {
    const existing = groups.get(event.code);
    if (existing) existing.push(event);
    else groups.set(event.code,[event]);
  }
  const countByStep = new Map(counts.results.map(row => [row.checkpoint,row.accounts]));
  const rows = [...groups].slice(0,PAGE_SIZE).map(([code,items]) => {
    const reached = new Map(items.map(item => [item.checkpoint,item.at]));
    return { code, next: nextTutorialMilestone([...reached.keys()]), events: TUTORIAL_STEPS.flatMap(step => {
      const at = reached.get(step.id);
      return at ? [{ checkpoint: step.id, at }] : [];
    }) };
  });
  return {
    version: TUTORIAL_VERSION,
    counts: TUTORIAL_STEPS.map(step => ({ checkpoint: step.id, accounts: countByStep.get(step.id) ?? 0 })),
    rows, after: cursor, next: groups.size>PAGE_SIZE ? rows.at(-1)!.code : '',
  };
}
