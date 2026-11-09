import { env } from '@/lib/runtime';
import { HttpError, isAppOwner, principal } from './security';

/** Append immediately after the authoritative save inside the same write batch. */
export function firstTaskAfterSave(userId: string) {
  return env.DB.prepare(`INSERT INTO onboarding_first_tasks (user_id,created_at)
    SELECT user_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM members
    WHERE changes()=1 AND user_id=? AND actor_id<>'jack'
    ON CONFLICT(user_id) DO NOTHING`).bind(userId);
}

const pageSize = 50;
type MilestoneRow = {
  account_code: string | null;
  first_project_at: string | null;
  first_task_at: string | null;
  accounts: number;
  projects: number;
  tasks: number;
  both: number;
};

export async function readOnboardingMilestones(after?: string) {
  // Use the global principal. Project organizers must never get app-wide access.
  const viewer = await principal();
  if (!isAppOwner(viewer)) throw new HttpError(403, 'Not found.');
  const cursor = typeof after === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(after) ? after : '';
  // One read snapshot for the full-cohort totals and a bounded page. No project or
  // task content, Google identity, email, or names are selected.
  const { results } = await env.DB.prepare(`WITH milestones AS (
      SELECT m.actor_id AS account_code,
        (SELECT MIN(p.created_at) FROM projects p WHERE p.owner_id=m.user_id) AS first_project_at,
        t.created_at AS first_task_at
      FROM members m LEFT JOIN onboarding_first_tasks t ON t.user_id=m.user_id
      WHERE m.user_id<>?
    ), totals AS (
      SELECT COUNT(*) AS accounts, COUNT(first_project_at) AS projects,
        COUNT(first_task_at) AS tasks,
        COUNT(CASE WHEN first_project_at IS NOT NULL AND first_task_at IS NOT NULL THEN 1 END) AS both
      FROM milestones
    ), page AS (
      SELECT * FROM milestones WHERE account_code>? ORDER BY account_code LIMIT ?
    )
    SELECT totals.*, page.* FROM totals LEFT JOIN page ON 1 ORDER BY page.account_code`)
    .bind(viewer.userId, cursor, pageSize + 1).all<MilestoneRow>();
  const rows = results.flatMap(row => row.account_code ? [{
    accountCode: row.account_code,
    firstProjectAt: row.first_project_at,
    firstTaskAt: row.first_task_at,
  }] : []);
  const { accounts, projects, tasks, both } = results[0];
  return {
    totals: { accounts, projects, tasks, both },
    rows: rows.slice(0, pageSize),
    after: cursor,
    next: rows.length > pageSize ? rows[pageSize - 1].accountCode : '',
  };
}
