import {
  getAuthenticatedUser,
  isAuthConfigured,
  safeRelativeReturnPath,
} from '@/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { PrivacyLinks } from '@/components/privacy-links';
import { SignInButton } from '../signin-with-chatgpt/sign-in-button';
import { CreateAccountButton } from './signup-client';

export const dynamic = 'force-dynamic';
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeRelativeReturnPath(params.return_to);
  const destination = returnTo.startsWith('/signup') ? '/' : returnTo;
  const user = await getAuthenticatedUser();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <a href="/" className="text-2xl font-semibold">
          weft
        </a>
        <ThemeToggle />
      </header>
      <section className="space-y-5 rounded-xl border bg-card p-7">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Create a private event project or join your team.
        </p>
        {!isAuthConfigured() ? (
          <p role="alert">
            Sign-up is temporarily unavailable. Please try again later.
          </p>
        ) : user ? (
          <>
            <p className="break-all text-sm">{user.email}</p>
            <CreateAccountButton returnTo={destination} />
            <a
              className="block text-sm underline"
              href={
                '/signout-with-chatgpt?return_to=' +
                encodeURIComponent(
                  '/signup?return_to=' + encodeURIComponent(destination),
                )
              }
            >
              Use another account
            </a>
          </>
        ) : (
          <SignInButton
            returnTo={'/signup?return_to=' + encodeURIComponent(destination)}
          />
        )}
        <p className="text-sm text-muted-foreground">
          Google verifies your identity. Signing up does not give Weft access to
          your Gmail inbox.
        </p>
        {!user && (
          <p className="text-sm">
            Already have an account?{' '}
            <a
              className="underline"
              href={
                '/signin-with-chatgpt?return_to=' +
                encodeURIComponent(destination)
              }
            >
              Sign in
            </a>
          </p>
        )}
      </section>
      <PrivacyLinks />
    </main>
  );
}
