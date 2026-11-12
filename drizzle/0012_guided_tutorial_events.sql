CREATE TABLE `guided_tutorial_events` (
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`checkpoint` text NOT NULL,
	`occurred_at` text NOT NULL,
	`project_id` text,
	PRIMARY KEY(`user_id`, `version`, `checkpoint`),
	FOREIGN KEY (`user_id`) REFERENCES `members`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guided_tutorial_funnel` ON `guided_tutorial_events` (`version`,`checkpoint`,`occurred_at`);