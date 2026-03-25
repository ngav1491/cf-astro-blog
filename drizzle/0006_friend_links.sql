CREATE TABLE `friend_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`site_url` text NOT NULL,
	`avatar_url` text,
	`description` text NOT NULL,
	`contact` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	UNIQUE(`site_url`)
);
--> statement-breakpoint
CREATE INDEX `friend_links_status_idx` ON `friend_links` (`status`);
