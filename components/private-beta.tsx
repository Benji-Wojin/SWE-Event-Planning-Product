import { ThemeToggle } from './theme-toggle';
import { PrivacyLinks } from './privacy-links';
import { Welcome } from './welcome';

export function PrivateBeta({ signedIn = false }: { signedIn?: boolean }) {
  if (!signedIn) return <Welcome beta />;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-7 px-6 py-10">
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
      <section className="rounded-[14px] border border-border bg-card p-1">
        <div className="space-y-5 rounded-[10px] bg-secondary/55 p-7">
          <h1 className="text-3xl font-medium tracking-[-0.035em]">Private beta</h1>
          <p className="text-muted-foreground">
            {signedIn
              ? 'This account does not have beta access yet.'
              : 'Weft is currently available to approved testers.'}
          </p>
          <a
            className="inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
            href={
              signedIn
                ? '/signout-with-chatgpt?return_to=%2Fbeta'
                : '/sign-in?return_to=%2F'
            }
          >
            {signedIn ? 'Use another account' : 'Tester sign in'}
          </a>
          <p className="text-sm text-muted-foreground">
            To request access, email{' '}
            <a
              className="break-all underline underline-offset-4"
              href="mailto:support@weftplan.com?subject=Weft%20beta%20access"
            >
              support@weftplan.com
            </a>
            .
          </p>
        </div>
      </section>
      <PrivacyLinks />
    </main>
  );
}
