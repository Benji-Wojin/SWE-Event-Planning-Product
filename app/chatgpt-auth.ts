import { redirect } from 'next/navigation';
import { getAuthenticatedUser, safeRelativeReturnPath, type WeftUser } from '@/auth';
import { hasBetaAccess } from '@/lib/beta-access';

// Compatibility exports for the existing app. Identity now comes from Google OAuth,
// never from the Sites-only oai-authenticated-* headers on a public Vercel request.
export type ChatGPTUser = WeftUser;
const SIGN_IN_PATH = '/signin-with-chatgpt';
const SIGN_OUT_PATH = '/signout-with-chatgpt';

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  return getAuthenticatedUser();
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) {
    if (!await hasBetaAccess(user)) redirect('/beta');
    return user;
  }

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = '/'): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}
