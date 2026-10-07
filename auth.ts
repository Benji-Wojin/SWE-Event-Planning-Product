import { getServerSession, type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export type WeftUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

declare module 'next-auth' {
  interface Session {
    weftUser?: WeftUser;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    weftUser?: WeftUser;
  }
}

/** Only a configured canonical origin may receive OAuth redirects. */
export function authOrigin(): string | null {
  try {
    const url = new URL(process.env.NEXTAUTH_URL || '');
    const local = process.env.NODE_ENV !== 'production' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isAuthConfigured(): boolean {
  return Boolean(
    authOrigin() && process.env.NEXTAUTH_SECRET?.trim().length &&
    process.env.NEXTAUTH_SECRET.trim().length >= 32 &&
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function safeRelativeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 ||
    !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://app.local');
    const decodedPath = decodeURIComponent(url.pathname).replace(/\/+$/, '');
    if (url.origin !== 'https://app.local' ||
      ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(decodedPath) ||
      decodedPath === '/api/auth' || decodedPath.startsWith('/api/auth/')) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

export function safeAuthRedirect(value: string): string {
  const origin = authOrigin();
  if (!origin) return '/';
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return origin + '/';
    return origin + safeRelativeReturnPath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return origin + '/';
  }
}

function googleIdentity(profile: unknown): WeftUser | null {
  if (!profile || typeof profile !== 'object') return null;
  const p = profile as Record<string, unknown>;
  if (p.email_verified !== true || typeof p.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(p.sub) ||
    typeof p.email !== 'string' || p.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return null;
  const email = p.email.toLowerCase();
  const fullName = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 200) : null;
  return { userId: `google:${p.sub}`, email, fullName, displayName: fullName || email };
}

/** App membership remains in the database; signing in alone never grants a role. */
export function getAuthOptions(): NextAuthOptions {
  return {
    secret: process.env.NEXTAUTH_SECRET,
    providers: [GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: { params: { scope: 'openid email profile' } },
      checks: ['pkce', 'state'],
    })],
    session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
    pages: { signIn: '/signin-with-chatgpt', error: '/signin-with-chatgpt' },
    callbacks: {
      async signIn({ account, profile }) {
        return account?.provider === 'google' && Boolean(googleIdentity(profile));
      },
      async jwt({ token, account, profile }) {
        // Only the OAuth callback can establish identity. Ignore session-update input.
        if (account) {
          const identity = account.provider === 'google' ? googleIdentity(profile) : null;
          if (!identity) throw new Error('Verified Google identity required');
          token.weftUser = identity;
        }
        return token;
      },
      async session({ session, token }) {
        // Do not expose provider access tokens or trust the default email as identity.
        return { expires: session.expires, weftUser: token.weftUser };
      },
      async redirect({ url }) {
        return safeAuthRedirect(url);
      },
    },
    logger: {
      // Provider errors can contain sensitive request/token metadata.
      error() { console.error('Weft authentication failed.'); },
      warn() { console.warn('Weft authentication configuration warning.'); },
      debug() {},
    },
  };
}

export async function getAuthenticatedUser(): Promise<WeftUser | null> {
  if (!isAuthConfigured()) return null;
  try {
    const session = await getServerSession(getAuthOptions());
    const user = session?.weftUser;
    if (!user || typeof user.userId !== 'string' || !/^google:[A-Za-z0-9_-]{1,255}$/.test(user.userId) ||
      typeof user.email !== 'string' || !user.email || typeof user.displayName !== 'string' ||
      (user.fullName !== null && typeof user.fullName !== 'string')) return null;
    return user;
  } catch {
    // A broken/expired session must never fall back to caller-supplied identity headers.
    return null;
  }
}
