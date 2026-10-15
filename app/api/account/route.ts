import { getChatGPTUser } from '@/app/chatgpt-auth';
import { HttpError, json, organizerAccount, requireBetaAccess, safe } from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function GET() {
  return safe(async () => {
    const identity = await getChatGPTUser();
    if (!identity) throw new HttpError(401, 'Sign in to Weft.');
    await requireBetaAccess(identity);
    let organizer = false;
    try {
      await organizerAccount(); organizer = true;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 403) throw error;
    }
    return json({
      name: identity.displayName,
      email: identity.email,
      organizer,
    });
  });
}
