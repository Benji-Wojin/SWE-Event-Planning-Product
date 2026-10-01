import { env } from 'cloudflare:workers';
import { HttpError, json, safe } from '@/lib/security';
import { runDueMailboxes } from '@/lib/gmail-automatic';
export const dynamic = 'force-dynamic';

// Sites dispatch authenticates the service credential before this route runs.
// Enable only for an owner-private Site; disable before expanding its audience.
// No service call can enroll an account, select a mailbox, or share a message.
export async function POST(request: Request) {
  return safe(async () => {
    if (env.GMAIL_BACKGROUND_MODE !== 'owner-private')
      throw new HttpError(503, 'Background email checks are not enabled.');
    if (
      request.headers.has('origin') ||
      request.headers.has('oai-authenticated-user-id') ||
      request.headers.get('x-weft-job') !== 'gmail-detection' ||
      (await request.text()) !== '{}'
    )
      throw new HttpError(403, 'Use the authenticated background runner.');
    return json(await runDueMailboxes());
  });
}
