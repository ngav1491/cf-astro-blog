import { desc, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
	ANALYTICS_RETENTION_DAYS,
	maybeCleanupAnalyticsData,
} from "@/admin/lib/analytics-retention";
import { analyticsEvents, analyticsSessions, mcpAuditLogs } from "@/db/schema";
import { getDb } from "@/lib/db";
import { escapeAttribute, escapeHtml } from "@/lib/security";
import {
	type AdminAppEnv,
	getAuthenticatedSession,
	requireAuth,
} from "../middleware/auth";
import { adminLayout } from "../views/layout";

const analytics = new Hono<AdminAppEnv>();

const TOP_ITEMS_LIMIT = 10;
const RECENT_EVENTS_PAGE_SIZE = 20;
const RECENT_MCP_PAGE_SIZE = 30;

type RecentEventRow = {
	eventType: string;
	pageUrl: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	timestamp: string;
};

type RecentMcpAuditRow = {
	ipAddress: string | null;
	requestMethod: string;
	requestPath: string;
	sessionId: string | null;
	authState: string;
	responseStatus: number;
	outcome: string;
	mcpMethod: string | null;
	toolName: string | null;
	requestId: string | null;
	detail: string | null;
	timestamp: string;
};

type FullSessionRow = {
	id: number;
	sessionId: string;
	ipAddress: string | null;
	ipHash: string | null;
	country: string | null;
	region: string | null;
	city: string | null;
	userAgent: string | null;
	browser: string | null;
	os: string | null;
	deviceType: string | null;
	referrer: string | null;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	landingPage: string | null;
	startedAt: string;
	lastSeenAt: string;
};

type FullEventRow = {
	id: number;
	sessionId: string;
	eventType: string;
	eventName: string | null;
	pageUrl: string | null;
	pageTitle: string | null;
	ipAddress: string | null;
	userAgent: string | null;
	eventData: string | null;
	scrollDepth: number | null;
	timeOnPageSeconds: number | null;
	timestamp: string;
};

type FullMcpAuditRow = {
	id: number;
	ipAddress: string | null;
	requestMethod: string;
	requestPath: string;
	sessionId: string | null;
	authState: string;
	responseStatus: number;
	outcome: string;
	mcpMethod: string | null;
	toolName: string | null;
	requestId: string | null;
	detail: string | null;
	userAgent: string | null;
	timestamp: string;
};

function parsePageValue(value: string | undefined, fallback = 1) {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return fallback;
	}

	return parsed;
}

function buildPageHref(
	requestUrl: string,
	paramKey: "eventsPage" | "mcpPage",
	page: number,
) {
	const url = new URL(requestUrl);
	url.searchParams.set(paramKey, String(page));
	url.searchParams.delete("cleanup");
	return `${url.pathname}${url.search}`;
}

function renderPagination(options: {
	requestUrl: string;
	paramKey: "eventsPage" | "mcpPage";
	current: number;
	total: number;
}) {
	const { requestUrl, paramKey, current, total } = options;
	if (total <= 1) {
		return "";
	}

	const previous = current > 1 ? current - 1 : null;
	const next = current < total ? current + 1 : null;

	return `
		<div class="table-actions" style="margin-top: 0.75rem;">
			${
				previous
					? `<a class="btn btn-sm" href="${escapeAttribute(buildPageHref(requestUrl, paramKey, previous))}">Trang trước</a>`
					: `<span class="btn btn-sm" aria-disabled="true" style="pointer-events:none;opacity:0.48;">Trang trước</span>`
			}
			<span class="form-help">Trang ${current} / ${total}</span>
			${
				next
					? `<a class="btn btn-sm" href="${escapeAttribute(buildPageHref(requestUrl, paramKey, next))}">Trang sau</a>`
					: `<span class="btn btn-sm" aria-disabled="true" style="pointer-events:none;opacity:0.48;">Trang sau</span>`
			}
		</div>
	`;
}

function formatExportTimestamp() {
	return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function toUtcIsoString(value: string): string | null {
	const raw = String(value ?? "").trim();
	if (!raw) {
		return null;
	}

	let normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
	if (!/[zZ]$|[+-]\d{2}:\d{2}$/u.test(normalized)) {
		normalized = `${normalized}Z`;
	}

	return Number.isNaN(Date.parse(normalized)) ? null : normalized;
}

function renderLocalTimeCell(value: string): string {
	const iso = toUtcIsoString(value);
	if (!iso) {
		return escapeHtml(value);
	}

	return `<time data-admin-local-time="utc" data-admin-time-value="${escapeAttribute(iso)}">${escapeHtml(value)}</time>`;
}

analytics.use("*", requireAuth);

analytics.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const requestedEventsPage = parsePageValue(c.req.query("eventsPage"), 1);
	const requestedMcpPage = parsePageValue(c.req.query("mcpPage"), 1);
	const forceCleanup = c.req.query("cleanup") === "1";

	const stats = {
		totalSessions: 0,
		totalPageViews: 0,
		totalMcpRequests: 0,
		totalMcpNotFound: 0,
		topPages: [] as Array<{ pageUrl: string; views: number }>,
		topReferrers: [] as Array<{ referrer: string; count: number }>,
		recentEvents: [] as RecentEventRow[],
		recentMcpLogs: [] as RecentMcpAuditRow[],
		eventsPage: 1,
		mcpPage: 1,
		totalEventPages: 1,
		totalMcpPages: 1,
		cleanupNotice: "",
	};

	try {
		const db = getDb(c.env.DB);
		const cleanup = await maybeCleanupAnalyticsData(c.env, {
			force: forceCleanup,
		});
		if (cleanup.ran) {
			stats.cleanupNotice = `Chính sách lưu giữ thống kê đã được thực thi: Đã xóa ${cleanup.deletedEvents} sự kiện, ${cleanup.deletedSessions} phiên, ${cleanup.deletedMcpLogs} kiểm toán MCP (giữ lại ${ANALYTICS_RETENTION_DAYS} ngày gần nhất)`;
		}

		const [sessionCount] = await db
			.select({ count: sql<number>`count(*)` })
			.from(analyticsSessions);
		stats.totalSessions = sessionCount?.count ?? 0;

		const [pageViewCount] = await db
			.select({ count: sql<number>`count(*)` })
			.from(analyticsEvents);
		stats.totalPageViews = pageViewCount?.count ?? 0;

		const [mcpRequestCount] = await db
			.select({ count: sql<number>`count(*)` })
			.from(mcpAuditLogs);
		stats.totalMcpRequests = mcpRequestCount?.count ?? 0;

		const [mcpNotFoundCount] = await db
			.select({ count: sql<number>`count(*)` })
			.from(mcpAuditLogs)
			.where(sql`${mcpAuditLogs.responseStatus} = 404`);
		stats.totalMcpNotFound = mcpNotFoundCount?.count ?? 0;

		stats.totalEventPages = Math.max(
			1,
			Math.ceil(stats.totalPageViews / RECENT_EVENTS_PAGE_SIZE),
		);
		stats.totalMcpPages = Math.max(
			1,
			Math.ceil(stats.totalMcpRequests / RECENT_MCP_PAGE_SIZE),
		);
		stats.eventsPage = Math.min(requestedEventsPage, stats.totalEventPages);
		stats.mcpPage = Math.min(requestedMcpPage, stats.totalMcpPages);
		const eventsOffset = (stats.eventsPage - 1) * RECENT_EVENTS_PAGE_SIZE;
		const mcpOffset = (stats.mcpPage - 1) * RECENT_MCP_PAGE_SIZE;

		stats.topPages = (await db
			.select({
				pageUrl: analyticsEvents.pageUrl,
				views: sql<number>`count(*)`,
			})
			.from(analyticsEvents)
			.groupBy(analyticsEvents.pageUrl)
			.orderBy(desc(sql`count(*)`))
			.limit(TOP_ITEMS_LIMIT)) as Array<{ pageUrl: string; views: number }>;

		stats.topReferrers = (
			await db
				.select({
					referrer: analyticsSessions.referrer,
					count: sql<number>`count(*)`,
				})
				.from(analyticsSessions)
				.groupBy(analyticsSessions.referrer)
				.orderBy(desc(sql`count(*)`))
				.limit(TOP_ITEMS_LIMIT)
		).filter((r) => r.referrer) as Array<{ referrer: string; count: number }>;

		stats.recentEvents = await db
			.select({
				eventType: analyticsEvents.eventType,
				pageUrl: analyticsEvents.pageUrl,
				ipAddress: analyticsEvents.ipAddress,
				userAgent: analyticsEvents.userAgent,
				timestamp: analyticsEvents.timestamp,
			})
			.from(analyticsEvents)
			.orderBy(desc(analyticsEvents.timestamp))
			.limit(RECENT_EVENTS_PAGE_SIZE)
			.offset(eventsOffset);

		stats.recentMcpLogs = await db
			.select({
				ipAddress: mcpAuditLogs.ipAddress,
				requestMethod: mcpAuditLogs.requestMethod,
				requestPath: mcpAuditLogs.requestPath,
				sessionId: mcpAuditLogs.sessionId,
				authState: mcpAuditLogs.authState,
				responseStatus: mcpAuditLogs.responseStatus,
				outcome: mcpAuditLogs.outcome,
				mcpMethod: mcpAuditLogs.mcpMethod,
				toolName: mcpAuditLogs.toolName,
				requestId: mcpAuditLogs.requestId,
				detail: mcpAuditLogs.detail,
				timestamp: mcpAuditLogs.timestamp,
			})
			.from(mcpAuditLogs)
			.orderBy(desc(mcpAuditLogs.timestamp))
			.limit(RECENT_MCP_PAGE_SIZE)
			.offset(mcpOffset);
	} catch {
		// Khi D1 không được liên kết, quay về thống kê trống
	}

	const content = `
		<div class="page-header">
			<h1>Thống kê truy cập</h1>
			<div class="table-actions analytics-actions">
				<a href="/api/admin/analytics/export?format=jsonl" class="btn">Tải xuống toàn bộ chi tiết (JSONL)</a>
				<a href="/api/admin/analytics/export?format=json" class="btn">Tải xuống toàn bộ chi tiết (JSON)</a>
				<a href="/api/admin/analytics?cleanup=1" class="btn">Xóa dữ liệu cũ hơn ${ANALYTICS_RETENTION_DAYS} ngày</a>
			</div>
		</div>
			<p class="page-intro">Tập trung xem lượt truy cập trang, phân bổ nguồn truy cập, sự kiện gần đây và kiểm toán MCP. Mặc định tự động giữ lại ${ANALYTICS_RETENTION_DAYS} ngày gần nhất để tránh log tăng không giới hạn.</p>
		${
			stats.cleanupNotice
				? `<div class="alert alert-success">${escapeHtml(stats.cleanupNotice)}</div>`
				: ""
		}
			<div class="stats-grid">
				<div class="stat-card">
					<span class="stat-value">${stats.totalSessions}</span>
					<span class="stat-label">Tổng số phiên</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.totalPageViews}</span>
					<span class="stat-label">Tổng số sự kiện</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.totalMcpRequests}</span>
					<span class="stat-label">Tổng yêu cầu MCP</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${stats.totalMcpNotFound}</span>
					<span class="stat-label">Số lần MCP 404</span>
				</div>
			</div>

		<h2>Trang phổ biến</h2>
		${
			stats.topPages.length > 0
				? `<div class="table-card"><table class="data-table">
				<thead><tr><th>Trang</th><th>Lượt xem</th></tr></thead>
				<tbody>
					${stats.topPages.map((p) => `<tr><td class="table-cell-break">${escapeHtml(p.pageUrl || "-")}</td><td>${p.views}</td></tr>`).join("")}
				</tbody>
			</table></div>`
				: "<p class='empty-state'>Hiện chưa có dữ liệu truy cập trang.</p>"
		}

			<h2>Trang nguồn</h2>
			${
				stats.topReferrers.length > 0
					? `<div class="table-card"><table class="data-table">
					<thead><tr><th>Nguồn</th><th>Số lần</th></tr></thead>
				<tbody>
					${stats.topReferrers.map((r) => `<tr><td class="table-cell-break">${escapeHtml(r.referrer)}</td><td>${r.count}</td></tr>`).join("")}
				</tbody>
				</table></div>`
					: "<p class='empty-state'>Hiện chưa có dữ liệu thống kê nguồn truy cập.</p>"
			}

			<h2>Cột kiểm toán MCP</h2>
			<p class="form-help">Ghi lại toàn bộ yêu cầu MCP, bao gồm xác thực thất bại, 404 do quét, giới hạn tốc độ và chi tiết gọi công cụ.</p>
			${
				stats.recentMcpLogs.length > 0
					? `<div class="table-card"><table class="data-table">
					<thead><tr><th>Thời gian</th><th>IP</th><th>Yêu cầu</th><th>Thao tác</th><th>Kết quả</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
					<tbody>
						${stats.recentMcpLogs
							.map((log) => {
								const operationLabel = escapeHtml(
									log.toolName
										? `${log.mcpMethod || "tools/call"}:${log.toolName}`
										: log.mcpMethod || "-",
								);
								const resultLabel = escapeHtml(
									`${log.authState} / ${log.outcome}`,
								);
								const requestLabel = escapeHtml(
									`${log.requestMethod} ${log.requestPath}`,
								);
								const statusLabel = escapeHtml(String(log.responseStatus));
								const note = [
									log.requestId ? `requestId=${log.requestId}` : "",
									log.sessionId ? `session=${log.sessionId}` : "",
									log.detail || "",
								]
									.filter(Boolean)
									.join(" | ");
								return `<tr><td>${renderLocalTimeCell(log.timestamp)}</td><td>${escapeHtml(log.ipAddress || "-")}</td><td class="table-cell-break">${requestLabel}</td><td class="table-cell-break">${operationLabel}</td><td class="table-cell-break">${resultLabel}</td><td>${statusLabel}</td><td class="table-cell-break">${escapeHtml(note || "-")}</td></tr>`;
							})
							.join("")}
					</tbody>
				</table></div>
				${renderPagination({
					requestUrl: c.req.url,
					paramKey: "mcpPage",
					current: stats.mcpPage,
					total: stats.totalMcpPages,
				})}`
					: "<p class='empty-state'>Hiện chưa có log kiểm toán MCP.</p>"
			}

		<h2>Sự kiện gần đây</h2>
		${
			stats.recentEvents.length > 0
				? `<div class="table-card"><table class="data-table">
				<thead><tr><th>Loại</th><th>Trang</th><th>IP</th><th>UA</th><th>Thời gian</th></tr></thead>
				<tbody>
					${stats.recentEvents.map((e) => `<tr><td>${escapeHtml(e.eventType)}</td><td class="table-cell-break">${escapeHtml(e.pageUrl || "-")}</td><td>${escapeHtml(e.ipAddress || "-")}</td><td class="table-cell-break">${escapeHtml(e.userAgent || "-")}</td><td>${renderLocalTimeCell(e.timestamp)}</td></tr>`).join("")}
				</tbody>
			</table></div>
			${renderPagination({
				requestUrl: c.req.url,
				paramKey: "eventsPage",
				current: stats.eventsPage,
				total: stats.totalEventPages,
			})}`
				: "<p class='empty-state'>Hiện chưa có bản ghi sự kiện.</p>"
		}
	`;

	return c.html(
		adminLayout("Thống kê truy cập", content, { csrfToken: session.csrfToken }),
	);
});

analytics.get("/export", async (c) => {
	const db = getDb(c.env.DB);
	const format = c.req.query("format") === "json" ? "json" : "jsonl";
	const generatedAt = new Date().toISOString();

	const sessions = (await db
		.select({
			id: analyticsSessions.id,
			sessionId: analyticsSessions.sessionId,
			ipAddress: analyticsSessions.ipAddress,
			ipHash: analyticsSessions.ipHash,
			country: analyticsSessions.country,
			region: analyticsSessions.region,
			city: analyticsSessions.city,
			userAgent: analyticsSessions.userAgent,
			browser: analyticsSessions.browser,
			os: analyticsSessions.os,
			deviceType: analyticsSessions.deviceType,
			referrer: analyticsSessions.referrer,
			utmSource: analyticsSessions.utmSource,
			utmMedium: analyticsSessions.utmMedium,
			utmCampaign: analyticsSessions.utmCampaign,
			landingPage: analyticsSessions.landingPage,
			startedAt: analyticsSessions.startedAt,
			lastSeenAt: analyticsSessions.lastSeenAt,
		})
		.from(analyticsSessions)
		.orderBy(desc(analyticsSessions.lastSeenAt))) as FullSessionRow[];

	const events = (await db
		.select({
			id: analyticsEvents.id,
			sessionId: analyticsEvents.sessionId,
			eventType: analyticsEvents.eventType,
			eventName: analyticsEvents.eventName,
			pageUrl: analyticsEvents.pageUrl,
			pageTitle: analyticsEvents.pageTitle,
			ipAddress: analyticsEvents.ipAddress,
			userAgent: analyticsEvents.userAgent,
			eventData: analyticsEvents.eventData,
			scrollDepth: analyticsEvents.scrollDepth,
			timeOnPageSeconds: analyticsEvents.timeOnPageSeconds,
			timestamp: analyticsEvents.timestamp,
		})
		.from(analyticsEvents)
		.orderBy(desc(analyticsEvents.timestamp))) as FullEventRow[];

	const mcpLogs = (await db
		.select({
			id: mcpAuditLogs.id,
			ipAddress: mcpAuditLogs.ipAddress,
			requestMethod: mcpAuditLogs.requestMethod,
			requestPath: mcpAuditLogs.requestPath,
			sessionId: mcpAuditLogs.sessionId,
			authState: mcpAuditLogs.authState,
			responseStatus: mcpAuditLogs.responseStatus,
			outcome: mcpAuditLogs.outcome,
			mcpMethod: mcpAuditLogs.mcpMethod,
			toolName: mcpAuditLogs.toolName,
			requestId: mcpAuditLogs.requestId,
			detail: mcpAuditLogs.detail,
			userAgent: mcpAuditLogs.userAgent,
			timestamp: mcpAuditLogs.timestamp,
		})
		.from(mcpAuditLogs)
		.orderBy(desc(mcpAuditLogs.timestamp))) as FullMcpAuditRow[];

	const fileName = `analytics-export-${formatExportTimestamp()}.${format === "json" ? "json" : "jsonl"}`;
	if (format === "json") {
		const payload = JSON.stringify(
			{
				generatedAt,
				retentionDays: ANALYTICS_RETENTION_DAYS,
				sessions,
				events,
				mcpLogs,
			},
			null,
			2,
		);

		return new Response(payload, {
			headers: {
				"content-type": "application/json; charset=utf-8",
				"content-disposition": `attachment; filename="${fileName}"`,
				"cache-control": "no-store",
			},
		});
	}

	const lines = [
		JSON.stringify({
			type: "meta",
			generatedAt,
			retentionDays: ANALYTICS_RETENTION_DAYS,
			sessionsCount: sessions.length,
			eventsCount: events.length,
			mcpLogsCount: mcpLogs.length,
		}),
	];

	for (const row of sessions) {
		lines.push(JSON.stringify({ type: "session", ...row }));
	}
	for (const row of events) {
		lines.push(JSON.stringify({ type: "event", ...row }));
	}
	for (const row of mcpLogs) {
		lines.push(JSON.stringify({ type: "mcp-audit", ...row }));
	}

	return new Response(lines.join("\n"), {
		headers: {
			"content-type": "application/x-ndjson; charset=utf-8",
			"content-disposition": `attachment; filename="${fileName}"`,
			"cache-control": "no-store",
		},
	});
});

export { analytics as analyticsRoutes };
