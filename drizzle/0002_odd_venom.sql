CREATE TABLE `resource_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`context_hash` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`lease` text NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
