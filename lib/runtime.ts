import 'server-only';
import { createDatabaseFromEnvironment } from './platform/database';
import { createPrivateBucket, type PrivateBucket } from './platform/blob';

let database: D1Database | undefined;
let bucket: PrivateBucket | undefined;

// Keep provider initialization behind getters. Next.js imports server modules
// during a build, when production credentials need not be available.
export const env = {
  get GOOGLE_CLIENT_ID(): string | undefined {
    return process.env.GOOGLE_CLIENT_ID;
  },
  get GOOGLE_CLIENT_SECRET(): string | undefined {
    return process.env.GOOGLE_CLIENT_SECRET;
  },
  get DB(): D1Database {
    return (database ??= createDatabaseFromEnvironment({
      TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
      TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    }));
  },
  get BUCKET(): PrivateBucket | undefined {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
    return (bucket ??= createPrivateBucket(process.env.BLOB_READ_WRITE_TOKEN));
  },
  get GATHER_ORIGIN(): string {
    return process.env.GATHER_ORIGIN || '';
  },
  get GATHER_OWNER_EMAIL(): string {
    return process.env.GATHER_OWNER_EMAIL || '';
  },
  get GATHER_ENCRYPTION_KEY(): string {
    return process.env.GATHER_ENCRYPTION_KEY || '';
  },
  get GROQ_API_KEY(): string | undefined {
    return process.env.GROQ_API_KEY;
  },
  get GROQ_WEB_SEARCH_ENABLED(): string | undefined {
    return process.env.GROQ_WEB_SEARCH_ENABLED;
  },
  get GMAIL_BACKGROUND_MODE(): string | undefined {
    return process.env.GMAIL_BACKGROUND_MODE;
  },
  get CRON_SECRET(): string | undefined {
    return process.env.CRON_SECRET;
  },
};
