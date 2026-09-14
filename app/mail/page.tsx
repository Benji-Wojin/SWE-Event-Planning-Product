import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { MailInbox } from './mail-client';
export const dynamic = 'force-dynamic';
export default async function Mail() {
  await requireChatGPTUser('/mail');
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="text-3xl font-semibold text-primary">
          gather
        </a>
        <nav className="flex gap-5 text-sm">
          <a className="underline" href="/">
            Shared plan
          </a>
          <a className="underline" href="/settings">
            Gmail settings
          </a>
        </nav>
      </header>
      <p className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">
        Organizer-only inbox
      </p>
      <h1 className="text-3xl font-semibold">Gmail inbox</h1>
      <p className="mb-7 mt-3 text-base text-muted-foreground">
        Share summaries without confirmation codes or personal details.
      </p>
      <MailInbox />
    </main>
  );
}
