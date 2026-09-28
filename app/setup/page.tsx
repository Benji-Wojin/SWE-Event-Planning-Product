import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { ProjectSetup } from './setup-client';

export const dynamic = 'force-dynamic';
export default async function Setup() {
  await requireChatGPTUser('/setup');
  return <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <a href="/" className="text-2xl font-semibold tracking-tight text-primary">gather</a>
      <ThemeToggle />
    </header>
    <h1 className="mb-2 text-3xl font-semibold">Project setup</h1>
    <p className="mb-7 text-base text-muted-foreground">Add your event details. You can change them later.</p>
    <ProjectSetup />
  </main>;
}
