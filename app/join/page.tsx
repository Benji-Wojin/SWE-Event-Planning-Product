import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { JoinClient } from './join-client';
export const dynamic = 'force-dynamic';
export const metadata = { referrer: 'no-referrer' };
export default async function Join({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthenticatedJoin
      token={typeof params.invite === 'string' ? params.invite : ''}
    />
  );
}
async function AuthenticatedJoin({ token }: { token: string }) {
  await requireChatGPTUser('/join?invite=' + encodeURIComponent(token));
  return (
    <AccountLayout title="Project invitation">
      <JoinClient token={token} />
    </AccountLayout>
  );
}
