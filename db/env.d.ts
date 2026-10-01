declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    GATHER_ENCRYPTION_KEY: string;
    GATHER_OWNER_EMAIL: string;
    GATHER_ORIGIN: string;
    OPENAI_API_KEY?: string;
    // Only enable after confirming the Site is owner-private and scheduling its writer.
    GMAIL_BACKGROUND_MODE?: string;
  }
}
