import { redirect } from 'next/navigation';
import { getAuthenticatedUser } from '@/auth';
import { hasBetaAccess, privateBetaEnabled } from '@/lib/beta-access';
import { PrivateBeta } from '@/components/private-beta';

export const dynamic = 'force-dynamic';
export default async function BetaPage() {
  if (!privateBetaEnabled()) redirect('/');
  const user = await getAuthenticatedUser();
  if (user && await hasBetaAccess(user)) redirect('/');
  return <PrivateBeta signedIn={!!user} />;
}
