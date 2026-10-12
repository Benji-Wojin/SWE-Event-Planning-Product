const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));

// OAuth callbacks are browser navigations, not application fetches. Keep their
// error response private, readable and self-contained, with no external assets.
export function gmailCallbackError(message: string, status: number, recoveryPath: string, kind: 'import' | 'sender' = 'import') {
  const signedOut = status === 401;
  const href = signedOut
    ? '/signin-with-chatgpt?return_to=' + encodeURIComponent(recoveryPath)
    : recoveryPath;
  return new Response(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Gmail connection — Weft</title>
<style>body{font:1rem/1.6 system-ui,sans-serif;margin:0;padding:3rem 1.5rem}main{max-width:34rem;margin:8vh auto}h1{font-size:1.7rem;line-height:1.3}a{display:inline-block;padding:.6rem 1rem;border:1px solid currentColor;border-radius:.5rem;color:inherit;text-underline-offset:.2em}p{margin:1.2rem 0}</style>
</head><body><main><p>Weft</p><h1>${signedOut ? 'Sign in to connect Gmail' : kind === 'sender' ? 'Invitation sender not connected' : 'Gmail connection not completed'}</h1>
<p>${escapeHtml(message)}</p><p>${kind === 'sender' ? 'Open your project’s Team access to start a new sender connection.' : 'Return to settings and start a new connection.'} Your existing projects have not changed.</p>
<a href="${escapeHtml(href)}">${signedOut ? 'Sign in' : recoveryPath === '/' ? 'Back to projects' : kind === 'sender' ? 'Back to Team access' : 'Back to Gmail settings'}</a>
</main></body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      Vary: 'Cookie, Accept',
    },
  });
}
