CREATE INDEX IF NOT EXISTS `analytics_events_timestamp_idx`
	ON `analytics_events` (`timestamp`);
CREATE INDEX IF NOT EXISTS `analytics_events_page_url_idx`
	ON `analytics_events` (`page_url`);
CREATE INDEX IF NOT EXISTS `analytics_events_session_id_idx`
	ON `analytics_events` (`session_id`);
CREATE INDEX IF NOT EXISTS `analytics_sessions_last_seen_idx`
	ON `analytics_sessions` (`last_seen_at`);
