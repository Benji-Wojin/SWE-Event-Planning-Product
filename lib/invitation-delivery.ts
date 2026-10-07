import { env } from '@/lib/runtime';
import { HttpError, unseal } from './security';
import { type ProjectUser, projectOwner } from './project-access';
import { mailbox, readySender } from './invitation-sender';

type DeliveryRow = {
  status: string;
  attempts: number;
  attempted_at: number;
  sent_at: number;
  sender: string;
  issue: string;
};
export type DeliveryView = {
  status: 'unsent' | 'sending' | 'sent' | 'failed' | 'unknown';
  sentAt: number;
  sender: string;
  issue: string;
  retryAt: number;
  canRetry: boolean;
};
export async function deliveryView(inviteId: string): Promise<DeliveryView> {
  const row = await env.DB.prepare(
    'SELECT status,attempts,attempted_at,sent_at,sender,issue FROM invitation_deliveries WHERE invite_id=?',
  )
    .bind(inviteId)
    .first<DeliveryRow>();
  let status = (row?.status || 'unsent') as DeliveryView['status'];
  if (status === 'sending' && row!.attempted_at < Date.now() - 60000)
    status = 'unknown';
  return {
    status,
    sentAt: row?.sent_at || 0,
    sender: row?.sender || '',
    issue:
      status === 'unknown'
        ? 'Sending could not be confirmed. Check the sender’s Sent folder before revoking or replacing this invitation.'
        : row?.issue || '',
    retryAt: row ? row.attempted_at + 60000 : 0,
    canRetry:
      (status === 'unsent' || status === 'failed') && (row?.attempts || 0) < 3,
  };
}
function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}
export async function sendInvitation(
  user: ProjectUser,
  id: string,
  expectedSender: unknown,
) {
  if (
    user.role !== 'admin' ||
    (await projectOwner(user.projectId)) !== user.userId
  )
    throw new HttpError(
      403,
      'Only the organizer can send project invitations.',
    );
  const invite = await env.DB.prepare(
    "SELECT email,payload,expires_at FROM project_invites WHERE id=? AND project_id=? AND created_by=? AND accepted_by='' AND revoked_at='' AND expires_at>?",
  )
    .bind(id, user.projectId, user.userId, Date.now())
    .first<{ email: string; payload: string; expires_at: number }>();
  if (!invite)
    throw new HttpError(
      409,
      'This invitation is no longer pending. Reload Team access.',
    );
  if (!mailbox(invite.email))
    throw new HttpError(
      400,
      'This invitation needs a single valid email address. Revoke it and invite again.',
    );
  const previous = await deliveryView(id);
  if (['sent', 'sending', 'unknown'].includes(previous.status)) return;
  const sender = await readySender(user.userId);
  if (sender.email !== expectedSender)
    throw new HttpError(
      409,
      'The sender account changed. Reload Team access before sending.',
    );
  const workspace = await env.DB.prepare(
    'SELECT data FROM workspaces WHERE id=?',
  )
    .bind(user.projectId)
    .first<{ data: string }>();
  if (!workspace) throw new HttpError(404, 'Project not found.');
  const name = String(JSON.parse(workspace.data).event.name).slice(0, 300);
  const { token } = await unseal(invite.payload, 'invite:' + id);
  const link = new URL(
    '/join?invite=' + encodeURIComponent(token),
    env.GATHER_ORIGIN,
  ).href;
  const text = `${user.displayName.slice(0, 150)} invited you to ${name} on Weft.\n\nAccept invitation:\n${link}\n\nSign in with ${invite.email}. This link expires ${new Date(invite.expires_at).toISOString().slice(0, 10)} and only works for this address.\n\nIf the private site says you do not have access, ask the organizer to add you in the site's sharing settings.\n\nIf you weren't expecting this invitation, you can ignore it.`;
  // The subject is fixed and body is MIME-encoded. Names cannot inject headers.
  const mime = [
    `From: Weft <${sender.email}>`,
    `To: ${invite.email}`,
    'Subject: Weft project invitation',
    `Message-ID: <gather-${id}@${new URL(env.GATHER_ORIGIN).hostname}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(text)
      .match(/.{1,76}/g)!
      .join('\r\n'),
  ].join('\r\n');
  const raw = base64(mime)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const lease = crypto.randomUUID(),
    now = Date.now();
  // Atomic claim + durable quota entry. Repeated requests cannot dispatch again.
  const claimed = await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO invitation_deliveries (invite_id) VALUES (?)',
    ).bind(id),
    env.DB.prepare(`UPDATE invitation_deliveries SET status='sending',lease=?,attempts=attempts+1,attempted_at=?,sender=?,issue=''
      WHERE invite_id=? AND status IN ('unsent','failed') AND attempts<3 AND attempted_at<?
      AND EXISTS (SELECT 1 FROM project_invites WHERE id=? AND project_id=? AND created_by=? AND revoked_at='' AND accepted_by='' AND expires_at>?)
      AND EXISTS (SELECT 1 FROM gmail_senders WHERE user_id=? AND generation=?)
      AND (SELECT COUNT(*) FROM invitation_send_attempts WHERE user_id=? AND started_at>?)<50`).bind(
      lease,
      now,
      sender.email,
      id,
      now - 60000,
      id,
      user.projectId,
      user.userId,
      now,
      user.userId,
      sender.generation,
      user.userId,
      now - 86400000,
    ),
    env.DB.prepare(`INSERT INTO invitation_send_attempts (id,user_id,invite_id,started_at)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM invitation_deliveries WHERE invite_id=? AND lease=? AND status='sending')`).bind(
      lease,
      user.userId,
      id,
      now,
      id,
      lease,
    ),
  ]);
  if (claimed[1].meta.changes !== 1) {
    const current = await deliveryView(id);
    if (['sent', 'sending', 'unknown'].includes(current.status)) return;
    throw new HttpError(
      409,
      'Could not send. Reload Team access; wait at least a minute between attempts. Limits: 3 attempts per invitation and 50 in 24 hours.',
    );
  }
  let status = 'unknown',
    providerId = '',
    issue = '';
  try {
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + sender.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(20000),
      },
    );
    if (response.ok) {
      const receipt = (await response.json()) as { id?: unknown };
      if (
        typeof receipt.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,200}$/.test(receipt.id)
      ) {
        status = 'sent';
        providerId = receipt.id;
      }
    } else if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408
    ) {
      status = 'failed';
      issue =
        response.status === 401
          ? 'Reconnect the invitation Gmail account, then retry.'
          : response.status === 429
            ? 'Gmail limited sending. Wait and retry later.'
            : response.status === 403
              ? 'Gmail rejected sending. Check Gmail API access, consent, and account sending limits before retrying.'
              : 'Gmail rejected this invitation. Check the recipient address before retrying.';
    }
  } catch {
    /* Network uncertainty must never trigger an automatic resend. */
  }
  // If this write fails, the durable sending claim becomes unknown, not retryable.
  const saved = await env.DB.prepare(
    "UPDATE invitation_deliveries SET status=?,provider_id=?,sent_at=?,issue=? WHERE invite_id=? AND lease=? AND status='sending'",
  )
    .bind(
      status,
      providerId,
      status === 'sent' ? Date.now() : 0,
      issue,
      id,
      lease,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new HttpError(
      409,
      'Sending could not be confirmed. Reload Team access and check Gmail before trying again.',
    );
}
