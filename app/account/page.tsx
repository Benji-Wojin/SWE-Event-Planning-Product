import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { AccountClient } from './account-client';
export const dynamic = 'force-dynamic';
export default async function Account() {
  await requireChatGPTUser('/account');
  return (
    <AccountLayout title="Account">
      <AccountClient />
    </AccountLayout>
  );
}
