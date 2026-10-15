import { redirect } from 'next/navigation';
import { getAuthenticatedUser, isAuthConfigured, safeAuthRedirect, safeRelativeReturnPath } from '@/auth';
import { SignInButton } from './sign-in-button';
import { PrivacyLinks } from '@/components/privacy-links';
import { hasBetaAccess, privateBetaEnabled } from '@/lib/beta-access';

export const dynamic = 'force-dynamic';

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ return_to?: string; callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callback = typeof params.callbackUrl === 'string' ? safeAuthRedirect(params.callbackUrl) : '/';
  const returnTo = typeof params.return_to === 'string' ? safeRelativeReturnPath(params.return_to) : callback;
  const configured = isAuthConfigured();
  const user = configured ? await getAuthenticatedUser() : null;
  if (user && !await hasBetaAccess(user)) redirect('/beta');
  if (user && !params.error) redirect(returnTo);
  return <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
    <section className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-sm">
      <p className="mb-6 text-xl font-semibold">Weft</p>
      <h1 className="mb-3 text-2xl font-semibold">{configured ? 'Sign in' : 'Sign-in setup pending'}</h1>
      {configured ? <>
        <p className="mb-6 text-sm text-muted-foreground">Sign in to your projects and invitations.</p>
        {params.error && <p role="alert" className="mb-4 text-sm text-destructive">Sign-in didn’t finish. Use a verified Google account and try again.</p>}
        <SignInButton returnTo={returnTo} />
        {privateBetaEnabled() ? <p className="mt-5 text-sm text-muted-foreground">Access is limited to approved beta testers.</p> : <p className="mt-5 text-sm">New to Weft? <a className="underline" href={'/signup?return_to=' + encodeURIComponent(returnTo)}>Create an account</a></p>}
      </> : <p className="text-sm text-muted-foreground">The app owner needs to finish Google sign-in setup for this site. Your existing project data has not been moved or changed.</p>}
      <div className="mt-6"><PrivacyLinks /></div>
    </section>
  </main>;
}
