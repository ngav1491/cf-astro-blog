import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { friendLinks } from "@/db/schema";
import { getDb } from "@/lib/db";
import {
	escapeAttribute,
	escapeHtml,
	parseOptionalPositiveInt,
	sanitizeCanonicalUrl,
	sanitizePlainText,
} from "@/lib/security";
import {
	type AdminAppEnv,
	assertCsrfToken,
	getAuthenticatedSession,
	getBodyText,
	requireAuth,
} from "../middleware/auth";
import { adminLayout } from "../views/layout";

const friendsRoutes = new Hono<AdminAppEnv>();

const FRIEND_LINK_STATUS_VALUES = [
	"pending",
	"approved",
	"rejected",
	"offline",
] as const;

type FriendLinkStatus = (typeof FRIEND_LINK_STATUS_VALUES)[number];

interface FriendLinkRow {
	id: number;
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
	status: string;
	reviewNote: string | null;
	reviewedAt: string | null;
	createdAt: string;
}

interface FriendLinkCreateInput {
	name: string;
	siteUrl: string;
	avatarUrl: string | null;
	description: string;
	contact: string;
	note: string | null;
	status: FriendLinkStatus;
	reviewNote: string | null;
}

function normalizeFriendLinkStatus(value: unknown): FriendLinkStatus | null {
	const normalized = String(value ?? "").trim();
	return FRIEND_LINK_STATUS_VALUES.includes(normalized as FriendLinkStatus)
		? (normalized as FriendLinkStatus)
		: null;
}

function getFriendStatusLabel(status: string) {
	switch (normalizeFriendLinkStatus(status)) {
		case "approved":
			return "Đã duyệt";
		case "rejected":
			return "Đã từ chối";
		case "offline":
			return "Đã gỡ xuống";
		default:
			return "Chờ kiểm duyệt";
	}
}

function getFriendBadgeClass(status: string) {
	switch (normalizeFriendLinkStatus(status)) {
		case "approved":
			return "published";
		case "pending":
			return "scheduled";
		default:
			return "draft";
	}
}

function resolveAlert(
	status: string | null,
): { type: "success" | "error"; message: string } | undefined {
	switch (status) {
		case "updated":
			return { type: "success", message: "Trạng thái liên kết bạn bè đã được cập nhật" };
		case "deleted":
			return { type: "success", message: "Bản ghi liên kết bạn bè đã được xóa" };
		case "created":
			return { type: "success", message: "Đã thêm liên kết bạn bè, có thể quản lý ngay trong danh sách" };
		case "invalid-id":
			return { type: "error", message: "ID liên kết bạn bè không hợp lệ" };
		case "invalid-status":
			return { type: "error", message: "Trạng thái liên kết bạn bè không hợp lệ" };
		case "create-invalid":
			return { type: "error", message: "Tham số thêm liên kết bạn bè không đầy đủ hoặc định dạng không hợp lệ" };
		case "create-duplicate":
			return { type: "error", message: "Địa chỉ trang web này đã tồn tại, không thể thêm trùng lặp" };
		case "csrf-failed":
			return { type: "error", message: "Xác thực CSRF thất bại, vui lòng làm mới trang rồi thử lại" };
		default:
			return undefined;
	}
}

function parseFriendCreateInput(
	body: Record<string, unknown>,
): { data: FriendLinkCreateInput } | { error: "invalid" } {
	const name = sanitizePlainText(getBodyText(body, "createName"), 80);
	const siteUrl = sanitizeCanonicalUrl(getBodyText(body, "createSiteUrl"));
	const rawAvatarUrl = getBodyText(body, "createAvatarUrl");
	const avatarUrl = rawAvatarUrl ? sanitizeCanonicalUrl(rawAvatarUrl) : null;
	const description = sanitizePlainText(
		getBodyText(body, "createDescription"),
		320,
		{ allowNewlines: true },
	);
	const contact = sanitizePlainText(getBodyText(body, "createContact"), 120, {
		allowNewlines: true,
	});
	const note =
		sanitizePlainText(getBodyText(body, "createNote"), 320, {
			allowNewlines: true,
		}) || null;
	const reviewNote =
		sanitizePlainText(getBodyText(body, "createReviewNote"), 320, {
			allowNewlines: true,
		}) || null;
	const status = normalizeFriendLinkStatus(
		getBodyText(body, "createStatus") || "approved",
	);

	if (!name || !siteUrl || !contact || !status) {
		return { error: "invalid" };
	}

	if (rawAvatarUrl && !avatarUrl) {
		return { error: "invalid" };
	}

	return {
		data: {
			name,
			siteUrl,
			avatarUrl,
			description,
			contact,
			note,
			status,
			reviewNote,
		},
	};
}

function formatDateTime(value: string | null | undefined): string {
	if (!value) {
		return "-";
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return date.toLocaleString("zh-CN", { hour12: false });
}

function renderFriendRows(rows: FriendLinkRow[], csrfToken: string) {
	if (rows.length === 0) {
		return '<p class="form-help">Hiện không có bản ghi nào.</p>';
	}

	return rows
		.map(
			(item) => `
		<details class="appearance-panel review-card friend-review-item">
			<summary class="friend-review-summary">
				<div class="friend-review-summary-main">
					<h3 class="review-card-title">${escapeHtml(item.name)}</h3>
					<p class="form-help review-card-meta">Thời gian gửi: ${escapeHtml(formatDateTime(item.createdAt))}</p>
				</div>
				<div class="friend-review-summary-extra">
					<p class="friend-review-summary-site">${escapeHtml(item.siteUrl)}</p>
					<div class="friend-review-summary-state">
						<span class="badge badge-${escapeAttribute(getFriendBadgeClass(item.status))}">${escapeHtml(getFriendStatusLabel(item.status))}</span>
						<span class="friend-review-summary-caret" aria-hidden="true"></span>
					</div>
				</div>
			</summary>

			<div class="friend-review-content">
				<div class="review-card-body">
					<div class="review-item">
						<span class="review-item-label">Trang web</span>
						<span class="review-item-value"><a href="${escapeAttribute(item.siteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.siteUrl)}</a></span>
					</div>
					${
						item.avatarUrl
							? `<div class="review-item">
						<span class="review-item-label">Avatar</span>
						<span class="review-item-value"><a href="${escapeAttribute(item.avatarUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.avatarUrl)}</a></span>
					</div>`
							: ""
					}
					<div class="review-item review-item-span-2">
						<span class="review-item-label">Giới thiệu</span>
						<span class="review-item-value">${item.description ? escapeHtml(item.description) : "(Chưa điền)"}</span>
					</div>
					<div class="review-item">
						<span class="review-item-label">Liên hệ</span>
						<span class="review-item-value">${escapeHtml(item.contact)}</span>
					</div>
					<div class="review-item">
						<span class="review-item-label">Kiểm duyệt lần cuối</span>
						<span class="review-item-value">${escapeHtml(formatDateTime(item.reviewedAt))}</span>
					</div>
					${
						item.note
							? `<div class="review-item review-item-span-2">
						<span class="review-item-label">Ghi chú của quản trị viên</span>
						<span class="review-item-value">${escapeHtml(item.note)}</span>
					</div>`
							: ""
					}
				</div>

				<div class="review-card-actions">
					<form method="post" action="/api/admin/friends/${item.id}/review" class="review-review-form">
						<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
						<div class="appearance-inline-grid">
							<div class="form-group form-group-tight">
								<label for="status-${item.id}">Trạng thái kiểm duyệt</label>
								<select id="status-${item.id}" name="status" class="form-select">
									${FRIEND_LINK_STATUS_VALUES.map(
										(value) =>
											`<option value="${value}" ${item.status === value ? "selected" : ""}>${escapeHtml(getFriendStatusLabel(value))}</option>`,
									).join("")}
								</select>
							</div>
							<div class="form-group form-group-tight">
								<label for="reviewNote-${item.id}">Ghi chú kiểm duyệt</label>
								<input id="reviewNote-${item.id}" name="reviewNote" class="form-input" maxlength="320" value="${escapeAttribute(item.reviewNote || "")}" placeholder="Tùy chọn" />
							</div>
						</div>
						<div class="form-actions">
							<button type="submit" class="btn btn-primary btn-sm">Lưu kiểm duyệt</button>
						</div>
					</form>
					<form method="post" action="/api/admin/friends/${item.id}/delete" data-confirm-message="${escapeAttribute("Xác nhận xóa bản ghi liên kết bạn bè này?")}" class="review-delete-form">
						<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
						<button type="submit" class="btn btn-sm btn-danger">Xóa bản ghi</button>
					</form>
				</div>
			</div>
		</details>
		`,
		)
		.join("");
}
function renderCreateForm(csrfToken: string): string {
	const createStatusOptions: FriendLinkStatus[] = [
		"approved",
		"pending",
		"offline",
		"rejected",
	];

	return `
		<section id="friend-create-form" class="appearance-panel review-card">
			<h2 style="margin-bottom: 0.35rem;">Thêm liên kết bạn bè mới</h2>
			<p class="form-help" style="margin-bottom: 0.9rem;">Nhập trực tiếp trong backend và đặt trạng thái, không cần đăng ký từ trang chính.</p>
			<form method="post" action="/api/admin/friends/create">
				<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />
				<div class="appearance-inline-grid">
					<div class="form-group">
						<label for="createName">Tên trang web</label>
						<input id="createName" name="createName" class="form-input" maxlength="80" required />
					</div>
					<div class="form-group">
						<label for="createSiteUrl">Địa chỉ trang web</label>
						<input id="createSiteUrl" name="createSiteUrl" class="form-input" type="url" maxlength="320" placeholder="https://example.com" required />
					</div>
					<div class="form-group">
						<label for="createAvatarUrl">Địa chỉ avatar (tùy chọn)</label>
						<input id="createAvatarUrl" name="createAvatarUrl" class="form-input" type="url" maxlength="320" placeholder="https://example.com/avatar.png" />
					</div>
					<div class="form-group">
						<label for="createContact">Liên hệ</label>
						<input id="createContact" name="createContact" class="form-input" maxlength="120" placeholder="Email / X / Telegram" required />
					</div>
					<div class="form-group">
						<label for="createStatus">Trạng thái ban đầu</label>
						<select id="createStatus" name="createStatus" class="form-select">
							${createStatusOptions
								.map(
									(value) =>
										`<option value="${value}" ${value === "approved" ? "selected" : ""}>${escapeHtml(getFriendStatusLabel(value))}</option>`,
								)
								.join("")}
						</select>
					</div>
					<div class="form-group">
						<label for="createReviewNote">Ghi chú kiểm duyệt (tùy chọn)</label>
						<input id="createReviewNote" name="createReviewNote" class="form-input" maxlength="320" placeholder="Ví dụ: Thêm thủ công từ backend" />
					</div>
					<div class="form-group" style="grid-column: 1 / -1;">
						<label for="createDescription">Giới thiệu trang web (tùy chọn)</label>
						<textarea id="createDescription" name="createDescription" class="form-textarea" maxlength="320" rows="3"></textarea>
					</div>
					<div class="form-group" style="grid-column: 1 / -1;">
						<label for="createNote">Ghi chú của quản trị viên (tùy chọn)</label>
						<textarea id="createNote" name="createNote" class="form-textarea" maxlength="320" rows="3"></textarea>
					</div>
				</div>
				<div class="form-actions">
					<button type="submit" class="btn btn-primary">Thêm liên kết bạn bè</button>
				</div>
			</form>
		</section>
	`;
}

function renderFriendsPage(options: {
	rows: FriendLinkRow[];
	csrfToken: string;
	alert?: { type: "success" | "error"; message: string };
}) {
	const { rows, csrfToken, alert } = options;
	const pendingCount = rows.filter((item) => item.status === "pending").length;

	return adminLayout(
		"Quản lý liên kết bạn bè",
		`
			<h1>Quản lý liên kết bạn bè</h1>
			<p class="form-help" style="margin-bottom: 1rem;">Hỗ trợ thêm liên kết bạn bè trực tiếp từ backend, cũng hỗ trợ kiểm duyệt đơn đăng ký từ trang chính và quản lý trạng thái.</p>
			${alert ? `<div class="alert alert-${escapeAttribute(alert.type)}">${escapeHtml(alert.message)}</div>` : ""}
			<div class="page-actions">
				<a href="#friend-create-form" class="btn btn-primary">Thêm liên kết bạn bè</a>
			</div>
			${renderCreateForm(csrfToken)}

			<section>
				<h2 style="margin-bottom: 0.2rem;">Danh sách đăng ký</h2>
				<p class="form-help" style="margin: 0 0 0.8rem;">Tổng cộng ${rows.length} bản ghi, chờ kiểm duyệt ${pendingCount} bản ghi. Bấm vào từng bản ghi để mở rộng chi tiết kiểm duyệt.</p>
				${renderFriendRows(rows, csrfToken)}
			</section>
		`,
		{ csrfToken },
	);
}

friendsRoutes.use("*", requireAuth);

friendsRoutes.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const db = getDb(c.env.DB);
	const status = c.req.query("status") || null;

	const rows = await db
		.select()
		.from(friendLinks)
		.orderBy(desc(friendLinks.createdAt));

	return c.html(
		renderFriendsPage({
			rows,
			csrfToken: session.csrfToken,
			alert: resolveAlert(status),
		}),
	);
});

friendsRoutes.post("/create", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const parsed = parseFriendCreateInput(body);
	if ("error" in parsed) {
		return c.redirect("/api/admin/friends?status=create-invalid");
	}

	const db = getDb(c.env.DB);
	const [existing] = await db
		.select({ id: friendLinks.id })
		.from(friendLinks)
		.where(eq(friendLinks.siteUrl, parsed.data.siteUrl))
		.limit(1);
	if (existing) {
		return c.redirect("/api/admin/friends?status=create-duplicate");
	}

	const now = new Date().toISOString();
	await db.insert(friendLinks).values({
		name: parsed.data.name,
		siteUrl: parsed.data.siteUrl,
		avatarUrl: parsed.data.avatarUrl,
		description: parsed.data.description,
		contact: parsed.data.contact,
		note: parsed.data.note,
		status: parsed.data.status,
		reviewNote: parsed.data.reviewNote,
		reviewedAt: parsed.data.status === "pending" ? null : now,
		createdAt: now,
		updatedAt: now,
	});

	return c.redirect("/api/admin/friends?status=created");
});

friendsRoutes.post("/:id/review", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/friends?status=invalid-id");
	}

	const nextStatus = normalizeFriendLinkStatus(getBodyText(body, "status"));
	if (!nextStatus) {
		return c.redirect("/api/admin/friends?status=invalid-status");
	}

	const reviewNote =
		sanitizePlainText(getBodyText(body, "reviewNote"), 320, {
			allowNewlines: true,
		}) || null;
	const now = new Date().toISOString();
	const db = getDb(c.env.DB);

	await db
		.update(friendLinks)
		.set({
			status: nextStatus,
			reviewNote,
			reviewedAt: nextStatus === "pending" ? null : now,
			updatedAt: now,
		})
		.where(eq(friendLinks.id, id));

	return c.redirect("/api/admin/friends?status=updated");
});

friendsRoutes.post("/:id/delete", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody();
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.redirect("/api/admin/friends?status=csrf-failed");
	}

	const id = parseOptionalPositiveInt(c.req.param("id"));
	if (!id) {
		return c.redirect("/api/admin/friends?status=invalid-id");
	}

	const db = getDb(c.env.DB);
	await db.delete(friendLinks).where(eq(friendLinks.id, id));
	return c.redirect("/api/admin/friends?status=deleted");
});

export { friendsRoutes };
