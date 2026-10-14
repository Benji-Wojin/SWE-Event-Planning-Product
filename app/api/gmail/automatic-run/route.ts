import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/runtime';
import { HttpError, json, safe } from '@/lib/security';
import { runDueMailboxes } from '@/lib/gmail-automatic';
import { requireGmailEnabled } from '@/lib/gmail-policy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Stop before the two-minute mailbox lease expires. Unfinished work resumes
// from the saved checkpoint on a later run.
export const maxDuration = 110;

function authorize(request: Request) {
  requireGmailEnabled();
  const secret = env.CRON_SECRET;
  if (
    env.GMAIL_BACKGROUND_MODE !== 'vercel-cron' ||
    !secret ||
    secret.length < 32
  )
    throw new HttpError(503, 'Background email checks are not enabled.');
  const expected = createHash('sha256').update('Bearer ' + secret).digest();
  const received = createHash('sha256')
    .update(request.headers.get('authorization') || '')
    .digest();
  // Public Vercel routes do not inherit the private Sites dispatch boundary.
  // Only a separately configured server credential may run enrolled mailboxes.
  if (
    !timingSafeEqual(expected, received) ||
    request.headers.has('origin') ||
    request.headers.has('oai-authenticated-user-id') ||
    new URL(request.url).search !== ''
  )
    throw new HttpError(403, 'Use the authenticated background runner.');
}

// Vercel sends CRON_SECRET as a bearer token on scheduled GET requests.
// The schedule cannot enroll a mailbox; each owner must explicitly opt in.
export async function GET(request: Request) {
  return safe(async () => {
    authorize(request);
    return json(await runDueMailboxes());
  });
}

export async function POST(request: Request) {
  return safe(async () => {
    authorize(request);
    if (
      request.headers.get('x-weft-job') !== 'gmail-detection' ||
      (await request.text()) !== '{}'
    )
      throw new HttpError(403, 'Use the authenticated background runner.');
    return json(await runDueMailboxes());
  });
}
