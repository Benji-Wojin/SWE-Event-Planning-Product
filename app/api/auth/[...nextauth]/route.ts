import NextAuth from 'next-auth';
import type { NextRequest } from 'next/server';
import { getAuthOptions, isAuthConfigured } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handler(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  if (!isAuthConfigured()) {
    return Response.json({ error: 'Sign-in is not configured yet. Contact the app owner.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    return await NextAuth(getAuthOptions())(request, context);
  } catch {
    return Response.json({ error: 'Sign-in is temporarily unavailable. Please try again.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export { handler as GET, handler as POST };
