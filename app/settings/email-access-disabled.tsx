'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PrivacyLinks } from '@/components/privacy-links';

export function EmailAccessDisabled({ projectId }: { projectId?: string }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  async function disconnect() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/gmail/disconnect', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Gather-Request': '1' },
        body: '{}',
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not disconnect. Try again.');
      setNotice('Previous Gmail connections removed. Previously saved data is unchanged.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not disconnect.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="space-y-5 rounded-xl border bg-card p-5">
    <h2 className="text-lg font-semibold">Gmail access is unavailable</h2>
    <p className="text-sm text-muted-foreground">This release does not connect to or read your mailbox. Google sign-in only identifies your account.</p>
    {projectId && <a className="inline-block text-sm underline" href={'/team?project=' + encodeURIComponent(projectId)}>Manage project invitations</a>}
    <details className="space-y-3 text-sm">
      <summary className="cursor-pointer">Previously connected Gmail?</summary>
      <p className="mt-3">Mailbox checks are disabled. You can remove previous Gmail connections below. Saved summaries are retained; contact support to request deletion.</p>
      <Button variant="outline" disabled={busy} onClick={() => void disconnect()}>Remove previous Gmail connections</Button>
      <p><a className="underline" href="https://myaccount.google.com/connections">Manage Google permissions</a>. Removing Weft there revokes its Google grant and may affect all previously connected Gmail features.</p>
      {notice && <p role="status">{notice}</p>}
    </details>
    <PrivacyLinks />
  </section>;
}
