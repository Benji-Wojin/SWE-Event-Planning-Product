CREATE TABLE `project_info` (
	`scope` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`size` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `project_uploads_account` ON `project_uploads` (`account_id`);