import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { FeedbackForm } from './feedback-form';
import { HttpError, principal } from '@/lib/security';

export const dynamic = 'force-dynamic';
export default async function FeedbackPage() {
  await requireChatGPTUser('/feedback');
  let accessError = '';
  try { await principal(); }
  catch (error) {
    accessError = error instanceof HttpError && error.status === 403
      ? 'Open an invitation from your organizer and join a Gather project before sending feedback.'
      : 'We could not check your Gather access. Reload this page to try again.';
  }
  return <main className="mx-auto max-w-2xl px-5 py-10">
    <header className="mb-10 flex items-center justify-between gap-4">
      <a href="/" className="text-3xl font-semibold tracking-tight text-primary">gather</a>
      <ThemeToggle />
    </header>
    <p className="mb-2 text-sm text-muted-foreground">Gather beta</p>
    <h1 className="mb-3 text-3xl font-semibold">Send feedback</h1>
    <p className="mb-7 text-muted-foreground">Report something broken or suggest an improvement. Your report goes privately to the Gather owner and is reviewed with Codex.</p>
    {accessError ? <p role="alert" className="rounded-lg border border-border p-5">{accessError}</p> : <FeedbackForm />}
    <a href="/" className="mt-8 inline-block text-primary underline">Back to Gather</a>
  </main>;
}
