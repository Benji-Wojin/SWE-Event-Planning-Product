import { body, HttpError, json, principal, safe } from '@/lib/security';
import { recordAppOpen } from '@/lib/product-activity';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return safe(async () => {
    if (Object.keys(await body(request, 64)).length) throw new HttpError(400, 'Unexpected activity data.');
    const user = await principal();
    await recordAppOpen(user.userId);
    return json({ ok: true });
  });
}
