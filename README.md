# SWE-Event-Planning-Product

## Gather — event planning app

Gather is an event-planning app with a shared task list, task-based email conversations, clear change approvals, and organizer-only booking details. This repository contains the current owner-private hosted pilot, including the four-person demo.

- [Private Gather site](https://gather-event-coordinator.benjiwojin.chatgpt.site/)
- [Four-person demo](https://gather-event-coordinator.benjiwojin.chatgpt.site/demo)

The hosted site requires the owner's ChatGPT sign-in. The demo uses four simulated profiles (Jack, Maya, Jules, and Dev), not four independently authenticated accounts. Open a profile in its own tab to demonstrate shared task updates, ownership, comments, and organizer verification. Demo data is stored separately from the real plan.

## Working with this repository

Use Node.js 22.13 or newer and the included npm lockfile:

```sh
npm ci
npm run build
node --test tests/inbox.test.mjs tests/server.test.mjs
```

`npm run dev` starts the development server on a supported Cloudflare runtime host. The app relies on Sites-provided identity headers and D1; a successful build alone does not supply sign-in or production data locally. The API tests use a temporary SQLite database and mocked identity, without contacting Gmail.

Source layout:

- `app/`: server routes, Gmail settings, and the four-person demo.
- `legacy/`: shared planning interface, task model, and grouped email review.
- `lib/`: authorization, encryption, Gmail, workspace, and isolated demo logic.
- `db/` and `drizzle/`: database schema and migrations.
- `scripts/prepare.mjs`: regenerates the planning interface's public assets.
- `tests/`: task-conversation and server/API regression tests.

Only application source and blank environment examples belong in Git. Dependencies, build output, local databases, real environment values, and Gmail credentials are excluded. Configure real runtime values through Sites; do not paste them into this repository.

`.openai/hosting.json` identifies the existing private Gather Site and is required by the current build configuration. It is not a credential. Pushing to GitHub does not automatically deploy that Site. Keep this target for the existing app; configure a distinct Site before using this source for a separate deployment.

The original development checkout is preserved separately. This GitHub import does not copy live tasks, email contents, private bookings, or local browser data.

## What works

- Tasks, owner acceptance, completion reports, organizer verification, comments, follow-up drafts, event context, and contextual feedback rules persist in Cloudflare D1.
- Related emails collect in one conversation per task. Editable before/after previews show the effective change before acceptance, and accepted or set-aside messages remain in history.
- The four-profile demo shares one server-backed sample project across tabs, enforces simulated ownership and verification rules, and can be restarted independently of the real workspace.
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

`npm run build` reproduces the adapted legacy workspace and builds the Worker. `npx tsc --noEmit` checks the app. `node --test tests/inbox.test.mjs tests/server.test.mjs` tests grouped email review, change previews, route authorization, server identity, CSRF, stale writes, encryption boundaries, Gmail setup/state, safe review, and demo isolation using SQLite and mocked platform identity. No test mocks are included in the deployed Worker.

Generated Drizzle migrations are in `drizzle/` and are packaged with the deployment. Runtime secrets belong in Sites environment configuration, never in `.openai/hosting.json` or Git. `.env.example` lists required keys. D1 schema is defined in `db/schema.ts`.

The current macOS 13.4 host cannot run the local Cloudflare runtime, which requires 13.5+. Production bundling works. Browser interaction QA was not requested. The read_shared_plan and add_shared_task WebMCP tools are feature-detected; no supported browser WebMCP validation context was available, so that integration is unverified.

The inherited toolchain still reports dependency advisories. Runtime React/RSC and Vite were updated to the patched releases identified during this pass; remaining toolchain findings need a separate dependency compatibility review before broader rollout.

References: [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [message listing](https://developers.google.com/workspace/gmail/api/guides/list-messages).
