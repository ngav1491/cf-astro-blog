export const ANALYTICS_RETENTION_DAYS = 90;
const ANALYTICS_RETENTION_CHECK_INTERVAL_SECONDS = 6 * 60 * 60;
const LAST_CLEANUP_AT_KEY = "analytics:cleanup:last-at";

interface CleanupOptions {
	force?: boolean;
}

export interface AnalyticsCleanupResult {
	ran: boolean;
	deletedEvents: number;
	deletedSessions: number;
	deletedMcpLogs: number;
	lastCleanupAt: string;
}

function shouldRunCleanup(
	lastCleanupAt: string | null,
	force: boolean,
): boolean {
	if (force) {
		return true;
	}

	if (!lastCleanupAt) {
		return true;
	}

	const parsed = Date.parse(lastCleanupAt);
	if (Number.isNaN(parsed)) {
		return true;
	}

	return (
		Date.now() - parsed >= ANALYTICS_RETENTION_CHECK_INTERVAL_SECONDS * 1000
	);
}

function readChangesCount(result: unknown): number {
	const changes = (
		result as
			| {
					meta?: { changes?: number };
			  }
			| undefined
	)?.meta?.changes;

	return Number.isFinite(changes) ? Number(changes) : 0;
}

export async function maybeCleanupAnalyticsData(
	env: Env,
	options: CleanupOptions = {},
): Promise<AnalyticsCleanupResult> {
	const force = Boolean(options.force);
	const lastCleanupAt = await env.SESSION.get(LAST_CLEANUP_AT_KEY);
	if (!shouldRunCleanup(lastCleanupAt, force)) {
		return {
			ran: false,
			deletedEvents: 0,
			deletedSessions: 0,
			deletedMcpLogs: 0,
			lastCleanupAt: lastCleanupAt ?? "",
		};
	}

	const retentionOffset = `-${ANALYTICS_RETENTION_DAYS} days`;
	const deleteEventsResult = await env.DB.prepare(
		"DELETE FROM analytics_events WHERE timestamp < datetime('now', ?)",
	)
		.bind(retentionOffset)
		.run();
	const deleteSessionsResult = await env.DB.prepare(
		"DELETE FROM analytics_sessions WHERE last_seen_at < datetime('now', ?)",
	)
		.bind(retentionOffset)
		.run();
	const deleteMcpLogsResult = await env.DB.prepare(
		"DELETE FROM mcp_audit_logs WHERE timestamp < datetime('now', ?)",
	)
		.bind(retentionOffset)
		.run();

	const now = new Date().toISOString();
	await env.SESSION.put(LAST_CLEANUP_AT_KEY, now, {
		expirationTtl: ANALYTICS_RETENTION_CHECK_INTERVAL_SECONDS * 4,
	});

	return {
		ran: true,
		deletedEvents: readChangesCount(deleteEventsResult),
		deletedSessions: readChangesCount(deleteSessionsResult),
		deletedMcpLogs: readChangesCount(deleteMcpLogsResult),
		lastCleanupAt: now,
	};
}
