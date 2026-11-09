import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { AccountClient } from './account-client';
import { HttpError, isAppOwner, principal } from '@/lib/security';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default async function Account() {
  await requireChatGPTUser('/account');
  const member = await principal().catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 403) return null;
    throw error;
  });
  return (
    <AccountLayout title="Account">
      <AccountClient />
      {member && (
        <section aria-label="Onboarding" className="mt-5 rounded-xl border bg-card p-5 text-sm">
          {isAppOwner(member) ? (
            <Link prefetch={false} className="underline" href="/admin/onboarding">Onboarding dashboard</Link>
          ) : (
            <>
              <p className="font-medium">Your Weft account code</p>
              <p className="mt-1 break-all font-mono">{member.actorId}</p>
              <p className="mt-1 text-muted-foreground">Share this code with Weft support if you need help with onboarding.</p>
            </>
          )}
        </section>
      )}
    </AccountLayout>
  );
}
