'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

declare global {
  interface Window {
    GatherTheme?: { current(): 'dark' | 'light'; set(value: string): void; toggle(): void };
  }
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    window.addEventListener('gather-theme-change', sync);
    return () => window.removeEventListener('gather-theme-change', sync);
  }, []);
  return <Button type="button" variant="outline" size="sm" aria-pressed={dark} onClick={() => window.GatherTheme?.toggle()}>
    Dark mode<span aria-hidden="true" className="inline-flex h-5 w-8 shrink-0 items-center rounded-full bg-muted px-0.5 data-[on=true]:bg-primary" data-on={dark}>
      <span className="size-4 rounded-full bg-foreground data-[on=true]:translate-x-3 data-[on=true]:bg-primary-foreground" data-on={dark} />
    </span>
  </Button>;
}
