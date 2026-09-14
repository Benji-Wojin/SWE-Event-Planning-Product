import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { GmailSettings } from './settings-client';
export const dynamic = 'force-dynamic';
export default async function Settings() {
  const user = await requireChatGPTUser('/settings');
  return (
    <main className="mx-auto max-w-4xl px-5 py-10 md:px-10">
      <header className="mb-9 flex flex-wrap items-center justify-between gap-5">
        <a
          href="/"
          className="text-3xl font-semibold tracking-tight text-primary"
        >
          gather
        </a>
        <a
          href={chatGPTSignOutPath()}
          target="_top"
          className="text-sm underline"
        >
          Sign out
        </a>
      </header>
      <p className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">
        Organizer settings
      </p>
      <h1 className="mb-3 text-3xl font-semibold">
        Gmail settings
      </h1>
      <p className="mb-7 text-base text-muted-foreground">
        Signed in as {user.displayName}. Private to your account.
      </p>
      <GmailSettings />
      <a href="/" className="mt-7 inline-block text-primary underline">
        Shared plan
      </a>
    </main>
  );
}
