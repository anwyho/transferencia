ALTER TABLE `rule_state` ADD `mastery` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rule_state` ADD `coverage` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rule_state` ADD `seen_instruments` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `rule_state` ADD `success_days` text DEFAULT '[]' NOT NULL;