# Weft on Vercel

This runbook stages the existing product on Vercel without changing the private Sites app or copying its data. The implementation is not a claim that a hosted migration, Google login, Gmail ingestion or Groq setup has succeeded. Record those results against the exact reviewed commit after each check.

## Deployment settings

Confirm the intended Vercel team, project, repository, branch and full commit before changing settings or releasing anything. Use the directory containing `package.json` as the project Root Directory. For this branch:

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Framework default; disable any custom override |
| Node.js | A supported version satisfying `>=22.13.0`; use the same major locally and on Vercel |

`vercel.json` declares `nextjs`. Do **not** select Vite, publish `dist`, use a static export, or add a catch-all rewrite to `index.html`. The homepage and API routes require server execution. `npm run build` generates the legacy workspace assets and a normal Next.js build. Vercel's Next.js integration creates the server functions, not just static assets. See [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs).

Keep the existing private Site and its hosting configuration untouched. Do not change DNS to conceal a broken deployment, remove Deployment Protection, promote a preview, or replace production while staging is still unverified.

## Separate environments and storage

Provision only after the owner approves the accounts, service plans and intended environment. Use the existing Vercel project and its Marketplace/Storage configuration where possible; avoid duplicate installations.

- Create separate, initially empty **Turso databases for Preview and Production**, plus a development database if local app testing needs one. Turso preserves the existing SQLite SQL and migrations. Do not substitute a PostgreSQL URL without another adapter migration. The app requires a remote TLS `libsql://` or `https://` URL and token; it never silently falls back to ephemeral local storage. See [Turso's TypeScript reference](https://docs.turso.tech/sdk/ts/reference).
- Create separate **private Vercel Blob stores** for Preview and Production. This implementation explicitly uses `access: 'private'` and `BLOB_READ_WRITE_TOKEN`; a public store is not an acceptable substitute. OIDC-only provisioning does not satisfy this adapter's token configuration. Stored file bytes are also encrypted by Weft. Authenticated project routes authorize downloads. See [Vercel Blob](https://vercel.com/docs/vercel-blob).
- Scope each database token and Blob token to its environment. A preview must never receive production database, file or encryption credentials. Do not expose any environment's credentials to an unreviewed PR build.
- Keep initial tests fictional. The old database, file store and encrypted records are not a source of seed data. Missing Blob configuration leaves uploads unavailable; it does not make files public.

The app accepts approved file types up to **4 MB per upload**, leaving room for the request envelope. Existing per-account limits are 50 MB and 200 uploads, including archived files and earlier demo generations. Archiving does not reclaim storage. Files are not malware-scanned.

## Server environment

Use [.env.example](../.env.example) as the variable inventory. Set actual values through Vercel's environment settings or another approved secret-entry mechanism, never through chat, source files, logs, browser-visible variables or commit messages. No credential below belongs in a `NEXT_PUBLIC_` variable.

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | Exact canonical origin for this environment, such as `https://app.example.com` |
| `GATHER_ORIGIN` | The **same exact origin** as `NEXTAUTH_URL`, with no trailing slash or path |
| `NEXTAUTH_SECRET` | Independently generated random session secret, at least 32 characters |
| `GOOGLE_CLIENT_ID` | Owner-managed Google Web OAuth client used for app sign-in |
| `GOOGLE_CLIENT_SECRET` | That client's server-only secret |
| `TURSO_DATABASE_URL` | This environment's remote TLS database URL |
| `TURSO_AUTH_TOKEN` | Access token for that database only |
| `BLOB_READ_WRITE_TOKEN` | Token for this environment's **private** Blob store; optional until file storage is enabled |
| `GATHER_ENCRYPTION_KEY` | Base64 encoding of 32 random bytes for AES-256-GCM; preserve securely |
| `GATHER_OWNER_EMAIL` | Verified Google email allowed to bootstrap the initial organizer |
| `GROQ_API_KEY` | Optional server-only Groq key; absent until separately configured and tested |
| `GROQ_WEB_SEARCH_ENABLED` | Leave unset; enable `verified` only after the separate search/citation test |
| `GMAIL_BACKGROUND_MODE` | Leave unset; `vercel-cron` is the only enabled Vercel runner mode |
| `CRON_SECRET` | Separate random server secret of at least 32 characters; only needed for an approved runner |

Choose either the apex or `www` hostname as canonical, then keep sign-in callbacks, invitation links and mutation origins consistent with that choice. Production requires HTTPS. Local development can use matching `http://localhost:3000` origins and a separately registered local callback. Preview OAuth needs a stable, registered preview hostname; do not point preview configuration at production merely to make login work.

After correctly linking a local checkout, pull only its intended Development configuration into an ignored local file. Preserve any existing local configuration before replacing it. Preview/Production Secret values may not be returned by an environment pull; use separate Development credentials rather than weakening secret visibility. Standalone Node scripts do not automatically load `.env.local`; the migration examples below use Node's explicit `--env-file` option. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

An unset or invalid sign-in configuration deliberately produces a setup-pending page and a safe 503 from the auth API. Do not bypass it with fake sessions or `oai-authenticated-*` headers. Changing `GATHER_OWNER_EMAIL` does not revoke an already-bound owner. Changing the encryption key without re-encrypting records makes existing protected data unreadable.

## Google: owner setup once, users consent normally

The app owner owns the Google Cloud project, consent screen and Web OAuth client. End users sign in with Google and, when using an authorized Gmail feature, consent to its permissions. They do **not** create Cloud projects, API clients or API keys.

Register the exact callbacks for each allowed environment. They serve different purposes:

| Flow | Callback on the canonical origin | Permission |
| --- | --- | --- |
| Sign in to Weft | `/api/auth/callback/google` | `openid email profile` |
| Connect Gmail imports | `/api/gmail/callback` | Read-only Gmail access, separately authorized |
| Connect dedicated invitation sender | `/api/gmail/callback` | `gmail.send`, `openid`, `email`, separately authorized |

For example, the sign-in callback would be `https://app.example.com/api/auth/callback/google`; this example hostname must be replaced with the environment's actual canonical hostname. Google requires the complete redirect URI, not only the domain. See [NextAuth's Google provider](https://next-auth.js.org/providers/google) and [Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

1. Configure the sign-in client's ID and secret as the server environment variables above. In Google's Testing mode, add the owner and intended testers to the consent screen's test-user list. Broader Gmail access can require Google's verification process; do not promise public rollout merely because a tester can sign in.
2. Initialize the new database, then sign in with the verified `GATHER_OWNER_EMAIL`. Weft uses the Google subject as `google:<sub>`, not an email string as the identity key. Sign-in alone grants no project membership to other users.
3. For optional Gmail features, enable the Gmail API and configure the owner-managed Google Web client in the app's organizer Settings. This existing Gmail configuration is encrypted in the database; setting sign-in environment variables alone does not configure Gmail imports or sending. The same app-owned client may be reused with both callback URIs registered.
4. Connect the organizer's import mailbox and, separately, a dedicated invitation-sending Gmail account. They must be different accounts. Existing Sites OAuth grants are not imported by this runbook; reconnect on the new deployment. Google consent is distinct from Weft's project-selection and Groq-processing consent.
5. Invite only an approved test recipient, using their Google sign-in email. If Deployment Protection is enabled, authorize that tester at the Vercel layer separately. A Weft invitation cannot bypass platform protection.

The legacy `/signin-with-chatgpt` and `/signout-with-chatgpt` URLs remain compatibility aliases for the Google flow. Logout requires a confirmation click and a CSRF-protected POST; visiting its URL does not log the user out.

## Initialize an isolated database

This is an explicit operator action, **not a build hook or request-time migration**. The ten checked-in migrations `0000` through `0009` are unchanged. The runner applies them transactionally and records names/checksums in `_weft_migrations`. It refuses a nonempty database without that ledger or a changed applied history. Do not delete tables, reset a ledger or edit old migrations to bypass a refusal.

First verify the environment and exact database hostname in the provider dashboard. The `--target` argument is the hostname from `TURSO_DATABASE_URL`, **not the website domain**. Replace the fictional hostname below with that observed hostname. The ignored local file must contain only credentials approved for this target; never copy production secrets into a preview file.

```bash
node --env-file=.env.local scripts/migrate-vercel.mjs --check --target example-db-org.turso.io
```

`--check` connects and reads schema/history without applying SQL. On a fresh empty database it should report the ten pending migrations. Review that result and obtain approval to initialize that exact database before running:

```bash
node --env-file=.env.local scripts/migrate-vercel.mjs --apply --target example-db-org.turso.io
node --env-file=.env.local scripts/migrate-vercel.mjs --check --target example-db-org.turso.io
```

The second check should report no pending migrations. Repeat with independently verified Production configuration only when production initialization is approved. A failed or ambiguous run is not evidence of success; recheck history and connectivity, do not blindly clear state and retry. `npm run db:generate` creates schema source changes for development; it is not this deployment's database initialization command.

### Legacy data is a separate migration

No command here copies Sites data, reuses legacy identities or links accounts by matching email. Keep the private Site available while staging. A future data migration requires a controlled backup/export, explicit mapping from stable Site identities to verified Google subjects, preservation of project/member relationships, and a reviewed import plan.

Encrypted records use a key **and** identity/record-specific authenticated contexts. Keeping only the SQL rows or only the encryption key is insufficient if IDs or contexts change. Preserve key continuity where required, or deliberately decrypt and re-encrypt with reviewed context mapping. File objects, database references, Gmail grants, invitation state and project authorization must be handled together. Do not attach a copied legacy database to this branch and assume existing accounts or encrypted files will work.

## Optional background Gmail checks

Groq is not configured or proven working by this migration. Keep `GROQ_API_KEY`, `GROQ_WEB_SEARCH_ENABLED`, `GMAIL_BACKGROUND_MODE` and `CRON_SECRET` unset until their setup is approved. Keep the requested Groq Free plan; do not enable paid fallback or billing. Confirm the provider's data-retention controls before private-email processing. Ordinary project users need no Groq account.

Before unattended checks:

1. Verify a connected import mailbox, selected owned projects and fresh versioned Groq consent in Settings. The runner cannot create enrollment or infer consent.
2. Test one explicitly authorized, fictional project email end to end. Verify its private summary, correct project association and persisted checkpoint without logging email bodies or tokens. An empty or `not_due` response alone does not prove ingestion.
3. Obtain separate approval for a schedule and its frequency. No schedule is included in this branch's `vercel.json`; setting environment flags alone does not create one. Confirm the chosen Vercel plan permits the frequency and expected usage.
4. Configure a new `CRON_SECRET` of at least 32 random characters and `GMAIL_BACKGROUND_MODE=vercel-cron`. Configure an approved Vercel Cron entry for `/api/gmail/automatic-run`. Vercel sends a **GET** with `Authorization: Bearer <CRON_SECRET>`; never put the secret in the URL, cron definition or logs. See [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs).
5. Verify an actual scheduled invocation and database progress. Confirm unauthorized requests fail, the intended enrolled mailbox is processed, and pause/disconnect stops further processing. Keep notifications free of message content.

The authenticated GET takes no query overrides or body. The handler rejects Origin and legacy identity headers. The old Sites dispatch token and `owner-private` mode do not authorize this endpoint. Existing mailbox leases, bounded work, quota backoff and membership/consent checks still apply. Disable the mode and the separately configured schedule when deactivating background processing; pausing is not deleting retained private summaries.

## Verify, then request publication approval

Run these against the exact revision, without production credentials:

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

Record actual results, including unresolved audit findings. Unit tests and a successful build do not prove deployment configuration or provider connectivity. The reviewer must examine the full diff and evidence before publication approval. Follow [the repository's engineering loop](engineering-loop.md): present the report, scope, checks, independent review, risks, branch and **full commit SHA**, then obtain explicit approval to push that revision. Deployment/promotion and access changes require their corresponding approval. A Git push can trigger Vercel automatically, so check branch-to-environment behavior before pushing; an approved code change is not implicit release permission.

After an authorized **isolated preview** deployment, verify:

- `/` returns the sign-in flow or Projects page rather than a Vercel 404. Deployment resources include functions for dynamic pages/APIs, not only static files. Assets, refreshes and direct project URLs work.
- Google login/callback and confirmed logout work on the configured origin. Forged legacy identity headers do not authenticate. Uninvited users cannot read project APIs; the owner can create an empty project that persists across a reload.
- With an explicitly approved second test identity, invitation acceptance grants only the intended project. Claim/report/comment behavior and access removal work. Test cross-project denial, stale write handling and private-booking restrictions.
- A fictional guest record and an allowed file under 4 MB persist; only authorized members can download the file. Oversize/restricted uploads fail clearly. Files cannot be retrieved as public Blob URLs.
- If Gmail/Groq are configured, verify real callback, private summary review and approved invitation delivery separately. State which integrations remain unverified. Do not send unrequested emails as a smoke test.
- Missing configuration shows a safe setup message, and logs do not contain secrets, private email text or booking records.

Keep production unchanged until the owner approves its separately configured deployment. A preview tested against preview secrets is not a tested production build. Stage a production-configured deployment without moving domains, perform its approved checks, then promote only that tested production deployment. Promotion of a preview can rebuild with different environment values. See [Vercel deployments](https://vercel.com/docs/deployments) and [promoting deployments](https://vercel.com/docs/deployments/promoting-a-deployment).

Record the deployed full source SHA, environment, migration head, smoke-test results and any remaining limitations in the private engineering ledger. Rollback of application code does not undo database writes or migrate data back; preserve backups and the still-untouched original Site until a separate cutover plan is approved.
