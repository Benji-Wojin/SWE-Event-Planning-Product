import { env } from '@/lib/runtime';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Database storage is not configured. See docs/vercel-deployment.md.',
    );
  }

  return drizzle(env.DB, { schema });
}
