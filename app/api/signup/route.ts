import { body, HttpError, json, registerAccount, safe } from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return safe(async () => {
    if (Object.keys(await body(request)).length)
      throw new HttpError(
        400,
        'Account details come from your verified Google account.',
      );
    await registerAccount();
    return json({ created: true });
  });
}
