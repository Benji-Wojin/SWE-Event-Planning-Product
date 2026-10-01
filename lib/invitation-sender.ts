import { env } from 'cloudflare:workers';
import { configuration, connection, redirectUri, tokenRequest } from './gmail';
import { HttpError, nonce, seal, unseal } from './security';
import { projectUser, type ProjectUser, type User } from './project-access';

const sendScope = 'https://www.googleapis.com/auth/gmail.send';
// Mail headers only accept a single ASCII addr-spec, never a display name or list.
export const mailbox = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 254 &&
  /^[a-zA-Z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(
    value,
  );

export async function senderConnection(userId: string) {
  const row = await env.DB.prepare(
    'SELECT payload,generation FROM gmail_senders WHERE user_id=?',
  )
    .bind(userId)
    .first<{ payload: string; generation: string }>();
  if (!row) return null;
  const data = (await unseal(row.payload, 'gmail-sender:' + userId)) as {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    email: string;
    sub: string;
  };
  return { ...data, generation: row.generation, storedPayload: row.payload };
}
export async function senderStatus(userId: string) {
  const [config, sender] = await Promise.all([
    configuration(),
    senderConnection(userId),
  ]);
  return {
    configured: !!config,
    connected: !!sender,
    email: sender?.email || '',
  };
}
export async function beginSenderOAuth(user: ProjectUser) {
  if (user.role !== 'admin')
    throw new HttpError(
      403,
      'Only the organizer can connect an invitation sender.',
    );
  const config = await configuration();
  if (!config)
    throw new HttpError(
      409,
      'Set up the Google client in Gmail settings first.',
    );
  const state = 'send_' + nonce(),
    verifier = nonce(48);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  await env.DB.batch([
    env.DB.prepare(
      'DELETE FROM sender_oauth_states WHERE expires<? OR user_id=?',
    ).bind(Date.now(), user.userId),
    env.DB.prepare(
      'INSERT INTO sender_oauth_states (id,user_id,payload,expires) VALUES (?,?,?,?)',
    ).bind(
      state,
      user.userId,
      await seal(
        {
          verifier,
          projectId: user.projectId,
          configPayload: config.storedPayload,
        },
        'sender-oauth:' + state,
      ),
      Date.now() + 600000,
    ),
  ]);
  return (
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email ' + sendScope,
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
  );
}
export async function finishSenderOAuth(user: User, url: URL) {
  const state = url.searchParams.get('state') || '';
  const row = await env.DB.prepare(
    'SELECT payload FROM sender_oauth_states WHERE id=? AND user_id=? AND expires>?',
  )
    .bind(state, user.userId, Date.now())
    .first<{ payload: string }>();
  if (!row)
    throw new HttpError(
      400,
      'This sender authorization expired or was cancelled. Return to Team access and connect again.',
    );
  const secret = await unseal(row.payload, 'sender-oauth:' + state);
  const scoped = await projectUser(user, secret.projectId);
  if (scoped.role !== 'admin')
    throw new HttpError(403, 'Only the organizer can connect a sender.');
  const returnTo =
    env.GATHER_ORIGIN + '/team?project=' + encodeURIComponent(scoped.projectId);
  if (url.searchParams.has('error')) {
    await env.DB.prepare(
      'DELETE FROM sender_oauth_states WHERE id=? AND user_id=?',
    )
      .bind(state, user.userId)
      .run();
    return Response.redirect(returnTo + '&sender=cancelled', 303);
  }
  const config = await configuration(),
    code = url.searchParams.get('code');
  if (!config || config.storedPayload !== secret.configPayload)
    throw new HttpError(
      409,
      'The Google client changed. Return to Team access and connect again.',
    );
  if (!code)
    throw new HttpError(400, 'Google did not return an authorization code.');
  const token = await tokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: secret.verifier,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  if (!String(token.scope).split(' ').includes(sendScope))
    throw new HttpError(
      400,
      'Approve Gmail sending access to send invitations.',
    );
  if (
    !token.access_token ||
    !token.refresh_token ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0
  )
    throw new HttpError(
      400,
      'Google did not grant complete offline access. Return to Team access and connect again.',
    );
  const response = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    {
      headers: { Authorization: 'Bearer ' + token.access_token },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new HttpError(
      502,
      'Google could not verify the sender. Connect again.',
    );
  const profile = (await response.json()) as {
    email?: unknown;
    email_verified?: unknown;
    sub?: unknown;
  };
  if (
    !mailbox(profile.email) ||
    profile.email_verified !== true ||
    typeof profile.sub !== 'string' ||
    !profile.sub
  )
    throw new HttpError(
      400,
      'Google could not verify this email address. Connect a verified Gmail account.',
    );
  const imported = await connection(user.userId);
  if (imported?.email?.toLowerCase() === profile.email.toLowerCase())
    throw new HttpError(
      409,
      'Choose your separate Weft Gmail account, not the mailbox connected for importing.',
    );
  const payload = await seal(
    {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      email: profile.email.toLowerCase(),
      sub: profile.sub,
    },
    'gmail-sender:' + user.userId,
  );
  // State survives until this atomic commit so disconnect/config changes invalidate delayed callbacks.
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO gmail_senders (user_id,payload,generation)
      SELECT user_id,?,? FROM sender_oauth_states WHERE id=? AND user_id=? AND expires>?
      AND EXISTS (SELECT 1 FROM settings WHERE id='google-oauth' AND payload=?)
      AND COALESCE((SELECT payload FROM gmail_connections WHERE user_id=?),'')=?
      ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,generation=excluded.generation`).bind(
      payload,
      nonce(),
      state,
      user.userId,
      Date.now(),
      config.storedPayload,
      user.userId,
      imported?.storedPayload || '',
    ),
    env.DB.prepare(
      'DELETE FROM sender_oauth_states WHERE id=? AND user_id=?',
    ).bind(state, user.userId),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      409,
      'Sender authorization was cancelled or already completed.',
    );
  return Response.redirect(returnTo + '&sender=connected', 303);
}
export async function disconnectSender(userId: string) {
  // Local removal avoids revoking other Google grants for the same OAuth client.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gmail_senders WHERE user_id=?').bind(userId),
    env.DB.prepare('DELETE FROM sender_oauth_states WHERE user_id=?').bind(
      userId,
    ),
  ]);
}
export async function readySender(userId: string) {
  let sender = await senderConnection(userId);
  if (!sender)
    throw new HttpError(409, 'Connect the invitation Gmail account first.');
  if (sender.expiresAt < Date.now() + 60000) {
    const config = await configuration();
    if (!config) throw new HttpError(409, 'Reconnect the invitation sender.');
    const token = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: sender.refreshToken,
      grant_type: 'refresh_token',
    });
    if (
      !token.access_token ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0 ||
      (token.scope && !String(token.scope).split(' ').includes(sendScope))
    )
      throw new HttpError(409, 'Reconnect the invitation sender.');
    const { storedPayload, generation, ...data } = sender;
    const updated = {
      ...data,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || sender.refreshToken,
      expiresAt: Date.now() + token.expires_in * 1000,
    };
    const payload = await seal(updated, 'gmail-sender:' + userId);
    const result = await env.DB.prepare(
      'UPDATE gmail_senders SET payload=? WHERE user_id=? AND generation=? AND payload=?',
    )
      .bind(payload, userId, generation, storedPayload)
      .run();
    if (result.meta.changes !== 1)
      throw new HttpError(
        409,
        'The invitation sender changed. Reload Team access and try again.',
      );
    sender = { ...updated, generation, storedPayload: payload };
  }
  return sender;
}
