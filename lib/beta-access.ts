import { env } from '@/lib/runtime';

export const privateBetaEnabled = () => env.WEFT_PRIVATE_BETA === 'true';

/** Call only with the verified server session, never an email from a form. */
export async function hasBetaAccess(user: { userId: string; email: string }): Promise<boolean> {
  if (!privateBetaEnabled()) return true;
  const email = user.email.trim().toLowerCase();
  if (!email || !user.userId) return false;
  if (email === env.GATHER_OWNER_EMAIL.trim().toLowerCase()) return true;
  // Existing accounts retain access. Project invitations alone do not grant beta admission.
  if (await env.DB.prepare('SELECT 1 FROM members WHERE user_id=?')
    .bind(user.userId).first()) return true;
  const allowed = (env.WEFT_BETA_EMAILS || '').split(/[\s,;]+/)
    .map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email);
}
