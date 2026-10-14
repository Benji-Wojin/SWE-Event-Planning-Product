import { env } from '@/lib/runtime';
import { HttpError } from './security';

// App-managed transactional delivery; never requests a user's mailbox access.
export function invitationEmailConfiguration() {
  const key = env.RESEND_API_KEY?.trim();
  const domain = env.RESEND_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!key || !domain || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return null;
  return { email: 'invites@' + domain, accessToken: key, generation: '' };
}

export function readyInvitationEmail() {
  const config = invitationEmailConfiguration();
  if (!config) throw new HttpError(409, 'Invitation email is unavailable. You can still invite people in the app.');
  return config;
}
