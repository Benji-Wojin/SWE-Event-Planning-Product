CREATE TABLE `project_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`token_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_by` text DEFAULT '' NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_invites_token_hash_unique` ON `project_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `project_invites_project` ON `project_invites` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`invite_id` text NOT NULL,
	`joined_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_member_user` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_member_actor` ON `project_members` (`project_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `project_members_user` ON `project_members` (`user_id`,`revoked_at`);