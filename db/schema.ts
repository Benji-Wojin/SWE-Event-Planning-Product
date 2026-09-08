import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(1),
});
export const members = sqliteTable('members', {
  userId: text('user_id').primaryKey(),
  actorId: text('actor_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
});
export const privateRecords = sqliteTable('private_records', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
});
export const gmailConnections = sqliteTable('gmail_connections', {
  userId: text('user_id').primaryKey(),
  payload: text('payload').notNull(),
  generation: text('generation').notNull().default('initial'),
});
export const oauthStates = sqliteTable('oauth_states', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  payload: text('payload').notNull(),
  expires: integer('expires').notNull(),
});
export const mailMessages = sqliteTable(
  'mail_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    providerId: text('provider_id').notNull(),
    payload: text('payload').notNull(),
    receivedAt: text('received_at').notNull(),
  },
  (t) => [
    index('mail_user_date').on(t.userId, t.receivedAt),
    uniqueIndex('mail_provider_user').on(t.userId, t.providerId),
  ],
);
