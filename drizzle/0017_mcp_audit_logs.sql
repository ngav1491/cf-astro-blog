CREATE TABLE IF NOT EXISTS `mcp_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip_address` text,
	`request_method` text NOT NULL,
	`request_path` text NOT NULL,
	`session_id` text,
	`auth_state` text NOT NULL,
	`response_status` integer NOT NULL,
	`outcome` text NOT NULL,
	`mcp_method` text,
	`tool_name` text,
	`request_id` text,
	`detail` text,
	`user_agent` text,
	`timestamp` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mcp_audit_logs_timestamp_idx` ON `mcp_audit_logs` (`timestamp`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mcp_audit_logs_status_idx` ON `mcp_audit_logs` (`response_status`,`timestamp`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mcp_audit_logs_tool_idx` ON `mcp_audit_logs` (`tool_name`,`timestamp`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `mcp_audit_logs_ip_idx` ON `mcp_audit_logs` (`ip_address`,`timestamp`);
