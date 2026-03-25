CREATE TABLE `site_appearance_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`background_image_key` text,
	`background_blur` integer DEFAULT 24 NOT NULL,
	`background_scale` integer DEFAULT 112 NOT NULL,
	`background_position_x` integer DEFAULT 50 NOT NULL,
	`background_position_y` integer DEFAULT 50 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
