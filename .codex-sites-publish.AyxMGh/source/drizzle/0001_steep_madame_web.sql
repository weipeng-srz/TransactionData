CREATE TABLE `telemetry_daily` (
	`key` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`event` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`total_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telemetry_daily_date_idx` ON `telemetry_daily` (`date`);