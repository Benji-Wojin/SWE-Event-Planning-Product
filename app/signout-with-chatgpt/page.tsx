import { redirect } from 'next/navigation';
import { getAuthenticatedUser, safeRelativeReturnPath } from '@/auth';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function SignOutPage({ searchParams }: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const { return_to } = await searchParams;
  const returnTo = safeRelativeReturnPath(return_to || '/');
  if (!await getAuthenticatedUser()) redirect(returnTo);
  return <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
    <section className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
      <h1 className="mb-3 text-2xl font-semibold">Sign out of Weft?</h1>
      <p className="mb-6 text-sm text-muted-foreground">You can sign back in with Google.</p>
      <SignOutButton returnTo={returnTo} />
      <a href={returnTo} className="mt-4 block text-center text-sm underline">Cancel</a>
    </section>
  </main>;
}
