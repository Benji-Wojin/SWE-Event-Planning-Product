CREATE TABLE `product_activity_daily` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`app_opens` integer DEFAULT 0 NOT NULL,
	`last_open_slot` integer DEFAULT -1 NOT NULL,
	`tasks_created` integer DEFAULT 0 NOT NULL,
	`tasks_completed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `members`(`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_activity_day` ON `product_activity_daily` (`day`);