'use client';

import { useLayoutEffect } from 'react';

declare global {
  interface Window {
    GatherTheme?: { current(): 'dark' | 'light'; set(value: string): void; toggle(): void; refresh?(): void };
  }
}

export function ThemeRecovery() {
  useLayoutEffect(() => { window.GatherTheme?.refresh?.(); }, []);
  return null;
}
