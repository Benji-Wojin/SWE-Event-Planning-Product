import { ThemeToggle } from './theme-toggle';
import { PrivacyLinks } from './privacy-links';
export function Welcome() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-8 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="text-2xl font-semibold">
          weft
        </a>
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <a href="/signin-with-chatgpt" className="text-sm underline">
            Sign in
          </a>
        </div>
      </header>
      <section className="my-auto max-w-2xl py-20">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Plan your event with your team.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          Tasks, schedules, guest information, and updates in one shared
          project.
        </p>
        <a
          href="/signup"
          className="mt-8 inline-flex rounded-md bg-primary px-5 py-3 font-medium text-primary-foreground"
        >
          Create an account
        </a>
        <p className="mt-5 text-sm text-muted-foreground">
          School events, corporate events, trips, and celebrations. Projects
          stay private until you invite someone.
        </p>
      </section>
      <footer className="border-t pt-6"><PrivacyLinks /></footer>
    </main>
  );
}
