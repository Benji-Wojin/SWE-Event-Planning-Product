# Release variants

## Branches

- `codex/email-reading` preserves the Gmail-enabled baseline at `99594f5322c6b5a1c13bdf8ad90a31a2ffce73a6`, including independent import/sender grants and opt-in automatic detection.
- `codex/report-launch-no-email-reading` is the public-launch candidate. It keeps accounts, projects, internal invitations, and transactional invitation emails without mailbox access.

Both are local branches until the owner approves the exact reviewed revision for a GitHub push. Deployment requires separate approval. Creating these branches does not change the live site or Google's pending verification.

## Launch safety boundary

`lib/release-policy.ts` hard-disables Gmail. Environment variables cannot override it. Gmail API routes, OAuth start/callback, token refresh, direct Gmail clients, and automatic processing reject before mailbox access. The Gmail cron is removed from `vercel.json`. The only remaining Gmail mutation is authenticated local disconnection, which removes the caller's previous import/sender tokens and invalidates their pending OAuth states. It does not revoke Google's app-wide grant or delete previously saved messages.

Google sign-in continues to request only `openid email profile`. The launch UI does not offer Gmail connections or private originals. Existing shared summaries remain; users can request deletion of retained private data through support.

## Invitation email

The server uses the connected Resend integration's `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN`. It sends from `invites@<verified domain>` with the public support address as Reply-To. The recipient, project, organizer, and invitation link come from authorized database records, not a caller-supplied message body. A user does not supply an email-service key or authorize Gmail.

In-app invitations still work with no email service configuration. Sending email is a separate explicit action. Preserve pending invitations and delivery receipts during deployment; no migration or data deletion is needed.

The durable invitation claim prevents concurrent duplicate dispatches. Each claimed request carries a provider idempotency key. Known rejection permits a manual retry after 60 seconds; timeouts, server errors, conflicts, malformed receipts, and lost database receipts remain non-retryable/unknown to avoid accidental duplicates. A successful API receipt means accepted, not delivered to the inbox.

Limits: three attempts per invitation, 50 per organizer per rolling day, and conservative application-wide ceilings of 90 attempts per rolling day and 2,900 per rolling 30 days. Provider limits still apply, and other sends from the same provider account can exhaust its quota. No paid fallback is enabled by the app. Open/click tracking should remain disabled for invitations.

## Verification and release gates

- `npm test`: real-policy launch coverage plus the existing Gmail regression suite with a test-only enabled policy. Tests intercept provider HTTP; they do not send real email.
- `npm run typecheck` and `npm run build`.
- Independent complete-diff review before committing/publishing.
- After deployment approval, test fresh Google sign-in, signup, project creation, an in-app invite, and authorized transactional email delivery on the actual deployment. Real email tests require recipient approval.
- Before replacing the current live Gmail-enabled deployment, establish a working reviewer-accessible Gmail review deployment and appropriate OAuth redirect configuration, or agree on another plan with Google. A Git branch alone is not a reviewer-accessible app. Do not silently replace the flow shown in the submitted verification video, remove requested scopes, or alter the pending submission.
- Recheck branch freshness, OAuth configuration, database isolation, canonical origin, and sender-domain verification before publishing. Do not use production database or mailbox credentials in an untrusted preview.
