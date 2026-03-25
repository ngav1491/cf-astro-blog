ALTER TABLE `site_appearance_settings` ADD `hero_signal_image_path` text;
ALTER TABLE `site_appearance_settings` ADD `hero_signal_chip_1` text DEFAULT 'Mouse Sync' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `hero_signal_chip_2` text DEFAULT 'Soft Orbit' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `hero_signal_chip_3` text DEFAULT 'Card Lift' NOT NULL;
ALTER TABLE `site_appearance_settings` DROP COLUMN `hero_topic_text`;
ALTER TABLE `site_appearance_settings` DROP COLUMN `hero_writing_text`;
