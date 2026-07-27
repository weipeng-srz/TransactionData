CREATE TABLE `price_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`direction` text NOT NULL,
	`target` real NOT NULL,
	`created_at` text NOT NULL,
	`triggered_at` text DEFAULT '' NOT NULL,
	`last_price` real,
	`last_checked_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_alerts_user_idx` ON `price_alerts` (`user_key`);--> statement-breakpoint
CREATE INDEX `price_alerts_active_idx` ON `price_alerts` (`triggered_at`,`code`);--> statement-breakpoint
CREATE TABLE `research_states` (
	`user_key` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
