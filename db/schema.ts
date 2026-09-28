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
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  requestPayload: text('request_payload').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [index('projects_owner').on(table.ownerId)]);
export const members = sqliteTable('members', {
  userId: text('user_id').primaryKey(),
  actorId: text('actor_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
});
export const projectInfo = sqliteTable('project_info', {
  scope: text('scope').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
});
export const projectUploads = sqliteTable('project_uploads', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  size: integer('size').notNull(),
}, table => [index('project_uploads_account').on(table.accountId)]);
export const privateRecords = sqliteTable('private_records', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
  scope: text('scope').notNull().default('main'),
});
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  payload: text('payload').notNull(),
});
export const taskResources = sqliteTable('task_resources', {
  id: text('id').primaryKey(),
  contextHash: text('context_hash').notNull(),
  location: text('location').notNull().default(''),
  payload: text('payload').notNull().default('{}'),
  status: text('status').notNull(),
  lease: text('lease').notNull(),
  startedAt: integer('started_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const resourceUsage = sqliteTable('resource_usage', {
  id: text('id').primaryKey(),
  count: integer('count').notNull().default(0),
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
