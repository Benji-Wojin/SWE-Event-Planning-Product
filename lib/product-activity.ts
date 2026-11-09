import { env } from '@/lib/runtime';
import { HttpError, isAppOwner, principal } from './security';

/** One counted entry per account and 30-minute UTC window, across tabs and devices. */
export async function recordAppOpen(userId: string) {
  await env.DB.prepare(`INSERT INTO product_activity_daily (user_id,day,app_opens,last_open_slot)
    SELECT user_id,date('now'),1,unixepoch('now')/1800 FROM members WHERE user_id=? AND actor_id<>'jack'
    ON CONFLICT(user_id,day) DO UPDATE SET
      app_opens=app_opens+1,last_open_slot=excluded.last_open_slot
    WHERE excluded.last_open_slot>product_activity_daily.last_open_slot`).bind(userId).run();
}

/** Must follow the authoritative write directly in its atomic batch. */
export function taskActivityAfterSave(userId: string, created: number, completed: number) {
  return env.DB.prepare(`INSERT INTO product_activity_daily (user_id,day,tasks_created,tasks_completed)
    SELECT user_id,date('now'),?,? FROM members WHERE changes()=1 AND user_id=? AND actor_id<>'jack'
    ON CONFLICT(user_id,day) DO UPDATE SET
      tasks_created=tasks_created+excluded.tasks_created,tasks_completed=tasks_completed+excluded.tasks_completed`)
    .bind(created, completed, userId);
}

type Daily = { day: string; active: number; opens: number; created: number; completed: number };
export async function readProductActivity(viewer: Awaited<ReturnType<typeof principal>>) {
  if (!isAppOwner(viewer)) throw new HttpError(403, 'Not found.');
  const { results } = await env.DB.prepare(`WITH RECURSIVE days(day) AS (
      SELECT date('now') UNION ALL SELECT date(day,'-1 day') FROM days WHERE day>date('now','-13 days')
    ), recent AS (
      SELECT a.* FROM product_activity_daily a JOIN members m ON m.user_id=a.user_id
      WHERE a.day BETWEEN date('now','-13 days') AND date('now') AND m.actor_id<>'jack'
    ), weekly AS (
      SELECT COUNT(DISTINCT user_id) AS weekly_active FROM recent WHERE day>=date('now','-6 days')
    )
    SELECT days.day,COUNT(recent.user_id) AS active,COALESCE(SUM(app_opens),0) AS opens,
      COALESCE(SUM(tasks_created),0) AS created,COALESCE(SUM(tasks_completed),0) AS completed,weekly.weekly_active
    FROM days CROSS JOIN weekly LEFT JOIN recent ON recent.day=days.day
    GROUP BY days.day ORDER BY days.day DESC`).all<Daily & { weekly_active: number }>();
  return {
    weeklyActive: results[0].weekly_active,
    days: results.map(({ day, active, opens, created, completed }) => ({ day, active, opens, created, completed })),
  };
}
