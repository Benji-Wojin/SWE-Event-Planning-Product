import { ThemeToggle } from './theme-toggle';
import { PrivacyLinks } from './privacy-links';

export function PrivateBeta({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <a href="/" className="text-2xl font-semibold">weft</a>
        <ThemeToggle />
      </header>
      <section className="space-y-5 rounded-xl border bg-card p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Private beta</h1>
        <p className="text-muted-foreground">
          {signedIn ? 'This account does not have beta access yet.' : 'Weft is currently available to approved testers.'}
        </p>
        <a className="inline-flex rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground"
          href={signedIn ? '/signout-with-chatgpt?return_to=%2Fbeta' : '/signin-with-chatgpt?return_to=%2F'}>
          {signedIn ? 'Use another account' : 'Tester sign in'}
        </a>
        <p className="text-sm text-muted-foreground">To request access, email{' '}
          <a className="break-all underline" href="mailto:support@weftplan.com?subject=Weft%20beta%20access">support@weftplan.com</a>.
        </p>
      </section>
      <PrivacyLinks />
    </main>
  );
}
