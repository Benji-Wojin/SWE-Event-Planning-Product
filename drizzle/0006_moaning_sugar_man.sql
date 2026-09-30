CREATE TABLE `gmail_senders` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`generation` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitation_deliveries` (
	`invite_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'unsent' NOT NULL,
	`lease` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`attempted_at` integer DEFAULT 0 NOT NULL,
	`sent_at` integer DEFAULT 0 NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`provider_id` text DEFAULT '' NOT NULL,
	`issue` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitation_send_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`invite_id` text NOT NULL,
	`started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invitation_attempts_user_date` ON `invitation_send_attempts` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `sender_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload` text NOT NULL,
	`expires` integer NOT NULL
);
