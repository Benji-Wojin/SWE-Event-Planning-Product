import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie',
    },
  });
}
export async function safe(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return json(
      {
        error:
          e instanceof HttpError
            ? e.message
            : 'The request could not be completed. Please retry.',
      },
      e instanceof HttpError ? e.status : 500,
    );
  }
}
export function guard(request: Request) {
  if (
    request.headers.get('origin') !== env.GATHER_ORIGIN ||
    request.headers.get('x-gather-request') !== '1' ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    throw new HttpError(
      403,
      'Request verification failed. Reload Gather and try again.',
    );
}
export async function body(request: Request) {
  guard(request);
  const raw = await request.text();
  if (raw.length > 50000) throw new HttpError(413, 'This update is too large.');
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'Invalid request.');
  }
}
export function nonce(length = 32) {
  return base64(crypto.getRandomValues(new Uint8Array(length)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}
function base64(value: Uint8Array) {
  return btoa(String.fromCharCode(...value));
}
function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
async function key() {
  if (!env.GATHER_ENCRYPTION_KEY)
    throw new HttpError(503, 'Private storage is not configured.');
  return crypto.subtle.importKey(
    'raw',
    bytes(env.GATHER_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function seal(value: unknown, context: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return base64(iv) + '.' + base64(new Uint8Array(data));
}
export async function unseal(value: string, context: string): Promise<any> {
  const [iv, data] = value.split('.');
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: bytes(iv),
          additionalData: new TextEncoder().encode(context),
        },
        await key(),
        bytes(data),
      ),
    ),
  );
}
export async function principal() {
  const user = await getChatGPTUser();
  if (!user) throw new HttpError(401, 'Sign in to Gather to continue.');
  let member = await env.DB.prepare('SELECT * FROM members WHERE user_id=?')
    .bind(user.userId)
    .first<any>();
  if (!member) {
    const owner =
      !!env.GATHER_OWNER_EMAIL &&
      user.email.toLowerCase() === env.GATHER_OWNER_EMAIL.toLowerCase();
    // The Sites access gate decides admission; app roles never come from a request body.
    if (!owner)
      throw new HttpError(
        403,
        'This private workspace is currently available only to its owner.',
      );
    await env.DB.prepare(
      'INSERT OR IGNORE INTO members (user_id,actor_id,email,name,role) VALUES (?,?,?,?,?)',
    )
      .bind(user.userId, 'jack', user.email, user.displayName, 'admin')
      .run();
    member = await env.DB.prepare('SELECT * FROM members WHERE user_id=?')
      .bind(user.userId)
      .first<any>();
    if (!member)
      throw new HttpError(
        403,
        'This account is not a member of this workspace.',
      );
  }
  return { ...user, actorId: member.actor_id, role: member.role };
}
export async function administrator() {
  const user = await principal();
  if (user.role !== 'admin')
    throw new HttpError(
      403,
      'Only the organizer can access private details or email connections.',
    );
  return user;
}
