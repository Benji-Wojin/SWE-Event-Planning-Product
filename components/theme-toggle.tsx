'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark');
    sync();
    window.addEventListener('gather-theme-change', sync);
    return () => window.removeEventListener('gather-theme-change', sync);
  }, []);
  return <Button type="button" variant="outline" size="sm" aria-pressed={dark} onClick={() => window.GatherTheme?.toggle()} className="gap-2 rounded-lg whitespace-nowrap">
    <span>Dark mode</span>
    <span aria-hidden="true" className="inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-[#767d8a] p-0.5 transition-colors duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)] motion-reduce:transition-none dark:bg-[#333a49] data-[on=true]:bg-[#077a47] dark:data-[on=true]:bg-[#077a47]" data-on={dark}>
      <span className="size-4 rounded-full bg-white shadow-xs transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none data-[on=true]:translate-x-4" data-on={dark} />
    </span>
  </Button>;
}
