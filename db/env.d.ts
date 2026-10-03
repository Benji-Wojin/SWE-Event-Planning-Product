declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    GATHER_ENCRYPTION_KEY: string;
    GATHER_OWNER_EMAIL: string;
    GATHER_ORIGIN: string;
    GROQ_API_KEY?: string;
    GROQ_WEB_SEARCH_ENABLED?: string;
    // Only enable after confirming the Site is owner-private and scheduling its writer.
    GMAIL_BACKGROUND_MODE?: string;
  }
}
