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
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <a
          href="/"
          className="inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight text-foreground"
        >
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="7" height="20" rx="3.5" transform="rotate(-10 4 4)" fill="#7AD6A3"/>
            <circle cx="17.5" cy="9.5" r="3.6" fill="#7AD6A3"/>
            <circle cx="19.5" cy="18.5" r="3.8" fill="#F29B7E"/>
          </svg>
          weft
        </a>
        <div className="flex items-center gap-3">
          <a href="/" className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Projects
          </a>
          <ThemeToggle />
        </div>
      </header>
      <h1 className="mb-7 text-3xl font-medium tracking-[-0.035em]">{title}</h1>
      {children}
    </main>
  );
}
