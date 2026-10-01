CREATE TABLE `gmail_automation` (
	`user_id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`connection_generation` text NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`payload` text NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`next_run` integer DEFAULT 0 NOT NULL,
	`last_success` text DEFAULT '' NOT NULL,
	`issue` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gmail_automation_due` ON `gmail_automation` (`enabled`,`next_run`);--> statement-breakpoint
CREATE TABLE `gmail_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gmail_receipts_date` ON `gmail_receipts` (`created_at`);--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `project_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `mail_user_project_date` ON `mail_messages` (`user_id`,`project_id`,`received_at`);