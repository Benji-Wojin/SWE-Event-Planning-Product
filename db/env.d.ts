declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GATHER_ENCRYPTION_KEY: string;
    GATHER_OWNER_EMAIL: string;
    GATHER_ORIGIN: string;
  }
}
