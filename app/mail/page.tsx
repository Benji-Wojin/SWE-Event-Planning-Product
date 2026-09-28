import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { MailInbox } from './mail-client';
import { ThemeToggle } from '@/components/theme-toggle';
export const dynamic = 'force-dynamic';
export default async function Mail() {
  await requireChatGPTUser('/mail');
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="text-3xl font-semibold text-primary">
          gather
        </a>
        <nav className="flex flex-wrap items-center gap-5 text-sm">
          <ThemeToggle />
          <a className="underline" href="/">
            Shared plan
          </a>
          <a className="underline" href="/settings">
            Gmail settings
          </a>
        </nav>
      </header>
      <p className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">
        Organizer only
      </p>
      <h1 className="text-3xl font-semibold">Gmail sources</h1>
      <p className="mb-7 mt-3 text-base text-muted-foreground">
        Import a safe summary into the email briefing. Original emails remain private.
      </p>
      <MailInbox />
    </main>
  );
}
