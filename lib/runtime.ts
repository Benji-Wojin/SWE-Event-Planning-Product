import 'server-only';
import { createDatabaseFromEnvironment } from './platform/database';
import { createPrivateBucket, type PrivateBucket } from './platform/blob';

let database: D1Database | undefined;
let bucket: PrivateBucket | undefined;
let bucketConfiguration = '';

// Keep provider initialization behind getters. Next.js imports server modules
// during a build, when production credentials need not be available.
export const env = {
  get WEFT_PRIVATE_BETA(): string | undefined { return process.env.WEFT_PRIVATE_BETA; },
  get WEFT_BETA_EMAILS(): string | undefined { return process.env.WEFT_BETA_EMAILS; },
  get RESEND_API_KEY(): string | undefined {
    return process.env.RESEND_API_KEY;
  },
  get RESEND_EMAIL_DOMAIN(): string | undefined {
    return process.env.RESEND_EMAIL_DOMAIN;
  },
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
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    const storeId = process.env.BLOB_STORE_ID?.trim();
    if (!token && !storeId) return undefined;
    // Preserve explicitly configured legacy credentials when both are present.
    const configuration = token ? 'token:' + token : 'store:' + storeId;
    if (!bucket || bucketConfiguration !== configuration) {
      bucket = createPrivateBucket(token || { storeId: storeId! });
      bucketConfiguration = configuration;
    }
    return bucket;
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
