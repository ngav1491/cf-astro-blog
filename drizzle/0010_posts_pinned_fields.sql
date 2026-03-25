ALTER TABLE `blog_posts` ADD `is_pinned` integer DEFAULT 0 NOT NULL;
ALTER TABLE `blog_posts` ADD `pinned_order` integer DEFAULT 100 NOT NULL;
CREATE INDEX `posts_pinned_order_idx` ON `blog_posts` (`is_pinned`,`pinned_order`,`published_at`);
