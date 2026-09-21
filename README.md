# Gather — owner-private hosted pilot

Real ChatGPT sign-in, a server-backed event plan, and encrypted organizer-only booking details. The original local prototype remains untouched in the parent directory; browser-local changes are not automatically uploaded. This hosted workspace begins with clearly labeled Field Day example data.

## What works

- Tasks, owner acceptance, completion reports, organizer verification, comments, follow-up drafts, event context, and contextual feedback rules persist in Cloudflare D1.
- Every API checks authenticated membership server-side. The initial owner is bootstrapped from the configured allowlisted email and then bound to its stable Site user ID. Browser actor selection cannot grant permissions. Only the owner can currently join.
- Workspace writes use a compare-and-swap revision. Other-tab conflicts require an explicit page reload; drafts are never silently rebased onto newer data.
- Flight/hotel/transport/venue references are encrypted using AES-256-GCM with a separate secret server key. Gmail credentials and text previews use distinct authenticated encryption contexts. Private data never goes into shared exports, browser localStorage, or task notes automatically.
- Gmail Web OAuth uses read-only scope, PKCE, expiring single-use state bound to the signed-in owner, server-side refresh tokens, and revocation. Save the Google client in the protected settings form, then authorize Gmail and choose a project label.
- Sync manually imports 20 messages at a time from that label, with paging and mailbox-aware deduplication. Private inbox shows the 100 most recent imported text previews; previews may be truncated and exclude attachments. A human writes and approves a safe title/summary before it enters shared email review. Originals stay encrypted separately. Conversation mapping and received time are retained for reviewed updates.

## Pilot boundaries

- Publication is private to the owner's account. Teammate invitations and account-free guest links are not enabled. Starter teammates are examples, not real accounts. Site sharing alone does not grant app membership.
- Suggestions use conservative local rules and event feedback, not a connected language model. No autonomous email sending, live RSVP integration, Gmail push notifications, or background sync.
- Google OAuth needs an actual Google Cloud Web client: enable Gmail API, configure consent/testing users and `gmail.readonly`, and add the exact redirect URI displayed in settings. Google may require verification for wider deployment; testing grants may need reconnecting after seven days.
- No production Gmail authorization was tested because no Google OAuth credentials were supplied. Do not enter passport or payment-card data. This pilot has not had an independent security assessment.
- Disconnect revokes future Gmail access but retains imported previews and shared summaries. Changing the Google client while connected is denied. Original retention controls and account deletion UI are future work.
- Editing `GATHER_OWNER_EMAIL` does not revoke an already-bound owner: ownership changes need deliberate membership migration. Do not rotate the encryption key without migrating existing ciphertext.
- Private view hiding clears visible records but is not sign-out. Use Sign out to terminate account access.

## Build and validation

`npm run build` reproduces the adapted legacy workspace and builds the Worker. `npx tsc --noEmit` checks the app. `node --test tests/*.test.mjs` runs the task reporting, dependencies, email briefing, concurrency, authorization, encryption, Gmail, and demo regression tests using SQLite and mocked platform identity. No test mocks are included in the deployed Worker.

Generated Drizzle migrations are in `drizzle/` and are packaged with the deployment. Runtime secrets belong in Sites environment configuration, never in `.openai/hosting.json` or Git. `.env.example` lists required keys. D1 schema is defined in `db/schema.ts`.

The current macOS 13.4 host cannot run the local Cloudflare runtime, which requires 13.5+. Production bundling works. Cleanup QA exercised the prepared workspace, four-profile demo, and Gmail pages against isolated sample-data route handlers, including mobile layouts and failed saves. This does not replace end-to-end testing of hosted sign-in or a real Gmail connection. The read_shared_plan and add_shared_task WebMCP tools are feature-detected; no supported browser WebMCP validation context was available, so that integration is unverified.

The September 2026 cleanup pins compatible patched `image-size` and `undici` versions without changing the framework beta. `npm audit --omit=dev` reports no known advisories in the installed production dependency tree. The full audit still reports nine development-tool findings (five high and four moderate); Wrangler and the Cloudflare Vite plugin also contain bundled dependency copies that npm overrides do not replace. These tooling updates need separate compatibility validation before broader rollout. This audit result is not a security certification.

References: [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [message listing](https://developers.google.com/workspace/gmail/api/guides/list-messages).
