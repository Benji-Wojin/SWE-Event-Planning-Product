CREATE TABLE `onboarding_first_tasks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `members`(`user_id`) ON UPDATE no action ON DELETE cascade
);
