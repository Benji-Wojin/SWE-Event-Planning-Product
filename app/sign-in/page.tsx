import { redirect } from 'next/navigation';
import { getAuthenticatedUser, isAuthConfigured, safeAuthRedirect, safeRelativeReturnPath } from '@/auth';
import { SignInButton } from './sign-in-button';
import { PrivacyLinks } from '@/components/privacy-links';
import { hasBetaAccess, privateBetaEnabled } from '@/lib/beta-access';
import { ThemeToggle } from '@/components/theme-toggle';

export const dynamic = 'force-dynamic';
export const metadata = {title:'Sign in to Weft', robots:{index:false,follow:false}};

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
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5 py-10 text-foreground">
    <header className="flex items-center justify-between">
      <a href="/" className="text-2xl font-semibold tracking-tight text-primary">weft</a>
      <ThemeToggle />
    </header>
    <section aria-labelledby="weft-sign-in-heading" className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <h1 id="weft-sign-in-heading" className="mb-2 text-2xl font-semibold tracking-tight">{configured ? 'Sign in to Weft' : 'Sign-in setup pending'}</h1>
      {configured ? <>
        <p className="mb-6 text-sm text-muted-foreground">Open your event plans, shared tasks, and invitations.</p>
        {params.error && <p role="alert" className="mb-4 text-sm text-destructive">Sign-in didn’t finish. Use a verified Google account and try again.</p>}
        <SignInButton returnTo={returnTo} />
        <p className="mt-3 text-sm text-muted-foreground">Google verifies who you are. Signing in does not give Weft access to your Gmail inbox.</p>
        {privateBetaEnabled() ? <p className="mt-5 text-sm text-muted-foreground">Access is limited to approved beta testers.</p> : <p className="mt-5 text-sm">New to Weft? <a className="underline" href={'/signup?return_to=' + encodeURIComponent(returnTo)}>Create an account</a></p>}
      </> : <p className="text-sm text-muted-foreground">The app owner needs to finish Google sign-in setup for this site. Your existing project data has not been moved or changed.</p>}
    </section>
    <PrivacyLinks />
  </main>;
}
