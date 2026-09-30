CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
ALTER TABLE `private_records` ADD `scope` text DEFAULT 'main' NOT NULL;