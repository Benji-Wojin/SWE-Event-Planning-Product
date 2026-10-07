import { env } from '@/lib/runtime';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { HttpError, nonce, seal, unseal } from './security';
import { type ProjectUser, projectOwner } from './project-access';
import { mailbox, senderStatus } from './invitation-sender';
import { deliveryView, sendInvitation, type DeliveryView } from './invitation-delivery';

type Invite = {
  id: string;
  project_id: string;
  email: string;
  token_hash: string;
  payload: string;
  created_by: string;
  created_at: string;
  expires_at: number;
  accepted_by: string;
  revoked_at: string;
};
type TeamMember = {
  id: string;
  actorId: string;
  name: string;
  email: string;
  revision: number;
};
export type TeamView = {
  projectId: string;
  name: string;
  owner: { name: string; email: string };
  members: TeamMember[];
  invitations: { id: string; email: string; expiresAt: number; link: string; delivery: DeliveryView }[];
  sender: Awaited<ReturnType<typeof senderStatus>>;
};
export type InviteView = {
  name: string;
  email: string;
  joined: boolean;
  projectId: string;
};

const emailOf = (value: string) => value.trim().toLowerCase();
const tokenHash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
function organizer(user: ProjectUser) {
  if (user.role !== 'admin')
    throw new HttpError(403, 'Only the organizer can manage project access.');
}
function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new HttpError(400, 'Unsupported invitation field.');
}
async function projectName(id: string) {
  const row = await env.DB.prepare('SELECT data FROM workspaces WHERE id=?')
    .bind(id)
    .first<{ data: string }>();
  if (!row) throw new HttpError(404, 'Project not found.');
  return JSON.parse(row.data).event.name as string;
}
async function invitationLink(invite: Invite) {
  const { token } = await unseal(invite.payload, 'invite:' + invite.id);
  return '/join?invite=' + encodeURIComponent(token);
}
export async function readTeam(user: ProjectUser): Promise<TeamView> {
  organizer(user);
  const [members, invites] = await Promise.all([
    env.DB.prepare(
      "SELECT p.id,p.actor_id AS actorId,m.name,m.email,p.revision FROM project_members p JOIN members m ON m.user_id=p.user_id WHERE p.project_id=? AND p.revoked_at='' ORDER BY p.joined_at",
    )
      .bind(user.projectId)
      .all<TeamMember>(),
    env.DB.prepare(
      "SELECT * FROM project_invites WHERE project_id=? AND revoked_at='' AND accepted_by='' AND expires_at>? ORDER BY created_at DESC",
    )
      .bind(user.projectId, Date.now())
      .all<Invite>(),
  ]);
  return {
    projectId: user.projectId,
    name: await projectName(user.projectId),
    owner: { name: user.displayName, email: user.email },
    members: members.results,
    sender: await senderStatus(user.userId),
    invitations: await Promise.all(
      invites.results.map(async (invite) => ({
        id: invite.id,
        email: invite.email,
        expiresAt: invite.expires_at,
        link: await invitationLink(invite),
        delivery: await deliveryView(invite.id),
      })),
    ),
  };
}
export async function changeTeam(
  user: ProjectUser,
  input: Record<string, unknown>,
) {
  organizer(user);
  if (input.action === 'sendInvite') {
    fields(input, ['action', 'email', 'requestId', 'senderEmail']);
    const sender = await senderStatus(user.userId);
    if (!sender.connected || input.senderEmail !== sender.email)
      throw new HttpError(409, 'Connect the invitation sender and reload Team access before sending.');
    await changeTeam(user, { action: 'invite', email: input.email, requestId: input.requestId });
    await sendInvitation(user, input.requestId as string, input.senderEmail);
    return readTeam(user);
  }
  if (input.action === 'sendExistingInvite') {
    fields(input, ['action', 'id', 'senderEmail']);
    if (typeof input.id !== 'string') throw new HttpError(400, 'Choose an invitation.');
    await sendInvitation(user, input.id, input.senderEmail);
    return readTeam(user);
  }
  if (input.action === 'invite') {
    fields(input, ['action', 'email', 'requestId']);
    if (
      typeof input.email !== 'string' ||
      input.email.length > 254 ||
      !mailbox(input.email.trim())
    )
      throw new HttpError(400, 'Enter a valid email address.');
    if (
      typeof input.requestId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(input.requestId)
    )
      throw new HttpError(400, 'Reload the invitation form.');
    const email = emailOf(input.email);
    if (email === emailOf(user.email))
      throw new HttpError(400, 'You already organize this project.');
    const existing = await env.DB.prepare(
      'SELECT * FROM project_invites WHERE id=?',
    )
      .bind(input.requestId)
      .first<Invite>();
    if (existing) {
      if (
        existing.project_id !== user.projectId ||
        existing.email !== email ||
        existing.created_by !== user.userId
      )
        throw new HttpError(
          409,
          'That request was already used. Reload the invitation form.',
        );
      return readTeam(user);
    }
    const member = await env.DB.prepare(
      "SELECT 1 FROM project_members p JOIN members m ON m.user_id=p.user_id WHERE p.project_id=? AND lower(m.email)=? AND p.revoked_at=''",
    )
      .bind(user.projectId, email)
      .first();
    if (member) throw new HttpError(409, 'This person has already joined.');
    const token = nonce(),
      now = Date.now();
    const result =
      await env.DB.prepare(`INSERT OR IGNORE INTO project_invites (id,project_id,email,token_hash,payload,created_by,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM project_invites WHERE project_id=?)<500
      AND (SELECT COUNT(*) FROM project_invites WHERE project_id=? AND accepted_by='' AND revoked_at='' AND expires_at>?)<50
      AND NOT EXISTS (SELECT 1 FROM project_invites WHERE project_id=? AND email=? AND accepted_by='' AND revoked_at='' AND expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM project_members p JOIN members m ON m.user_id=p.user_id WHERE p.project_id=? AND lower(m.email)=? AND p.revoked_at='')`)
        .bind(
          input.requestId,
          user.projectId,
          email,
          await tokenHash(token),
          await seal({ token }, 'invite:' + input.requestId),
          user.userId,
          new Date(now).toISOString(),
          now + 7 * 86400000,
          user.projectId,
          user.projectId,
          now,
          user.projectId,
          email,
          now,
          user.projectId,
          email,
        )
        .run();
    if (result.meta.changes !== 1) {
      const retry = await env.DB.prepare(
        'SELECT project_id,email,created_by FROM project_invites WHERE id=?',
      )
        .bind(input.requestId)
        .first<Pick<Invite, 'project_id' | 'email' | 'created_by'>>();
      if (
        !retry ||
        retry.project_id !== user.projectId ||
        retry.email !== email ||
        retry.created_by !== user.userId
      )
        throw new HttpError(
          409,
          'An invitation is already pending, the person has joined, or the project invitation limit was reached. Reload the list.',
        );
    }
  } else if (input.action === 'revokeInvite') {
    fields(input, ['action', 'id']);
    if (typeof input.id !== 'string')
      throw new HttpError(400, 'Choose an invitation.');
    await env.DB.prepare(
      "UPDATE project_invites SET revoked_at=? WHERE id=? AND project_id=? AND accepted_by='' AND revoked_at=''",
    )
      .bind(new Date().toISOString(), input.id, user.projectId)
      .run();
  } else if (input.action === 'removeMember') {
    fields(input, ['action', 'id', 'revision']);
    if (
      typeof input.id !== 'string' ||
      typeof input.revision !== 'number' ||
      !Number.isInteger(input.revision)
    )
      throw new HttpError(400, 'Reload the team before removing access.');
    const at = new Date().toISOString();
    const results = await env.DB.batch([
      env.DB.prepare(
        "UPDATE project_members SET revoked_at=?,revision=revision+1 WHERE id=? AND project_id=? AND revision=? AND revoked_at=''",
      ).bind(at, input.id, user.projectId, input.revision),
      env.DB.prepare(`UPDATE project_invites SET revoked_at=? WHERE project_id=? AND accepted_by='' AND revoked_at=''
        AND email IN (SELECT lower(m.email) FROM project_members p JOIN members m ON m.user_id=p.user_id WHERE p.id=? AND p.project_id=? AND p.revoked_at=? AND p.revision=?)`).bind(
        at,
        user.projectId,
        input.id,
        user.projectId,
        at,
        input.revision + 1,
      ),
      env.DB.prepare(
        'UPDATE workspaces SET revision=revision+1 WHERE id=? AND EXISTS (SELECT 1 FROM project_members WHERE id=? AND project_id=? AND revoked_at=? AND revision=?)',
      ).bind(user.projectId, input.id, user.projectId, at, input.revision + 1),
    ]);
    if (results[0].meta.changes !== 1)
      throw new HttpError(
        409,
        'Team access changed. Reload the team and try again.',
      );
  } else throw new HttpError(400, 'Choose a team action.');
  return readTeam(user);
}

async function invitation(token: unknown) {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to accept this invitation.');
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token))
    throw new HttpError(404, 'Invitation not found.');
  const invite = await env.DB.prepare(
    'SELECT * FROM project_invites WHERE token_hash=?',
  )
    .bind(await tokenHash(token))
    .first<Invite>();
  if (
    !invite ||
    invite.revoked_at ||
    invite.expires_at <= Date.now() ||
    !(await projectOwner(invite.project_id))
  )
    throw new HttpError(
      410,
      'This invitation expired or was revoked. Ask the organizer for a new one.',
    );
  if (emailOf(user.email) !== invite.email)
    throw new HttpError(
      403,
      'This invitation is for a different email. Sign in with the email your organizer invited.',
    );
  if (invite.accepted_by) {
    const membership = await env.DB.prepare(
      "SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND revoked_at=''",
    )
      .bind(invite.project_id, user.userId)
      .first();
    if (invite.accepted_by !== user.userId || !membership)
      throw new HttpError(
        410,
        'This invitation has already been used. Ask the organizer for a new one.',
      );
  }
  return { user, invite };
}
export async function previewInvitation(token: unknown): Promise<InviteView> {
  const { user, invite } = await invitation(token);
  return {
    name: await projectName(invite.project_id),
    email: user.email,
    joined: !!invite.accepted_by,
    projectId: invite.project_id,
  };
}
export async function acceptInvitation(input: Record<string, unknown>) {
  fields(input, ['token']);
  const { user, invite } = await invitation(input.token);
  if (invite.accepted_by) return { projectId: invite.project_id };
  // Each statement checks the same single-use invitation inside one D1 transaction.
  const valid =
    "EXISTS (SELECT 1 FROM project_invites WHERE id=? AND accepted_by='' AND revoked_at='' AND expires_at>?)";
  const args = [invite.id, Date.now()],
    at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO members (user_id,actor_id,email,name,role) SELECT ?,?,?,?,'member' WHERE ${valid}`,
    ).bind(
      user.userId,
      'u_' + crypto.randomUUID(),
      user.email,
      user.displayName,
      ...args,
    ),
    env.DB.prepare(`INSERT INTO project_members (id,project_id,user_id,actor_id,invite_id,joined_at)
      SELECT ?,?,?,actor_id,?,? FROM members WHERE user_id=? AND ${valid}
      AND (SELECT COUNT(*) FROM project_members WHERE project_id=? AND revoked_at='')<50
      AND ((SELECT COUNT(*) FROM project_members WHERE project_id=?)<500 OR EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=?))
      ON CONFLICT(project_id,user_id) DO UPDATE SET revoked_at='',revision=project_members.revision+1,invite_id=excluded.invite_id,joined_at=excluded.joined_at`).bind(
      crypto.randomUUID(),
      invite.project_id,
      user.userId,
      invite.id,
      at,
      user.userId,
      ...args,
      invite.project_id,
      invite.project_id,
      invite.project_id,
      user.userId,
    ),
    env.DB.prepare(`UPDATE project_invites SET accepted_by=? WHERE id=? AND accepted_by='' AND revoked_at='' AND expires_at>?
      AND EXISTS (SELECT 1 FROM project_members WHERE project_id=? AND user_id=? AND invite_id=? AND revoked_at='')`).bind(
      user.userId,
      invite.id,
      args[1],
      invite.project_id,
      user.userId,
      invite.id,
    ),
    env.DB.prepare(
      'UPDATE workspaces SET revision=revision+1 WHERE id=? AND EXISTS (SELECT 1 FROM project_invites WHERE id=? AND accepted_by=?)',
    ).bind(invite.project_id, invite.id, user.userId),
  ]);
  const accepted = await env.DB.prepare(
    'SELECT accepted_by FROM project_invites WHERE id=?',
  )
    .bind(invite.id)
    .first<{ accepted_by: string }>();
  if (accepted?.accepted_by !== user.userId)
    throw new HttpError(
      409,
      'This invitation could not be accepted. Ask the organizer to check team capacity or send a new invitation.',
    );
  return { projectId: invite.project_id };
}
