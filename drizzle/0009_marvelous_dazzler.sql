CREATE TABLE `plan_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`request_hash` text DEFAULT '' NOT NULL,
	`draft_generation` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'empty' NOT NULL,
	`issue` text DEFAULT '' NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`started_at` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL
);
