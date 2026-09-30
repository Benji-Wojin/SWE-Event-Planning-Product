import { ThemeToggle } from './theme-toggle';
/* Full navigation preserves server-owned authentication across the legacy and React app. */
/* oxlint-disable next/no-html-link-for-pages */
export function AccountLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <a
          href="/"
          className="text-2xl font-semibold tracking-tight text-primary"
        >
          gather
        </a>
        <div className="flex items-center gap-4">
          <a href="/" className="text-sm underline">
            Projects
          </a>
          <ThemeToggle />
        </div>
      </header>
      <h1 className="mb-7 text-3xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}
