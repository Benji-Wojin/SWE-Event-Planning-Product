import { env } from '@/lib/runtime';
import { HttpError, isAppOwner, principal } from './security';
import { freshWorkspace } from './workspace';
import { projectUser } from './project-access';

type User = Awaited<ReturnType<typeof principal>>;
// Legacy links still address main. New projects must be explicitly owned;
// internal demo and booking workspace keys are never accepted as project IDs.
export async function projectScope(user: User, request?: Request | string) {
  return (await projectUser(user,request)).projectId;
}
export async function listProjects(user: User) {
  const rows = await env.DB.prepare(`SELECT w.id,w.data FROM workspaces w LEFT JOIN projects p ON p.id=w.id
    WHERE (w.id='main' AND EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin')) OR p.owner_id=?
    OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id=w.id AND m.user_id=? AND m.revoked_at='')
    ORDER BY p.created_at DESC,w.id`).bind(user.userId,user.userId,user.userId).all<any>();
  return rows.results.map(row => {
    const state = JSON.parse(row.data);
    return { id: row.id, name: state.event.name || 'Untitled project', date: state.event.date || '', location: state.event.location || '',
      openTaskCount: state.tasks.filter((task: any) => task.status !== 'done' && !task.archivedAt).length };
  });
}
export async function createProject(user: User, input: any) {
  if (Object.keys(input).some(key => !['requestId', 'event'].includes(key)) ||
    typeof input.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId))
    throw new HttpError(400, 'Reload the form and try again.');
  // Match projectUser: owners use a project-local actor, not their global member ID.
  const owner = { ...user, actorId: 'jack', role: 'admin' };
  const store = freshWorkspace(owner);
  try { store.completeSetup(input.event, owner.actorId); }
  catch (error) { throw new HttpError(400, (error as Error).message); }
  const event = { ...store.getState().event, setupCompletedAt: '' };
  const payload = JSON.stringify(event), id = 'p_' + input.requestId;
  const appOwner = isAppOwner(user), totalLimit = appOwner ? 100 : 20;
  const dailyLimit = appOwner ? 100 : 5;
  const since = new Date(Date.now() - 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO projects (id,owner_id,request_payload,created_at)
      SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM projects WHERE owner_id=?)<?
      AND (SELECT COUNT(*) FROM projects WHERE owner_id=? AND created_at>?)<?`)
      .bind(id,user.userId,payload,new Date().toISOString(),user.userId,totalLimit,user.userId,since,dailyLimit),
    env.DB.prepare(`INSERT OR IGNORE INTO workspaces (id,data,revision) SELECT ?,?,1
      WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=? AND request_payload=?)`)
      .bind(id,store.exportState(),id,user.userId,payload),
  ]);
  const row = await env.DB.prepare('SELECT request_payload FROM projects WHERE id=? AND owner_id=?').bind(id,user.userId).first<any>();
  if (!row) throw new HttpError(409, `Project limit reached: ${totalLimit} projects per account and ${dailyLimit} new projects in 24 hours.`);
  if (row.request_payload !== payload) throw new HttpError(409, 'This form already created a project with different details. Return to Projects to open it.');
  return { id };
}
