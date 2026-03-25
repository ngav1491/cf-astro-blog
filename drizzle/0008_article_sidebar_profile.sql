ALTER TABLE `site_appearance_settings` ADD `article_sidebar_avatar_path` text;
ALTER TABLE `site_appearance_settings` ADD `article_sidebar_name` text DEFAULT 'Eric-Terminal' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `article_sidebar_bio` text DEFAULT '在比特海里未雨绸缪，身后养着一只叫晖的狐狸。' NOT NULL;
ALTER TABLE `site_appearance_settings` ADD `article_sidebar_badge` text DEFAULT '文章作者' NOT NULL;
