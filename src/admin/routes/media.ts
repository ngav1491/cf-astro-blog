import { Hono } from "hono";
import {
	deleteMediaObjectAndIndex,
	getAllowedMediaAcceptValue,
	getMediaContentTypeForKey,
	isAllowedImageMimeType,
	isImageMediaKey,
	isMediaHashIndexKey,
	MAX_UPLOAD_BYTES,
	saveMediaObjectWithDedup,
} from "@/lib/media";
import {
	buildProtectedAssetHeaders,
	decodeRouteParam,
	encodeRouteParam,
	escapeAttribute,
	escapeHtml,
	sanitizeMediaKey,
} from "@/lib/security";
import {
	type AdminAppEnv,
	assertCsrfToken,
	getAuthenticatedSession,
	getBodyFile,
	getBodyText,
	requireAuth,
} from "../middleware/auth";
import { adminLayout } from "../views/layout";

const media = new Hono<AdminAppEnv>();
const DEFAULT_MEDIA_UPLOAD_PREFIX = "uploads";
const POST_UPLOAD_SCOPE_PATTERN = /^[a-z0-9-]{1,80}$/u;

function renderMediaErrorPage(csrfToken: string, message: string) {
	return adminLayout(
		"Xử lý phương tiện thất bại",
		`<div class="alert alert-error">${escapeHtml(message)}</div><p><a href="/api/admin/media">Quay lại thư viện phương tiện</a></p>`,
		{ csrfToken },
	);
}

function parseUploadFile(body: Record<string, unknown>): File | null {
	return getBodyFile(body, "file");
}

function validateUploadFile(file: File): string | null {
	if (!isAllowedImageMimeType(file.type)) {
		return "Chỉ cho phép tải lên hình ảnh JPG, PNG, WEBP, AVIF hoặc GIF";
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		return "Mỗi tệp không thể vượt quá 50 MB";
	}

	return null;
}

function extractWildcardMediaKey(
	c: {
		req: {
			param: (name: string) => string;
			path: string;
		};
	},
	prefix: string,
) {
	const wildcardRaw =
		c.req.param("*") || c.req.param("0") || c.req.path.replace(prefix, "");
	const normalized = wildcardRaw.replace(/^\/+/u, "");
	return decodeRouteParam(normalized);
}

function sanitizePostUploadScope(value: string): string | null {
	const normalized = String(value ?? "")
		.trim()
		.toLowerCase();
	if (!normalized) {
		return null;
	}

	return POST_UPLOAD_SCOPE_PATTERN.test(normalized) ? normalized : null;
}

function resolveUploadPrefix(body: Record<string, unknown>): {
	error: string | null;
	prefix: string;
} {
	const uploadScopeRaw = getBodyText(body, "uploadScope");
	if (!uploadScopeRaw) {
		return { prefix: DEFAULT_MEDIA_UPLOAD_PREFIX, error: null };
	}

	const uploadScope = sanitizePostUploadScope(uploadScopeRaw);
	if (!uploadScope) {
		return {
			prefix: DEFAULT_MEDIA_UPLOAD_PREFIX,
			error: "Tham số thư mục tải lên không hợp lệ, chỉ cho phép chữ thường, số và dấu gạch ngang",
		};
	}

	const uploadKindRaw = getBodyText(body, "uploadKind").toLowerCase();
	const uploadKind = uploadKindRaw === "cover" ? "cover" : "content";
	return {
		prefix: `posts/${uploadScope}/${uploadKind}`,
		error: null,
	};
}

function getMediaDisplayName(key: string) {
	const normalized = String(key ?? "").trim();
	if (!normalized) {
		return "-";
	}

	const segments = normalized.split("/").filter(Boolean);
	return segments.at(-1) || normalized;
}

function getMediaDirectoryLabel(key: string) {
	const normalized = String(key ?? "").trim();
	if (!normalized || !normalized.includes("/")) {
		return "Thư mục gốc";
	}

	const segments = normalized.split("/").filter(Boolean);
	if (segments.length <= 1) {
		return "Thư mục gốc";
	}

	return segments.slice(0, -1).join("/");
}

async function saveUploadFile(
	c: { env: AdminAppEnv["Bindings"] },
	file: File,
	prefix = DEFAULT_MEDIA_UPLOAD_PREFIX,
) {
	return saveMediaObjectWithDedup({
		bucket: c.env.MEDIA_BUCKET,
		file,
		prefix,
	});
}

async function listVisibleMediaObjects(
	bucket: AdminAppEnv["Bindings"]["MEDIA_BUCKET"],
	limit: number,
) {
	const visibleObjects: R2Object[] = [];
	let cursor: string | undefined;

	while (visibleObjects.length < limit) {
		const listed = await bucket.list({ cursor, limit: 1000 });
		for (const object of listed.objects) {
			if (!isMediaHashIndexKey(object.key)) {
				visibleObjects.push(object);
			}

			if (visibleObjects.length >= limit) {
				break;
			}
		}

		if (!listed.truncated) {
			break;
		}
		cursor = listed.cursor;
	}

	return visibleObjects;
}

media.use("*", requireAuth);

media.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	let objects: R2Object[] = [];

	try {
		objects = await listVisibleMediaObjects(c.env.MEDIA_BUCKET, 100);
	} catch {
		// Khi R2 không được liên kết, quay về danh sách trống
	}

	const content = `
		<h1>Thư viện phương tiện</h1>
		<form
			method="post"
			action="/api/admin/media/upload"
			enctype="multipart/form-data"
			class="upload-form media-upload-form"
			data-media-upload-form="true"
		>
			<input type="hidden" name="_csrf" value="${escapeAttribute(session.csrfToken)}" />
			<input
				type="file"
				id="mediaUploadInput"
				name="file"
				accept="${escapeAttribute(getAllowedMediaAcceptValue())}"
				class="media-upload-input"
				data-media-upload-input="true"
				required
			/>
			<label
				for="mediaUploadInput"
				class="media-upload-dropzone"
				data-media-upload-dropzone="true"
				tabindex="0"
			>
				<span class="media-upload-copy">
					<strong>Kéo hình ảnh vào đây, hoặc nhấp để chọn tệp</strong>
					<span data-media-upload-filename="true">Hỗ trợ JPG, PNG, WEBP, AVIF, GIF, mỗi tệp không quá 50 MB</span>
				</span>
			</label>
			<div class="media-upload-actions">
				<button type="submit" class="btn btn-primary">Tải lên</button>
			</div>
		</form>
		<div class="media-grid">
			${
				objects.length > 0
					? objects
							.map((obj) => {
								const displayName = getMediaDisplayName(obj.key);
								const directory = getMediaDirectoryLabel(obj.key);
								return `
				<div class="media-item">
					<div class="media-preview">
						${
							isImageMediaKey(obj.key)
								? `<img src="/api/admin/media/file/${encodeRouteParam(obj.key)}" alt="${escapeAttribute(obj.key)}" loading="lazy" />`
								: `<span class="file-icon">${escapeHtml(obj.key.split(".").pop()?.toUpperCase() || "Tệp")}</span>`
						}
					</div>
					<div class="media-info">
						<span class="media-name" title="${escapeAttribute(obj.key)}">${escapeHtml(displayName)}</span>
						<span class="media-directory" title="${escapeAttribute(directory)}">Thư mục: ${escapeHtml(directory)}</span>
						<span class="media-size">${formatBytes(obj.size)}</span>
					</div>
					<form method="post" action="/api/admin/media/delete/${encodeRouteParam(obj.key)}" class="media-actions" data-confirm-message="${escapeAttribute("Xác nhận xóa tệp phương tiện này?")}">
						<input type="hidden" name="_csrf" value="${escapeAttribute(session.csrfToken)}" />
						<button type="button" class="btn btn-sm" data-copy-value="${escapeAttribute(obj.key)}">Sao chép khóa</button>
						<button type="submit" class="btn btn-sm btn-danger">Xóa</button>
					</form>
				</div>`;
							})
							.join("")
					: "<p class='empty-state'>Hiện chưa tải lên bất kỳ tệp phương tiện nào.</p>"
			}
		</div>
	`;

	return c.html(
		adminLayout("Thư viện phương tiện", content, { csrfToken: session.csrfToken }),
	);
});

media.post("/upload", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody({ all: true });
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("Xác thực CSRF thất bại", 403);
	}
	const file = parseUploadFile(body);
	if (!file) {
		return c.html(
			renderMediaErrorPage(session.csrfToken, "Vui lòng chọn tệp để tải lên"),
			400,
		);
	}

	const validationError = validateUploadFile(file);
	if (validationError) {
		return c.html(
			renderMediaErrorPage(session.csrfToken, validationError),
			400,
		);
	}

	const uploadTarget = resolveUploadPrefix(body);
	if (uploadTarget.error) {
		return c.html(
			renderMediaErrorPage(session.csrfToken, uploadTarget.error),
			400,
		);
	}

	await saveUploadFile(c, file, uploadTarget.prefix);

	return c.redirect("/api/admin/media");
});

media.post("/upload-async", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody({ all: true });
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.json({ message: "Xác thực CSRF thất bại" }, 403);
	}

	const file = parseUploadFile(body);
	if (!file) {
		return c.json({ message: "Vui lòng chọn tệp để tải lên" }, 400);
	}

	const validationError = validateUploadFile(file);
	if (validationError) {
		return c.json({ message: validationError }, 400);
	}

	const uploadTarget = resolveUploadPrefix(body);
	if (uploadTarget.error) {
		return c.json({ message: uploadTarget.error }, 400);
	}

	try {
		const uploaded = await saveUploadFile(c, file, uploadTarget.prefix);
		return c.json({
			key: uploaded.key,
			url: `/media/${uploaded.key}`,
			deduplicated: uploaded.deduplicated,
			message: uploaded.deduplicated
				? "Phát hiện nội dung trùng lặp, đã sử dụng lại tệp phương tiện hiện có"
				: "Tải lên thành công",
		});
	} catch {
		return c.json({ message: "Tải lên thất bại, vui lòng thử lại sau" }, 500);
	}
});

media.get("/file/*", async (c) => {
	const decodedKey = extractWildcardMediaKey(c, "/admin/media/file/");
	const key = sanitizeMediaKey(decodedKey);
	if (!key) {
		return c.notFound();
	}

	const contentType = getMediaContentTypeForKey(key);
	if (!contentType) {
		return c.notFound();
	}

	const object = await c.env.MEDIA_BUCKET.get(key);

	if (!object) {
		return c.notFound();
	}

	return new Response(object.body, {
		headers: buildProtectedAssetHeaders(contentType),
	});
});

media.post("/delete/*", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = await c.req.parseBody({ all: true });
	if (!assertCsrfToken(getBodyText(body, "_csrf"), session)) {
		return c.text("Xác thực CSRF thất bại", 403);
	}

	const decodedKey = extractWildcardMediaKey(c, "/admin/media/delete/");
	const key = sanitizeMediaKey(decodedKey);
	if (!key) {
		return c.text("Khóa phương tiện không hợp lệ", 400);
	}
	if (isMediaHashIndexKey(key)) {
		return c.text("Không cho phép xóa đối tượng chỉ mục nội bộ", 400);
	}

	await deleteMediaObjectAndIndex(c.env.MEDIA_BUCKET, key);
	return c.redirect("/api/admin/media");
});

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export { media as mediaRoutes };
