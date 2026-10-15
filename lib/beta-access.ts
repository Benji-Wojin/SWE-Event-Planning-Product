import { env } from '@/lib/runtime';

export const privateBetaEnabled = () => env.WEFT_PRIVATE_BETA === 'true';

/** Call only with the verified server session, never an email from a form. */
export async function hasBetaAccess(user: { userId: string; email: string }): Promise<boolean> {
  if (!privateBetaEnabled()) return true;
  const email = user.email.trim().toLowerCase();
  if (!email || !user.userId) return false;
  if (email === env.GATHER_OWNER_EMAIL.trim().toLowerCase()) return true;
  // Existing accounts retain access even if their original invitation is later revoked.
  if (await env.DB.prepare('SELECT 1 FROM members WHERE user_id=?')
    .bind(user.userId).first()) return true;
  const allowed = (env.WEFT_BETA_EMAILS || '').split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(email)) return true;
  const ownerEmail = env.GATHER_OWNER_EMAIL.trim().toLowerCase();
  if (!ownerEmail) return false;
  // Only a live invitation from the app owner grants admission, not invitations
  // from other project organizers. Match the recipient's verified session email;
  // a forwarded link or a caller-supplied sender must never grant access.
  return !!await env.DB.prepare(`SELECT 1 FROM project_invites i
    JOIN members m ON m.user_id=i.created_by
    JOIN workspaces w ON w.id=i.project_id
    WHERE i.email=? AND i.accepted_by='' AND i.revoked_at='' AND i.expires_at>?
    AND lower(m.email)=? AND m.actor_id='jack' AND m.role='admin'
    AND (i.project_id='main' OR EXISTS (
      SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_id=i.created_by
    )) LIMIT 1`).bind(email, Date.now(), ownerEmail).first();
}
