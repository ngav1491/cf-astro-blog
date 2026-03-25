import { type Context, Hono } from "hono";
import { blogPosts, webMentions } from "@/db/schema";
import { getDb } from "@/lib/db";
import { getPublicPostBySlugCondition } from "@/lib/public-content";
import { sanitizeCanonicalUrl, sanitizePlainText } from "@/lib/security";
import { siteConfig } from "@/lib/types";
import type { AdminAppEnv } from "../middleware/auth";

const webmentionRoutes = new Hono<AdminAppEnv>();
const targetOrigin = new URL(siteConfig.url).origin;
const allowedStaticTargets = new Set(["/", "/blog", "/friends", "/search"]);
const WEBMENTION_FETCH_TIMEOUT_MS = 8_000;
const WEBMENTION_MAX_REDIRECTS = 3;
const WEBMENTION_MAX_HTML_BYTES = 1024 * 1024;

function getBodyText(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	if (Array.isArray(value)) {
		const firstText = value.find(
			(item): item is string => typeof item === "string",
		);
		return firstText?.trim() ?? "";
	}

	return typeof value === "string" ? value.trim() : "";
}

function normalizePathname(pathname: string): string {
	if (!pathname || pathname === "/") {
		return "/";
	}

	return pathname.replace(/\/+$/u, "") || "/";
}

function resolveBlogSlug(pathname: string): string | null {
	const match = pathname.match(/^\/blog\/([^/]+)$/u);
	if (!match?.[1]) {
		return null;
	}

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}

function escapeRegExp(value: string): string {
	return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map((part) => Number(part));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return false;
	}

	const [a, b] = parts;
	if (a === 10 || a === 127 || a === 0) {
		return true;
	}

	if (a === 169 && b === 254) {
		return true;
	}

	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}

	if (a === 192 && b === 168) {
		return true;
	}

	if (a === 100 && b >= 64 && b <= 127) {
		return true;
	}

	return a === 198 && (b === 18 || b === 19);
}

function normalizeHostname(hostname: string): string {
	const normalized = hostname.trim().toLowerCase();
	if (normalized.startsWith("[") && normalized.endsWith("]")) {
		return normalized.slice(1, -1);
	}

	return normalized;
}

function isPrivateIpv6(hostname: string): boolean {
	if (!hostname.includes(":")) {
		return false;
	}

	if (
		hostname === "::1" ||
		hostname.startsWith("fe80:") ||
		hostname.startsWith("fc") ||
		hostname.startsWith("fd")
	) {
		return true;
	}

	// Để tránh địa chỉ IPv4 ánh xạ bị绕过, trực tiếp từ chối toàn bộ tiền tố ::ffff:.
	return hostname.startsWith("::ffff:");
}

function isBlockedSourceHost(hostname: string): boolean {
	const normalized = normalizeHostname(hostname);
	if (!normalized) {
		return true;
	}

	if (
		normalized === "localhost" ||
		normalized.endsWith(".local") ||
		normalized.endsWith(".internal")
	) {
		return true;
	}

	if (isPrivateIpv4(normalized) || isPrivateIpv6(normalized)) {
		return true;
	}

	return false;
}

function validateSourceUrl(sourceUrl: URL): string | null {
	if (!["http:", "https:"].includes(sourceUrl.protocol)) {
		return "source chỉ cho phép sử dụng giao thức http/https.";
	}

	if (sourceUrl.username || sourceUrl.password) {
		return "URL source không được phép chứa tên người dùng hoặc mật khẩu.";
	}

	if (isBlockedSourceHost(sourceUrl.hostname)) {
		return "source không được phép sử dụng địa chỉ máy chủ cục bộ hoặc nội bộ.";
	}

	return null;
}

function decodeHtmlEntities(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&apos;", "'");
}

function findMetaContent(
	html: string,
	attr: "name" | "property",
	key: string,
): string | null {
	const keyPattern = escapeRegExp(key);
	const direct = new RegExp(
		`<meta\\b[^>]*\\b${attr}\\s*=\\s*["']${keyPattern}["'][^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*>`,
		"iu",
	);
	const reverse = new RegExp(
		`<meta\\b[^>]*\\bcontent\\s*=\\s*["']([^"']+)["'][^>]*\\b${attr}\\s*=\\s*["']${keyPattern}["'][^>]*>`,
		"iu",
	);
	const matched = html.match(direct) || html.match(reverse);
	if (!matched?.[1]) {
		return null;
	}

	return decodeHtmlEntities(matched[1]).trim() || null;
}

function findTagText(
	html: string,
	tagName: string,
	maxLength: number,
): string | null {
	const pattern = new RegExp(
		`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
		"iu",
	);
	const matched = html.match(pattern);
	if (!matched?.[1]) {
		return null;
	}

	const stripped = decodeHtmlEntities(matched[1].replaceAll(/<[^>]+>/g, " "))
		.replaceAll(/\s+/g, " ")
		.trim();

	return sanitizePlainText(stripped, maxLength) || null;
}

function extractSourceMetadata(html: string): {
	sourceTitle: string | null;
	sourceExcerpt: string | null;
	sourceAuthor: string | null;
	sourcePublishedAt: string | null;
} {
	const sourceTitle =
		sanitizePlainText(
			findMetaContent(html, "property", "og:title") ||
				findTagText(html, "title", 180) ||
				"",
			180,
		) || null;

	const sourceExcerpt =
		sanitizePlainText(
			findMetaContent(html, "name", "description") ||
				findMetaContent(html, "property", "og:description") ||
				findTagText(html, "p", 320) ||
				"",
			320,
			{ allowNewlines: true },
		) || null;

	const sourceAuthor =
		sanitizePlainText(findMetaContent(html, "name", "author") || "", 120) ||
		null;

	const published =
		findMetaContent(html, "property", "article:published_time") ||
		findMetaContent(html, "name", "date") ||
		null;
	const sourcePublishedAt = sanitizeCanonicalDate(published);

	return {
		sourceTitle,
		sourceExcerpt,
		sourceAuthor,
		sourcePublishedAt,
	};
}

function sanitizeCanonicalDate(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return parsed.toISOString();
}

function buildTargetCandidates(targetUrl: URL): string[] {
	const normalized = targetUrl.toString();
	const withoutHash = new URL(targetUrl.toString());
	withoutHash.hash = "";
	const normalizedWithoutHash = withoutHash.toString();

	const candidates = new Set<string>([normalized, normalizedWithoutHash]);
	if (normalizedWithoutHash.endsWith("/")) {
		candidates.add(normalizedWithoutHash.replace(/\/+$/u, ""));
	} else {
		candidates.add(`${normalizedWithoutHash}/`);
	}

	return [...candidates].filter(Boolean);
}

function sourceContainsTargetLink(html: string, targetUrl: URL): boolean {
	const candidates = buildTargetCandidates(targetUrl);
	return candidates.some((candidate) => {
		const pattern = new RegExp(
			`<a\\b[^>]*\\bhref\\s*=\\s*["'][^"']*${escapeRegExp(candidate)}[^"']*["']`,
			"iu",
		);
		return pattern.test(html) || html.includes(candidate);
	});
}

function isRedirectStatus(status: number): boolean {
	return [301, 302, 303, 307, 308].includes(status);
}

async function readResponseTextWithLimit(
	response: Response,
	maxBytes: number,
): Promise<string | null> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		return null;
	}

	if (!response.body) {
		return "";
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}

		if (!value) {
			continue;
		}

		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel();
			return null;
		}

		chunks.push(value);
	}

	const decoder = new TextDecoder();
	let text = "";
	for (const chunk of chunks) {
		text += decoder.decode(chunk, { stream: true });
	}
	text += decoder.decode();

	return text;
}

type SourceHtmlFetchResult =
	| { ok: true; html: string }
	| { ok: false; error: string };

async function fetchSourceHtml(sourceUrl: URL): Promise<SourceHtmlFetchResult> {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => {
		abortController.abort();
	}, WEBMENTION_FETCH_TIMEOUT_MS);

	try {
		let currentUrl = new URL(sourceUrl.toString());

		for (
			let redirectCount = 0;
			redirectCount <= WEBMENTION_MAX_REDIRECTS;
			redirectCount += 1
		) {
			const validationError = validateSourceUrl(currentUrl);
			if (validationError) {
				return { ok: false, error: validationError };
			}

			let response: Response;
			try {
				response = await fetch(currentUrl.toString(), {
					headers: {
						Accept: "text/html,application/xhtml+xml",
						"User-Agent": "cf-astro-blog-starter-webmention/1.0",
					},
					redirect: "manual",
					signal: abortController.signal,
				});
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					return { ok: false, error: "Hết thời gian khi tìm nạp trang source." };
				}
				return { ok: false, error: "Tìm nạp trang source thất bại." };
			}

			if (isRedirectStatus(response.status)) {
				const location = response.headers.get("location");
				if (!location) {
					return { ok: false, error: "Phản hồi chuyển hướng source thiếu location." };
				}

				try {
					currentUrl = new URL(location, currentUrl);
				} catch {
					return { ok: false, error: "Địa chỉ chuyển hướng source không hợp lệ." };
				}
				continue;
			}

			if (!response.ok) {
				return { ok: false, error: "Không thể truy cập trang source." };
			}

			const contentType = response.headers.get("content-type") || "";
			if (
				!contentType.includes("text/html") &&
				!contentType.includes("application/xhtml+xml")
			) {
				return { ok: false, error: "source phải là trang HTML." };
			}

			const html = await readResponseTextWithLimit(
				response,
				WEBMENTION_MAX_HTML_BYTES,
			);
			if (html === null) {
				return { ok: false, error: "Trang source có kích thước quá lớn, đã từ chối xử lý." };
			}

			return { ok: true, html };
		}

		return { ok: false, error: "Source chuyển hướng quá nhiều lần, đã từ chối xử lý." };
	} finally {
		clearTimeout(timeoutId);
	}
}

async function validateTargetPath(
	c: Context<AdminAppEnv>,
	targetUrl: URL,
): Promise<boolean> {
	const normalizedPath = normalizePathname(targetUrl.pathname);
	if (allowedStaticTargets.has(normalizedPath)) {
		return true;
	}

	const blogSlug = resolveBlogSlug(normalizedPath);
	if (!blogSlug) {
		return false;
	}

	const db = getDb(c.env.DB);
	const [post] = await db
		.select({ id: blogPosts.id })
		.from(blogPosts)
		.where(getPublicPostBySlugCondition(blogSlug))
		.limit(1);

	return Boolean(post);
}

webmentionRoutes.get("/", (c) =>
	c.text("Webmention endpoint: use POST with source and target fields."),
);

webmentionRoutes.post("/", async (c) => {
	const body = await c.req.parseBody();
	const source = sanitizeCanonicalUrl(getBodyText(body, "source"));
	const target = sanitizeCanonicalUrl(getBodyText(body, "target"));

	if (!source || !target) {
		return c.text(
			"Tham số source và target không được để trống, và phải là URL http/https hợp lệ.",
			400,
		);
	}

	let sourceUrl: URL;
	let targetUrl: URL;
	try {
		sourceUrl = new URL(source);
		targetUrl = new URL(target);
	} catch {
		return c.text("Phân tích URL source hoặc target thất bại.", 400);
	}

	if (targetUrl.origin !== targetOrigin) {
		return c.text("target phải là trang trên trang web này.", 400);
	}

	const sourceValidationError = validateSourceUrl(sourceUrl);
	if (sourceValidationError) {
		return c.text(sourceValidationError, 400);
	}

	const targetPath = normalizePathname(targetUrl.pathname);
	if (targetPath.startsWith("/api/") || targetPath.startsWith("/admin")) {
		return c.text("target không được trỏ đến đường dẫn backend hoặc API.", 400);
	}

	const targetAllowed = await validateTargetPath(c, targetUrl);
	if (!targetAllowed) {
		return c.text("Trang target không tồn tại hoặc không nằm trong phạm vi cho phép nhận Webmention.", 400);
	}

	const sourceResult = await fetchSourceHtml(sourceUrl);
	if (!sourceResult.ok) {
		return c.text(sourceResult.error, 400);
	}
	const sourceHtml = sourceResult.html;

	if (!sourceContainsTargetLink(sourceHtml, targetUrl)) {
		return c.text("Không tìm thấy liên kết đến target trong trang source.", 400);
	}

	const metadata = extractSourceMetadata(sourceHtml);
	const now = new Date().toISOString();
	const db = getDb(c.env.DB);

	await db
		.insert(webMentions)
		.values({
			sourceUrl: sourceUrl.toString(),
			targetUrl: targetUrl.toString(),
			sourceTitle: metadata.sourceTitle,
			sourceExcerpt: metadata.sourceExcerpt,
			sourceAuthor: metadata.sourceAuthor,
			sourcePublishedAt: metadata.sourcePublishedAt,
			status: "pending",
			reviewNote: null,
			reviewedAt: null,
			lastCheckedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [webMentions.sourceUrl, webMentions.targetUrl],
			set: {
				sourceTitle: metadata.sourceTitle,
				sourceExcerpt: metadata.sourceExcerpt,
				sourceAuthor: metadata.sourceAuthor,
				sourcePublishedAt: metadata.sourcePublishedAt,
				status: "pending",
				reviewNote: null,
				reviewedAt: null,
				lastCheckedAt: now,
				updatedAt: now,
			},
		});

	return c.text("Đã nhận Webmention, đang chờ xem xét.", 202);
});

export { webmentionRoutes };
