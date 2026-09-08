import { env } from 'cloudflare:workers';
import { HttpError, nonce, seal, unseal } from './security';
export const redirectUri = () => env.GATHER_ORIGIN + '/api/gmail/callback';
export async function configuration() {
  const row = await env.DB.prepare('SELECT payload FROM settings WHERE id=?')
    .bind('google-oauth')
    .first<any>();
  return row ? await unseal(row.payload, 'google-oauth') : null;
}
export async function connection(userId: string) {
  const row = await env.DB.prepare(
    'SELECT payload,generation FROM gmail_connections WHERE user_id=?',
  )
    .bind(userId)
    .first<any>();
  return row
    ? {
        ...(await unseal(row.payload, 'gmail:' + userId)),
        generation: row.generation,
        storedPayload: row.payload,
      }
    : null;
}
export async function saveConnection(
  userId: string,
  value: any,
  rotate = false,
) {
  if (!value?.generation || !value.storedPayload)
    throw new HttpError(409, 'Gmail was disconnected. Reconnect to continue.');
  const { storedPayload, generation, ...data } = value;
  const result = await env.DB.prepare(
    'UPDATE gmail_connections SET payload=?,generation=? WHERE user_id=? AND generation=? AND payload=?',
  )
    .bind(
      await seal(data, 'gmail:' + userId),
      rotate ? nonce() : generation,
      userId,
      generation,
      storedPayload,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(
      409,
      'Your Gmail connection changed. Reload and try again.',
    );
}
export async function tokenRequest(params: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const result = (await response.json()) as any;
  if (!response.ok)
    throw new HttpError(
      400,
      result.error === 'invalid_grant'
        ? 'Google authorization expired or was revoked. Reconnect Gmail.'
        : 'Google could not complete authorization. Check the OAuth client and redirect URI.',
    );
  return result;
}
export async function gmail(userId: string, path: string) {
  let conn = await connection(userId);
  if (!conn) throw new HttpError(409, 'Connect Gmail first.');
  if (conn.expiresAt < Date.now() + 60000) {
    const config = await configuration();
    if (!config || !conn.refreshToken)
      throw new HttpError(409, 'Reconnect Gmail to continue.');
    const token = await tokenRequest({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: 'refresh_token',
    });
    conn = {
      ...conn,
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      refreshToken: token.refresh_token || conn.refreshToken,
    };
    await saveConnection(userId, conn);
  }
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/' + path,
    { headers: { Authorization: 'Bearer ' + conn.accessToken } },
  );
  if (!response.ok)
    throw new HttpError(
      response.status === 429 ? 429 : 502,
      response.status === 401
        ? 'Gmail needs to be reconnected.'
        : 'Gmail could not complete this request. Try again later.',
    );
  return (await response.json()) as any;
}
export async function beginOAuth(userId: string) {
  const config = await configuration();
  if (!config) throw new HttpError(409, 'Save your Google OAuth client first.');
  const state = nonce(),
    verifier = nonce(48);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  await env.DB.prepare('DELETE FROM oauth_states WHERE expires<? OR user_id=?')
    .bind(Date.now(), userId)
    .run();
  await env.DB.prepare(
    'INSERT INTO oauth_states (id,user_id,payload,expires) VALUES (?,?,?,?)',
  )
    .bind(
      state,
      userId,
      await seal({ verifier }, 'oauth:' + state),
      Date.now() + 10 * 60000,
    )
    .run();
  return (
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
  );
}
export function readPlain(payload: any): string {
  const parts = [payload, ...(payload?.parts || [])];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      try {
        return new TextDecoder()
          .decode(
            Uint8Array.from(
              atob(part.body.data.replace(/-/g, '+').replace(/_/g, '/')),
              (c) => c.charCodeAt(0),
            ),
          )
          .slice(0, 24000);
      } catch {}
    }
    if (part !== payload && part.parts) {
      const text = readPlain(part);
      if (text) return text;
    }
  }
  return '';
}
