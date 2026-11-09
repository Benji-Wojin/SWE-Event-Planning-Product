'use client';

import { useEffect } from 'react';

export function AppOpen() {
  useEffect(() => {
    let lastAttempt = -1;
    const record = () => {
      if (document.visibilityState !== 'visible') return;
      const slot = Math.floor(Date.now() / 1_800_000);
      if (lastAttempt === slot) return;
      lastAttempt = slot;
      void fetch('/api/activity', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Gather-Request': '1' },
        body: '{}',
      }).catch(() => { /* Analytics must not interrupt navigation. */ });
    };
    record();
    document.addEventListener('visibilitychange', record);
    window.addEventListener('pageshow', record);
    return () => {
      document.removeEventListener('visibilitychange', record);
      window.removeEventListener('pageshow', record);
    };
  }, []);
  return null;
}
