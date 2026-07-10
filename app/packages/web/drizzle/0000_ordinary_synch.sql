CREATE TABLE `item_exposure` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`times_seen` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_rating` text,
	`known` integer DEFAULT 0 NOT NULL,
	`starred` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` text,
	`rule_keys` text,
	`exercise_type_key` text,
	`param_key` text,
	`direction` text,
	`rating` text,
	`assessment` text,
	`hint_revealed` integer,
	`latency_ms` integer,
	`content_hash` text,
	`session_id` integer,
	`annotation_known` integer,
	`annotation_lesson` integer,
	`session_mode` text,
	`session_target_attempts` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `review_log_user_at_id_idx` ON `review_log` (`user_id`,`at`,`id`);--> statement-breakpoint
CREATE TABLE `rule_state` (
	`user_id` text NOT NULL,
	`rule_key` text NOT NULL,
	`direction` text NOT NULL,
	`blob` text NOT NULL,
	`due` integer NOT NULL,
	`first_exposed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `rule_key`, `direction`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `rule_state_user_due_idx` ON `rule_state` (`user_id`,`due`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`mode` text NOT NULL,
	`target_attempts` integer NOT NULL,
	`realized_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL
) STRICT;
