import { env } from 'cloudflare:workers';
import { HttpError, type principal } from './security';
export type User = Awaited<ReturnType<typeof principal>>;
export type ProjectUser = User & {
  projectId: string;
  membershipRevision: number;
  projectOwnerId: string;
};

export function projectIdFrom(request?: Request | string) {
  const id =
    typeof request === 'string'
      ? request
      : request
        ? (new URL(request.url).searchParams.get('project') ?? 'main')
        : 'main';
  if (
    id !== 'main' &&
    !/^p_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new HttpError(404, 'Project not found.');
  return id;
}
export async function projectOwner(id: string): Promise<string | undefined> {
  const row =
    id === 'main'
      ? await env.DB.prepare(
          "SELECT user_id AS owner_id FROM members WHERE actor_id='jack' AND role='admin'",
        ).first<{ owner_id: string }>()
      : await env.DB.prepare('SELECT owner_id FROM projects WHERE id=?')
          .bind(id)
          .first<{ owner_id: string }>();
  return row?.owner_id;
}
export async function projectUser(
  user: User,
  request?: Request | string,
): Promise<ProjectUser> {
  const projectId = projectIdFrom(request),
    ownerId = await projectOwner(projectId);
  if (ownerId === user.userId)
    return {
      ...user,
      actorId: 'jack',
      role: 'admin',
      projectId,
      projectOwnerId: ownerId,
      membershipRevision: 0,
    };
  const member =
    ownerId &&
    (await env.DB.prepare(
      "SELECT actor_id,revision FROM project_members WHERE project_id=? AND user_id=? AND revoked_at=''",
    )
      .bind(projectId, user.userId)
      .first<{ actor_id: string; revision: number }>());
  if (!member)
    throw new HttpError(
      404,
      'You do not have access to this project. Ask its organizer for an invitation.',
    );
  return {
    ...user,
    actorId: member.actor_id,
    role: 'member',
    projectId,
    projectOwnerId: ownerId!,
    membershipRevision: member.revision,
  };
}
// Repeat authorization inside each write, including the membership generation.
// Removing then re-inviting a person cannot revive their in-flight old writes.
export const projectWriteAccess = `((?='main' AND EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin'))
  OR EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=?)
  OR EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND revision=? AND revoked_at=''))`;
export const accessArgs = (user: ProjectUser) => [
  user.projectId,
  user.userId,
  user.projectId,
  user.userId,
  user.projectId,
  user.userId,
  user.membershipRevision,
];
export async function assertProjectAccess(user?: ProjectUser) {
  if (
    user &&
    !(await env.DB.prepare(`SELECT 1 WHERE ${projectWriteAccess}`)
      .bind(...accessArgs(user))
      .first())
  )
    throw new HttpError(
      403,
      'Your project access changed. Return to Projects.',
    );
}
