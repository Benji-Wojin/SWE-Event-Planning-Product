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
  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-5 py-10 text-foreground">
    <header className="flex items-center justify-between gap-3">
      <a href="/" className="inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight text-foreground">
        <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="7" height="20" rx="3.5" transform="rotate(-10 4 4)" fill="#7AD6A3"/>
          <circle cx="17.5" cy="9.5" r="3.6" fill="#7AD6A3"/>
          <circle cx="19.5" cy="18.5" r="3.8" fill="#F29B7E"/>
        </svg>
        weft
      </a>
      <ThemeToggle />
    </header>
    <section aria-labelledby="weft-sign-in-heading" className="w-full rounded-[14px] border border-border bg-card p-1 shadow-sm">
      <div className="rounded-[10px] bg-secondary/55 p-6 sm:p-7">
        <h1 id="weft-sign-in-heading" className="mb-2 text-2xl font-medium tracking-[-0.03em]">{configured ? 'Sign in to Weft' : 'Sign-in setup pending'}</h1>
        {configured ? <>
          <p className="mb-6 text-sm text-muted-foreground">Open your event plans, shared tasks, and invitations.</p>
          {params.error && <p role="alert" className="mb-4 text-sm text-destructive">Sign-in didn’t finish. Use a verified Google account and try again.</p>}
          <SignInButton returnTo={returnTo} />
          <p className="mt-3 text-sm text-muted-foreground">Google verifies who you are. Signing in does not give Weft access to your Gmail inbox.</p>
          {privateBetaEnabled() ? <p className="mt-5 text-sm text-muted-foreground">Access is limited to approved beta testers.</p> : <p className="mt-5 text-sm">New to Weft? <a className="underline underline-offset-4" href={'/signup?return_to=' + encodeURIComponent(returnTo)}>Create an account</a></p>}
        </> : <p className="text-sm text-muted-foreground">The app owner needs to finish Google sign-in setup for this site. Your existing project data has not been moved or changed.</p>}
      </div>
    </section>
    <PrivacyLinks />
  </main>;
}
