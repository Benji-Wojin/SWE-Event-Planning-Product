import { body, json, principal, safe } from '@/lib/security';
import { submitFeedback } from '@/lib/beta-feedback';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return safe(async () => {
    const input = await body(request);
    const user = await principal();
    return json(await submitFeedback(user.userId, input));
  });
}
