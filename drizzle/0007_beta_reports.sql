CREATE TABLE `beta_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `beta_reports_user_date` ON `beta_reports` (`user_id`,`created_at`);